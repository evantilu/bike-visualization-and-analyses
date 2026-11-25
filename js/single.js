// Single-ride report.
import { kmSplits, speedByGrade, GRID } from './ride.js';
import { groupedBars } from './charts.js';
import { mountPlayer } from './player.js';
import { tok, el, fmtTime, fmtDate, speedColor } from './theme.js';
import { inWindows } from './ride.js';
import { buildPowerSection } from './powerview.js';
import { buildRideExplorer } from './rideview.js';
import { hasSensor } from './samples.js';

const clsColor = (c) => c.key.includes('up') ? tok('up') : c.key.includes('down') ? tok('down') : tok('flat');

export function buildSingle(host, ride) {
  host.innerHTML = '';
  const G = ride.grid;
  const segs = ride.segments.map((s, k) => ({ ...s, n: k + 1, name: String(k + 1),
    t: G.mt[s.i1] - G.mt[s.i0], v: (s.d1 - s.d0) / Math.max(G.mt[s.i1] - G.mt[s.i0], 1) * 3.6 }));
  // speed colour range: 5th..95th percentile
  const vs = Array.from(G.v).filter(Number.isFinite).sort((a, b) => a - b);
  const vlo = vs[Math.floor(vs.length * 0.05)], vhi = vs[Math.floor(vs.length * 0.95)];
  const device = ride.session;
  const stopT = ride.stops.reduce((a, s) => a + s.dur, 0);

  // ---- header + tiles
  host.append(el('section', { class: 'rsec' },
    el('h2', {}, `單趟分析：${ride.name || ride.fileName}`),
    el('p', { class: 'lead' }, `${fmtDate(ride.start)}｜${ride.fileName}`),
    el('div', { class: 'tiles' },
      tile('距離', ((device?.distance ?? ride.total) / 1000).toFixed(2), 'km', Number.isFinite(device?.distance) ? '碼錶記錄' : undefined),
      tile(Number.isFinite(device?.timer) ? '碼錶計時' : '移動時間', fmtTime(device?.timer ?? ride.moving), '', `經過時間 ${fmtTime(device?.elapsed ?? ride.elapsed)}`),
      tile('均速', (device?.speed ?? ride.avg).toFixed(1), 'km/h', Number.isFinite(device?.speed) ? '碼錶記錄' : '距離 ÷ 移動時間'),
      tile('最高速', (device?.maxSpeed ?? ride.vmax).toFixed(1), 'km/h', Number.isFinite(device?.maxSpeed)
        ? '碼錶記錄' : `在 ${(ride.vmaxD / 1000).toFixed(2)} km（7 秒平滑）`),
      tile('爬升', Math.round(device?.ascent ?? ride.gain), 'm', `海拔 ${Math.round(ride.eleMin)}–${Math.round(ride.eleMax)} m`),
      tile('停車', ride.stops.length, '次', ride.stops.length ? `共 ${fmtTime(stopT)}` : '沒有停車'),
    ),
    el('p', { class: 'note' }, device ? `路線分析以 GPS 計算，移動時間 ${fmtTime(ride.moving)}，距離 ${(ride.total / 1000).toFixed(2)} km。` : '爬升依 GPS 海拔資料計算。')));

  const explorer = buildRideExplorer(host, ride, segs, { vlo, vhi, clsColor });

  if (!hasSensor(ride, 'power')) {
    const estimate = el('details', { class: 'rsec' }, el('summary', {}, '功率估算'));
    host.append(estimate);
    estimate.addEventListener('toggle', () => {
      if (estimate.open && estimate.children.length === 1) buildPowerSection(estimate, ride);
    });
  }

  // ---- segments
  const segSec = el('section', { class: 'rsec' }, el('h2', {}, '自動分段'),
    el('p', { class: 'lead' }, '依海拔起伏自動切段（短於 500 m 的起伏會併入相鄰路段；去回路線會在折返點切開）。長條＝該段平均速度，顏色＝坡度類型。'));
  const barEl = el('div', { class: 'bars' }); segSec.append(barEl);
  groupedBars(barEl, { cats: segs.map(s => [`#${s.name}`, s.cls.label, `${s.grade >= 0 ? '+' : ''}${s.grade.toFixed(1)}%`]),
    series: [{ name: '均速', color: segs.map(s => clsColor(s.cls)), values: segs.map(s => s.v) }], yLabel: '平均速度 km/h' });
  const tb = el('table', { class: 'segtable' }, el('thead', {}, el('tr', {}, ...['#', '類型', '範圍 km', '長度', '海拔 m', '坡度', '用時', '均速', '爬升率'].map((h, i) => el('th', { class: i > 1 ? 'n' : '' }, h)))),
    el('tbody', {}, segs.map(s => el('tr', {}, el('td', {}, el('button', { class: 'btn segment-link', onclick: () => explorer.selectTerrain(s.n - 1), 'aria-label': `定位地形分段 ${s.name}` }, s.name)), el('td', {}, s.cls.label),
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
    host.append(el('section', { class: 'rsec' }, el('h2', {}, '停車紀錄'), el('p', { class: 'lead' }, '停留 5 秒以上的地方。停在原地和暫停的時間都不計入移動時間。'),
      el('div', { class: 'tablewrap' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, '位置'), el('th', { class: 'n' }, '總停留'), el('th', { class: 'n' }, '停在原地'), el('th', { class: 'n' }, '暫停'))),
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
      const st = ride.stops.find(s => Math.abs(s.d - pos[0]) < 40); if (st) return `在 ${(st.d / 1000).toFixed(2)} km 停車 ${fmtTime(st.dur)}（不計入移動時間，回放直接跳過）。`;
      if (inWindows(pos[0], ride.glitches)) return '這段 GPS 飄移，速度讀數不準。';
      const sg = segs.find(s => pos[0] >= s.d0 && pos[0] <= s.d1); return sg ? `分段 #${sg.name}：${sg.cls.label} ${sg.grade >= 0 ? '+' : ''}${sg.grade.toFixed(1)}%，這段平均 ${sg.v.toFixed(1)} km/h。` : '';
    },
  });
  return explorer.destroy;
}

function tile(k, v, unit, d) { return el('div', { class: 'tile' }, el('div', { class: 'k' }, k), el('div', { class: 'v', html: `${v}<small>${unit}</small>` }), d ? el('div', { class: 'd' }, d) : null); }
