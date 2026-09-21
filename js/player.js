// Animated replay (one rider) / virtual race (two riders) on real maps.
import { makeMap, canvasOverlay, laneScreen, drawLane, kmMarkers, dot, pill, fitTo } from './maps.js';
import { tok, rgba, FONT, fmtTime, speedColor, diffColor, el } from './theme.js';
import { interp } from './util.js';

const STEP = 10;

// s at race time t (timeline arrays: grid s, T non-decreasing, duplicates at section jumps)
function locate(grid, T, t) {
  const n = T.length; if (t <= T[0]) return grid[0]; if (t >= T[n - 1]) return grid[n - 1];
  let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
  const dt = T[hi] - T[lo]; const f = dt > 0 ? (t - T[lo]) / dt : 0; return grid[lo] + f * (grid[hi] - grid[lo]);
}

export function mountPlayer(host, cfg) {
  const race = cfg.riders.length === 2;
  const R = cfg.route; // {lat, lon, ele} on a 10 m grid from s=0
  const routeS = (i) => i * STEP;
  const posAt = (s) => { const i = Math.max(0, Math.min(R.lat.length - 2, Math.floor(s / STEP))); const f = Math.min(1, Math.max(0, (s - i * STEP) / STEP)); return [R.lat[i] + f * (R.lat[i + 1] - R.lat[i]), R.lon[i] + f * (R.lon[i + 1] - R.lon[i])]; };
  const inExcl = (s) => (cfg.excl || []).some(([a, b]) => s > a && s < b);
  const total = (R.lat.length - 1) * STEP;

  // ---------- DOM ----------
  const ov = el('div', { class: 'map ovmap' }), fcEl = el('div', { class: 'fcmap' });
  const clock = el('div', { class: 'clock' }, '0:00');
  const gapwho = el('div', { class: 'gapwho' }), gapnum = el('div', { class: 'gapnum' }), gapm = el('div', { class: 'gapm' });
  const rows = cfg.riders.map(r => {
    const km = el('span', { class: 'v' }), seg = el('span', { class: 'v' }), v = el('span', { class: 'v' });
    const row = el('div', { class: 'rider' }, el('span', { class: 'dot', style: `background:${r.color}` }), el('span', { class: 'nm' }, r.short), km, seg, v);
    return { row, km, seg, v, dotEl: row.firstChild };
  });
  const note = el('div', { class: 'bnote' });
  const board = el('div', { class: 'board', role: 'status' },
    el('div', { class: 'brow' }, el('div', {}, el('div', { class: 'lbl' }, '移動時間'), clock), el('div', { class: 'gapbox' }, gapwho, gapnum, gapm)),
    el('div', { class: 'riders' }, rows.map(r => r.row)), note);
  const playBtn = el('button', { class: 'btn primary', 'aria-label': '播放或暫停' }, '▶ 播放');
  const restart = el('button', { class: 'btn', 'aria-label': '回到起點' }, '⟲ 重來');
  const scrub = el('input', { type: 'range', min: 0, max: 100, step: 0.1, value: 0, 'aria-label': '時間軸' });
  const scrubT = el('span', {}, '0:00');
  const speedSeg = el('div', { class: 'seg' }, [10, 20, 40, 80].map(v => el('button', { 'data-v': v, 'aria-pressed': v === 20 ? 'true' : 'false' }, v + '×')));
  const startSel = el('select', { 'aria-label': '起算點' }, cfg.starts.map((st, k) => el('option', { value: k }, st.label)));
  const adjChk = el('input', { type: 'checkbox' });
  const colChk = el('input', { type: 'checkbox' }); colChk.checked = !race;
  const controls = el('div', { class: 'card controls noprint' }, playBtn, restart, el('div', { class: 'scrub' }, scrub, scrubT),
    el('div', { class: 'grp' }, '播放速度', speedSeg),
    race ? el('div', { class: 'grp' }, '起算點', startSel) : null,
    race && cfg.hasAdj ? el('label', { class: 'chk' }, adjChk, `扣除停車影響（${cfg.adjLabel}）`) : null,
    el('label', { class: 'chk' }, colChk, race ? '路線顯示速度差顏色' : '路線依速度上色'));
  const pfCv = el('canvas', { class: 'pf' });
  const pfCard = el('div', { class: 'card' }, el('div', { class: 'legend', style: 'padding:8px 12px' }, race ? '上：海拔剖面與兩人的位置；下：累計時間差（負＝藍色領先）。點一下剖面可以跳到該位置。' : '海拔剖面與目前位置。點一下剖面可以跳到該位置。'), pfCv);
  host.append(el('div', { class: 'player' }, el('div', { class: 'stage' }, ov, el('div', { class: 'side' }, board, fcEl)), controls, pfCard));
  if (!race) { gapwho.textContent = '距離'; }

  // ---------- state ----------
  let T = 0, playing = false, speed = 20, last = null, adj = false, startK = 0, cam = null;
  let grid, TL, Tmax;
  const build = () => {
    const s0 = cfg.starts[startK].s;
    let j = 0; while (j < cfg.grid.length - 1 && cfg.grid[j] < s0 - 1e-6) j++;
    grid = cfg.grid.slice(j);
    TL = cfg.riders.map(r => { const src = adj && r.Tadj ? r.Tadj : r.T; const b = src[j]; return src.slice(j).map(v => v - b); });
    Tmax = Math.max(...TL.map(a => a[a.length - 1])) + 1;
    scrub.max = Tmax.toFixed(1); pfStatic = null;
  };
  const Tof = (k, s) => interp(s, grid, TL[k]);
  const vOf = (k, s) => interp(s, cfg.grid, cfg.riders[k].v);
  const segName = (s) => { for (const g of cfg.segments) if (s >= g.d0 - 0.5 && s <= g.d1 + 0.5) return g.name; return '—'; };
  const compDist = (s) => { let d = s - grid[0]; for (const [a, b] of cfg.excl || []) { if (b <= grid[0]) continue; const A = Math.max(a, grid[0]); if (s > b) d -= (b - A); else if (s > A) d -= (s - A); } return d; };

  // ---------- maps ----------
  const map = makeMap(ov), fmap = makeMap(fcEl, { interactive: false });
  fitTo(map, R.lat, R.lon, 24); fmap.setView(posAt(grid?.[0] ?? 0), 16);
  const laneColor = (i) => {
    const s = routeS(i);
    if (inExcl(s)) return rgba(tok('neutral'), 0.95);
    if (colChk.checked && cfg.colorAt) return cfg.colorAt(s);
    return rgba(tok('lane'), 0.6);
  };
  const drawScene = (m, ctx, { big }) => {
    const lane = laneScreen(m, R.lat, R.lon, big ? 7 : 5);
    drawLane(ctx, lane, { width: big ? 6 : 4, colorAt: laneColor, dashAt: (i) => inExcl(routeS(i)) });
    kmMarkers(ctx, lane, routeS, total, { r: big ? 9 : 7.5 });
    const toPt = (s) => { const [la, lo] = posAt(s); const p = m.latLngToContainerPoint([la, lo]);
      const [la2, lo2] = posAt(Math.min(total, s + 15)), [la1, lo1] = posAt(Math.max(0, s - 15));
      const a = m.latLngToContainerPoint([la1, lo1]), b = m.latLngToContainerPoint([la2, lo2]); const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const off = big ? 7 : 5; return [p.x - (b.y - a.y) / L * off, p.y + (b.x - a.x) / L * off]; };
    const pos = cfg.riders.map((r, k) => locate(grid, TL[k], T));
    // trails
    cfg.riders.forEach((r, k) => {
      let prev = null, prevS = null; const span = big ? 20 : 30;
      for (let q = span; q >= 0; q--) { const t = T - q; if (t < 0) { prev = null; continue; } const s = locate(grid, TL[k], t); const p = toPt(s);
        if (prev && Math.abs(s - prevS) < 80) { ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(p[0], p[1]); ctx.strokeStyle = rgba(r.color, 0.1 + 0.7 * (1 - q / span)); ctx.lineWidth = big ? 5 : 4; ctx.lineCap = 'round'; ctx.stroke(); }
        prev = p; prevS = s; }
    });
    // gap highlight (follow cam)
    if (big && race && Math.abs(pos[0] - pos[1]) > 5) {
      const lo = Math.min(...pos), hi = Math.max(...pos), lead = pos[0] > pos[1] ? cfg.riders[0].color : cfg.riders[1].color;
      ctx.beginPath(); let first = true;
      for (let s = lo; s <= hi; s += 5) { if (inExcl(s)) { first = true; continue; } const p = toPt(s); if (first) { ctx.moveTo(p[0], p[1]); first = false; } else ctx.lineTo(p[0], p[1]); }
      ctx.strokeStyle = rgba(lead, 0.35); ctx.lineWidth = 12; ctx.lineCap = 'round'; ctx.stroke();
    }
    const pts = pos.map(toPt);
    const order = race && pos[0] < pos[1] ? [0, 1] : [1, 0];
    for (const k of (race ? order : [0])) dot(ctx, pts[k][0], pts[k][1], cfg.riders[k].color, big ? 8 : 6.5);
    if (big) {
      if (race) { const close = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) < 44;
        cfg.riders.forEach((r, k) => pill(ctx, pts[k][0], pts[k][1] - (close && pos[k] < pos[1 - k] ? 40 : 22), r.short, r.color)); }
      // 100 m scale bar
      const c = m.getCenter(), mpp = 156543.03 * Math.cos(c.lat * Math.PI / 180) / Math.pow(2, m.getZoom()); const Lpx = 100 / mpp;
      const h = m.getSize().y; ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(8, h - 26, Lpx + 18, 18);
      ctx.strokeStyle = '#1b201c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(16, h - 13); ctx.lineTo(16 + Lpx, h - 13); ctx.stroke();
      ctx.fillStyle = '#1b201c'; ctx.font = `600 11px ${FONT()}`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText('100 m', 16, h - 14);
    }
    return pos;
  };
  const ovl = canvasOverlay(map, (ctx) => drawScene(map, ctx, { big: false }));
  const fovl = canvasOverlay(fmap, (ctx) => drawScene(fmap, ctx, { big: true }));
  const follow = (pos) => {
    const pts = pos.map(posAt); const la = pts.reduce((a, p) => a + p[0], 0) / pts.length, lo = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    let dist = 0; if (pts.length === 2) dist = map.distance(pts[0], pts[1]);
    const size = fmap.getSize(), mppAt = (z) => 156543.03 * Math.cos(la * Math.PI / 180) / Math.pow(2, z);
    let z = 17; while (z > 13 && dist / mppAt(z) > Math.min(size.x, size.y) * 0.6) z -= 0.5;
    if (!cam) cam = { la, lo, z }; else { cam.la += (la - cam.la) * 0.2; cam.lo += (lo - cam.lo) * 0.2; if (Math.abs(z - cam.z) >= 0.5) cam.z = z; }
    fmap.setView([cam.la, cam.lo], cam.z, { animate: false });
  };

  // ---------- profile / gap canvas ----------
  let pfStatic = null, pfG = null;
  const pfX = (s, w) => 46 + (s / total) * (w - 58);
  const buildPf = (w, h, dpr) => {
    const c = document.createElement('canvas'); c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = tok('surface'); ctx.fillRect(0, 0, w, h);
    const muted = tok('muted'), ink = tok('ink'), font = FONT();
    const top = [22, race ? 104 : h - 30], bot = race ? [122, h - 26] : null;
    const e = R.ele; let emin = Infinity, emax = -Infinity; for (const v of e) { emin = Math.min(emin, v); emax = Math.max(emax, v); }
    const pad = Math.max(3, (emax - emin) * 0.1); emin -= pad; emax += pad;
    const ey = (v) => top[1] - (v - emin) / (emax - emin) * (top[1] - top[0]);
    for (const [a, b] of cfg.excl || []) { ctx.fillStyle = rgba(tok('neutral'), 0.16); ctx.fillRect(pfX(a, w), top[0] - 6, pfX(b, w) - pfX(a, w), (bot ? bot[1] : top[1]) - top[0] + 6); }
    ctx.font = `600 11px ${font}`; ctx.textAlign = 'center';
    for (const g of cfg.segments) { ctx.fillStyle = muted; if (pfX(g.d1, w) - pfX(g.d0, w) > 18) ctx.fillText(g.name, (pfX(g.d0, w) + pfX(g.d1, w)) / 2, 14);
      ctx.strokeStyle = rgba(muted, 0.3); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(pfX(g.d1, w), top[0] - 4); ctx.lineTo(pfX(g.d1, w), bot ? bot[1] : top[1]); ctx.stroke(); ctx.setLineDash([]); }
    ctx.beginPath(); ctx.moveTo(pfX(0, w), top[1]); for (let i = 0; i < e.length; i++) ctx.lineTo(pfX(i * STEP, w), ey(e[i])); ctx.lineTo(pfX(total, w), top[1]); ctx.closePath();
    ctx.fillStyle = rgba(muted, 0.2); ctx.fill();
    ctx.beginPath(); for (let i = 0; i < e.length; i++) { const x = pfX(i * STEP, w), y = ey(e[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.strokeStyle = rgba(muted, 0.8); ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.font = `500 10.5px ${font}`;
    ctx.fillText(Math.round(emax - pad) + ' m', 40, ey(emax - pad) + 4); ctx.fillText(Math.round(emin + pad) + ' m', 40, ey(emin + pad) + 4);
    let gy = null, gs = null;
    if (race) {
      gs = grid.map((s, i) => TL[0][i] - TL[1][i]);
      let gmin = Math.min(...gs, -5), gmax = Math.max(...gs, 5); const st = gmax - gmin > 120 ? 60 : 20;
      gmin = Math.floor((gmin - 5) / st) * st; gmax = Math.ceil((gmax + 5) / st) * st;
      gy = (g) => bot[0] + (gmax - g) / (gmax - gmin) * (bot[1] - bot[0]);
      ctx.strokeStyle = rgba(muted, 0.5); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(46, gy(0)); ctx.lineTo(w - 12, gy(0)); ctx.stroke();
      for (let g = gmin; g <= gmax; g += st) { ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.fillText((g > 0 ? '+' : '') + g + 's', 40, gy(g) + 3); }
      ctx.beginPath(); let first = true; for (let i = 0; i < grid.length; i++) { const x = pfX(grid[i], w), y = gy(gs[i]); if (first || grid[i] - grid[i - 1] > 15) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y); }
      ctx.strokeStyle = rgba(ink, 0.18); ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.textAlign = 'center'; ctx.fillStyle = muted; const kmStep = total > 40000 ? 10 : total > 15000 ? 2 : 1;
    for (let k = 0; k * 1000 <= total; k += kmStep) ctx.fillText(k + '', pfX(k * 1000, w), h - 8);
    pfG = { top, bot, ey, gy, gs };
    return c;
  };
  const drawPf = (pos) => {
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = pfCv.clientWidth, h = pfCv.clientHeight; if (!w) return;
    if (pfCv.width !== Math.round(w * dpr)) { pfCv.width = Math.round(w * dpr); pfCv.height = Math.round(h * dpr); pfStatic = null; }
    if (!pfStatic) pfStatic = buildPf(w, h, dpr);
    const ctx = pfCv.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(pfStatic, 0, 0); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { top, ey, gy, gs } = pfG;
    if (race) {
      const sStar = Math.min(...pos), z = gy(0);
      for (let i = 1; i < grid.length; i++) { if (grid[i] > sStar) break; if (grid[i] - grid[i - 1] > 15) continue;
        const g = (gs[i - 1] + gs[i]) / 2; ctx.fillStyle = rgba(g <= 0 ? cfg.riders[0].color : cfg.riders[1].color, 0.28);
        ctx.fillRect(pfX(grid[i - 1], w), Math.min(z, gy(g)), pfX(grid[i], w) - pfX(grid[i - 1], w) + 0.5, Math.abs(gy(g) - z)); }
      ctx.beginPath(); let first = true; for (let i = 0; i < grid.length; i++) { if (grid[i] > sStar) break; const x = pfX(grid[i], w), y = gy(gs[i]); if (first || grid[i] - grid[i - 1] > 15) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y); }
      ctx.strokeStyle = tok('ink'); ctx.lineWidth = 2; ctx.stroke();
    }
    cfg.riders.forEach((r, k) => { const x = pfX(pos[k], w); ctx.strokeStyle = rgba(r.color, 0.55); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, top[0] - 4); ctx.lineTo(x, top[1]); ctx.stroke();
      const i = Math.min(R.ele.length - 1, Math.round(pos[k] / STEP)); dot(ctx, x, ey(R.ele[i]), r.color, 4.5); });
  };
  pfCv.addEventListener('click', (e) => { const r = pfCv.getBoundingClientRect(); const s = ((e.clientX - r.left) - 46) / (r.width - 58) * total;
    const sc = Math.max(grid[0], Math.min(grid[grid.length - 1], s)); T = Math.min(...TL.map((_, k) => Tof(k, sc))); cam = null; setPlay(); });

  // ---------- HUD ----------
  const hud = (pos) => {
    clock.textContent = fmtTime(T); scrubT.textContent = fmtTime(T);
    const done = TL.map(a => T >= a[a.length - 1]);
    cfg.riders.forEach((r, k) => {
      rows[k].km.innerHTML = (pos[k] / 1000).toFixed(2) + '<small>km</small>';
      rows[k].seg.textContent = done[k] ? '完成' : segName(pos[k]);
      rows[k].v.innerHTML = (done[k] ? '—' : Math.round(vOf(k, pos[k]))) + '<small>km/h</small>';
      rows[k].dotEl.style.background = r.color;
    });
    if (race) {
      const s = Math.min(...pos), g = Tof(0, s) - Tof(1, s), dm = compDist(pos[0]) - compDist(pos[1]);
      const lead = Math.abs(g) < 0.5 ? null : (g < 0 ? 0 : 1);
      gapwho.textContent = lead === null ? (T < 0.5 ? '同時出發' : '並駕齊驅') : cfg.riders[lead].short + ' 領先';
      const col = lead === null ? 'var(--board-ink)' : cfg.riders[lead].color;
      gapwho.style.color = col; gapnum.style.color = col; gapnum.textContent = Math.abs(g).toFixed(1) + ' 秒'; gapm.textContent = '相距 ' + Math.abs(Math.round(dm)) + ' m';
      note.textContent = cfg.note({ T, pos, done, gap: g, TL, adj, start: cfg.starts[startK] });
    } else {
      gapnum.textContent = (pos[0] / 1000).toFixed(2) + ' km'; gapm.textContent = cfg.riders[0].gradeAt ? `坡度 ${cfg.riders[0].gradeAt(pos[0]).toFixed(1)}%` : '';
      note.textContent = cfg.note({ T, pos, done });
    }
  };
  // ---------- loop ----------
  const frame = (ts) => {
    if (!host.isConnected) return;
    if (playing) { if (last !== null) { T += Math.min(0.1, (ts - last) / 1000) * speed; if (T >= Tmax) { T = Tmax; playing = false; setPlay(); } } last = ts; } else last = null;
    const pos = cfg.riders.map((r, k) => locate(grid, TL[k], T));
    follow(pos); ovl.redraw(); fovl.redraw(); drawPf(pos); hud(pos);
    if (document.activeElement !== scrub) scrub.value = T.toFixed(1);
    requestAnimationFrame(frame);
  };
  const setPlay = () => { playBtn.textContent = playing ? '❚❚ 暫停' : (T > 0 && T < Tmax ? '▶ 繼續' : '▶ 播放'); };
  playBtn.onclick = () => { if (T >= Tmax) T = 0; playing = !playing; setPlay(); };
  restart.onclick = () => { T = 0; cam = null; setPlay(); };
  scrub.addEventListener('input', () => { T = parseFloat(scrub.value); setPlay(); });
  speedSeg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; speedSeg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false')); speed = +b.dataset.v; });
  startSel.addEventListener('change', () => { startK = +startSel.value; build(); T = 0; cam = null; playing = false; setPlay(); });
  adjChk.addEventListener('change', () => { adj = adjChk.checked; build(); T = Math.min(T, Tmax); });
  colChk.addEventListener('change', () => { ovl.redraw(); });
  host.addEventListener('keydown', (e) => { if (e.code === 'Space' && e.target.tagName !== 'INPUT') { e.preventDefault(); playBtn.click(); } });
  new ResizeObserver(() => { map.invalidateSize(); fmap.invalidateSize(); pfStatic = null; }).observe(host);
  build(); setPlay(); requestAnimationFrame(frame);
  return { setColors() { pfStatic = null; } };
}
