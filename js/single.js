// Single-ride report.
import { kmSplits, speedByGrade, GRID } from './ride.js';
import { PanelChart, groupedBars } from './charts.js';
import { makeMap, canvasOverlay, laneScreen, drawLane, kmMarkers, dot, badge, fitTo } from './maps.js';
import { mountPlayer } from './player.js';
import { tok, rgba, el, fmtTime, fmtDate, speedColor, SPEED_RAMP_STOPS } from './theme.js';
import { inWindows } from './ride.js';

const clsColor = (c) => c.key.includes('up') ? tok('up') : c.key.includes('down') ? tok('down') : tok('flat');

export function buildSingle(host, ride) {
  host.innerHTML = '';
  const G = ride.grid, km = Array.from(G.d, v => v / 1000);
  const segs = ride.segments.map((s, k) => ({ ...s, n: k + 1, name: String(k + 1),
    t: G.mt[s.i1] - G.mt[s.i0], v: (s.d1 - s.d0) / Math.max(G.mt[s.i1] - G.mt[s.i0], 1) * 3.6 }));
  // speed colour range: 5th..95th percentile
  const vs = Array.from(G.v).filter(Number.isFinite).sort((a, b) => a - b);
  const vlo = vs[Math.floor(vs.length * 0.05)], vhi = vs[Math.floor(vs.length * 0.95)];
  const stopT = ride.stops.reduce((a, s) => a + s.dur, 0);

  // ---- header + tiles
  host.append(el('section', { class: 'rsec' },
    el('h2', {}, `單趟分析：${ride.name || ride.fileName}`),
    el('p', { class: 'lead' }, `${fmtDate(ride.start)}｜${ride.fileName}`),
    el('div', { class: 'tiles' },
      tile('距離', (ride.total / 1000).toFixed(2), 'km'),
      tile('移動時間', fmtTime(ride.moving), '', `經過時間 ${fmtTime(ride.elapsed)}`),
      tile('均速', ride.avg.toFixed(1), 'km/h', '距離 ÷ 移動時間'),
      tile('最高速', ride.vmax.toFixed(1), 'km/h', `在 ${(ride.vmaxD / 1000).toFixed(2)} km（7 秒平滑）`),
      tile('爬升', Math.round(ride.gain), 'm', `海拔 ${Math.round(ride.eleMin)}–${Math.round(ride.eleMax)} m`),
      tile('停車', ride.stops.length, '次', ride.stops.length ? `共 ${fmtTime(stopT)}` : '沒有停車'),
    ),
    el('p', { class: 'note' }, '爬升用本工具的演算法計算，可能和 Strava 顯示的差幾公尺。')));

  // ---- map
  const mapSec = el('section', { class: 'rsec' }, el('h2', {}, '地圖：每個位置的速度'),
    el('p', { class: 'lead' }, '顏色越深越快。去回同一條路時，兩個方向會分開畫在各自行進方向的右側。圓圈數字＝公里數，方框＝分段編號（對應下方分段表）。'));
  const mapEl = el('div', { class: 'map' }); mapSec.append(mapEl, speedLegend(vlo, vhi)); host.append(mapSec);
  const map = makeMap(mapEl); fitTo(map, G.lat, G.lon);
  let cursorKm = null;
  const ovl = canvasOverlay(map, (ctx) => {
    const lane = laneScreen(map, G.lat, G.lon, 5);
    drawLane(ctx, lane, { width: 5, colorAt: (i) => inWindows(G.d[i], ride.glitches) ? rgba(tok('neutral'), .95) : speedColor(G.v[i], vlo, vhi) });
    kmMarkers(ctx, lane, (i) => G.d[i], ride.total);
    const P = (d) => { const i = Math.min(G.d.length - 1, Math.round(d / GRID)); return map.latLngToContainerPoint([G.lat[i], G.lon[i]]); };
    for (const s of segs) { const p = P((s.d0 + s.d1) / 2); badge(ctx, p.x + 16, p.y - 12, s.name, clsColor(s.cls)); }
    for (const st of ride.stops) { const p = P(st.d); ctx.fillStyle = tok('red'); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.rect(p.x - 6, p.y - 6, 12, 12); ctx.fill(); ctx.stroke(); }
    { const p = P(ride.vmaxD); ctx.fillStyle = '#1b201c'; ctx.beginPath(); ctx.moveTo(p.x, p.y - 9); ctx.lineTo(p.x + 8, p.y + 6); ctx.lineTo(p.x - 8, p.y + 6); ctx.closePath(); ctx.fill(); }
    { const p = P(0); dot(ctx, p.x, p.y, '#3fae49', 6); }
    if (cursorKm != null) { const p = P(cursorKm * 1000); dot(ctx, p.x, p.y, tok('ink'), 5); }
  });
  mapSec.append(el('div', { class: 'legend' }, el('span', {}, el('i', { class: 'dot', style: 'background:#3fae49' }), '起點'),
    el('span', {}, el('i', { style: `background:${tok('red')};width:10px;height:10px` }), '停車'), el('span', {}, '▲ 最高速位置'),
    el('span', {}, el('i', { style: `background:${tok('neutral')}` }), 'GPS 飄移（速度不可信）')));

  // ---- profile chart
  const chartSec = el('section', { class: 'rsec' }, el('h2', {}, '海拔與速度剖面'),
    el('p', { class: 'lead' }, '滑鼠移到圖上，地圖會標出同一個位置。虛線是分段分界，上方數字是分段編號。'));
  const chartEl = el('div', { class: 'chart' }); chartSec.append(chartEl); host.append(chartSec);
  const panels = [
    { h: 130, label: '海拔 m', series: [{ y: G.ele, color: tok('muted'), area: true, name: '海拔', fmt: v => v.toFixed(0) + ' m' }] },
    { h: 170, label: '速度 km/h', yMin: 0, series: [{ y: G.v, color: tok('blue'), name: '速度', fmt: v => v.toFixed(1) + ' km/h' }] },
  ];
  const extra = { hr: ['心率', 'bpm', tok('red')], cad: ['踏頻', 'rpm', tok('down')], power: ['功率', 'W', tok('up')], temp: ['溫度', '°C', tok('muted')] };
  for (const k in extra) if (G[k]) panels.push({ h: 100, label: `${extra[k][0]} ${extra[k][1]}`, series: [{ y: G[k], color: extra[k][2], name: extra[k][0], fmt: v => v.toFixed(0) + ' ' + extra[k][1] }] });
  const chart = new PanelChart(chartEl, { x: km, xMax: km[km.length - 1], panels, shades: ride.glitches.map(([a, b]) => [a / 1000, b / 1000]),
    vlines: segs.slice(0, -1).map(s => s.d1 / 1000), tops: segs.map(s => ({ x: (s.d0 + s.d1) / 2000, text: s.name })),
    tipExtra: (i) => `坡度 ${G.grade[i].toFixed(1)}%`,
    onHover: (k) => { cursorKm = k; ovl.redraw(); } });
  chart.draw();

  // ---- segments
  const segSec = el('section', { class: 'rsec' }, el('h2', {}, '自動分段'),
    el('p', { class: 'lead' }, '依海拔起伏自動切段（短於 500 m 的起伏會併入相鄰路段；去回路線會在折返點切開）。長條＝該段平均速度，顏色＝坡度類型。'));
  const barEl = el('div', { class: 'bars' }); segSec.append(barEl);
  groupedBars(barEl, { cats: segs.map(s => [`#${s.name}`, s.cls.label, `${s.grade >= 0 ? '+' : ''}${s.grade.toFixed(1)}%`]),
    series: [{ name: '均速', color: segs.map(s => clsColor(s.cls)), values: segs.map(s => s.v) }], yLabel: '平均速度 km/h' });
  const tb = el('table', { class: 'segtable' }, el('thead', {}, el('tr', {}, ...['#', '類型', '範圍 km', '長度', '海拔 m', '坡度', '用時', '均速', '爬升率'].map((h, i) => el('th', { class: i > 1 ? 'n' : '' }, h)))),
    el('tbody', {}, segs.map(s => el('tr', {}, el('td', {}, el('span', { class: 'badge', style: `background:${clsColor(s.cls)}` }, s.name)), el('td', {}, s.cls.label),
      el('td', { class: 'n' }, `${(s.d0 / 1000).toFixed(2)}–${(s.d1 / 1000).toFixed(2)}`), el('td', { class: 'n' }, `${((s.d1 - s.d0) / 1000).toFixed(2)} km`),
      el('td', { class: 'n' }, `${Math.round(s.z0)}→${Math.round(s.z1)}`), el('td', { class: 'n' }, `${s.grade >= 0 ? '+' : ''}${s.grade.toFixed(1)}%`),
      el('td', { class: 'n' }, fmtTime(s.t)), el('td', { class: 'n' }, s.v.toFixed(1) + ' km/h'),
      el('td', { class: 'n' }, s.z1 > s.z0 + 3 ? Math.round((s.z1 - s.z0) / s.t * 3600) + ' m/h' : '—')))));
  segSec.append(el('div', { class: 'tablewrap' }, tb)); host.append(segSec);

  // ---- km splits + grade bins
  const splits = kmSplits(ride);
  const spSec = el('section', { class: 'rsec' }, el('h2', {}, '每公里用時'), el('p', { class: 'lead' }, '長條高度＝該公里的平均速度，上方是用時（移動時間）。'));
  const spEl = el('div', { class: 'bars' }); spSec.append(spEl); host.append(spSec);
  groupedBars(spEl, { cats: splits.map(s => s.partial ? `${s.km.toFixed(2)}` : `${s.km}`), series: [{ name: '均速', color: tok('blue'), values: splits.map(s => s.dist / s.time * 3.6) }],
    above: splits.map(s => ({ text: fmtTime(s.time) })), yLabel: '平均速度 km/h', height: 260 });
  const gb = speedByGrade(ride);
  const gSec = el('section', { class: 'rsec' }, el('h2', {}, '依坡度分組的速度'), el('p', { class: 'lead' }, '把路線切成每 10 m 一格，依坡度分組計算平均速度（排除停車前後與 GPS 飄移）。這是你在這條路上的「速度指紋」，下次比較時可以對照。'));
  const gEl = el('div', { class: 'bars' }); gSec.append(gEl); host.append(gSec);
  groupedBars(gEl, { cats: gb.map(b => [b.label, `${(b.dist / 1000).toFixed(1)} km`]), series: [{ name: '均速', color: tok('blue'), values: gb.map(b => b.v) }], yLabel: '平均速度 km/h', height: 260 });

  // ---- stops
  if (ride.stops.length) {
    host.append(el('section', { class: 'rsec' }, el('h2', {}, '停車紀錄'),
      el('div', { class: 'tablewrap' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, '位置'), el('th', { class: 'n' }, '總停留'), el('th', { class: 'n' }, '靜止（計入移動時間）'), el('th', { class: 'n' }, '自動暫停（不計入）'))),
        el('tbody', {}, ride.stops.map(s => el('tr', {}, el('td', {}, `${(s.d / 1000).toFixed(2)} km`), el('td', { class: 'n' }, fmtTime(s.dur)), el('td', { class: 'n' }, fmtTime(s.still)), el('td', { class: 'n' }, fmtTime(s.paused)))))))));
  }

  // ---- replay
  const pSec = el('section', { class: 'rsec' }, el('h2', {}, '回放'), el('p', { class: 'lead' }, '依移動時間回放這一趟。右側鏡頭會跟著你移動。'));
  host.append(pSec);
  const pHost = el('div'); pSec.append(pHost);
  mountPlayer(pHost, {
    route: { lat: G.lat, lon: G.lon, ele: G.ele }, grid: G.d,
    riders: [{ short: '你', color: tok('blue'), T: G.mt, v: G.v, gradeAt: (s) => G.grade[Math.min(G.grade.length - 1, Math.round(s / GRID))] }],
    starts: [{ label: '出發', s: 0 }], segments: segs.map(s => ({ name: '#' + s.name, d0: s.d0, d1: s.d1 })), excl: [],
    colorAt: (s) => speedColor(G.v[Math.min(G.v.length - 1, Math.round(s / GRID))], vlo, vhi),
    note: ({ pos, done }) => {
      if (done[0]) return `完成：${(ride.total / 1000).toFixed(2)} km，移動時間 ${fmtTime(ride.moving)}。`;
      const st = ride.stops.find(s => Math.abs(s.d - pos[0]) < 40); if (st) return `在 ${(st.d / 1000).toFixed(2)} km 停車：共 ${fmtTime(st.dur)}（自動暫停 ${fmtTime(st.paused)} 不計入移動時間）。`;
      if (inWindows(pos[0], ride.glitches)) return '這段 GPS 飄移，速度讀數不準。';
      const sg = segs.find(s => pos[0] >= s.d0 && pos[0] <= s.d1); return sg ? `分段 #${sg.name}：${sg.cls.label} ${sg.grade >= 0 ? '+' : ''}${sg.grade.toFixed(1)}%，這段平均 ${sg.v.toFixed(1)} km/h。` : '';
    },
  });
}

function tile(k, v, unit, d) { return el('div', { class: 'tile' }, el('div', { class: 'k' }, k), el('div', { class: 'v', html: `${v}<small>${unit}</small>` }), d ? el('div', { class: 'd' }, d) : null); }
function speedLegend(lo, hi) {
  const grad = `linear-gradient(90deg, ${SPEED_RAMP_STOPS.join(',')})`;
  return el('div', { class: 'legend' }, el('span', {}, `${lo.toFixed(0)} km/h`), el('span', { style: `display:inline-block;width:180px;height:10px;border-radius:5px;background:${grad}` }), el('span', {}, `${hi.toFixed(0)} km/h`));
}
