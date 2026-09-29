// Power estimation from GPS speed + elevation, without a power meter. Pure JS (browser + Node).
//
// Physics (per sample): P = [m·g·vz + Crr·m·g·v + ½·ρ·CdA·(v+w)|v+w|·v + m_eff·a·v] / η
//   gravity from the elevation change, rolling resistance, aerodynamic drag with a head-wind w,
//   kinetic energy, drivetrain efficiency η (a crank/pedal power meter measures before the drivetrain).
// Everything we cannot measure (CdA, Crr, η, wind, air density, elevation error) is drawn from a
// range many times (seeded, so the same file always gives the same numbers). The spread of the
// results is the uncertainty we show; segments whose 90 % range is too wide are not estimated.


const g = 9.81;

// ---- parameter ranges -------------------------------------------------------------------------
// CdA (m²) by hand position. Wind-tunnel values: tops 0.408, hoods 0.324, drops 0.307, clip-on
// aero bars 0.291 (Jeukendrup 2002); ranges widened for rider size and clothing.
export const POSITIONS = {
  tops: { label: '上把（最直立）', cda: [0.37, 0.45] },
  hoods: { label: '變把', cda: [0.32, 0.40] },
  drops: { label: '下把', cda: [0.29, 0.36] },
  aero: { label: '休息把', cda: [0.25, 0.31] },
  mixed: { label: '混著握', cda: [0.30, 0.42] },
  unknown: { label: '不確定', cda: [0.29, 0.45] },
};
// Rolling resistance on a lab drum at ~100 psi with a butyl tube (bicyclerollingresistance.com:
// GP5000 28 mm ≈ 10.3 W at 29 km/h / 42.5 kg → Crr ≈ 0.0031).
export const TIRES = {
  race: { label: '高效能競賽胎（GP5000、Corsa、P Zero Race 等）', crr: [0.0029, 0.0032] },
  standard: { label: '一般公路胎／耐磨胎', crr: [0.0036, 0.0050] },
  unknown: { label: '不確定', crr: [0.0029, 0.0050] },
};
export const TUBES = {
  light: { label: 'TPU／乳膠內胎', f: [0.93, 0.96] },
  butyl: { label: '一般丁基內胎', f: [0.99, 1.01] },
  tubeless: { label: '無內胎', f: [0.93, 0.97] },
  unknown: { label: '不確定', f: [0.93, 1.01] },
};
export const CHAINS = {
  clean: { label: '剛清潔上油', eta: [0.970, 0.980] },
  normal: { label: '一般', eta: [0.960, 0.975] },
  dirty: { label: '很髒／很久沒保養', eta: [0.950, 0.965] },
  unknown: { label: '不確定', eta: [0.950, 0.980] },
};
// wind at rider height (m/s), constant over the ride, random direction
export const WINDS = {
  none: { label: '幾乎沒風', sd: 0.5 },
  light: { label: '微風', sd: 1.2 },
  strong: { label: '明顯有風', sd: 2.5 },
  unknown: { label: '不確定', sd: 1.5 },
};
// GP5000 28 mm at 120/100/80/60 psi: 9.7/10.3/11.5/14.1 W → factor relative to 100 psi
const PSI_TABLE = [[60, 1.37], [80, 1.12], [100, 1.0], [120, 0.94]];
function psiFactor(psi) {
  if (!(psi > 0)) return [1.0, 1.15]; // unknown: assume 75–100 psi
  const p = Math.max(60, Math.min(120, psi));
  for (let k = 0; k < PSI_TABLE.length - 1; k++) {
    const [a, fa] = PSI_TABLE[k], [b, fb] = PSI_TABLE[k + 1];
    if (p >= a && p <= b) { const f = fa + (fb - fa) * (p - a) / (b - a); return [f * 0.98, f * 1.02]; }
  }
  return [1, 1];
}
const ROAD = [1.1, 1.5]; // real asphalt is rougher than the lab drum

export const CLIMB_GRADE = 2.0; // % — samples steeper than this use the climbing hand position
// Above 40 km/h (descents, sprints) riders often tuck or drop lower than their usual cruising
// position, so the drag range there is widened down to a low tuck (0.25 m²).
export const FAST = 40 / 3.6;
const TUCK = 0.25;

// Turn user settings into parameter ranges. Returns { ok, missing[], p } where p holds ranges.
export function paramRanges(settings = {}, ride = null) {
  const rider = settings.rider || {}, bike = settings.bike || {}, rs = settings.ride || {};
  const missing = [];
  const massKit = +rs.massKit > 0 ? +rs.massKit : +rider.massKit;
  if (!(massKit > 30 && massKit < 200)) return { ok: false, missing: ['massKit'] };
  const bikeMass = +bike.mass > 3 && +bike.mass < 30 ? [+bike.mass - 0.2, +bike.mass + 0.2] : (missing.push('bikeMass'), [7.5, 10.5]);
  const tire = TIRES[bike.tire] || (missing.push('tire'), TIRES.unknown);
  const tube = TUBES[bike.tube] || (missing.push('tube'), TUBES.unknown);
  if (!(+bike.psi > 0)) missing.push('psi');
  const pf = psiFactor(+bike.psi);
  const chain = CHAINS[bike.chain] || (missing.push('chain'), CHAINS.unknown);
  const climbPos = POSITIONS[rs.climbPos] || (missing.push('climbPos'), POSITIONS.unknown);
  const flatPos = POSITIONS[rs.flatPos] || (missing.push('flatPos'), POSITIONS.unknown);
  const wind = WINDS[rs.wind] || (missing.push('wind'), WINDS.unknown);
  // air density from temperature and the ride's mean elevation (dry air, standard pressure)
  const zMean = ride ? (ride.eleMin + ride.eleMax) / 2 : 100;
  const pAir = 101325 * Math.pow(1 - 2.25577e-5 * zMean, 5.25588);
  const rhoAt = (tc) => pAir / (287.05 * (tc + 273.15));
  const temp = Number.isFinite(+rs.tempC) && rs.tempC !== '' && rs.tempC != null ? +rs.tempC : null;
  if (temp == null) missing.push('tempC');
  const rho = temp == null ? [rhoAt(35), rhoAt(10)] : [rhoAt(temp) * 0.985, rhoAt(temp) * 1.01];
  const drafting = rs.drafting === 'yes' ? 'yes' : rs.drafting === 'no' ? 'no' : (missing.push('drafting'), 'unknown');
  return {
    ok: true, missing,
    p: {
      mass: [massKit - 0.3 + bikeMass[0], massKit + 0.3 + bikeMass[1]], massKit,
      crrBase: tire.crr, tube: tube.f, psi: pf, road: ROAD,
      cdaClimb: climbPos.cda, cdaFlat: flatPos.cda, eta: chain.eta, rho, windSd: wind.sd, drafting,
    },
  };
}

// ---- random numbers (deterministic) -----------------------------------------------------------
export function rng(seed = 1) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return {
    u: (lo, hi) => lo + (hi - lo) * next(),
    n: (sd = 1) => { let u = 0, v = 0; while (u === 0) u = next(); v = next(); return sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); },
  };
}
const mid = ([a, b]) => (a + b) / 2;
const U = (r, [a, b]) => r.u(a, b);

// one "true world" draw of every uncertain parameter
function drawParams(p, r, fix = null) {
  const q = {
    mass: U(r, p.mass), cdaClimb: U(r, p.cdaClimb), cdaFlat: U(r, p.cdaFlat), cdaFast: r.u(Math.min(TUCK, p.cdaFlat[0]), p.cdaFlat[1]),
    crr: U(r, p.crrBase) * U(r, p.tube) * U(r, p.psi) * U(r, p.road), eta: U(r, p.eta), rho: U(r, p.rho),
    wind: Math.abs(r.n(p.windSd)), windDir: r.u(0, 2 * Math.PI),
  };
  if (fix) for (const k in fix) q[k] = fix[k];
  return q;
}
function nominalParams(p) {
  return { mass: mid(p.mass), cdaClimb: mid(p.cdaClimb), cdaFlat: mid(p.cdaFlat), cdaFast: (Math.min(TUCK, p.cdaFlat[0]) + p.cdaFlat[1]) / 2,
    crr: mid(p.crrBase) * mid(p.tube) * mid(p.psi) * mid(p.road), eta: mid(p.eta), rho: mid(p.rho), wind: 0, windDir: 0 };
}

// ---- per-sample kinematics --------------------------------------------------------------------
export function kinematics(ride) {
  const n = ride.n, t = ride.t, v = Float64Array.from(ride.v, x => x / 3.6);
  const cdiff = (a, k) => { const o = new Float64Array(n); for (let i = 0; i < n; i++) { const lo = Math.max(0, i - k), hi = Math.min(n - 1, i + k); o[i] = (a[hi] - a[lo]) / Math.max(t[hi] - t[lo], 1e-6); } return o; };
  const acc = cdiff(v, 2), vz = cdiff(ride.ele, 5);
  const hx = cdiff(ride.x, 3), hy = cdiff(ride.y, 3);
  for (let i = 0; i < n; i++) { const h = Math.hypot(hx[i], hy[i]) || 1; hx[i] /= h; hy[i] /= h; }
  // grade along the road (for choosing the hand position), from the 10 m grid
  const G = ride.grid, grade = new Float64Array(n);
  for (let i = 0; i < n; i++) grade[i] = G.grade[Math.min(G.grade.length - 1, Math.round(ride.d[i] / 10))];
  // usable samples: moving, no recording gap, not stopped
  const ok = new Uint8Array(n);
  for (let i = 1; i < n; i++) ok[i] = !ride.paused[i] && ride.dt[i] <= 3 && ride.v[i] >= 2 ? 1 : 0;
  // elevation source: a basemap / barometric profile is smooth sample to sample, raw GPS altitude
  // jumps by metres (RMS of the second difference ≈ 0.1 m vs ≈ 2 m)
  let s2 = 0, c2 = 0;
  for (let i = 1; i < n - 1; i++) if (ride.dt[i] <= 2 && ride.dt[i + 1] <= 2) { s2 += (ride.ele[i + 1] - 2 * ride.ele[i] + ride.ele[i - 1]) ** 2; c2++; }
  const eleNoise = c2 ? Math.sqrt(s2 / c2) : 0;
  // recording gaps while moving (power unknown) — best-effort windows must not span them
  const gap = new Uint8Array(n);
  for (let i = 1; i < n; i++) gap[i] = !ride.paused[i] && ride.dt[i] > 5 ? 1 : 0;
  return { n, t, v, acc, vz, hx, hy, grade, ok, gap, dt: ride.dt, d: ride.d, ele: ride.ele, eleNoise, dhSd: eleNoise < 0.4 ? 1.5 : 4 };
}

// power of every sample for one parameter draw (W at the cranks; negative = coasting/braking)
function samplePower(K, q, out) {
  const wx = -q.wind * Math.sin(q.windDir), wy = -q.wind * Math.cos(q.windDir);
  for (let i = 0; i < K.n; i++) {
    if (!K.ok[i]) { out[i] = NaN; continue; }
    const v = K.v[i], va = v - (wx * K.hx[i] + wy * K.hy[i]);
    const cda = K.grade[i] >= CLIMB_GRADE ? q.cdaClimb : v > FAST ? q.cdaFast : q.cdaFlat;
    out[i] = (q.mass * g * K.vz[i] + q.crr * q.mass * g * v + 0.5 * q.rho * cda * va * Math.abs(va) * v + (q.mass + 1) * K.acc[i] * v) / q.eta;
  }
  return out;
}

// energy balance over [i0, i1] (used for climbs: robust to per-sample noise). Returns W.
function segmentPower(K, i0, i1, q, dhErr = 0) {
  const wx = -q.wind * Math.sin(q.windDir), wy = -q.wind * Math.cos(q.windDir);
  let T = 0, Ea = 0, Er = 0;
  for (let i = i0 + 1; i <= i1; i++) {
    if (!K.ok[i]) continue;
    const dt = K.dt[i], v = K.v[i], va = v - (wx * K.hx[i] + wy * K.hy[i]);
    const cda = K.grade[i] >= CLIMB_GRADE ? q.cdaClimb : v > FAST ? q.cdaFast : q.cdaFlat;
    T += dt; Ea += 0.5 * q.rho * cda * va * Math.abs(va) * v * dt; Er += q.crr * q.mass * g * v * dt;
  }
  const Eg = q.mass * g * (K.ele[i1] - K.ele[i0] + dhErr);
  const Ek = 0.5 * (q.mass + 1) * (K.v[i1] ** 2 - K.v[i0] ** 2);
  return T > 0 ? (Ea + Er + Eg + Ek) / q.eta / T : NaN;
}

const pct = (arr, p) => { const a = Float64Array.from(arr).filter(Number.isFinite).sort(); if (!a.length) return NaN; const k = (a.length - 1) * p, lo = Math.floor(k); return a[lo] + (a[Math.min(a.length - 1, lo + 1)] - a[lo]) * (k - lo); };
export function summarize(samples) {
  const med = pct(samples, 0.5), lo = pct(samples, 0.05), hi = pct(samples, 0.95);
  const half = med > 0 ? (hi - lo) / 2 / med : Infinity;
  return { med, lo, hi, half, tier: tierOf(half) };
}
export const TIERS = { good: 0.08, fair: 0.15 };
export function tierOf(half) { return half <= TIERS.good ? 'good' : half <= TIERS.fair ? 'fair' : 'none'; }

// ---- climbs -----------------------------------------------------------------------------------
// Merge consecutive profile segments steeper than 2 %; keep climbs with ≥ 20 m gain, ≥ 2.5 % and
// ≥ 60 s; split them where the recording has a gap or the rider stopped.
export function findClimbs(ride, K) {
  const segs = ride.segments, runs = [];
  let cur = null;
  for (const s of segs) {
    if (s.grade >= 2.0) { if (cur) cur.d1 = s.d1; else cur = { d0: s.d0, d1: s.d1 }; }
    else if (cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  const idxAt = (dd) => { let lo = 0, hi = K.n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (K.d[m] < dd) lo = m; else hi = m; } return hi; };
  const out = [];
  for (const r of runs) {
    let a = idxAt(r.d0), b = idxAt(r.d1);
    // split where the recording has a gap or the rider stopped
    let s = a;
    for (let i = a + 1; i <= b; i++) if (!K.ok[i]) { if (i - 1 > s) out.push({ i0: s, i1: i - 1 }); s = i; }
    if (b > s) out.push({ i0: s, i1: b });
  }
  return out.map(c => {
    const len = K.d[c.i1] - K.d[c.i0], gain = K.ele[c.i1] - K.ele[c.i0];
    let T = 0; for (let i = c.i0 + 1; i <= c.i1; i++) if (K.ok[i]) T += K.dt[i];
    return { ...c, d0: K.d[c.i0], d1: K.d[c.i1], len, gain, grade: gain / Math.max(len, 1) * 100, time: T };
  }).filter(c => c.gain >= 20 && c.grade >= 2.5 && c.time >= 60);
}

// ---- main entry -------------------------------------------------------------------------------
// opts: { draws, seed, routeDraws }
export function analyzePower(ride, settings, opts = {}) {
  const R = paramRanges(settings, ride);
  if (!R.ok) return { ok: false, missing: R.missing };
  const p = R.p, K = kinematics(ride);
  const N = opts.draws ?? 800, NR = opts.routeDraws ?? 200, seed = opts.seed ?? 20260928;
  const r = rng(seed);
  const draws = Array.from({ length: N }, () => drawParams(p, r));
  const climbs = findClimbs(ride, K);
  const dh = draws.map(() => climbs.map(() => r.n(K.dhSd)));
  const nom = nominalParams(p);
  const massKit = p.massKit;
  const drafting = p.drafting === 'yes';

  // climbs
  for (const [k, c] of climbs.entries()) {
    const s = summarize(draws.map((q, j) => segmentPower(K, c.i0, c.i1, q, dh[j][k])));
    Object.assign(c, s, { nominal: segmentPower(K, c.i0, c.i1, nom), wkg: s.med / massKit, speed: c.len / c.time * 3.6 });
    if (drafting && !(c.grade >= 4 && c.speed < 20)) c.tier = 'none';
    c.measured = measuredAvg(ride, c.i0, c.i1, K);
  }

  // per-sample power for every draw → whole-ride average and best windows
  const buf = new Float64Array(K.n);
  const nomP = samplePower(K, nom, new Float64Array(K.n));
  const bestWin = (P, W) => bestWindow(K, P, W);
  const wins = { 300: bestWin(nomP, 300), 1200: bestWin(nomP, 1200) };
  const whole = [], w300 = [], w1200 = [];
  for (const q of draws) {
    samplePower(K, q, buf);
    whole.push(meanClipped(K, buf, 1, K.n - 1));
    if (wins[300]) w300.push(meanElapsed(K, buf, wins[300].i0, wins[300].i1));
    if (wins[1200]) w1200.push(meanElapsed(K, buf, wins[1200].i0, wins[1200].i1));
  }
  const W = { ...summarize(whole), time: movingTime(K, 1, K.n - 1) };
  const oneWay = headingImbalance(K, 1, K.n - 1);
  if (drafting) W.tier = 'none';
  const best = {};
  for (const [secs, arr] of [[300, w300], [1200, w1200]]) {
    const w = wins[secs]; if (!w) continue;
    const s = summarize(arr);
    best[secs] = { ...w, ...s, wkg: s.med / massKit, climbShare: climbShare(K, w.i0, w.i1), oneWay: headingImbalance(K, w.i0, w.i1) };
    if (drafting && best[secs].climbShare < 0.8) best[secs].tier = 'none';
  }

  // FTP: only from a trustworthy effort of at least 15 minutes
  let ftp = null;
  const longClimb = climbs.filter(c => c.time >= 900 && c.tier === 'good').sort((a, b) => b.med - a.med)[0];
  const b20 = best[1200] && best[1200].tier === 'good' ? best[1200] : null;
  const src = longClimb && (!b20 || longClimb.med >= b20.med) ? { kind: 'climb', ...longClimb } : b20 ? { kind: 'best20', ...b20 } : null;
  if (src) {
    // 60-min ≈ 20-min × 0.88 (recreational) … 0.95 (well trained) — Allen & Coggan update, Univ. of
    // Zaragoza (120 riders). A 15–20 min effort is ~3–5 % above 20-min power, so its factor is lower;
    // longer efforts are closer to the one-hour value. Assumes the effort was ridden flat out.
    const dur = src.kind === 'climb' ? src.time : 1200;
    const f = dur >= 3000 ? [0.97, 1.0] : dur >= 1800 ? [0.92, 0.98] : dur >= 1200 ? [0.88, 0.95] : [0.84, 0.92];
    ftp = { lo: src.lo * f[0], hi: src.hi * f[1], med: src.med * (f[0] + f[1]) / 2, source: src, factor: f };
    ftp.wkg = ftp.med / massKit;
  }

  // route series: 30-s smoothed power band on 10-s bins
  const route = routeBand(K, p, r, NR);
  // where do the errors come from (best climb)
  const top = climbs.filter(c => c.tier !== 'none').sort((a, b) => (a.half - b.half))[0];
  const budget = top ? errorBudget(K, p, top, seed) : null;

  return { ok: true, missing: R.missing, params: p, K, climbs, whole: { ...W, oneWay }, best, ftp, route, budget, budgetClimb: top || null, massKit, drafting, eleNoise: K.eleNoise };
}

function movingTime(K, i0, i1) { let T = 0; for (let i = i0 + 1; i <= i1; i++) if (K.ok[i]) T += K.dt[i]; return T; }
function meanClipped(K, P, i0, i1) { let T = 0, E = 0; for (let i = i0 + 1; i <= i1; i++) if (K.ok[i] && Number.isFinite(P[i])) { T += K.dt[i]; E += Math.max(0, P[i]) * K.dt[i]; } return T > 0 ? E / T : NaN; }
function meanElapsed(K, P, i0, i1) { let T = 0, E = 0; for (let i = i0 + 1; i <= i1; i++) { T += K.dt[i]; if (K.ok[i] && Number.isFinite(P[i])) E += Math.max(0, P[i]) * K.dt[i]; } return T > 0 ? E / T : NaN; }
// share of the time spent on climbs (grade ≥ 2 %)
function climbShare(K, i0, i1) { let T = 0, C = 0; for (let i = i0 + 1; i <= i1; i++) if (K.ok[i]) { T += K.dt[i]; if (K.grade[i] >= CLIMB_GRADE) C += K.dt[i]; } return T ? C / T : 0; }
// 0 = headings cancel (loop / out-and-back), 1 = all one direction (wind cannot cancel)
function headingImbalance(K, i0, i1) { let T = 0, X = 0, Y = 0; for (let i = i0 + 1; i <= i1; i++) if (K.ok[i]) { T += K.dt[i]; X += K.hx[i] * K.dt[i]; Y += K.hy[i] * K.dt[i]; } return T ? Math.hypot(X, Y) / T : 1; }
// best average (clipped) power over W seconds of elapsed time. Short stops count as zero; windows
// that span a recording gap or are more than 10 % stopped are skipped (they are not one effort)
function bestWindow(K, P, W) {
  const n = K.n, cumT = new Float64Array(n), cumE = new Float64Array(n), cumG = new Float64Array(n), cumS = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const ok = K.ok[i] && Number.isFinite(P[i]);
    cumT[i] = cumT[i - 1] + K.dt[i]; cumE[i] = cumE[i - 1] + (ok ? Math.max(0, P[i]) * K.dt[i] : 0);
    cumG[i] = cumG[i - 1] + K.gap[i]; cumS[i] = cumS[i - 1] + (K.ok[i] ? 0 : K.dt[i]);
  }
  if (cumT[n - 1] < W) return null;
  let best = null, j = 0;
  for (let i = 1; i < n; i++) {
    while (j < i && cumT[i] - cumT[j + 1] >= W) j++;
    const span = cumT[i] - cumT[j];
    if (span < W * 0.98 || span > W * 1.1 || cumG[i] - cumG[j] > 0 || cumS[i] - cumS[j] > 0.1 * W) continue; // no gaps, ≤ 10 % stopped
    const e = (cumE[i] - cumE[j]) / span;
    if (!best || e > best.p) best = { p: e, i0: j, i1: i };
  }
  if (!best) return null;
  return { i0: best.i0, i1: best.i1, d0: K.d[best.i0], d1: K.d[best.i1], secs: W };
}

function measuredAvg(ride, i0, i1, K) {
  const pw = ride.extras?.power; if (!pw) return null;
  let T = 0, E = 0; for (let i = i0 + 1; i <= i1; i++) if (K.ok[i]) { T += K.dt[i]; E += pw[i] * K.dt[i]; }
  return T ? E / T : null;
}

function routeBand(K, p, r, NR) {
  // 10-s bins on the moving clock
  const bins = []; let acc = 0, start = 1;
  for (let i = 1; i < K.n; i++) {
    if (K.ok[i]) acc += K.dt[i];
    if (acc >= 10 || i === K.n - 1) { bins.push([start, i]); start = i + 1; acc = 0; }
  }
  const B = bins.length, smooth = 3; // ±3 bins ≈ 70 s window → ~30-s-ish visual smoothing
  const store = Array.from({ length: B }, () => new Float32Array(NR));
  const buf = new Float64Array(K.n);
  const binMean = (P, [a, b]) => { let T = 0, E = 0; for (let i = a; i <= b; i++) if (K.ok[i] && Number.isFinite(P[i])) { T += K.dt[i]; E += Math.max(0, P[i]) * K.dt[i]; } return T > 3 ? E / T : NaN; };
  for (let j = 0; j < NR; j++) {
    samplePower(K, drawParams(p, r), buf);
    const m = bins.map(bn => binMean(buf, bn));
    for (let b = 0; b < B; b++) {
      let s = 0, c = 0; for (let k = Math.max(0, b - smooth); k <= Math.min(B - 1, b + smooth); k++) if (Number.isFinite(m[k])) { s += m[k]; c++; }
      store[b][j] = c ? s / c : NaN;
    }
  }
  const x = new Float64Array(B), med = new Float64Array(B), lo = new Float64Array(B), hi = new Float64Array(B), tier = [];
  for (let b = 0; b < B; b++) {
    const [a, e] = bins[b]; x[b] = (K.d[a] + K.d[e]) / 2;
    const s = summarize(store[b]); med[b] = s.med; lo[b] = s.lo; hi[b] = s.hi;
    // tier of a short stretch: low power (coasting) is shown but never called reliable
    tier.push(!(s.med > 40) ? 'none' : s.tier);
  }
  return { x, med, lo, hi, tier };
}

// how much each uncertain input contributes to the 90 % range of one climb (others held at mid)
function errorBudget(K, p, c, seed) {
  const nom = nominalParams(p), n = 300;
  const groups = [
    ['風', (r) => ({ wind: Math.abs(r.n(p.windSd)), windDir: r.u(0, 2 * Math.PI) })],
    ['高度資料', null],
    ['輪胎滾阻', (r) => ({ crr: U(r, p.crrBase) * U(r, p.tube) * U(r, p.psi) * U(r, p.road) })],
    ['騎姿風阻', (r) => ({ cdaClimb: U(r, p.cdaClimb), cdaFlat: U(r, p.cdaFlat), cdaFast: r.u(Math.min(TUCK, p.cdaFlat[0]), p.cdaFlat[1]) })],
    ['傳動效率', (r) => ({ eta: U(r, p.eta) })],
    ['重量', (r) => ({ mass: U(r, p.mass) })],
    ['氣溫', (r) => ({ rho: U(r, p.rho) })],
  ];
  const out = [];
  for (const [name, f] of groups) {
    const r = rng(seed + name.length * 7919), vals = [];
    for (let j = 0; j < n; j++) vals.push(f ? segmentPower(K, c.i0, c.i1, { ...nom, ...f(r) }) : segmentPower(K, c.i0, c.i1, nom, r.n(K.dhSd)));
    const s = summarize(vals); out.push({ name, half: s.half });
  }
  return out.sort((a, b) => b.half - a.half);
}

// ---- comparison: the same climb ridden twice --------------------------------------------------
// sameBike/samePos share those draws between rides; elevation error is always shared (same road,
// same elevation map), wind is independent. Returns per-climb { a, b, diff (b vs a, %) }.
export function compareClimbs(rideA, setA, rideB, setB, pairs, opts = {}) {
  const RA = paramRanges(setA, rideA), RB = paramRanges(setB, rideB);
  if (!RA.ok || !RB.ok) return { ok: false, missing: [...(RA.missing || []), ...(RB.missing || [])] };
  const KA = kinematics(rideA), KB = kinematics(rideB);
  const sameBike = !!(setA.bike?.id && setA.bike.id === setB.bike?.id);
  const samePos = !!(setA.ride?.climbPos && setA.ride.climbPos === setB.ride?.climbPos && setA.ride.climbPos !== 'unknown');
  const sameFlat = !!(setA.ride?.flatPos && setA.ride.flatPos === setB.ride?.flatPos && setA.ride.flatPos !== 'unknown');
  const r = rng(opts.seed ?? 20260928), N = opts.draws ?? 600;
  const needClip = pairs.some(pr => pr.mode === 'clipped');
  const bufA = new Float64Array(KA.n), bufB = new Float64Array(KB.n);
  const res = pairs.map(() => ({ a: [], b: [], diff: [] }));
  for (let j = 0; j < N; j++) {
    const qa = drawParams(RA.p, r);
    const fix = {};
    if (sameBike) { fix.crr = qa.crr; fix.eta = qa.eta; }
    if (samePos) fix.cdaClimb = qa.cdaClimb;
    if (sameFlat) { fix.cdaFlat = qa.cdaFlat; fix.cdaFast = qa.cdaFast; }
    const qb = drawParams(RB.p, r, fix);
    if (needClip) { samplePower(KA, qa, bufA); samplePower(KB, qb, bufB); }
    pairs.forEach((pr, k) => {
      let a, b;
      if (pr.mode === 'clipped') { a = meanRanges(KA, bufA, pr.a); b = meanRanges(KB, bufB, pr.b); }
      else { const dhe = r.n(Math.max(KA.dhSd, KB.dhSd)); a = segmentPower(KA, pr.a[0], pr.a[1], qa, dhe); b = segmentPower(KB, pr.b[0], pr.b[1], qb, dhe); }
      res[k].a.push(a); res[k].b.push(b); res[k].diff.push((b / a - 1) * 100);
    });
  }
  return {
    ok: true, sameBike, samePos, sameFlat,
    rows: pairs.map((pr, k) => {
      const d = res[k].diff, dm = pct(d, 0.5), dl = pct(d, 0.05), dh = pct(d, 0.95);
      const A = summarize(res[k].a), B = summarize(res[k].b), half = (dh - dl) / 2;
      return { ...pr, A, B, diff: { med: dm, lo: dl, hi: dh, half, tier: half <= 3 ? 'good' : half <= 6 ? 'fair' : 'none' } };
    }),
  };
}
function meanRanges(K, P, ranges) {
  let T = 0, E = 0;
  for (const [i0, i1] of ranges) for (let i = i0 + 1; i <= i1; i++) if (K.ok[i] && Number.isFinite(P[i])) { T += K.dt[i]; E += Math.max(0, P[i]) * K.dt[i]; }
  return T > 0 ? E / T : NaN;
}
