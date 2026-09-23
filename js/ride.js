// Single-ride preprocessing: moving clock, speeds, stops, GPS glitches, distance grid,
// elevation gain and automatic grade segmentation. Pure JS (browser + Node).
import { median, cumsum, lastLE, movingAvg, clamp } from './util.js';

export const R_EARTH = 6371000;
export const GRID = 10; // metres between grid samples

export function makeProjection(lat0, lon0) {
  const k = Math.cos(lat0 * Math.PI / 180), r = Math.PI / 180 * R_EARTH;
  return (lat, lon) => [(lon - lon0) * r * k, (lat - lat0) * r];
}

// First index k with arr[k] >= v in a non-decreasing array (arr.length if none).
function lowerBound(arr, v) {
  let lo = -1, hi = arr.length;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m] >= v) hi = m; else lo = m; }
  return hi;
}

// Time (on clock `clk`) at which cumulative position `pos` first reaches g.
export function firstCrossing(pos, clk, g) {
  const k = lowerBound(pos, g);
  if (k >= pos.length) return NaN;
  if (k === 0) return clk[0];
  const p0 = pos[k - 1], p1 = pos[k];
  const f = p1 > p0 ? (g - p0) / (p1 - p0) : 1;
  return clk[k - 1] + f * (clk[k] - clk[k - 1]);
}

export function prepareRide(gpx, meta = {}) {
  // clean: finite time, strictly increasing
  const raw = gpx.points.filter(p => Number.isFinite(p.t));
  const pts = [];
  for (const p of raw) { if (!pts.length || p.t > pts[pts.length - 1].t) pts.push(p); }
  const n = pts.length;
  if (n < 10) throw new Error('GPX 軌跡點太少（少於 10 點）');
  const t0 = pts[0].t;
  const lat = Float64Array.from(pts, p => p.lat), lon = Float64Array.from(pts, p => p.lon);
  const t = Float64Array.from(pts, p => (p.t - t0) / 1000);
  // elevation: fill gaps by linear interpolation
  const ele = Float64Array.from(pts, p => p.ele);
  fillNaN(ele);
  const lat0 = lat.reduce((a, b) => a + b, 0) / n;
  const proj = makeProjection(lat0, lon[0]);
  const x = new Float64Array(n), y = new Float64Array(n);
  for (let i = 0; i < n; i++) { const [a, b] = proj(lat[i], lon[i]); x[i] = a; y[i] = b; }
  const step = new Float64Array(n), dt = new Float64Array(n);
  for (let i = 1; i < n; i++) { step[i] = Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]); dt[i] = t[i] - t[i - 1]; }
  const d = cumsum(step);
  const medDt = median(dt.subarray(1)) || 1;
  // pauses: long gap with (almost) no movement = device auto-pause
  const paused = new Uint8Array(n);
  const mstep = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const isPause = dt[i] > Math.max(3, 2.5 * medDt) && step[i] / dt[i] < 1.0;
    paused[i] = isPause ? 1 : 0;
    mstep[i] = isPause ? medDt : dt[i];
  }
  const mt = cumsum(mstep); // moving clock (s)
  // Implausible single steps: a frozen fix that jumps, or plain GPS noise. The displacement is
  // kept in the ride distance (Strava counts it too), but it is left out of the speed series,
  // otherwise one bad fix turns into a 100 km/h "max speed".
  const rawV = new Float64Array(n);
  for (let i = 1; i < n; i++) rawV[i] = paused[i] ? 0 : step[i] / Math.max(mstep[i], 1e-6) * 3.6;
  const bad = new Uint8Array(n);
  for (let i = 1; i < n; i++) {
    if (paused[i] || dt[i] > 2 * medDt || rawV[i] < 45) continue;
    const loc = [];
    for (let k = Math.max(1, i - 10); k <= Math.min(n - 1, i + 10); k++) if (k !== i && !paused[k] && dt[k] <= 2 * medDt) loc.push(rawV[k]);
    const m = median(loc) || 1;
    if (rawV[i] > 3 * m && rawV[i] > 60) bad[i] = 2;        // one fix jumped far ahead: also a glitch window
    else if (rawV[i] > 2.0 * m) bad[i] = 1;                 // isolated noisy fix
  }
  const dMove = cumsum(Float64Array.from(step, (v2, i) => (paused[i] || bad[i] ? 0 : v2)));
  const v = windowSpeed(dMove, mt, 3);   // ~7 s centred (km/h)
  const v1 = windowSpeed(dMove, mt, 1);  // ~3 s centred, for stop detection
  const glitches = detectGlitches(d, rawV, bad);
  const stops = detectStops(d, t, v1, paused, dt);
  // distance grid
  const total = d[n - 1];
  const gd = [];
  for (let g = 0; g <= total; g += GRID) gd.push(g);
  const G = gd.length;
  const grid = { d: Float64Array.from(gd), t: new Float64Array(G), mt: new Float64Array(G), ele: new Float64Array(G), v: new Float64Array(G),
    lat: new Float64Array(G), lon: new Float64Array(G) };
  const extras = {};
  for (const key of ['hr', 'cad', 'power', 'temp']) {
    const arr = Float64Array.from(pts, p => p[key]);
    if (arr.some(Number.isFinite)) { fillNaN(arr); extras[key] = arr; grid[key] = new Float64Array(G); }
  }
  for (let j = 0; j < G; j++) {
    const g = gd[j];
    const k = Math.min(n - 1, lowerBound(d, g));
    const k0 = Math.max(0, k - 1);
    const f = d[k] > d[k0] ? clamp((g - d[k0]) / (d[k] - d[k0]), 0, 1) : 1;
    const lerp = (a) => a[k0] + f * (a[k] - a[k0]);
    grid.t[j] = lerp(t); grid.mt[j] = lerp(mt); grid.ele[j] = lerp(ele); grid.v[j] = lerp(v);
    grid.lat[j] = lerp(lat); grid.lon[j] = lerp(lon);
    for (const key in extras) grid[key][j] = lerp(extras[key]);
  }
  const eleS = movingAvg(grid.ele, 9);
  grid.eleS = eleS;
  grid.grade = new Float64Array(G);
  for (let j = 0; j < G; j++) {
    const a = Math.max(0, j - 1), b = Math.min(G - 1, j + 1);
    grid.grade[j] = b > a ? (eleS[b] - eleS[a]) / ((b - a) * GRID) * 100 : 0;
  }
  // max speed outside glitch windows
  let vmax = 0, vmaxD = 0;
  for (let i = 0; i < n; i++) {
    if (inWindows(d[i], glitches)) continue;
    if (v[i] > vmax) { vmax = v[i]; vmaxD = d[i]; }
  }
  const ride = {
    id: meta.id ?? '', fileName: meta.fileName ?? '', name: gpx.name || meta.fileName || '',
    start: t0, n, lat, lon, ele, t, x, y, d, dt, step, mt, paused, v, rawV, lat0, proj,
    extras, grid, glitches, stops,
    total, elapsed: t[n - 1], moving: mt[n - 1],
    avg: total / Math.max(mt[n - 1], 1) * 3.6, vmax, vmaxD,
    gain: elevationGain(movingAvg(ele, 15), 0.5), eleMin: Math.min(...ele), eleMax: Math.max(...ele),
  };
  // out-and-back: split the profile at the turnaround (farthest point from the start)
  const force = [];
  if (Math.hypot(x[n - 1] - x[0], y[n - 1] - y[0]) < 300) {
    let far = 0, fd = -1;
    for (let i = 0; i < n; i++) { const r = Math.hypot(x[i] - x[0], y[i] - y[0]); if (r > fd) { fd = r; far = i; } }
    ride.turnD = d[far];
    force.push(Math.round(d[far] / GRID));
  }
  ride.segments = segmentProfile(grid.d, eleS, { from: 0, to: G - 1, force });
  return ride;
}

function fillNaN(arr) {
  const n = arr.length; let last = -1;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(arr[i])) {
      if (last === -1 && i > 0) for (let k = 0; k < i; k++) arr[k] = arr[i];
      else if (last >= 0 && i - last > 1) for (let k = last + 1; k < i; k++) arr[k] = arr[last] + (arr[i] - arr[last]) * (k - last) / (i - last);
      last = i;
    }
  }
  if (last === -1) arr.fill(0); else for (let k = last + 1; k < n; k++) arr[k] = arr[last];
}

// centred speed over +-w samples on the moving clock (km/h)
function windowSpeed(d, mt, w) {
  const n = d.length, out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - w), b = Math.min(n - 1, i + w);
    const tt = mt[b] - mt[a];
    out[i] = tt > 0 ? (d[b] - d[a]) / tt * 3.6 : 0;
  }
  return out;
}

export function inWindows(x, wins) { for (const [a, b] of wins) if (x >= a && x <= b) return true; return false; }

// GPS jumps: a lagging fix that catches up shows up as >=2 near-consecutive 1-s steps far faster
// than the neighbourhood (single-step jitter is left alone; the 7-s speed already smooths it).
function detectGlitches(d, rawV, spike) {
  const n = d.length;
  const wins = [];
  for (let i = 1; i < n; i++) {
    if (!spike[i]) continue;
    if (spike[i] === 2) { wins.push([d[i] - 150, d[i] + 80]); continue; }  // single teleport
    for (let k = i + 1; k <= Math.min(n - 1, i + 3); k++) if (spike[k]) { wins.push([d[i] - 150, d[k] + 80]); break; }
  }
  return mergeWindows(wins, 20);
}

export function mergeWindows(wins, gap = 0) {
  const w = wins.slice().sort((a, b) => a[0] - b[0]), out = [];
  for (const [a, b] of w) {
    if (out.length && a <= out[out.length - 1][1] + gap) out[out.length - 1][1] = Math.max(out[out.length - 1][1], b);
    else out.push([a, b]);
  }
  return out;
}

// Stops: consecutive samples that are stationary (<2 km/h over ~3 s) or auto-paused.
function detectStops(d, t, v1, paused, dt) {
  const n = d.length, stops = [];
  let i = 0;
  while (i < n) {
    const still = (k) => paused[k] || v1[k] < 2;
    if (!still(i)) { i++; continue; }
    let j = i;
    while (j + 1 < n && (still(j + 1) || d[j + 1] - d[i] < 3)) j++;
    let pausedS = 0, stillS = 0;
    for (let k = i + 1; k <= j; k++) { if (paused[k]) pausedS += dt[k]; else stillS += dt[k]; }
    if (paused[i] && i > 0) pausedS += dt[i];
    const dur = t[j] - t[Math.max(0, i - 1)];
    if (dur >= 5) stops.push({ d: d[i], i0: i, i1: j, t0: t[i], dur, paused: pausedS, still: dur - pausedS });
    i = j + 1;
  }
  // merge stops closer than 25 m
  const out = [];
  for (const s of stops) {
    const p = out[out.length - 1];
    if (p && s.d - p.d < 25) { p.i1 = s.i1; p.dur += s.dur; p.paused += s.paused; p.still += s.still; }
    else out.push({ ...s });
  }
  return out;
}

// Elevation gain with a small hysteresis to ignore noise (m)
export function elevationGain(ele, thr = 1.0) {
  let gain = 0, ref = ele[0];
  for (let i = 1; i < ele.length; i++) {
    if (ele[i] > ref + thr) { gain += ele[i] - ref; ref = ele[i]; }
    else if (ele[i] < ref) ref = ele[i];
  }
  return gain;
}

// ---- automatic grade segmentation on a distance grid -----------------------------------
export const GRADE_CLASSES = [
  { max: -5, key: 'steep-down', label: '陡下坡' },
  { max: -2, key: 'down', label: '下坡' },
  { max: -0.3, key: 'gentle-down', label: '緩下坡' },
  { max: 0.3, key: 'flat', label: '平路' },
  { max: 2, key: 'gentle-up', label: '緩上坡' },
  { max: 5, key: 'up', label: '上坡' },
  { max: Infinity, key: 'steep-up', label: '陡上坡' },
];
export function gradeClass(g) { for (const c of GRADE_CLASSES) if (g < c.max) return c; return GRADE_CLASSES[GRADE_CLASSES.length - 1]; }

// Douglas–Peucker (vertical tolerance) + merge of short pieces. Returns [{i0,i1,d0,d1,z0,z1,grade,cls}]
export function segmentProfile(gd, ele, { from = 0, to = gd.length - 1, minLen = 500, force = [] } = {}) {
  if (to - from < 2) return [];
  let lo = Infinity, hi = -Infinity;
  for (let i = from; i <= to; i++) { lo = Math.min(lo, ele[i]); hi = Math.max(hi, ele[i]); }
  const tol = Math.max(1.5, 0.03 * (hi - lo));
  const fixed = [from, ...force.filter(f => f > from && f < to), to].sort((p, q) => p - q);
  const keep = new Set(fixed);
  const stack = [];
  for (let k = 0; k < fixed.length - 1; k++) stack.push([fixed[k], fixed[k + 1]]);
  const isFixed = new Set(fixed);
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = -1, wd = 0;
    for (let i = a + 1; i < b; i++) {
      const z = ele[a] + (ele[b] - ele[a]) * (gd[i] - gd[a]) / (gd[b] - gd[a]);
      const dev = Math.abs(ele[i] - z);
      if (dev > wd) { wd = dev; worst = i; }
    }
    if (worst > 0 && wd > tol) { keep.add(worst); stack.push([a, worst], [worst, b]); }
  }
  let br = [...keep].sort((p, q) => p - q);
  const gradeOf = (a, b) => (ele[b] - ele[a]) / Math.max(gd[b] - gd[a], 1) * 100;
  // merge short pieces into the neighbour with the most similar grade
  for (;;) {
    let shortest = -1, sl = Infinity;
    for (let k = 0; k < br.length - 1; k++) { const L = gd[br[k + 1]] - gd[br[k]]; if (L < sl) { sl = L; shortest = k; } }
    if (sl >= minLen || br.length <= 2) break;
    const g = gradeOf(br[shortest], br[shortest + 1]);
    const left = shortest > 0 ? Math.abs(gradeOf(br[shortest - 1], br[shortest]) - g) : Infinity;
    const right = shortest + 1 < br.length - 1 ? Math.abs(gradeOf(br[shortest + 1], br[shortest + 2]) - g) : Infinity;
    const canL = shortest > 0 && !isFixed.has(br[shortest]);
    const canR = shortest + 1 < br.length - 1 && !isFixed.has(br[shortest + 1]);
    if (!canL && !canR) { if (sl >= 100) break; }
    if (canL && (left <= right || !canR)) br.splice(shortest, 1);
    else if (canR) br.splice(shortest + 1, 1);
    else break;
  }
  // merge neighbours of the same class with near-identical grade
  for (let k = 1; k < br.length - 1;) {
    const g1 = gradeOf(br[k - 1], br[k]), g2 = gradeOf(br[k], br[k + 1]);
    if (!isFixed.has(br[k]) && gradeClass(g1).key === gradeClass(g2).key && Math.abs(g1 - g2) < 0.25 && gd[br[k + 1]] - gd[br[k - 1]] < 3000) br.splice(k, 1);
    else k++;
  }
  const segs = [];
  for (let k = 0; k < br.length - 1; k++) {
    const a = br[k], b = br[k + 1], g = gradeOf(a, b);
    segs.push({ i0: a, i1: b, d0: gd[a], d1: gd[b], z0: ele[a], z1: ele[b], grade: g, cls: gradeClass(g) });
  }
  return segs;
}

// per-km splits on the moving clock
export function kmSplits(ride) {
  const out = [];
  for (let k = 1000; k <= ride.total + 1; k += 1000) {
    const a = firstCrossing(ride.d, ride.mt, k - 1000), b = firstCrossing(ride.d, ride.mt, k);
    out.push({ km: k / 1000, time: b - a, dist: 1000 });
  }
  const rest = ride.total % 1000;
  if (rest > 100) {
    const a = firstCrossing(ride.d, ride.mt, ride.total - rest);
    out.push({ km: ride.total / 1000, time: ride.mt[ride.n - 1] - a, dist: rest, partial: true });
  }
  return out;
}

// speed by grade band using 10 m cells (excluding stops and glitches)
export const GRADE_BINS = [[-99, -2, '下坡 < −2%'], [-2, -0.3, '緩下坡'], [-0.3, 0.3, '平路'], [0.3, 2, '緩上坡'], [2, 99, '上坡 > 2%']];
export function speedByGrade(ride) {
  const G = ride.grid, excl = [...ride.glitches, ...ride.stops.map(s => [s.d - 100, s.d + 130])];
  const acc = GRADE_BINS.map(([a, b, label]) => ({ label, lo: a, hi: b, dist: 0, time: 0 }));
  for (let j = 1; j < G.d.length; j++) {
    const mid = (G.d[j] + G.d[j - 1]) / 2;
    if (inWindows(mid, excl)) continue;
    const g = (G.grade[j] + G.grade[j - 1]) / 2, dtm = G.mt[j] - G.mt[j - 1];
    if (!(dtm > 0)) continue;
    for (const b of acc) if (g >= b.lo && g < b.hi) { b.dist += GRID; b.time += dtm; break; }
  }
  return acc.map(b => ({ ...b, v: b.time > 0 ? b.dist / b.time * 3.6 : NaN }));
}
