// Single-ride map, segment selector and synchronized raw-sample charts.
import { mountMapInset } from './map-inset.js?v=2.0.4';
import { PanelChart } from './charts.js?v=2.0.4';
import { makeMap, canvasOverlay, laneScreen, drawLane, kmMarkers, dot, badge, fitTo } from './maps.js?v=2.0.4';
import { SENSORS, activeSeconds, sensorMeans, hasSensor } from './samples.js?v=2.0.4';
import { interp, lastLE } from './util.js?v=2.0.4';
import { inWindows } from './ride.js?v=2.0.4';
import { el, fmtTime, tok, speedColor, SPEED_RAMP_STOPS } from './theme.js?v=2.0.4';

const LAP_COLORS = ['#086b91', '#ad451c', '#7750a4', '#127153', '#a22f68', '#786017', '#3c59ae', '#495f63'];
const rounded = (v, unit, digits = 0) => Number.isFinite(v) ? `${v.toFixed(digits)} ${unit}` : '—';

export function buildRideExplorer(host, ride, terrain, { vlo, vhi, clsColor }) {
  const G = ride.grid, { samples } = ride;
  const offset = (ride.trackStart - ride.start) / 1000;
  const trackTime = ride.t.map(t => t + offset);
  const gridTime = G.t.map(t => t + offset);
  const whole = { name: '全程', a: 0, b: ride.session?.elapsed ?? Math.max(trackTime.at(-1), samples.t.at(-1)),
    distance: ride.session?.distance ?? ride.total, timer: ride.session?.timer ?? ride.moving, device: ride.session };
  const laps = ride.laps.map((lap, i) => ({
    name: `Lap ${i + 1}`, color: LAP_COLORS[i % LAP_COLORS.length], device: lap,
    a: (lap.start - ride.start) / 1000, b: (lap.end - ride.start) / 1000,
    distance: lap.distance, timer: lap.timer,
  }));
  const hills = terrain.map(s => ({
    name: `#${s.name} ${s.cls.label}`, mark: s.name, color: clsColor(s.cls),
    a: gridTime[s.i0], b: gridTime[s.i1], distance: s.d1 - s.d0, timer: s.t,
  }));
  const hasDeviceSpeed = samples.records.some(p => Number.isFinite(p.speed));
  const trackSpeed = hasDeviceSpeed ? ride.trackSpeed : ride.v;
  const sortedSpeeds = Array.from(trackSpeed).filter(Number.isFinite).sort((a, b) => a - b);
  const speedLo = sortedSpeeds[Math.floor(sortedSpeeds.length * 0.05)] ?? vlo;
  const speedHi = sortedSpeeds[Math.floor(sortedSpeeds.length * 0.95)] ?? vhi;
  let peak = Math.max(0, lastLE(ride.d, ride.vmaxD));
  if (hasDeviceSpeed) {
    peak = -1;
    trackSpeed.forEach((v, i) => {
      if (Number.isFinite(v) && (peak < 0 || v > trackSpeed[peak])) peak = i;
    });
  }
  const speed = Float64Array.from(samples.records, (p, i) =>
    hasDeviceSpeed ? p.speed : interp(samples.t[i], trackTime, ride.v));
  const altitude = Float64Array.from(samples.records, p => p.ele);
  // Use the device distance stream only if it provides a complete, monotonic axis.
  const hasDeviceDistance = samples.records.every((p, i, arr) =>
    Number.isFinite(p.distance) && (!i || p.distance >= arr[i - 1].distance));
  const distance = Float64Array.from(samples.records, (p, i) =>
    hasDeviceDistance ? p.distance : interp(samples.t[i], trackTime, ride.d));
  const gpsAt = (t) => {
    if (t < trackTime[0] || t > trackTime.at(-1)) return null;
    const i = lastLE(trackTime, t), j = i + 1;
    if (t === trackTime[i] || j >= ride.n) return [ride.lat[i], ride.lon[i]];
    if (ride.paused[j] || trackTime[j] - trackTime[i] > samples.maxGap) return null;
    const f = (t - trackTime[i]) / (trackTime[j] - trackTime[i]);
    return [ride.lat[i] + f * (ride.lat[j] - ride.lat[i]), ride.lon[i] + f * (ride.lon[j] - ride.lon[i])];
  };
  const intervals = samples.timerIntervals;
  const active = intervals ? (a, b) => activeSeconds(intervals, a, b) : null;
  const sensorKeys = Object.keys(SENSORS).filter(key => key !== 'temp' && hasSensor(ride, key));
  const readSegment = (part) => {
    const measured = sensorMeans(samples, part.a, part.b, active);
    const length = part.distance ?? interp(part.b, trackTime, ride.d) - interp(part.a, trackTime, ride.d);
    const timer = part.timer ?? (active ? active(part.a, part.b) : part.b - part.a);
    return [rounded(length / 1000, 'km', 2), fmtTime(timer), fmtTime(part.b - part.a),
      ...sensorKeys.map(key => rounded(part.device?.[key] ?? measured[key], SENSORS[key].unit))];
  };
  const sec = el('section', { class: 'rsec ride-explorer' }, el('h2', {}, '路線與騎乘曲線'));
  const modeBar = el('div', { class: 'ride-controls', role: 'group', 'aria-label': '分段方式' });
  const lapBar = el('div', { class: 'ride-controls', role: 'group', 'aria-label': '查看分段' });
  const mapEl = el('div', { class: 'map' });
  const detailToggle = el('input', { type: 'checkbox' });
  detailToggle.checked = window.matchMedia('(min-width: 900px)').matches;
  const detailMapEl = el('div', { class: 'map ride-detail-map', role: 'img', 'aria-label': '局部放大地圖' });
  const detailStatus = el('span', { class: 'ride-detail-status' });
  const detailHandle = el('button', { type: 'button', class: 'ride-detail-handle',
    title: '拖曳或使用方向鍵移動局部地圖', 'aria-label': '移動局部地圖，可用方向鍵' }, '局部放大');
  const detailAuto = el('button', { type: 'button', class: 'ride-detail-auto', title: '恢復自動位置',
    'aria-label': '恢復局部地圖自動位置', disabled: true }, '自動');
  const detailPane = el('div', { class: 'ride-detail-pane' },
    el('div', { class: 'ride-detail-label' }, detailHandle, detailStatus, detailAuto), detailMapEl);
  detailPane.hidden = !detailToggle.checked;
  const mapGroup = el('div', { class: 'ride-map-group' }, mapEl, detailPane);
  const legend = el('div', { class: 'legend' });
  const axisBar = el('div', { class: 'ride-controls', role: 'group', 'aria-label': '圖表橫軸' });
  const metricBar = el('div', { class: 'ride-metrics', 'aria-live': 'polite' });
  const chartEl = el('div', { class: 'chart ride-plot' });
  const hasTemperature = !!samples.sensors.temp;
  const temperature = el('input', { type: 'checkbox' });
  temperature.checked = hasTemperature && window.matchMedia('(min-width: 900px) and (min-height: 840px)').matches;
  const range = el('input', { type: 'range', step: '1', 'aria-label': '查看曲線與地圖位置' });
  const reading = el('div', { class: 'ride-reading', 'aria-label': '游標讀值' });
  const channels = [
    ['時間', i => fmtTime(samples.t[i])],
    ['距離', i => rounded(distance[i] / 1000, 'km', 2)],
    ['速度', i => rounded(speed[i], 'km/h', 1)],
    ...sensorKeys.filter(key => samples.sensors[key]).map(key =>
      [SENSORS[key].name, i => rounded(samples.sensors[key][i], SENSORS[key].unit)]),
    ...(altitude.some(Number.isFinite) ? [['海拔', i => rounded(altitude[i], 'm')]] : []),
    ...(hasTemperature ? [['溫度', i => rounded(samples.sensors.temp[i], '°C')]] : []),
  ];
  const values = channels.map(([label]) => {
    const value = el('strong', {}, '—');
    reading.append(el('div', {}, el('span', {}, label), value));
    return value;
  });
  const table = el('div', { class: 'tablewrap' });
  sec.append(
    el('div', { class: 'ride-toolbar noprint' }, modeBar, axisBar,
      hasTemperature ? el('label', { class: 'chk ride-temperature' }, temperature, '溫度曲線') : null,
      el('label', { class: 'chk' }, detailToggle, '局部地圖')),
    lapBar, metricBar,
    el('div', { class: 'ride-stage' },
      el('div', { class: 'ride-map-pane' }, mapGroup,
        el('div', { class: 'ride-map-meta' }, legend,
          el('button', { class: 'btn noprint', onclick: fitSelected }, '重設地圖'))),
      el('div', { class: 'ride-chart-pane' }, chartEl,
        el('div', { class: 'ride-scrubber noprint' }, range), reading)),
    table);
  host.append(sec);

  const map = makeMap(mapEl);
  let mode = laps.length > 1 ? 'lap' : 'terrain';
  let axis = mode === 'lap' ? 'time' : 'distance';
  let selected = whole, cursor = null, chart;
  const parts = () => mode === 'lap' ? laps : hills;
  const labels = ['距離', '計時', '經過', ...sensorKeys.map(key => `平均${SENSORS[key].name}`)];
  const selector = (label, pressed, callback, color) => el('button', {
    class: 'btn', 'aria-pressed': String(pressed), onclick: callback,
    style: color ? `--segment-color:${color}` : undefined,
  }, label);

  const pointSlices = (a, b) => {
    let from = Math.max(0, lastLE(trackTime, a));
    if (trackTime[from] < a) from++;
    const to = lastLE(trackTime, b) + 1;
    const slices = [];
    for (let i = from + 1; i < to; i++) {
      if (ride.paused[i] || ride.dt[i] > samples.maxGap) {
        if (i > from) slices.push([from, i]);
        from = i;
      }
    }
    if (to > from) slices.push([from, to]);
    return slices;
  };
  let tracks = [], visible = [];
  let detailMap, detailOverlay, detailFrame = null, detailFocus = null, previousDetailPoint = null;
  const inset = mountMapInset({
    map, overview: mapEl, pane: detailPane, handle: detailHandle, autoButton: detailAuto,
    paths: () => tracks.map(track => Array.from(track.lat, (lat, i) => map.latLngToContainerPoint([lat, track.lon[i]]))),
  });
  function updateTracks() {
    visible = pointSlices(selected.a, selected.b);
    const layers = mode === 'lap' && selected === whole ? laps : [selected];
    tracks = layers.flatMap(part => pointSlices(part.a, part.b).map(([a, b]) => ({
      a, lat: ride.lat.subarray(a, b), lon: ride.lon.subarray(a, b), color: mode === 'lap' ? part.color : null,
    })));
  }
  function trackColor(track, i) {
    const v = trackSpeed[i];
    const missing = !Number.isFinite(v) || (!hasDeviceSpeed && inWindows(ride.d[i], ride.glitches));
    return track.color ?? (missing ? tok('neutral') : speedColor(v, speedLo, speedHi));
  }

  const overlay = canvasOverlay(map, (ctx) => {
    for (const track of tracks) {
      const lane = laneScreen(map, track.lat, track.lon, 4);
      drawLane(ctx, lane, {
        width: 5,
        colorAt: i => trackColor(track, track.a + i),
      });
      if (mode === 'terrain') kmMarkers(ctx, lane, i => ride.d[track.a + i], ride.total);
    }
    const project = (p) => map.latLngToContainerPoint(p);
    for (const part of selected === whole ? parts() : [selected]) {
      const p = gpsAt((part.a + part.b) / 2);
      if (!p) continue;
      const { x, y } = project(p);
      badge(ctx, x + 13, y - 12, part.mark ?? part.name, part.color);
    }
    if (selected === whole) {
      const p = project([ride.lat[0], ride.lon[0]]);
      dot(ctx, p.x, p.y, '#3fae49', 6);
      for (const stop of ride.stops) {
        const s = project([ride.lat[stop.i0], ride.lon[stop.i0]]);
        ctx.fillStyle = tok('red'); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.fillRect(s.x - 5, s.y - 5, 10, 10); ctx.strokeRect(s.x - 5, s.y - 5, 10, 10);
      }
      if (mode === 'terrain' && peak >= 0) {
        const max = project([ride.lat[peak], ride.lon[peak]]);
        ctx.fillStyle = tok('ink'); ctx.beginPath(); ctx.moveTo(max.x, max.y - 9);
        ctx.lineTo(max.x + 8, max.y + 6); ctx.lineTo(max.x - 8, max.y + 6); ctx.closePath(); ctx.fill();
      }
    }
    const p = cursor == null ? null : gpsAt(cursor);
    if (p) { const { x, y } = project(p); dot(ctx, x, y, tok('ink'), 6); }
  });

  function drawDetail(ctx) {
    if (!detailFocus) return;
    const { point, index } = detailFocus;
    const from = Math.max(0, lastLE(ride.d, ride.d[index] - 340));
    const to = lastLE(ride.d, ride.d[index] + 340) + 1;
    for (const track of tracks) {
      const a = Math.max(track.a, from), b = Math.min(track.a + track.lat.length, to);
      if (b - a < 2) continue;
      const lane = laneScreen(detailMap, ride.lat.subarray(a, b), ride.lon.subarray(a, b), 3);
      drawLane(ctx, lane, { width: 4, colorAt: i => trackColor(track, a + i) });
    }
    const { x, y } = detailMap.latLngToContainerPoint(point);
    dot(ctx, x, y, tok('ink'), 5);
  }

  function updateDetail() {
    if (!detailToggle.checked || detailFrame != null) return;
    detailFrame = requestAnimationFrame(() => {
      detailFrame = null;
      const first = visible[0]?.[0];
      const point = cursor == null
        ? (first == null ? null : [ride.lat[first], ride.lon[first]])
        : gpsAt(cursor);
      const status = point ? '' : '無 GPS';
      if (detailStatus.textContent !== status) detailStatus.textContent = status;
      if (!point) {
        detailFocus = null;
        detailOverlay?.redraw();
        return;
      }
      detailFocus = { point, index: cursor == null ? first : lastLE(trackTime, cursor) };
      if (!detailMap) {
        detailMap = makeMap(detailMapEl, { interactive: false });
        detailMap.setView(point, 17, { animate: false });
        detailOverlay = canvasOverlay(detailMap, drawDetail);
      } else if (point.some((coordinate, i) => coordinate !== previousDetailPoint[i])) {
        detailMap.setView(point, 17, { animate: false });
      }
      previousDetailPoint = point;
      detailOverlay.redraw();
    });
  }

  function showSample(i) {
    cursor = i == null ? null : samples.t[i];
    const readings = channels.map(([label, get]) => i == null ? '—' : get(i));
    values.forEach((value, j) => { value.textContent = readings[j]; });
    if (i != null) {
      range.value = i;
      range.setAttribute('aria-valuetext', channels.map(([label], j) => `${label} ${readings[j]}`).join('，'));
    }
    overlay.redraw();
    updateDetail();
  }

  function drawChart(sample = null) {
    chart?.destroy();
    showSample(null);
    const a = Math.max(0, lastLE(samples.t, selected.a - 0.0001) + 1);
    // The FIT timestamp at a lap boundary belongs to the next lap.
    const end = selected === whole || selected === laps.at(-1) ? selected.b : selected.b - 0.0001;
    const b = lastLE(samples.t, end) + 1;
    range.min = a; range.max = Math.max(a, b - 1); range.value = a; range.disabled = b - a < 2;
    range.removeAttribute('aria-valuetext');
    if (b <= a) {
      chart = null;
      chartEl.textContent = '這段沒有可用的取樣資料。';
      return;
    }
    chartEl.textContent = '';
    const isTime = axis === 'time';
    const xStart = isTime ? selected.a : distance[a] / 1000;
    const x = isTime ? samples.t.slice(a, b).map(v => v - xStart) : distance.slice(a, b).map(v => v / 1000 - xStart);
    const xMax = Math.max(isTime ? selected.b - xStart : x.at(-1), 0.001);
    const breaks = samples.t.slice(a, b).map((t, i) => {
      if (!i) return 0;
      const previous = samples.t[a + i - 1];
      return t - previous > samples.maxGap || (active && active(previous, t) < t - previous - 0.001);
    });
    const series = [
      ['power', samples.sensors.power, '功率', 'W', 'up'],
      ['hr', samples.sensors.hr, '心率', 'bpm', 'red'],
      ['speed', speed, '速度', 'km/h', 'blue'],
      ['cad', samples.sensors.cad, '踏頻', 'rpm', 'down'],
      ['altitude', altitude, '海拔', 'm', 'muted'],
      ['temp', temperature.checked ? samples.sensors.temp : null, '溫度', '°C', 'fair'],
    ];
    const panels = series.flatMap(([key, data, name, unit, color]) => {
      const y = data?.subarray(a, b);
      return y?.some(Number.isFinite) ? [{
        h: key === 'power' || key === 'speed' ? 130 : 100, label: `${name} ${unit}`,
        yMin: ['power', 'speed', 'cad'].includes(key) ? 0 : undefined,
        series: [{ y, name, color: tok(color), area: key === 'altitude', fmt: v => rounded(v, unit, key === 'speed' ? 1 : 0) }],
      }] : [];
    });
    const xAt = (t) => isTime ? t - xStart : interp(t, samples.t, distance) / 1000 - xStart;
    const boundaries = selected === whole ? parts() : [];
    chart = new PanelChart(chartEl, {
      x, xMax, panels, breaks, fitHeight: true, fixedReading: true, breakGap: Math.max(isTime ? samples.maxGap : 0.05, xMax / 40),
      xFormat: v => isTime ? fmtTime(v + xStart) : rounded(v + xStart, 'km', 2),
      xTick: isTime ? fmtTime : v => rounded(v + xStart, 'km', 2),
      vlines: boundaries.slice(1).map(p => xAt(p.a)).filter(v => v > 0 && v < xMax),
      tops: boundaries.map(p => ({ x: xAt((p.a + p.b) / 2), text: p.mark ?? p.name })),
      onHover: (_, i) => showSample(i == null ? null : a + i),
    });
    if (sample != null && sample >= a && sample < b) {
      chart.cursor = sample - a;
      showSample(sample);
    }
    chart.draw();
  }

  function drawTable() {
    if (mode !== 'lap') { table.replaceChildren(); return; }
    table.replaceChildren(el('table', { class: 'segtable' },
      el('thead', {}, el('tr', {}, el('th', {}, '分段'), ...labels.map(label => el('th', { class: 'n' }, label)))),
      el('tbody', {}, laps.map(part => el('tr', { class: part === selected ? 'sel' : '' },
        el('td', {}, selector(part.name, part === selected, () => select(part, true), part.color)),
        ...readSegment(part).map(v => el('td', { class: 'n' }, v)))))));
  }

  function drawSelectors() {
    modeBar.replaceChildren(...(laps.length > 1 ? [selector('碼錶 Lap', mode === 'lap', () => changeMode('lap'))] : []),
      selector('地形分段', mode === 'terrain', () => changeMode('terrain')));
    const scrollLeft = lapBar.scrollLeft;
    lapBar.replaceChildren(...[whole, ...parts()].map(part =>
      selector(part.name, selected === part, () => select(part), part.color)));
    lapBar.scrollLeft = scrollLeft;
    axisBar.replaceChildren(selector('時間軸', axis === 'time', () => changeAxis('time')),
      selector('距離軸', axis === 'distance', () => changeAxis('distance')));
  }
  function changeMode(next) { if (next !== mode) { mode = next; select(whole); } }
  function changeAxis(next) {
    if (next === axis) return;
    axis = next;
    [...axisBar.children].forEach((button, i) => button.setAttribute('aria-pressed', String(i === (axis === 'time' ? 0 : 1))));
    drawChart(cursor == null ? null : +range.value);
  }

  function select(part, scroll = false) {
    selected = part ?? whole;
    updateTracks();
    drawSelectors();
    const values = readSegment(selected);
    const timeLabel = Number.isFinite(selected.device?.timer) ? '碼錶計時'
      : selected === whole || mode === 'terrain' ? '移動時間' : '計時';
    metricBar.replaceChildren(el('strong', {}, selected.name),
      ...values.map((v, i) => el('span', {}, `${i === 1 ? timeLabel : labels[i]} `, el('b', {}, v))));
    legend.replaceChildren(
      ...(mode === 'terrain' ? [el('span', {}, rounded(speedLo, 'km/h')),
        el('i', { class: 'ride-speed-ramp', style: `background:linear-gradient(90deg,${SPEED_RAMP_STOPS.join(',')})` }),
        el('span', {}, rounded(speedHi, 'km/h')),
        el('span', {}, hasDeviceSpeed ? '▲ 有定位的最高速　灰色＝缺速度' : '▲ 最高速　灰色＝GPS 飄移')] : []),
      el('span', {}, '● 起點　■ 停車'),
      !visible.length ? el('span', {}, '這段沒有 GPS 定位') : null);
    fitSelected();
    inset.refresh();
    drawChart();
    drawTable();
    if (scroll) sec.scrollIntoView({ block: 'start' });
  }

  function fitSelected() {
    if (visible.length) {
      const from = visible[0][0], to = visible.at(-1)[1];
      fitTo(map, ride.lat.subarray(from, to), ride.lon.subarray(from, to));
    } else {
      fitTo(map, ride.lat, ride.lon);
    }
  }

  const mapObserver = new ResizeObserver(entries => {
    if (entries.some(entry => entry.target === mapEl)) fitSelected();
    if (entries.some(entry => entry.target === detailMapEl) && detailToggle.checked) {
      detailMap?.invalidateSize({ pan: false });
      inset.refresh();
      updateDetail();
    }
  });
  mapObserver.observe(mapEl);
  mapObserver.observe(detailMapEl);
  detailToggle.addEventListener('change', () => {
    detailPane.hidden = !detailToggle.checked;
    if (detailToggle.checked) {
      detailMap?.invalidateSize({ pan: false });
      inset.refresh();
      updateDetail();
    } else if (detailFrame != null) {
      cancelAnimationFrame(detailFrame);
      detailFrame = null;
    }
  });
  temperature.addEventListener('change', () => drawChart(cursor == null ? null : +range.value));

  range.addEventListener('input', () => {
    const i = +range.value;
    if (!chart) return;
    chart.cursor = i - Number(range.min);
    chart.draw();
    showSample(i);
  });
  select(whole);
  return {
    selectTerrain: (i) => { mode = 'terrain'; select(hills[i], true); },
    destroy: () => {
      mapObserver.disconnect();
      inset.destroy();
      if (detailFrame != null) cancelAnimationFrame(detailFrame);
      chart?.destroy();
      detailMap?.remove();
      map.remove();
    },
  };
}
