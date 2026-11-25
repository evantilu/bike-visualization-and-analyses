import assert from 'node:assert/strict';
import { parseFIT } from '../js/fit.js';
import { parseGPX } from '../js/gpx.js';
import { prepareRide } from '../js/ride.js';
import { compareRides } from '../js/compare.js';
import { sensorMeans } from '../js/samples.js';

await assert.rejects(() => parseFIT(new Uint8Array([0, 1, 2])), /無法解析 FIT/);

const start = Date.UTC(2026, 0, 1);
const points = Array.from({ length: 401 }, (_, i) => ({
  t: start + i * 1000, lat: 25, lon: 121 + i * 0.0001, ele: 20 + i * 0.01,
  power: i === 100 ? undefined : i < 200 ? 0 : 200, hr: 150,
}));
const noGps = { t: start + 100_500, power: 175, hr: 155 };
const fit = prepareRide({
  format: 'FIT', points: [...points.slice(0, 101), noGps, ...points.slice(101)],
  laps: [{ start, end: start + 200_000 }, { start: start + 200_000, end: start + 400_000 }],
  session: { start, elapsed: 400, timer: 395 },
  timerIntervals: [[start, start + 250_000], [start + 255_000, start + 400_000]],
});
assert.equal(fit.n, 401);
assert.equal(fit.samples.t.length, 402);
assert.equal(fit.samples.sensors.power[101], 175);
assert.ok(Number.isNaN(fit.samples.gpsSensors.power[100]));
assert.ok(fit.paused[251]);
assert.equal(fit.moving, 395);

const early = sensorMeans(fit.samples, 98, 102);
assert.equal(early.power, 25); // 3 seconds at 0 W, 0.5 valid second at 175 W, 0.5 second missing
const gpx = prepareRide(parseGPX('<gpx><trk><trkseg>' + points.map(p =>
  `<trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.ele}</ele><time>${new Date(p.t - 86400_000).toISOString()}</time></trkpt>`
).join('') + '</trkseg></trk></gpx>'));
const cmp = compareRides(fit, gpx);
assert.equal(cmp.error, undefined);
assert.ok(cmp.compLen > 3000);
const role = cmp.R === fit ? 'R' : 'O';
const other = role === 'R' ? 'O' : 'R';
assert.ok(cmp.readings.power[role].some(v => v === 0));
assert.ok(cmp.readings.power[role].some(v => v === 200));
assert.ok(cmp.readings.power[role].some(Number.isNaN));
assert.equal(cmp.readings.power[other], undefined);
console.log('PASS FIT sample handling and mixed-format comparison');
