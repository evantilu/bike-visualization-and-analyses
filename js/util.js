// Small numeric helpers shared by the engine (pure, no DOM).

export function median(arr) {
  const a = Array.from(arr).filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function cumsum(arr) {
  const out = new Float64Array(arr.length);
  let s = 0;
  for (let i = 0; i < arr.length; i++) { s += arr[i]; out[i] = s; }
  return out;
}

// Index of the last element <= v in a non-decreasing array (-1 if none).
export function lastLE(arr, v) {
  let lo = -1, hi = arr.length;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (arr[m] <= v) lo = m; else hi = m;
  }
  return lo;
}

// Linear interpolation of y(x) at xq; x must be non-decreasing. Clamps at the ends.
export function interp(xq, x, y) {
  const n = x.length;
  if (!n) return NaN;
  if (xq <= x[0]) return y[0];
  if (xq >= x[n - 1]) return y[n - 1];
  const i = lastLE(x, xq);
  const x0 = x[i], x1 = x[i + 1];
  if (x1 === x0) return y[i + 1];
  return y[i] + (y[i + 1] - y[i]) * (xq - x0) / (x1 - x0);
}

export function interpArray(xq, x, y) {
  const out = new Float64Array(xq.length);
  for (let i = 0; i < xq.length; i++) out[i] = interp(xq[i], x, y);
  return out;
}

// Centered moving average with window n (odd), edges padded with edge values.
export function movingAvg(arr, n) {
  const h = n >> 1, len = arr.length, out = new Float64Array(len);
  if (!len) return out;
  let s = 0;
  const at = (i) => arr[Math.min(len - 1, Math.max(0, i))];
  for (let i = -h; i <= h; i++) s += at(i);
  for (let i = 0; i < len; i++) {
    out[i] = s / n;
    s += at(i + h + 1) - at(i - h);
  }
  return out;
}

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export function range(start, stop, step) {
  const out = [];
  for (let v = start; v <= stop + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

export function sum(arr) { let s = 0; for (const v of arr) s += v; return s; }
