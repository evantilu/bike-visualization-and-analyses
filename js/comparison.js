// Two-ride comparison report + virtual race.
import { GRID, inWindows } from './ride.js';
import { PanelChart, groupedBars } from './charts.js';
import { makeMap, canvasOverlay, laneScreen, drawLane, kmMarkers, dot, badge, fitTo } from './maps.js';
import { mountPlayer } from './player.js';
import { tok, rgba, el, fmtTime, fmtDate, fmtSigned, diffColor } from './theme.js';
import { interp, movingAvg } from './util.js';

const day = (r) => fmtDate(r.start).slice(0, 10);

export function buildCompare(host, cmp, { swap = false, onSwap } = {}) {
  host.innerHTML = '';
  const { R, O } = cmp;
  // blue = newer ride by default
  const newerIsR = R.start >= O.start;
  const blueRole = (newerIsR !== swap) ? 'R' : 'O', redRole = blueRole === 'R' ? 'O' : 'R';
  const ride = { R, O }, BLUE = tok('blue'), RED = tok('red');
  const blue = ride[blueRole], red = ride[redRole];
  const nameB = `${day(blue)}`, nameR = `${day(red)}`;
  const g = cmp.grid, n = g.length, km = Array.from(g, v => v / 1000);
  const Tb = cmp.T[blueRole], Tr = cmp.T[redRole], Tba = cmp.Tadj[blueRole], Tra = cmp.Tadj[redRole];
  const Vb = cmp.V[blueRole], Vr = cmp.V[redRole];
  const gap = Float64Array.from(g, (s, i) => Tb[i] - Tr[i]);
  const gapAdj = Float64Array.from(g, (s, i) => Tba[i] - Tra[i]);
  const diff = Float64Array.from(g, (s, i) => Vb[i] - Vr[i]);
  const total = R.total, tB = Tb[n - 1], tR = Tr[n - 1], dAll = tB - tR, dAdj = Tba[n - 1] - Tra[n - 1];
  const costs = [...cmp.costs.R.map(c => ({ ...c, who: 'R' })), ...cmp.costs.O.map(c => ({ ...c, who: 'O' }))];
  const hasAdj = costs.length > 0;
  const who = (role) => role === blueRole ? `藍（${nameB}）` : `紅（${nameR}）`;
  // excluded zones on the reference axis
  const excl = []; let prev = 0;
  for (const [a, b] of cmp.sections) { if (a > prev) excl.push([prev, a]); prev = b; }
  if (prev < total) excl.push([prev, total]);
  // segments
  const segs = cmp.segments.map((s, k) => ({ ...s, n: k + 1, tb: blueRole === 'R' ? s.tR : s.tO, tr: blueRole === 'R' ? s.tO : s.tR }));
  let acc = 0; for (const s of segs) { s.dt = s.tb - s.tr; acc += s.dt; s.cum = acc; }

  // ---- header / summary
  const faster = dAll < 0 ? '快' : '慢';
  const reasons = cmp.zones.slice().sort((p, q) => p.a - q.a).map(z => {
    const r = `${(z.a / 1000).toFixed(2)}–${(z.b / 1000).toFixed(2)} km`;
    if (z.type === 'start') return `${r}：起步加速段（原地出發的那一段不比）`;
    if (z.type === 'end') return `${r}：終點前減速段`;
    if (z.type === 'detour') return `${r}：${who('O')}在這裡離開路線、之後又回來（岔路、繞路或停下來），這段的時間不能比`;
    return `${r}：只有${who('R')}騎了這段`;
  });
  const oExtra = Math.max(0, O.total - cmp.runs.reduce((a, r) => a + (r.s1 - r.s0), 0));
  host.append(el('section', { class: 'rsec' },
    el('div', { style: 'display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-end' },
      el('h2', {}, `比較：${nameB} vs ${nameR}`), el('button', { class: 'btn noprint', onclick: () => onSwap?.() }, '對調顏色')),
    el('p', { class: 'lead' }, el('b', { style: `color:${BLUE}` }, `藍＝${nameB}「${blue.name}」`), '　', el('b', { style: `color:${RED}` }, `紅＝${nameR}「${red.name}」`)),
    el('div', { class: 'box' }, el('ul', {},
      el('li', { html: `<b>兩趟可以比較的路段共 ${(cmp.compLen / 1000).toFixed(2)} km：藍比紅${faster} ${Math.abs(dAll).toFixed(0)} 秒</b>（移動時間 ${fmtTime(tR)} → ${fmtTime(tB)}，均速 ${(cmp.compLen / tR * 3.6).toFixed(1)} → ${(cmp.compLen / tB * 3.6).toFixed(1)} km/h）。` }),
      hasAdj ? el('li', { html: `扣除停車的影響後（${costs.map(c => `${who(c.who)} ${(c.s / 1000).toFixed(2)} km 約 ${c.cost.toFixed(0)} 秒`).join('、')}），藍比紅${dAdj < 0 ? '快' : '慢'} ${Math.abs(dAdj).toFixed(0)} 秒。` }) : null,
      el('li', {}, `下面所有時間都是移動時間（自動暫停不計，和 Strava 一致），用每 10 m 一個計時點算出來。`))),
    el('div', { class: 'tiles' },
      tile(`藍 ${nameB}`, (blue.total / 1000).toFixed(2), 'km', `整趟 ${fmtTime(blue.moving)}，均速 ${blue.avg.toFixed(1)}`, BLUE),
      tile(`紅 ${nameR}`, (red.total / 1000).toFixed(2), 'km', `整趟 ${fmtTime(red.moving)}，均速 ${red.avg.toFixed(1)}`, RED),
      tile('可比路段', (cmp.compLen / 1000).toFixed(2), 'km', `參考路線：${who('R')}`),
      tile('時間差（藍 − 紅）', fmtSigned(dAll, 0), '秒', hasAdj ? `扣除停車 ${fmtSigned(dAdj, 0)} 秒` : '負＝藍比較快')),
    el('details', {}, el('summary', {}, `自動剔除的路段（${reasons.length} 處${oExtra > 200 ? `；另外${who('O')}多騎約 ${(oExtra / 1000).toFixed(1)} km 不在參考路線上` : ''}）`),
      el('ul', {}, reasons.map(r => el('li', {}, r))))));

  // ---- alignment map
  const aSec = el('section', { class: 'rsec' }, el('h2', {}, '兩趟路線對齊'), el('p', { class: 'lead' }, '藍、紅細線是兩趟實際的 GPS 軌跡（略微錯開以免重疊）；灰色粗底線是兩趟都騎過、可以比較的路段。'));
  const aMap = el('div', { class: 'map', style: 'height:440px' }); aSec.append(aMap); host.append(aSec);
  const am = makeMap(aMap); fitTo(am, [...R.lat, ...O.lat], [...R.lon, ...O.lon]);
  const inSec = (s) => cmp.sections.some(([a, b]) => s >= a && s <= b);
  canvasOverlay(am, (ctx) => {
    const L = laneScreen(am, R.grid.lat, R.grid.lon, 0); drawLane(ctx, L, { width: 9, casing: false, colorAt: (i) => inSec(i * GRID) ? rgba(tok('lane'), 0.35) : null });
    for (const [r, col, off] of [[red, RED, 2], [blue, BLUE, -2]]) { const T = laneScreen(am, r.lat, r.lon, off, 2); drawLane(ctx, T, { width: 2.2, colorAt: () => col, casing: false }); }
    const p0 = am.latLngToContainerPoint([R.lat[0], R.lon[0]]); dot(ctx, p0.x, p0.y, '#3fae49', 5);
  });

  // ---- 4-panel overlay chart
  const sOn = [], eOn = []; for (let i = 0; i < O.n; i++) if (Number.isFinite(cmp.sO[i])) { sOn.push(cmp.sO[i]); eOn.push(O.ele[i]); }
  const eleO = Float64Array.from(g, s => interp(s, sOn, eOn)), eleR = Float64Array.from(g, s => R.grid.ele[Math.min(R.grid.ele.length - 1, Math.round(s / GRID))]);
  const eleB = blueRole === 'R' ? eleR : eleO, eleRd = blueRole === 'R' ? eleO : eleR;
  const cSec = el('section', { class: 'rsec' }, el('h2', {}, '完整疊圖'),
    el('p', { class: 'lead' }, '橫軸是參考路線上的距離，灰底是不比較的地方。① 兩條海拔線重合代表對齊正確；② 同一位置的速度；③ 逐點速度差；④ 累計時間差，可以想成兩趟同時出發的虛擬對騎。'));
  const cEl = el('div', { class: 'chart' }); cSec.append(cEl);
  cSec.append(el('div', { class: 'legend' }, el('span', {}, el('i', { style: `background:${BLUE}` }), `藍 ${nameB}`), el('span', {}, el('i', { style: `background:${RED}` }), `紅 ${nameR}`),
    hasAdj ? el('span', {}, el('i', { style: `background:${tok('ink')};height:0;border-top:2px dashed ${tok('ink')}` }), '扣除停車影響') : null));
  host.append(cSec);
  let mapCursor = null, dmap = null, dovl = null;
  const chart = new PanelChart(cEl, { x: km, xMax: total / 1000, breakGap: 0.03,
    panels: [
      { h: 110, label: '海拔 m', title: '① 海拔', series: [{ y: eleRd, color: RED, width: 2, name: '紅 海拔', fmt: v => v.toFixed(0) + ' m' }, { y: eleB, color: BLUE, width: 2, dash: [6, 3], name: '藍 海拔', fmt: v => v.toFixed(0) + ' m' }] },
      { h: 160, label: 'km/h', title: '② 速度', yMin: 0, series: [{ y: Vr, color: RED, width: 1.4, name: '紅', fmt: v => v.toFixed(1) + ' km/h' }, { y: Vb, color: BLUE, width: 1.4, name: '藍', fmt: v => v.toFixed(1) + ' km/h' }] },
      { h: 100, label: 'km/h', title: '③ 速度差（藍 − 紅）', zero: true, yMin: -15, yMax: 15, series: [{ y: movingAvg(diff, 3), fillSign: { pos: BLUE, neg: RED }, color: BLUE }] },
      { h: 120, label: '秒', title: '④ 累計時間差（負＝藍領先）', zero: true, series: [{ y: gap, color: tok('ink'), width: 2, name: '時間差', fmt: v => fmtSigned(v, 1, ' 秒') }, ...(hasAdj ? [{ y: gapAdj, color: tok('ink'), width: 1.3, dash: [5, 3], name: '扣除停車', fmt: v => fmtSigned(v, 1, ' 秒') }] : [])] },
    ],
    shades: excl.map(([a, b]) => [a / 1000, b / 1000]), vlines: segs.slice(0, -1).map(s => s.d1 / 1000), tops: segs.map(s => ({ x: (s.d0 + s.d1) / 2000, text: '#' + s.n })),
    onHover: (k) => { mapCursor = k; dovl?.redraw(); } });
  chart.draw();

  // ---- diff map
  const dSec = el('section', { class: 'rsec' }, el('h2', {}, '地圖：每個位置誰比較快'),
    el('p', { class: 'lead' }, '顏色＝速度差：藍色代表藍那趟在這裡比較快，紅色代表紅那趟比較快，越深差距越大（±6 km/h 封頂，50 m 平滑）。灰色虛線＝不比較的地方。去回同一條路時，兩個方向分開畫在各自的右側。方框＝分段編號與該段時間差。'));
  const dEl = el('div', { class: 'map' }); dSec.append(dEl); host.append(dSec);
  const diffFull = new Float64Array(R.grid.lat.length).fill(NaN);
  const dsm = movingAvg(diff, 5);
  g.forEach((s, i) => { diffFull[Math.min(diffFull.length - 1, Math.round(s / GRID))] = dsm[i]; });
  dmap = makeMap(dEl); fitTo(dmap, R.grid.lat, R.grid.lon);
  dovl = canvasOverlay(dmap, (ctx) => {
    const lane = laneScreen(dmap, R.grid.lat, R.grid.lon, 6);
    const ex = (i) => !Number.isFinite(diffFull[i]) || inWindows(i * GRID, cmp.glitches);
    drawLane(ctx, lane, { width: 5.5, colorAt: (i) => ex(i) ? rgba(tok('neutral'), .95) : diffColor(diffFull[i]), dashAt: (i) => !Number.isFinite(diffFull[i]) });
    kmMarkers(ctx, lane, (i) => i * GRID, total);
    const P = (s) => { const i = Math.min(R.grid.lat.length - 1, Math.round(s / GRID)); return dmap.latLngToContainerPoint([R.grid.lat[i], R.grid.lon[i]]); };
    for (const s of segs) { const p = P((s.d0 + s.d1) / 2); badge(ctx, p.x + 30, p.y - 16, `#${s.n} ${fmtSigned(s.dt, 0)}s`, s.dt < 0 ? BLUE : RED); }
    for (const c of costs) { const p = P(c.s); ctx.fillStyle = c.who === blueRole ? BLUE : RED; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.rect(p.x - 6, p.y - 6, 12, 12); ctx.fill(); ctx.stroke(); }
    const p0 = P(0); dot(ctx, p0.x, p0.y, '#3fae49', 5);
    if (mapCursor != null) { const p = P(mapCursor * 1000); dot(ctx, p.x, p.y, tok('ink'), 5); }
  });
  dSec.append(el('div', { class: 'legend' }, el('span', {}, '紅較快'), el('span', { style: `display:inline-block;width:180px;height:10px;border-radius:5px;background:linear-gradient(90deg,${RED},${tok('neutral')},${BLUE})` }), el('span', {}, '藍較快'),
    el('span', {}, el('i', { style: `background:${tok('neutral')};width:10px;height:10px` }), '方塊＝停車位置')));

  // ---- segment comparison
  const sSec = el('section', { class: 'rsec' }, el('h2', {}, '分段比較'), el('p', { class: 'lead' }, '依參考路線的海拔自動切段。上方數字＝藍比紅快（−）或慢（+）幾秒；差距 5 秒以內可視為打平（每個計時點約 ±1–2 秒誤差）。'));
  const sb = el('div', { class: 'bars' }); sSec.append(sb); host.append(sSec);
  groupedBars(sb, { cats: segs.map(s => [`#${s.n} ${s.cls.label}`, `${(s.d0 / 1000).toFixed(1)}–${(s.d1 / 1000).toFixed(1)} km`, `${s.grade >= 0 ? '+' : ''}${s.grade.toFixed(1)}%`]),
    series: [{ name: '紅', color: RED, values: segs.map(s => (s.d1 - s.d0) / s.tr * 3.6) }, { name: '藍', color: BLUE, values: segs.map(s => (s.d1 - s.d0) / s.tb * 3.6) }],
    above: segs.map(s => ({ text: fmtSigned(s.dt, 0) + 's' })), yLabel: '平均速度 km/h' });
  sSec.append(el('div', { class: 'tablewrap' }, el('table', { class: 'segtable' },
    el('thead', {}, el('tr', {}, ...['#', '類型', '範圍 km', '海拔 m', '坡度', '紅 用時', '藍 用時', '紅 km/h', '藍 km/h', '差', '累計'].map((h, i) => el('th', { class: i > 1 ? 'n' : '' }, h)))),
    el('tbody', {}, segs.map(s => el('tr', {}, el('td', {}, '#' + s.n), el('td', {}, s.cls.label), el('td', { class: 'n' }, `${(s.d0 / 1000).toFixed(2)}–${(s.d1 / 1000).toFixed(2)}`),
      el('td', { class: 'n' }, `${Math.round(s.z0)}→${Math.round(s.z1)}`), el('td', { class: 'n' }, `${s.grade >= 0 ? '+' : ''}${s.grade.toFixed(1)}%`),
      el('td', { class: 'n' }, fmtTime(s.tr)), el('td', { class: 'n' }, fmtTime(s.tb)), el('td', { class: 'n' }, ((s.d1 - s.d0) / s.tr * 3.6).toFixed(1)), el('td', { class: 'n' }, ((s.d1 - s.d0) / s.tb * 3.6).toFixed(1)),
      el('td', { class: s.dt < 0 ? 'n neg' : 'n pos' }, fmtSigned(s.dt, 0) + 's'), el('td', { class: 'n' }, fmtSigned(s.cum, 0) + 's')))))));

  // ---- grade bins
  const bins = cmp.bins.map(b => ({ ...b, vb: blueRole === 'R' ? b.vR : b.vO, vr: blueRole === 'R' ? b.vO : b.vR })).filter(b => b.dist > 0);
  const gSec = el('section', { class: 'rsec' }, el('h2', {}, '依坡度分組比較'), el('p', { class: 'lead' }, '把可比路段切成每 10 m 一格，依坡度分組計算兩趟的平均速度（排除停車前後與 GPS 飄移）。'));
  const gEl = el('div', { class: 'bars' }); gSec.append(gEl); host.append(gSec);
  groupedBars(gEl, { cats: bins.map(b => [b.label, `${(b.dist / 1000).toFixed(1)} km`]), series: [{ name: '紅', color: RED, values: bins.map(b => b.vr) }, { name: '藍', color: BLUE, values: bins.map(b => b.vb) }],
    above: bins.map(b => ({ text: fmtSigned(b.vb - b.vr, 1) + ' km/h' })), yLabel: '平均速度 km/h', height: 280 });

  // ---- virtual race
  const pSec = el('section', { class: 'rsec' }, el('h2', {}, '虛擬對騎'), el('p', { class: 'lead' }, '兩趟放在同一條路線上同時出發；不比較的路段兩個點都直接跳過，時間差照樣延續。'));
  host.append(pSec); const pHost = el('div'); pSec.append(pHost);
  const zoneReason = (s) => { const z = cmp.zones.find(z => s >= z.b - 1 && s < z.b + 150); if (!z) return null;
    return z.type === 'detour' ? `略過 ${(z.a / 1000).toFixed(2)}–${(z.b / 1000).toFixed(2)} km：${who('O')}在這裡離開路線又回來，這段不比。` : z.type === 'skip' ? `略過 ${(z.a / 1000).toFixed(2)}–${(z.b / 1000).toFixed(2)} km：只有${who('R')}騎了這段。` : null; };
  mountPlayer(pHost, {
    route: { lat: R.grid.lat, lon: R.grid.lon, ele: R.grid.ele }, grid: g,
    riders: [{ short: '藍', color: BLUE, T: Tb, Tadj: Tba, v: Vb }, { short: '紅', color: RED, T: Tr, Tadj: Tra, v: Vr }],
    starts: [{ label: `出發（全部可比 ${(cmp.compLen / 1000).toFixed(2)} km）`, s: g[0] }, ...segs.slice(1).map(s => ({ label: `#${s.n} 起點（${(s.d0 / 1000).toFixed(2)} km）`, s: s.d0 }))],
    segments: segs.map(s => ({ name: '#' + s.n, d0: s.d0, d1: s.d1 })), excl, hasAdj, adjLabel: `約 ${costs.reduce((a, c) => a + c.cost, 0).toFixed(0)} 秒`,
    colorAt: (s) => { const v = diffFull[Math.min(diffFull.length - 1, Math.round(s / GRID))]; return Number.isFinite(v) ? diffColor(v) : rgba(tok('neutral'), .95); },
    note: ({ T, pos, done, gap: gg, TL, adj, start }) => {
      if (T < 0.3) return `按播放。兩人從${start.label.replace(/（.*/, '')}（${(g.find(s => s >= start.s) / 1000).toFixed(2)} km）同時出發。`;
      if (done[0] && done[1]) { const d = TL[0][TL[0].length - 1] - TL[1][TL[1].length - 1]; return `終點：藍比紅${d < 0 ? '快' : '慢'} ${Math.abs(d).toFixed(0)} 秒${adj ? '（已扣除停車影響）' : ''}。把時間軸往回拉，可以看是在哪裡拉開的。`; }
      if (done[0]) return `藍已經到終點，紅還差 ${Math.abs(gg).toFixed(0)} 秒。`;
      if (done[1]) return `紅已經到終點，藍還差 ${Math.abs(gg).toFixed(0)} 秒。`;
      for (const st of cmp.stops) { const k = st.who === blueRole ? 0 : 1; if (Math.abs(pos[k] - st.s) < 60) return adj && st.cost ? `已扣除停車影響：${k ? '紅' : '藍'}在 ${(st.w0 / 1000).toFixed(2)}–${(st.w1 / 1000).toFixed(2)} km 用停車前的速度推算。` : `${k ? '紅' : '藍'}在 ${(st.s / 1000).toFixed(2)} km 停車：共 ${fmtTime(st.dur)}（其中自動暫停 ${fmtTime(st.paused)} 不計入移動時間）。`; }
      for (const s of pos) { const r = zoneReason(s); if (r) return r; }
      for (const s of pos) if (inWindows(s, cmp.glitches)) return 'GPS 飄移路段：這裡的逐點速度不準，但段落總時間仍然可信。';
      const sg = segs.find(s => pos[0] >= s.d0 && pos[0] <= s.d1);
      return sg ? `#${sg.n} ${sg.cls.label}（${sg.grade >= 0 ? '+' : ''}${sg.grade.toFixed(1)}%）：這段藍比紅${sg.dt < 0 ? '快' : '慢'} ${Math.abs(sg.dt).toFixed(0)} 秒。` : '';
    },
  });

  // ---- method notes
  host.append(el('section', { class: 'rsec' }, el('h2', {}, '方法與限制'), el('div', { class: 'warnbox' }, el('ul', {},
    el('li', {}, '兩趟都投影到參考路線上（誤差 25 m 內、行進方向一致才算同一段），每 10 m 一個計時點。剔除的路段是自動判斷的，和人工挑選的範圍可能差幾十公尺，總時間差可能因此差幾秒。'),
    el('li', {}, 'GPX 只有位置、海拔和時間；沒有功率和心率時，無法分辨進步來自車還是人。風向、氣溫、路況與體能都會影響結果。'),
    el('li', {}, '差距 5 秒以內的分段可視為打平。')))));
}

function tile(k, v, unit, d, color) { return el('div', { class: 'tile', style: color ? `border-top:3px solid ${color}` : '' }, el('div', { class: 'k' }, k), el('div', { class: 'v', html: `${v}<small>${unit}</small>` }), d ? el('div', { class: 'd' }, d) : null); }
