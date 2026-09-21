// Read design tokens from CSS so canvas drawing follows light/dark theme.
export function tok(name) { return getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim(); }
export function hex(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); }
export function rgba(h, a) { const c = hex(h); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
export function mix(h1, h2, t) { const a = hex(h1), b = hex(h2); return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
export const FONT = () => getComputedStyle(document.body).fontFamily;
// sequential ramp for speed (single hue, light -> dark)
const SPEED_RAMP = ['#b7d3f6', '#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281', '#0d366b'];
export function speedColor(v, lo, hi) {
  const t = Math.max(0, Math.min(1, (v - lo) / Math.max(hi - lo, 1e-6))) * (SPEED_RAMP.length - 1);
  const i = Math.min(SPEED_RAMP.length - 2, Math.floor(t));
  return mix(SPEED_RAMP[i], SPEED_RAMP[i + 1], t - i);
}
export const SPEED_RAMP_STOPS = SPEED_RAMP;
// diverging: red (older faster) <- neutral -> blue (newer faster)
export function diffColor(d, cap = 6, neg = tok('red'), pos = tok('blue'), mid = tok('neutral')) {
  const v = Math.max(-cap, Math.min(cap, d)) / cap;
  return mix(mid, v >= 0 ? pos : neg, Math.pow(Math.abs(v), 0.8));
}
export function fmtTime(sec) {
  if (!Number.isFinite(sec)) return '—';
  sec = Math.round(sec); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
export function fmtDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function fmtSigned(v, digits = 0, unit = '') { if (!Number.isFinite(v)) return '—'; const s = v.toFixed(digits); return (v > 0 ? '+' : v < 0 ? '−' : '') + s.replace('-', '') + unit; }
export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'html') e.innerHTML = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
