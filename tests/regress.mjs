// Regression against the 2026-09-21 manual analysis (fixtures are private, not in the repo).
import { readFileSync, existsSync } from 'node:fs';
import { parseGPX } from '../js/gpx.js';
import { prepareRide } from '../js/ride.js';
import { compareRides } from '../js/compare.js';
import { interp } from '../js/util.js';
import { analyzePower, compareClimbs, paramRanges } from '../js/power.js';
const fx = (f) => new URL('../private/fixtures/' + f, import.meta.url);
// physics sanity check on a synthetic ride (always runs): 25 min at 11 km/h up a steady 7 % grade
{
  const pts = [], t0 = Date.UTC(2026, 8, 28), v = 11 / 3.6; let d = 0, z = 100;
  for (let i = 0; i <= 1500; i++) { pts.push({ lat: 24.8 + d / 111320, lon: 121, ele: z, t: t0 + i * 1000 }); d += v; z += v * 0.07; }
  const P = analyzePower(prepareRide({ name: 'synthetic', points: pts }, {}), { rider: { massKit: 70 },
    bike: { id: 'x', mass: 8, tire: 'race', tube: 'light', psi: 90, chain: 'normal' }, ride: { climbPos: 'hoods', flatPos: 'hoods', wind: 'none', tempC: 20, drafting: 'no' } });
  const c = P.climbs[0];
  const ok = c && Math.abs(c.med - 185) <= 3 && c.tier === 'good' && P.ftp && P.ftp.lo > 150 && P.ftp.hi < 185;
  console.log(`${ok ? 'PASS' : 'FAIL'} synthetic 7 % climb: ${c ? Math.round(c.med) : '—'} W (want 185 ±3, tier good) FTP ${P.ftp ? Math.round(P.ftp.lo) + '–' + Math.round(P.ftp.hi) : '—'}`);
  if (!ok) process.exitCode = 1;
}
if (!existsSync(fx('2025-09-21_before.gpx'))) { console.log('SKIP: private fixtures missing'); process.exit(process.exitCode || 0); }
const B = prepareRide(parseGPX(readFileSync(fx('2025-09-21_before.gpx'), 'utf8')), { id: 'before' });
const A = prepareRide(parseGPX(readFileSync(fx('2026-09-21_after.gpx'), 'utf8')), { id: 'after' });
let fails = 0;
const check = (label, got, want, tol) => { const ok = Math.abs(got - want) <= tol; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${got.toFixed(1)} (want ${want} ±${tol})`); };
check('before moving time', B.moving, 2076, 1); check('after moving time', A.moving, 1435, 1);
check('after max speed', A.vmax, 45.9, 0.3); check('before max speed', B.vmax, 40.4, 0.3);
const stopA = A.stops.find(s => Math.abs(s.d - 4850) < 30); check('after stop duration', stopA ? stopA.dur : -1, 28, 1);
for (const [label, secs] of [['manual sections', [[200, 880], [930, 5640], [5940, 11400]]], ['auto sections', null]]) {
  const c = compareRides(A, B, secs ? { sections: secs } : {});
  if (c.error) { console.log('FAIL', label, c.error); fails++; continue; }
  console.log(`-- ${label}: ref=${c.R.id} sections=${JSON.stringify(c.sections.map(([a, b]) => [a, b]))} zones=${JSON.stringify(c.zones.map(z => [z.type, Math.round(z.a), Math.round(z.b)]))}`);
  const endR = c.T.R[c.T.R.length - 1], endO = c.T.O[c.T.O.length - 1];
  const gap = endR - endO; // after(R) − before(O): negative = after faster
  const j = c.grid.indexOf(930) >= 0 ? c.grid.indexOf(930) : c.grid.findIndex(s => s >= 930);
  const gapJ = (endR - c.T.R[j]) - (endO - c.T.O[j]);
  const gapAdj = c.Tadj.R[c.Tadj.R.length - 1] - c.Tadj.O[c.Tadj.O.length - 1];
  const gapAdjJ = (c.Tadj.R[c.Tadj.R.length - 1] - c.Tadj.R[j]) - (c.Tadj.O[c.Tadj.O.length - 1] - c.Tadj.O[j]);
  const tol = secs ? 1.0 : 4.0;
  check(label + ' gap from start', gap, -32.9, tol); check(label + ' gap from junction', gapJ, -18.6, tol);
  check(label + ' adjusted from start', gapAdj, -53.4, tol + 1); check(label + ' adjusted from junction', gapAdjJ, -39.1, tol + 1);
  if (secs) {
    const segT = (a, b) => (interp(b, c.grid, c.T.R) - interp(a, c.grid, c.T.R)) - (interp(b, c.grid, c.T.O) - interp(a, c.grid, c.T.O));
    for (const [n, a, b, want] of [['D1', 930, 1800, 11.3], ['D2', 1800, 4000, 2.9], ['D3', 4000, 5640, 16.1], ['C1', 5940, 7600, -14.1], ['C2', 7600, 9300, -9.4], ['C3', 9300, 10490, -16.1], ['收尾', 10490, 11400, -9.3]]) check('segment ' + n, segT(a, b), want, 1.0);
  }
  console.log('   stops', c.stops.map(s => `${s.who}@${(s.s/1000).toFixed(2)} cost=${(s.cost ?? 0).toFixed(1)}`).join(' '), ' glitches', JSON.stringify(c.glitches.map(w => w.map(Math.round))));
  console.log('   segments', c.segments.map(s => `${(s.d0/1000).toFixed(2)}-${(s.d1/1000).toFixed(2)} ${s.grade.toFixed(1)}% Δ${(s.tR - s.tO).toFixed(0)}`).join(' | '));
  console.log('   bins', c.bins.map(b => `${b.label} ${b.vO.toFixed(1)}→${b.vR.toFixed(1)} (${b.dist}m)`).join(' | '));
}
// a ride with a frozen GPS fix that jumps 171 m, then a 276 s recording gap
{
  const p = fx('2026-09-23_ride.gpx');
  if (existsSync(p)) {
    const R = prepareRide(parseGPX(readFileSync(p, 'utf8')), { id: '2026-09-23' });
    check('glitch ride: max speed is plausible', R.vmax, 43.8, 0.5);
    check('glitch ride: jump is flagged', R.glitches.some(([a, b]) => a < 19155 && b > 19155) ? 1 : 0, 1, 0);
    check('glitch ride: distance keeps the jump (as Strava does)', R.total / 1000, 23.27, 0.05);
    check('glitch ride: 276 s recording gap counts as moving time', R.moving, 3066, 2);
  } else console.log('SKIP glitch-ride checks (fixture missing)');
}

// order independence and self-comparison
{
  const c = compareRides(B, A);
  const gap = c.T.R[c.T.R.length - 1] - c.T.O[c.T.O.length - 1];
  check('swapped input picks after as reference', c.R.id === 'after' ? 1 : 0, 1, 0);
  check('swapped input gap', gap, -36.2, 0.5);
  const s = compareRides(A, A);
  check('self-compare gap', s.T.R[s.T.R.length - 1] - s.T.O[s.T.O.length - 1], 0, 0.5);
  check('self-compare coverage km', s.compLen / 1000, 11.2, 0.3);
}

// power estimation (numbers from the 2026-09-28 hand analysis with the rider's own inputs)
{
  const p = fx('2026-09-28_xinpu.gpx');
  if (existsSync(p)) {
    const X = prepareRide(parseGPX(readFileSync(p, 'utf8')), { id: '2026-09-28' });
    const S = { rider: { massKit: 68.8 }, bike: { id: 'caad10', mass: 7.75, tire: 'race', tube: 'light', chain: 'normal' },
      ride: { climbPos: 'tops', flatPos: 'unknown', wind: 'none', tempC: 31, drafting: 'no' } };
    const P = analyzePower(X, S);
    check('power: two climbs found', P.climbs.length, 2, 0);
    const [c1, c2] = P.climbs;
    check('power: outbound climb (3 min) W', c1.med, 222, 4); check('power: outbound climb tier good', c1.tier === 'good' ? 1 : 0, 1, 0);
    check('power: outbound climb ±%', c1.half * 100, 6, 1.5);
    check('power: return climb (6 min) W', c2.med, 191, 4); check('power: return climb tier good', c2.tier === 'good' ? 1 : 0, 1, 0);
    check('power: descent sprint window is not estimated', P.best[300]?.tier === 'none' ? 1 : 0, 1, 0);
    check('power: no 20-min window across the break / recording gap', P.best[1200] ? 0 : 1, 1, 0);
    check('power: no FTP without a long reliable climb', P.ftp ? 0 : 1, 1, 0);
    check('power: basemap elevation detected as smooth', P.K.dhSd, 1.5, 0);
    const P2 = analyzePower(X, S);
    check('power: deterministic', P2.climbs[0].med - c1.med, 0, 0);
    check('power: needs the rider weight', analyzePower(X, { ...S, rider: {} }).ok ? 0 : 1, 1, 0);
    check('power: unknown inputs widen the range', analyzePower(X, { rider: { massKit: 68.8 } }).climbs[0].half * 100, 12, 5);
    const cc = compareClimbs(X, S, X, S, P.climbs.map(c => ({ a: [c.i0, c.i1], b: [c.i0, c.i1] })));
    check('power: same climb vs itself ~0 %', cc.rows[0].diff.med, 0, 1);
  } else console.log('SKIP power checks (fixture missing)');
  const Sflat = { rider: { massKit: 72 }, bike: { id: 'caad10', mass: 7.17, tire: 'race', tube: 'unknown', chain: 'normal' }, ride: { climbPos: 'unknown', flatPos: 'mixed', wind: 'unknown', tempC: 30, drafting: 'no' } };
  const W = analyzePower(A, Sflat).whole;
  check('power: flat out-and-back whole-ride W', W.med, 165, 6); check('power: flat whole ride only "fair"', W.tier === 'fair' ? 1 : 0, 1, 0);
  check('power: drafting hides the flat estimate', analyzePower(A, { ...Sflat, ride: { ...Sflat.ride, drafting: 'yes' } }).whole.tier === 'none' ? 1 : 0, 1, 0);
  check('power: air density at 31 °C, ~100 m', paramRanges({ rider: { massKit: 70 }, ride: { tempC: 31 } }, { eleMin: 55, eleMax: 144 }).p.rho.reduce((a, b) => a + b) / 2, 1.144, 0.005);
}
if (process.exitCode) fails++; // the synthetic check above
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
