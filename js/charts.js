// Canvas panel chart (shared x axis, several stacked panels, hover crosshair) and SVG bars.
import { tok, rgba, FONT } from './theme.js';

function niceStep(range, target) {
  const raw = range / Math.max(target, 1), p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}

export class PanelChart {
  // opts: { x:[km], xMax, panels:[{h,label,yMin,yMax,zero,series:[{y,color,width,dash,area,fillSign,name,fmt}]}],
  //         shades:[[a,b]], vlines:[km], tops:[{x,text}], breakGap, onHover }
  constructor(host, opts) {
    this.host = host; this.o = opts; this.cursor = null;
    this.cv = document.createElement('canvas'); host.appendChild(this.cv);
    this.tip = document.createElement('div'); this.tip.className = 'tip'; this.tip.hidden = true; host.appendChild(this.tip);
    this.padL = 50; this.padR = 14; this.padT = opts.tops ? 20 : 8; this.padB = 24; this.gap = 14;
    this.height = this.padT + this.padB + opts.panels.reduce((s, p) => s + p.h, 0) + this.gap * (opts.panels.length - 1);
    this.cv.style.height = this.height + 'px';
    const move = (e) => { const r = this.cv.getBoundingClientRect(); const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left; this.hover(cx); };
    this.cv.addEventListener('mousemove', move); this.cv.addEventListener('touchmove', move, { passive: true });
    this.cv.addEventListener('mouseleave', () => { this.cursor = null; this.tip.hidden = true; this.draw(); opts.onHover?.(null); });
    new ResizeObserver(() => this.draw()).observe(host);
  }
  xpx(v) { return this.padL + (v / this.o.xMax) * (this.w - this.padL - this.padR); }
  hover(cx) {
    const x = this.o.x; const v = (cx - this.padL) / (this.w - this.padL - this.padR) * this.o.xMax;
    let lo = 0, hi = x.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (x[m] <= v) lo = m; else hi = m; }
    const i = Math.abs(x[hi] - v) < Math.abs(x[lo] - v) ? hi : lo;
    if (Math.abs(x[i] - v) > (this.o.breakGap ?? 0.05)) { this.cursor = null; this.tip.hidden = true; this.draw(); this.o.onHover?.(null); return; }
    this.cursor = i; this.draw(); this.o.onHover?.(x[i]);
    const rows = [`<b>${x[i].toFixed(2)} km</b>`];
    for (const p of this.o.panels) for (const s of p.series) if (s.name) { const val = s.y[i]; if (Number.isFinite(val)) rows.push(`<i style="background:${s.color}"></i>${s.name}：${s.fmt ? s.fmt(val) : val.toFixed(1)}`); }
    if (this.o.tipExtra) { const t = this.o.tipExtra(i); if (t) rows.push(t); }
    this.tip.innerHTML = rows.join('<br>'); this.tip.hidden = false;
    const px = this.xpx(x[i]); const tw = this.tip.offsetWidth;
    this.tip.style.left = Math.min(this.w - tw - 4, Math.max(4, px + 12)) + 'px'; this.tip.style.top = '8px';
  }
  setCursorKm(km) {
    if (km == null) { this.cursor = null; this.draw(); return; }
    const x = this.o.x; let lo = 0, hi = x.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (x[m] <= km) lo = m; else hi = m; }
    this.cursor = lo; this.draw();
  }
  draw() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.host.clientWidth; if (!w) return; this.w = w;
    this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(this.height * dpr);
    const ctx = this.cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, this.height);
    const ink = tok('ink'), muted = tok('muted'), line = tok('line'), neutral = tok('neutral');
    const font = FONT(); const o = this.o, x = o.x, bg = o.breakGap ?? 0.05;
    const top0 = this.padT, bottom = this.height - this.padB;
    // shades
    for (const [a, b] of o.shades || []) { ctx.fillStyle = rgba(neutral, 0.16); ctx.fillRect(this.xpx(a), top0 - 4, this.xpx(b) - this.xpx(a), bottom - top0 + 4); }
    for (const v of o.vlines || []) { ctx.strokeStyle = rgba(muted, 0.35); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(this.xpx(v), top0 - 4); ctx.lineTo(this.xpx(v), bottom); ctx.stroke(); ctx.setLineDash([]); }
    ctx.font = `600 11px ${font}`; ctx.textAlign = 'center'; ctx.fillStyle = muted;
    for (const t of o.tops || []) ctx.fillText(t.text, this.xpx(t.x), 13);
    let y0 = top0;
    for (const p of o.panels) {
      const vals = []; for (const s of p.series) for (const v of s.y) if (Number.isFinite(v)) vals.push(v);
      let lo = p.yMin ?? Math.min(...vals), hi = p.yMax ?? Math.max(...vals);
      if (p.zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
      if (p.yMin == null || p.yMax == null) { const pad = (hi - lo) * 0.08 || 1; if (p.yMin == null) lo -= pad; if (p.yMax == null) hi += pad; }
      const Y = (v) => y0 + (hi - v) / (hi - lo) * p.h;
      // grid + ticks
      const st = niceStep(hi - lo, p.h / 40);
      ctx.font = `500 10.5px ${font}`; ctx.textAlign = 'right'; ctx.fillStyle = muted;
      for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) {
        ctx.strokeStyle = rgba(muted, 0.12); ctx.beginPath(); ctx.moveTo(this.padL, Y(v)); ctx.lineTo(w - this.padR, Y(v)); ctx.stroke();
        ctx.fillText((p.tickFmt ? p.tickFmt(v) : +v.toFixed(2)), this.padL - 6, Y(v) + 3.5);
      }
      if (p.zero) { ctx.strokeStyle = rgba(ink, 0.6); ctx.beginPath(); ctx.moveTo(this.padL, Y(0)); ctx.lineTo(w - this.padR, Y(0)); ctx.stroke(); }
      ctx.save(); ctx.translate(12, y0 + p.h / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillStyle = muted; ctx.font = `500 11px ${font}`; ctx.fillText(p.label || '', 0, 0); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.rect(this.padL, y0 - 2, w - this.padL - this.padR, p.h + 4); ctx.clip();
      for (const s of p.series) {
        const y = s.y;
        if (s.fillSign) {
          for (let i = 1; i < x.length; i++) {
            if (!Number.isFinite(y[i]) || !Number.isFinite(y[i - 1]) || x[i] - x[i - 1] > bg) continue;
            const v = (y[i] + y[i - 1]) / 2; const xa = this.xpx(x[i - 1]), xb = this.xpx(x[i]);
            ctx.fillStyle = rgba(v >= 0 ? s.fillSign.pos : s.fillSign.neg, 0.5);
            ctx.fillRect(xa, Math.min(Y(0), Y(v)), xb - xa + 0.6, Math.abs(Y(v) - Y(0)));
          }
          continue;
        }
        if (s.area) {
          ctx.beginPath(); let open = false, startX = 0, lastX = 0;
          for (let i = 0; i < x.length; i++) {
            const brk = !Number.isFinite(y[i]) || (i > 0 && x[i] - x[i - 1] > bg);
            if (brk && open) { ctx.lineTo(lastX, Y(lo)); ctx.lineTo(startX, Y(lo)); ctx.closePath(); open = false; }
            if (!Number.isFinite(y[i])) continue;
            const px = this.xpx(x[i]);
            if (!open) { ctx.moveTo(px, Y(lo)); ctx.lineTo(px, Y(y[i])); startX = px; open = true; } else ctx.lineTo(px, Y(y[i]));
            lastX = px;
          }
          if (open) { ctx.lineTo(lastX, Y(lo)); ctx.lineTo(startX, Y(lo)); ctx.closePath(); }
          ctx.fillStyle = s.area === true ? rgba(s.color, 0.18) : s.area; ctx.fill();
        }
        ctx.beginPath(); let pen = false;
        for (let i = 0; i < x.length; i++) {
          if (!Number.isFinite(y[i]) || (i > 0 && x[i] - x[i - 1] > bg)) { pen = false; if (!Number.isFinite(y[i])) continue; }
          const px = this.xpx(x[i]), py = Y(y[i]);
          if (!pen) { ctx.moveTo(px, py); pen = true; } else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = s.color; ctx.lineWidth = s.width ?? 1.6; ctx.setLineDash(s.dash || []); ctx.lineJoin = 'round'; ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.restore();
      if (p.title) { ctx.textAlign = 'left'; ctx.font = `600 12px ${font}`; ctx.fillStyle = ink; ctx.fillText(p.title, this.padL + 4, y0 + 12); }
      y0 += p.h + this.gap;
    }
    // x axis
    ctx.fillStyle = muted; ctx.font = `500 10.5px ${font}`; ctx.textAlign = 'center';
    const st = niceStep(o.xMax, (w - 80) / 70);
    for (let v = 0; v <= o.xMax + 1e-9; v += st) ctx.fillText(+v.toFixed(2) + (v + st > o.xMax ? ' km' : ''), this.xpx(v), this.height - 7);
    if (this.cursor != null) { const px = this.xpx(x[this.cursor]); ctx.strokeStyle = rgba(ink, 0.55); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, top0 - 4); ctx.lineTo(px, bottom); ctx.stroke(); }
  }
}

// grouped bars in SVG. cats: [string|[lines]], series:[{name,color,values}], above:[{text,color}] per category
export function groupedBars(host, { cats, series, above = [], yLabel = '', fmt = (v) => v.toFixed(1), yMin = null, height = 300 }) {
  const W = 1000, H = height, padL = 56, padR = 10, padT = 30, padB = 64;
  const all = series.flatMap(s => s.values).filter(Number.isFinite);
  let lo = yMin ?? Math.max(0, Math.floor((Math.min(...all) * 0.8) / 5) * 5), hi = Math.max(...all) * 1.08;
  if (lo >= hi) lo = 0;
  const Y = (v) => padT + (hi - v) / (hi - lo) * (H - padT - padB);
  const gw = (W - padL - padR) / cats.length, bw = Math.min(46, gw * 0.8 / series.length);
  const muted = tok('muted'), ink = tok('ink');
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${yLabel}">`;
  const st = niceStep(hi - lo, 5);
  for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) svg += `<line x1="${padL}" x2="${W - padR}" y1="${Y(v)}" y2="${Y(v)}" stroke="${rgba(muted, .15)}"/><text x="${padL - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="12" fill="${muted}">${+v.toFixed(1)}</text>`;
  svg += `<text x="14" y="${(padT + H - padB) / 2}" transform="rotate(-90 14 ${(padT + H - padB) / 2})" text-anchor="middle" font-size="12" fill="${muted}">${yLabel}</text>`;
  cats.forEach((c, i) => {
    const cx = padL + gw * (i + 0.5), x0 = cx - bw * series.length / 2;
    let top = H;
    series.forEach((s, k) => {
      const v = s.values[i]; if (!Number.isFinite(v)) return;
      const x = x0 + k * bw + 1, y = Y(v); top = Math.min(top, y);
      const color = Array.isArray(s.color) ? s.color[i] : s.color;
      svg += `<rect x="${x}" y="${y}" width="${bw - 2}" height="${Math.max(0, Y(lo) - y)}" rx="3" fill="${color}"><title>${s.name}：${fmt(v)}</title></rect>`;
      if (bw > 26) svg += `<text x="${x + (bw - 2) / 2}" y="${y + 15}" text-anchor="middle" font-size="11" fill="#fff">${fmt(v)}</text>`;
    });
    const a = above[i]; if (a) svg += `<text x="${cx}" y="${top - 8}" text-anchor="middle" font-size="13" font-weight="700" fill="${a.color || ink}">${a.text}</text>`;
    const lines = Array.isArray(c) ? c : [c];
    lines.forEach((t, j) => svg += `<text x="${cx}" y="${H - padB + 18 + j * 15}" text-anchor="middle" font-size="12" fill="${j ? muted : ink}">${t}</text>`);
  });
  svg += '</svg>';
  host.innerHTML = svg;
}
