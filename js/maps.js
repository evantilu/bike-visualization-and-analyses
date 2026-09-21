// Leaflet base map (OSM + NLSC hillshade) and a canvas overlay that draws routes
// "keep right" (each direction offset to the right of travel, so out-and-back lanes separate).
import { tok, rgba, FONT } from './theme.js';
const L = window.L;

export function makeMap(el, { interactive = true } = {}) {
  const map = L.map(el, {
    zoomAnimation: false, zoomSnap: 0.25, attributionControl: interactive, zoomControl: interactive,
    dragging: interactive, scrollWheelZoom: interactive ? 'center' : false, doubleClickZoom: interactive, boxZoom: interactive, keyboard: interactive, touchZoom: interactive,
  });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
  map.createPane('hill'); map.getPane('hill').classList.add('hill-pane'); map.getPane('hill').style.zIndex = 250;
  L.tileLayer('https://wmts.nlsc.gov.tw/wmts/MOI_HILLSHADE/default/GoogleMapsCompatible/{z}/{y}/{x}', { pane: 'hill', maxNativeZoom: 17, maxZoom: 19, attribution: '地形暈渲 © 內政部國土測繪中心' }).addTo(map);
  return map;
}

// Canvas overlay; draw(ctx, helpers) is called on every move/zoom/resize and on redraw().
export function canvasOverlay(map, draw) {
  const cv = document.createElement('canvas'); cv.className = 'ovl'; map.getContainer().appendChild(cv);
  const redraw = () => {
    const size = map.getSize(), dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(size.x * dpr) || cv.height !== Math.round(size.y * dpr)) { cv.width = Math.round(size.x * dpr); cv.height = Math.round(size.y * dpr); cv.style.width = size.x + 'px'; cv.style.height = size.y + 'px'; }
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, size.x, size.y);
    draw(ctx, { w: size.x, h: size.y, pt: (lat, lon) => map.latLngToContainerPoint([lat, lon]) });
  };
  map.on('move zoom resize viewreset load', redraw);
  requestAnimationFrame(redraw);
  return { redraw, canvas: cv };
}

// Screen polyline of a route with right-hand offset. lat/lon arrays; returns {x,y,idx} (subsampled by pixel distance)
export function laneScreen(map, lat, lon, offset, minPx = 1.5) {
  const n = lat.length, P = new Array(n);
  for (let i = 0; i < n; i++) { const p = map.latLngToContainerPoint([lat[i], lon[i]]); P[i] = p; }
  const X = [], Y = [], I = [];
  let nx = 0, ny = 0;
  for (let i = 0; i < n; i++) {
    let a = i, b = i, L2 = 0;
    for (let k = 1; k < 8 && L2 < 36; k++) { a = Math.max(0, i - k); b = Math.min(n - 1, i + k); L2 = (P[b].x - P[a].x) ** 2 + (P[b].y - P[a].y) ** 2; }
    if (L2 > 1) { const L = Math.sqrt(L2); const tx = (P[b].x - P[a].x) / L, ty = (P[b].y - P[a].y) / L; nx = -ty; ny = tx; }
    const x = P[i].x + nx * offset, y = P[i].y + ny * offset;
    if (X.length && Math.hypot(x - X[X.length - 1], y - Y[Y.length - 1]) < minPx && i < n - 1) continue;
    X.push(x); Y.push(y); I.push(i);
  }
  return { X, Y, I };
}

// Draw a lane: colorAt(i) -> css color | null (skip) ; dashAt(i) -> bool
export function drawLane(ctx, lane, { width = 4, colorAt, dashAt = () => false, casing = true }) {
  const { X, Y, I } = lane;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (casing) {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = width + 2.6; ctx.beginPath();
    for (let k = 0; k < X.length; k++) { if (k === 0) ctx.moveTo(X[k], Y[k]); else ctx.lineTo(X[k], Y[k]); }
    ctx.stroke();
  }
  for (let k = 1; k < X.length; k++) {
    const i = I[k - 1], c = colorAt(i); if (!c) continue;
    const dash = dashAt(i);
    ctx.beginPath(); ctx.moveTo(X[k - 1], Y[k - 1]); ctx.lineTo(X[k], Y[k]);
    ctx.setLineDash(dash ? [width, width] : []); ctx.lineWidth = dash ? width * 0.75 : width; ctx.strokeStyle = c; ctx.stroke();
  }
  ctx.setLineDash([]);
}

export function kmMarkers(ctx, lane, sAt, total, { every = 1000, r = 8 } = {}) {
  // lane: screen lane; sAt(i) route distance of source index i
  const { X, Y, I } = lane; if (X.length < 2) return;
  // choose spacing so markers are >= 28 px apart
  let span = 0; for (let k = 1; k < X.length; k++) span += Math.hypot(X[k] - X[k - 1], Y[k] - Y[k - 1]);
  const pxPerM = span / Math.max(total, 1); let step = every;
  for (const m of [1000, 2000, 5000, 10000, 20000]) { step = m; if (m * pxPerM >= 30) break; }
  let next = step; const font = FONT();
  for (let k = 1; k < X.length; k++) {
    const s0 = sAt(I[k - 1]), s1 = sAt(I[k]);
    while (s1 >= next && s0 < next) {
      const f = (next - s0) / Math.max(s1 - s0, 1e-6), x = X[k - 1] + f * (X[k] - X[k - 1]), y = Y[k - 1] + f * (Y[k] - Y[k - 1]);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = '#1b201c'; ctx.stroke();
      ctx.fillStyle = '#1b201c'; ctx.font = `700 ${r + 2}px ${font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(next / 1000), x, y + 0.5);
      next += step;
    }
    if (s1 < s0) next = Math.ceil((s1 + 1) / step) * step;
  }
}

export function dot(ctx, x, y, color, r = 7) {
  ctx.beginPath(); ctx.arc(x, y, r + 2.2, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
}
export function pill(ctx, x, y, text, color, fs = 12) {
  ctx.font = `600 ${fs}px ${FONT()}`; const w = ctx.measureText(text).width + 12, h = fs + 8;
  ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 0.5);
}
export function badge(ctx, x, y, text, edge, fs = 11) {
  ctx.font = `700 ${fs}px ${FONT()}`; const w = Math.max(fs + 8, ctx.measureText(text).width + 10), h = fs + 8;
  ctx.fillStyle = '#fff'; ctx.strokeStyle = edge; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, 6); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#1b201c'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 0.5);
}
export function fitTo(map, lat, lon, pad = 30) {
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  for (let i = 0; i < lat.length; i++) { a = Math.min(a, lat[i]); b = Math.max(b, lat[i]); c = Math.min(c, lon[i]); d = Math.max(d, lon[i]); }
  const apply = () => { map.invalidateSize(); map.fitBounds([[a, c], [b, d]], { padding: [pad, pad] }); };
  apply(); requestAnimationFrame(apply);
}
