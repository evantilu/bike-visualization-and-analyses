// Canvas panel chart (shared x axis, several stacked panels, hover crosshair) and SVG bars.
import { tok, rgba, FONT } from './theme.js?v=2.0.7';

function niceStep(range, target) {
  const raw = range / Math.max(target, 1), p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}

function paintCursorLabel(ctx, point, plot, colors) {
  const { x, y, text, color, top, bottom } = point;
  const gap = 8, height = 18, pad = 6;
  const width = Math.ceil(ctx.measureText(text).width) + pad * 2;
  if (width + 4 > plot.right - plot.left || height + 4 > bottom - top) return;
  const preferred = x + gap + width <= plot.right - 2 ? x + gap : x - gap - width;
  const bx = Math.max(plot.left + 2, Math.min(plot.right - width - 2, preferred));
  const by = Math.max(top + 2, Math.min(bottom - height - 2, y - height / 2));

  ctx.beginPath(); ctx.roundRect(bx, by, width, height, 5);
  ctx.fillStyle = colors.surface;
  ctx.shadowColor = rgba(colors.ink, 0.16); ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1; ctx.strokeStyle = rgba(color, 0.48); ctx.stroke();
  ctx.fillStyle = colors.ink;
  ctx.fillText(text, bx + width / 2, by + height / 2);

  ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = colors.surface; ctx.lineWidth = 1.5; ctx.stroke();
}

export class PanelChart {
  // opts: { x:[km], xMax, panels:[{h,label,yMin,yMax,zero,series:[{y,color,width,dash,area,fillSign,name,fmt}]}],
  //         shades:[[a,b]], vlines:[km], tops:[{x,text}], breakGap, onHover, fitHeight, fixedReading, cursorLabels }
  constructor(host, opts) {
    this.host = host; this.o = opts; this.cursor = null;
    this.cv = document.createElement('canvas'); host.appendChild(this.cv);
    this.tip = document.createElement('div'); this.tip.className = 'tip'; this.tip.hidden = true; host.appendChild(this.tip);
    this.padL = opts.fitHeight ? 68 : 50; this.padR = 14; this.padT = opts.tops ? 20 : 8; this.padB = 24; this.gap = opts.fitHeight ? 9 : 14;
    this.height = this.padT + this.padB + opts.panels.reduce((s, p) => s + p.h, 0) + this.gap * (opts.panels.length - 1);
    this.cv.style.height = this.height + 'px';
    const move = (e) => { const r = this.cv.getBoundingClientRect(); const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left; this.hover(cx); };
    this.cv.addEventListener('mousemove', move); this.cv.addEventListener('click', move); this.cv.addEventListener('touchmove', move, { passive: true });
    if (!opts.fixedReading) this.cv.addEventListener('mouseleave', () => { this.cursor = null; this.tip.hidden = true; this.draw(); opts.onHover?.(null); });
    this.observer = new ResizeObserver(() => this.draw());
    this.observer.observe(host);
  }
  destroy() { this.observer.disconnect(); this.cv.remove(); this.tip.remove(); }
  xpx(v) { return this.padL + (v / this.o.xMax) * (this.w - this.padL - this.padR); }
  hover(cx) {
    const x = this.o.x; const v = (cx - this.padL) / (this.w - this.padL - this.padR) * this.o.xMax;
    let lo = 0, hi = x.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (x[m] <= v) lo = m; else hi = m; }
    const i = Math.abs(x[hi] - v) < Math.abs(x[lo] - v) ? hi : lo;
    if (Math.abs(x[i] - v) > (this.o.breakGap ?? 0.05)) { this.cursor = null; this.tip.hidden = true; this.draw(); this.o.onHover?.(null); return; }
    this.cursor = i; this.draw(); this.o.onHover?.(x[i], i);
    if (this.o.fixedReading) return;
    const rows = [`<b>${this.o.xFormat ? this.o.xFormat(x[i]) : x[i].toFixed(2) + ' km'}</b>`];
    for (const p of this.o.panels) for (const s of p.series) if (s.name && s.y) { const val = s.y[i]; if (Number.isFinite(val)) rows.push(`<i style="background:${s.color}"></i>${s.name}：${s.fmt ? s.fmt(val) : val.toFixed(1)}`); }
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
    const panels = this.o.panels;
    const padding = this.padT + this.padB + this.gap * Math.max(0, panels.length - 1);
    const base = panels.reduce((sum, panel) => sum + panel.h, 0);
    const available = this.o.fitHeight ? Math.max(panels.length, this.host.clientHeight - padding) : base;
    this.height = padding + available;
    if (this.o.fitHeight) this.cv.style.height = this.height + 'px';
    this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(this.height * dpr);
    const ctx = this.cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, this.height);
    const ink = tok('ink'), muted = tok('muted'), line = tok('line'), neutral = tok('neutral');
    const font = FONT(); const o = this.o, x = o.x, bg = o.breakGap ?? 0.05;
    const broken = (i) => i > 0 && (o.breaks?.[i] || x[i] - x[i - 1] > bg);
    const top0 = this.padT, bottom = this.height - this.padB;
    const cursorX = this.cursor == null ? null : this.xpx(x[this.cursor]);
    const labels = [];
    // shades
    for (const [a, b] of o.shades || []) { ctx.fillStyle = rgba(neutral, 0.16); ctx.fillRect(this.xpx(a), top0 - 4, this.xpx(b) - this.xpx(a), bottom - top0 + 4); }
    for (const v of o.vlines || []) { ctx.strokeStyle = rgba(muted, 0.35); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(this.xpx(v), top0 - 4); ctx.lineTo(this.xpx(v), bottom); ctx.stroke(); ctx.setLineDash([]); }
    ctx.font = `600 11px ${font}`; ctx.textAlign = 'center'; ctx.fillStyle = muted;
    for (const t of o.tops || []) ctx.fillText(t.text, this.xpx(t.x), 13);
    let y0 = top0;
    for (const panel of panels) {
      const p = available === base ? panel : { ...panel, h: available * panel.h / base };
      let min = Infinity, max = -Infinity;
      for (const s of p.series) for (const arr of [s.y, ...(s.band || [])]) if (arr) {
        for (const v of arr) if (Number.isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); }
      }
      let lo = p.yMin ?? (Number.isFinite(min) ? min : 0), hi = p.yMax ?? (Number.isFinite(max) ? max : 1);
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
      ctx.save();
      const center = y0 + p.h / 2;
      ctx.textAlign = 'center'; ctx.fillStyle = muted; ctx.font = `500 11px ${font}`;
      if (o.fitHeight) {
        const [name, unit] = (p.label || '').split(' ');
        ctx.fillText(name, 20, center - 2);
        if (unit) ctx.fillText(unit, 20, center + 10);
      } else {
        ctx.translate(12, center); ctx.rotate(-Math.PI / 2);
        ctx.fillText(p.label || '', 0, 0);
      }
      ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.rect(this.padL, y0 - 2, w - this.padL - this.padR, p.h + 4); ctx.clip();
      for (const s of p.series) {
        const y = s.y;
        if (s.band) { // shaded range between two arrays, broken at NaN / gaps
          const [lo2, hi2] = s.band; let seg = [];
          const flush = () => { if (seg.length > 1) { ctx.beginPath(); seg.forEach(([px, a], k) => k ? ctx.lineTo(px, Y(a)) : ctx.moveTo(px, Y(a))); for (let k = seg.length - 1; k >= 0; k--) ctx.lineTo(seg[k][0], Y(seg[k][2])); ctx.closePath(); ctx.fillStyle = rgba(s.color, s.bandAlpha ?? 0.2); ctx.fill(); } seg = []; };
          for (let i = 0; i < x.length; i++) {
            if (!Number.isFinite(lo2[i]) || !Number.isFinite(hi2[i]) || broken(i)) { flush(); if (!Number.isFinite(lo2[i]) || !Number.isFinite(hi2[i])) continue; }
            seg.push([this.xpx(x[i]), hi2[i], lo2[i]]);
          }
          flush();
          if (!s.y) continue;
        }
        if (s.fillSign) {
          for (let i = 1; i < x.length; i++) {
            if (!Number.isFinite(y[i]) || !Number.isFinite(y[i - 1]) || broken(i)) continue;
            const v = (y[i] + y[i - 1]) / 2; const xa = this.xpx(x[i - 1]), xb = this.xpx(x[i]);
            ctx.fillStyle = rgba(v >= 0 ? s.fillSign.pos : s.fillSign.neg, 0.5);
            ctx.fillRect(xa, Math.min(Y(0), Y(v)), xb - xa + 0.6, Math.abs(Y(v) - Y(0)));
          }
          continue;
        }
        if (s.area) {
          ctx.beginPath(); let open = false, startX = 0, lastX = 0;
          for (let i = 0; i < x.length; i++) {
            const brk = !Number.isFinite(y[i]) || broken(i);
            if (brk && open) { ctx.lineTo(lastX, Y(lo)); ctx.lineTo(startX, Y(lo)); ctx.closePath(); open = false; }
            if (!Number.isFinite(y[i])) continue;
            const px = this.xpx(x[i]);
            if (!open) { ctx.moveTo(px, Y(lo)); ctx.lineTo(px, Y(y[i])); startX = px; open = true; } else ctx.lineTo(px, Y(y[i]));
            lastX = px;
          }
          if (open) { ctx.lineTo(lastX, Y(lo)); ctx.lineTo(startX, Y(lo)); ctx.closePath(); }
          ctx.fillStyle = s.area === true ? rgba(s.color, 0.18) : s.area; ctx.fill();
        }
        if (!s.y) continue;
        ctx.beginPath(); let pen = false;
        for (let i = 0; i < x.length; i++) {
          if (!Number.isFinite(y[i]) || broken(i)) { pen = false; if (!Number.isFinite(y[i])) continue; }
          const px = this.xpx(x[i]), py = Y(y[i]);
          if (!pen) { ctx.moveTo(px, py); pen = true; } else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = s.color; ctx.lineWidth = s.width ?? 1.6; ctx.setLineDash(s.dash || []); ctx.lineJoin = 'round'; ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.restore();
      if (o.cursorLabels && cursorX != null) for (const s of p.series) {
        const value = s.y?.[this.cursor];
        if (!Number.isFinite(value) || value < lo || value > hi || s.fillSign) continue;
        labels.push({
          x: cursorX, y: Y(value), color: s.color, top: y0, bottom: y0 + p.h,
          text: s.fmt ? s.fmt(value) : value.toFixed(1),
        });
      }
      if (p.title) { ctx.textAlign = 'left'; ctx.font = `600 12px ${font}`; ctx.fillStyle = ink; ctx.fillText(p.title, this.padL + 4, y0 + 12); }
      y0 += p.h + this.gap;
    }
    // x axis
    ctx.fillStyle = muted; ctx.font = `500 10.5px ${font}`; ctx.textAlign = 'center';
    const st = niceStep(o.xMax, (w - 80) / 70);
    for (let v = 0; v <= o.xMax + 1e-9; v += st) ctx.fillText(o.xTick ? o.xTick(v) : +v.toFixed(2) + (v + st > o.xMax ? ' km' : ''), this.xpx(v), this.height - 7);
    if (cursorX != null) {
      ctx.strokeStyle = rgba(ink, 0.55); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cursorX, top0 - 4); ctx.lineTo(cursorX, bottom); ctx.stroke();
    }
    if (labels.length) {
      const plot = { left: this.padL, right: w - this.padR };
      const colors = { ink, surface: tok('surface') };
      ctx.save();
      ctx.font = `600 11px ${font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const label of labels) paintCursorLabel(ctx, label, plot, colors);
      ctx.restore();
    }
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
