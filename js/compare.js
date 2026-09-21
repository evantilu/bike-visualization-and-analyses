// Two-ride comparison: align ride O onto reference ride R, find the comparable stretches,
// time both riders through 10 m gates, and build virtual-race timelines.
import { makeProjection, firstCrossing, GRID, segmentProfile, inWindows, mergeWindows, GRADE_BINS } from './ride.js';
import { interp, lastLE } from './util.js';

const MATCH_R = 25;       // m: a point closer than this to the other track is "on route"
const START_MARGIN = 200; // m skipped after a standing start
const END_MARGIN = 150;   // m skipped before a ride's finish
const DETOUR_MARGIN = 50; // m either side of a place where one rider left and rejoined the route
const MIN_SECTION = 100;  // m

// ---------- spatial index over a polyline's segments ----------
function buildIndex(X, Y, cell = 50) {
  const map = new Map();
  const key = (cx, cy) => cx * 100003 + cy;
  for (let i = 0; i < X.length - 1; i++) {
    const x0 = Math.min(X[i], X[i + 1]) - MATCH_R, x1 = Math.max(X[i], X[i + 1]) + MATCH_R;
    const y0 = Math.min(Y[i], Y[i + 1]) - MATCH_R, y1 = Math.max(Y[i], Y[i + 1]) + MATCH_R;
    for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++)
      for (let cy = Math.floor(y0 / cell); cy <= Math.floor(y1 / cell); cy++) {
        const k = key(cx, cy); let a = map.get(k); if (!a) map.set(k, a = []); a.push(i);
      }
  }
  return { query(x, y) { return map.get(key(Math.floor(x / cell), Math.floor(y / cell))) || []; } };
}

// projections of (px,py) onto segments of (X,Y) within MATCH_R: [{seg, f, dist}]
function nearSegments(idx, X, Y, px, py) {
  const out = [];
  for (const i of idx.query(px, py)) {
    const ax = X[i], ay = Y[i], vx = X[i + 1] - ax, vy = Y[i + 1] - ay;
    const L2 = vx * vx + vy * vy;
    let f = L2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / L2 : 0;
    f = Math.max(0, Math.min(1, f));
    const dist = Math.hypot(ax + f * vx - px, ay + f * vy - py);
    if (dist <= MATCH_R) out.push({ seg: i, f, dist });
  }
  return out;
}

function coverage(Xa, Ya, idxB, Xb, Yb) {
  let on = 0;
  for (let i = 0; i < Xa.length; i++) if (nearSegments(idxB, Xb, Yb, Xa[i], Ya[i]).length) on++;
  return on / Xa.length;
}

// heading (unit vector) of ride points using +-2 samples
function headings(X, Y) {
  const n = X.length, hx = new Float64Array(n), hy = new Float64Array(n), ok = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2);
    const dx = X[b] - X[a], dy = Y[b] - Y[a], L = Math.hypot(dx, dy);
    if (L > 4) { hx[i] = dx / L; hy[i] = dy / L; ok[i] = 1; }
  }
  return { hx, hy, ok };
}

export function compareRides(r1, r2, opts = {}) {
  const lat0 = (r1.lat0 + r2.lat0) / 2;
  const proj = makeProjection(lat0, r1.lon[0]);
  const P = (r) => { const X = new Float64Array(r.n), Y = new Float64Array(r.n); for (let i = 0; i < r.n; i++) { const [a, b] = proj(r.lat[i], r.lon[i]); X[i] = a; Y[i] = b; } return { X, Y }; };
  const p1 = P(r1), p2 = P(r2);
  const idx1 = buildIndex(p1.X, p1.Y), idx2 = buildIndex(p2.X, p2.Y);
  const f1 = coverage(p1.X, p1.Y, idx2, p2.X, p2.Y); // share of r1 lying on r2
  const f2 = coverage(p2.X, p2.Y, idx1, p1.X, p1.Y);
  // reference = the ride that lies most completely on the other one
  const refIs1 = opts.ref ? opts.ref === r1.id : f1 >= f2;
  const R = refIs1 ? r1 : r2, O = refIs1 ? r2 : r1;
  const pR = refIs1 ? p1 : p2, pO = refIs1 ? p2 : p1, idxR = refIs1 ? idx1 : idx2;
  if (Math.max(f1, f2) < 0.3) return { error: 'overlap', f1, f2 };

  // ---- sequence-aware matching of O onto R ----
  const hO = headings(pO.X, pO.Y), hR = headings(pR.X, pR.Y);
  const sO = new Float64Array(O.n).fill(NaN);
  const cands = (i) => {
    let c = nearSegments(idxR, pR.X, pR.Y, pO.X[i], pO.Y[i]);
    if (hO.ok[i] && O.v[i] > 6) c = c.filter(q => {
      const vx = pR.X[q.seg + 1] - pR.X[q.seg], vy = pR.Y[q.seg + 1] - pR.Y[q.seg], L = Math.hypot(vx, vy) || 1;
      return (vx * hO.hx[i] + vy * hO.hy[i]) / L > 0;
    });
    return c.map(q => ({ s: R.d[q.seg] + q.f * (R.d[q.seg + 1] - R.d[q.seg]), dist: q.dist }));
  };
  // a (re)join at s is accepted only if the next ~15 points keep tracking R forward from s
  const confirms = (i, s) => {
    let ok = 0, tot = 0;
    for (let j = i + 1; j < Math.min(O.n, i + 16); j++) {
      tot++;
      const prog = O.d[j] - O.d[i];
      if (cands(j).some(q => q.s >= s - 30 && q.s <= s + prog + 40)) ok++;
    }
    return tot > 0 && ok >= Math.min(12, tot);
  };
  let cur = -Infinity, prevOn = false, prevMt = 0;
  for (let i = 0; i < O.n; i++) {
    const c = cands(i);
    const maxAdv = 60 + 25 * Math.max(1, O.mt[i] - prevMt);
    let best = NaN;
    if (prevOn) { // tracking: nearest candidate consistent with forward progress
      let bestDist = Infinity;
      for (const q of c) if (q.s >= cur - 30 && q.s <= cur + maxAdv && q.dist < bestDist) { bestDist = q.dist; best = q.s; }
    }
    if (!Number.isFinite(best)) { // (re)joining: first forward occurrence that is confirmed by what follows
      for (const q of c.filter(q => q.s >= cur - 30).sort((a, b) => a.s - b.s)) {
        if (prevOn && q.s <= cur + maxAdv) { best = q.s; break; }
        if (confirms(i, q.s)) { best = q.s; break; }
      }
    }
    if (Number.isFinite(best)) { sO[i] = cur === -Infinity ? best : Math.max(best, cur); cur = sO[i]; prevOn = true; prevMt = O.mt[i]; }
    else prevOn = false;
  }

  // ---- coverage runs of O along R ----
  const runs = [];
  let run = null;
  for (let i = 0; i < O.n; i++) {
    if (!Number.isFinite(sO[i])) { if (run) { runs.push(run); run = null; } continue; }
    if (run && sO[i] - run.s1 > 80) { runs.push(run); run = null; }
    if (!run) run = { i0: i, i1: i, s0: sO[i], s1: sO[i] };
    else { run.i1 = i; run.s1 = sO[i]; }
  }
  if (run) runs.push(run);
  const sig = runs.filter(r => r.s1 - r.s0 >= 50);
  const zones = [];
  let cover = sig.map(r => [r.s0, r.s1]);
  for (let k = 0; k < sig.length - 1; k++) {
    const a = sig[k].s1, b = sig[k + 1].s0;
    if (b - a <= 80) zones.push({ type: 'detour', a: Math.min(a, b) - DETOUR_MARGIN, b: Math.max(a, b) + DETOUR_MARGIN, oLeft: sig[k].i1, oBack: sig[k + 1].i0 });
    else zones.push({ type: 'skip', a, b });
  }
  // widen each detour zone while the detouring rider is still slowing down / speeding up for it
  {
    const on = []; for (let i = 0; i < O.n; i++) if (Number.isFinite(sO[i])) on.push(i);
    const sOn0 = Float64Array.from(on, i => sO[i]), vOn0 = Float64Array.from(on, i => O.v[i]);
    const vAt = (s) => interp(s, sOn0, vOn0);
    const ref = (a, b) => { const v = []; for (let s = a; s <= b; s += GRID) v.push(vAt(s)); v.sort((p, q) => p - q); return v[v.length >> 1]; };
    for (const z of zones) {
      if (z.type !== 'detour') continue;
      const before = ref(z.a - 500, z.a - 200), after = ref(z.b + 200, z.b + 500);
      let a = z.a; while (a > z.a - 300 && vAt(a) < 0.75 * before) a -= GRID;
      let b = z.b; while (b < z.b + 300 && vAt(b) < 0.75 * after) b += GRID;
      z.a = a; z.b = b;
    }
  }
  cover = mergeWindows(cover, 80);
  // standing starts / finishes
  const s0 = cover[0][0], s1 = cover[cover.length - 1][1];
  let lo = s0, hi = s1;
  const oStartsHere = sig.length && O.d[sig[0].i0] < 50;
  const oEndsHere = sig.length && O.d[O.n - 1] - O.d[sig[sig.length - 1].i1] < 50;
  if (s0 < 50 || oStartsHere) { lo = s0 + START_MARGIN; zones.push({ type: 'start', a: s0, b: lo }); }
  if (R.d[R.n - 1] - s1 < 50 || oEndsHere) { hi = s1 - END_MARGIN; zones.push({ type: 'end', a: hi, b: s1 }); }
  let sections = [];
  for (const [a, b] of cover) { const A = Math.max(a, lo), B = Math.min(b, hi); if (B > A) sections.push([A, B]); }
  for (const z of zones.filter(z => z.type === 'detour')) {
    const next = [];
    for (const [a, b] of sections) {
      if (z.b <= a || z.a >= b) { next.push([a, b]); continue; }
      if (z.a > a) next.push([a, z.a]);
      if (z.b < b) next.push([z.b, b]);
    }
    sections = next;
  }
  sections = sections.map(([a, b]) => [Math.ceil(a / GRID) * GRID, Math.floor(b / GRID) * GRID]).filter(([a, b]) => b - a >= MIN_SECTION);
  if (opts.sections) sections = opts.sections.map(x => x.slice());
  if (!sections.length) return { error: 'no-sections', f1, f2 };

  // ---- gate times ----
  const onIdx = []; for (let i = 0; i < O.n; i++) if (Number.isFinite(sO[i])) onIdx.push(i);
  const sOn = Float64Array.from(onIdx, i => sO[i]), mtOn = Float64Array.from(onIdx, i => O.mt[i]);
  const gateR = (g) => firstCrossing(R.d, R.mt, g);
  const gateO = (g) => firstCrossing(sOn, mtOn, g);
  const grid = [], secId = [];
  sections.forEach(([a, b], k) => { for (let g = a; g <= b + 1e-6; g += GRID) { grid.push(g); secId.push(k); } });
  const tR = grid.map(gateR), tO = grid.map(gateO);
  if (tO.some(v => !Number.isFinite(v))) return { error: 'gate', f1, f2 };
  const timeline = (tt) => { // concatenate sections: race clock
    const T = new Float64Array(grid.length); let acc = 0, base = 0;
    for (let j = 0; j < grid.length; j++) {
      if (j === 0 || secId[j] !== secId[j - 1]) { if (j > 0) acc = T[j - 1]; base = tt[j]; }
      T[j] = acc + (tt[j] - base);
    }
    return T;
  };
  const TR = timeline(tR), TO = timeline(tO);

  // ---- speeds and positions on the grid ----
  const vR = grid.map(s => R.grid.v[Math.min(R.grid.v.length - 1, Math.round(s / GRID))]);
  const vOn = Float64Array.from(onIdx, i => O.v[i]);
  const vO = grid.map(s => { const k = lastLE(sOn, s); return k < 0 ? vOn[0] : vOn[k]; });
  const gi = (s) => Math.min(R.grid.d.length - 1, Math.round(s / GRID));
  const ele = grid.map(s => R.grid.eleS[gi(s)]);
  const grade = grid.map(s => R.grid.grade[gi(s)]);

  // ---- stops (with their cost) and glitch windows mapped onto R's axis ----
  const sOfOIndex = (i) => { if (Number.isFinite(sO[i])) return sO[i]; for (let k = 1; k < 30; k++) { if (Number.isFinite(sO[i - k])) return sO[i - k]; if (Number.isFinite(sO[i + k])) return sO[i + k]; } return NaN; };
  const inSec = (s) => sections.findIndex(([a, b]) => s >= a && s <= b);
  const stops = [];
  for (const st of R.stops) if (inSec(st.d) >= 0) stops.push({ who: 'R', s: st.d, dur: st.dur, paused: st.paused, still: st.still });
  for (const st of O.stops) { const s = sOfOIndex(st.i0); if (Number.isFinite(s) && inSec(s) >= 0) stops.push({ who: 'O', s, dur: st.dur, paused: st.paused, still: st.still }); }
  const glitchR = R.glitches.map(w => w.slice());
  const glitchO = O.glitches.map(([a, b]) => {
    const ia = O.d.findIndex(x => x >= a), ib = O.d.findIndex(x => x >= b);
    const sa = sOfOIndex(Math.max(0, ia)), sb = sOfOIndex(ib < 0 ? O.n - 1 : ib);
    return [Math.min(sa, sb), Math.max(sa, sb)];
  }).filter(w => w.every(Number.isFinite));
  const glitches = mergeWindows([...glitchR, ...glitchO]);

  // stop-adjusted timelines: replace the stop window by the rider's own pace just before it
  const adjust = (T, who) => {
    const A = Float64Array.from(T); const costs = [];
    for (const st of stops.filter(q => q.who === who)) {
      const k = inSec(st.s); const [sa, sb] = sections[k];
      const w0 = Math.max(sa, Math.floor((st.s - 100) / GRID) * GRID), w1 = Math.min(sb, Math.ceil((st.s + 130) / GRID) * GRID);
      const j0 = grid.indexOf(w0), j1 = grid.indexOf(w1);
      let p0 = Math.max(sa, w0 - 500), jp = grid.indexOf(Math.round(p0 / GRID) * GRID);
      let pace;
      if (j0 - jp >= 10) pace = (A[j0] - A[jp]) / (grid[j0] - grid[jp]);
      else { const q1 = Math.min(sb, w1 + 500), jq = grid.indexOf(Math.round(q1 / GRID) * GRID); pace = (A[jq] - A[j1]) / Math.max(grid[jq] - grid[j1], 1); }
      const want = (grid[j1] - grid[j0]) * pace, have = A[j1] - A[j0], delta = have - want;
      if (!(delta > 0)) continue;
      for (let j = j0; j <= j1; j++) A[j] = A[j0] + (grid[j] - grid[j0]) * pace;
      for (let j = j1 + 1; j < A.length; j++) A[j] -= delta;
      costs.push({ s: st.s, cost: delta, w0, w1 });
      st.cost = delta; st.w0 = w0; st.w1 = w1;
    }
    return { T: A, costs };
  };
  const adjR = adjust(TR, 'R'), adjO = adjust(TO, 'O');

  // ---- segments (auto) on the reference profile, per section ----
  const segs = [];
  sections.forEach(([a, b]) => {
    const i0 = gi(a), i1 = gi(b);
    const force = [];
    if (R.turnD != null && R.turnD > a + 300 && R.turnD < b - 300) force.push(gi(R.turnD));
    for (const sg of segmentProfile(R.grid.d, R.grid.eleS, { from: i0, to: i1, force })) segs.push(sg);
  });
  const at = (T, s) => interp(s, grid, T);
  for (const sg of segs) {
    sg.tR = at(TR, sg.d1) - at(TR, sg.d0);
    sg.tO = at(TO, sg.d1) - at(TO, sg.d0);
    sg.tRadj = at(adjR.T, sg.d1) - at(adjR.T, sg.d0);
    sg.tOadj = at(adjO.T, sg.d1) - at(adjO.T, sg.d0);
  }

  // ---- speed by grade (cells), excluding stop windows and glitches ----
  const excl = [...glitches, ...stops.map(q => [q.s - 100, q.s + 130])];
  const bins = GRADE_BINS.map(([lo2, hi2, label]) => ({ label, lo: lo2, hi: hi2, dist: 0, tR: 0, tO: 0 }));
  for (let j = 1; j < grid.length; j++) {
    if (secId[j] !== secId[j - 1]) continue;
    const mid = (grid[j] + grid[j - 1]) / 2;
    if (inWindows(mid, excl)) continue;
    const g = (grade[j] + grade[j - 1]) / 2;
    for (const bn of bins) if (g >= bn.lo && g < bn.hi) { bn.dist += GRID; bn.tR += TR[j] - TR[j - 1]; bn.tO += TO[j] - TO[j - 1]; break; }
  }
  for (const bn of bins) { bn.vR = bn.dist / bn.tR * 3.6; bn.vO = bn.dist / bn.tO * 3.6; }

  const compLen = sections.reduce((s, [a, b]) => s + (b - a), 0);
  return {
    R, O, refIs1, f1, f2, sO, runs: sig, zones, sections, grid: Float64Array.from(grid), secId,
    T: { R: TR, O: TO }, Tadj: { R: adjR.T, O: adjO.T }, costs: { R: adjR.costs, O: adjO.costs },
    V: { R: Float64Array.from(vR), O: Float64Array.from(vO) }, ele: Float64Array.from(ele), grade: Float64Array.from(grade),
    stops, glitches, segments: segs, bins, compLen,
  };
}

// time gap (O − R, seconds) at route position s for a given pair of timelines
export function gapAt(cmp, s, adj = false) {
  const T = adj ? cmp.Tadj : cmp.T;
  return interp(s, cmp.grid, T.O) - interp(s, cmp.grid, T.R);
}
