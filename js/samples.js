import { median, lastLE } from './util.js?v=2.0.7';

export const SENSORS = {
  power: { name: '功率', unit: 'W', color: 'up' },
  hr: { name: '心率', unit: 'bpm', color: 'red' },
  cad: { name: '踏頻', unit: 'rpm', color: 'down' },
  temp: { name: '溫度', unit: '°C', color: 'muted' },
};

export function sampleGap(times) {
  const deltas = times.slice(1).map((t, i) => t - times[i]);
  return Math.max(3, 2.5 * (median(deltas) || 1));
}

// Time-weighted means for ranges without a device summary. Never fill gaps or missing readings.
export function sensorMeans(samples, start, end, active = null) {
  const { t, maxGap, sensors } = samples;
  const first = Math.max(0, lastLE(t, start));
  const out = {};
  for (const [key, values] of Object.entries(sensors)) {
    let sum = 0, seconds = 0;
    for (let i = first; i + 1 < t.length && t[i] < end; i++) {
      if (!Number.isFinite(values[i]) || t[i + 1] - t[i] > maxGap) continue;
      const a = Math.max(start, t[i]), b = Math.min(end, t[i + 1]);
      const dt = b > a ? (active ? active(a, b) : b - a) : 0;
      sum += values[i] * dt;
      seconds += dt;
    }
    if (seconds) out[key] = sum / seconds;
  }
  return out;
}

export function activeSeconds(intervals, a, b) {
  let seconds = 0;
  for (const [start, end] of intervals) {
    if (start >= b) break;
    seconds += Math.max(0, Math.min(b, end) - Math.max(a, start));
  }
  return seconds;
}

// Integrate into one-second bins, then use only uninterrupted 30-second windows.
export function normalizedPower(samples, start, end) {
  const { t, maxGap, timerIntervals, sensors: { power } } = samples;
  const windowSize = 30;
  if (!power || end - start < windowSize) return undefined;
  let fourthPower = 0, windows = 0;
  const ring = new Float64Array(windowSize);
  for (const [from, to] of timerIntervals ?? [[start, end]]) {
    const a = Math.max(start, from), b = Math.min(end, to);
    if (b - a < windowSize) continue;
    let fraction = 0, energy = 0, count = 0, rolling = 0;
    const first = Math.max(0, lastLE(t, a));
    for (let i = first; i + 1 < t.length && t[i] < b; i++) {
      let seconds = Math.min(t[i + 1], b) - Math.max(t[i], a);
      if (seconds <= 0) continue;
      if (!Number.isFinite(power[i]) || t[i + 1] - t[i] > maxGap) {
        fraction = energy = count = rolling = 0;
        continue;
      }
      while (seconds > 1e-9) {
        const step = Math.min(1 - fraction, seconds);
        fraction += step;
        energy += power[i] * step;
        seconds -= step;
        if (fraction < 1 - 1e-9) continue;
        const slot = count % windowSize;
        if (count >= windowSize) rolling -= ring[slot];
        ring[slot] = energy;
        rolling += energy;
        if (++count >= windowSize) {
          fourthPower += (rolling / windowSize) ** 4;
          windows++;
        }
        fraction = energy = 0;
      }
    }
  }
  return windows ? (fourthPower / windows) ** 0.25 : undefined;
}

export function hasSensor(ride, key) {
  return !!ride.samples.sensors[key] || Number.isFinite(ride.session?.[key]) || ride.laps.some(l => Number.isFinite(l[key]));
}

// Sample at a matched location using consecutive GPS fixes and their raw sensor readings.
export function sensorAt(ride, values, routePositions, s, i, j) {
  if (i < 0 || j >= ride.n || !Number.isFinite(routePositions[i]) || !Number.isFinite(routePositions[j])) return NaN;
  if (s === routePositions[i]) return values[i];
  if (j !== i + 1 || ride.paused[j] || ride.t[j] - ride.t[i] > ride.samples.maxGap
    || !Number.isFinite(values[i]) || !Number.isFinite(values[j]) || routePositions[j] <= routePositions[i]
    || s < routePositions[i] || s > routePositions[j]) return NaN;
  const f = (s - routePositions[i]) / (routePositions[j] - routePositions[i]);
  return values[i] + f * (values[j] - values[i]);
}
