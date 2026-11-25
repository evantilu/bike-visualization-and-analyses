// Keep the detail map clear of the overview route until the rider moves it manually.
function hitsBox(a, b, { x, y, width, height }) {
  let first = 0, last = 1;
  for (const [start, end, low, high] of [[a.x, b.x, x, x + width], [a.y, b.y, y, y + height]]) {
    const delta = end - start;
    if (!delta) {
      if (start < low || start > high) return false;
      continue;
    }
    const t1 = (low - start) / delta, t2 = (high - start) / delta;
    first = Math.max(first, Math.min(t1, t2));
    last = Math.min(last, Math.max(t1, t2));
    if (first > last) return false;
  }
  return true;
}

export function chooseInset(bounds, width, height, paths, preferred) {
  const { left, right, top, bottom } = bounds;
  const middle = (top + bottom) / 2;
  const center = (left + right) / 2;
  const candidates = [
    [right, top], [right, bottom], [left, bottom], [left, top],
    [right, middle], [left, middle], [center, top], [center, bottom],
  ];
  const order = [preferred, ...candidates.keys()].filter((key, i, all) => candidates[key] && all.indexOf(key) === i);
  const clearance = 16;
  for (const key of order) {
    const [x, y] = candidates[key];
    // The overview's Leaflet zoom controls occupy its top-left corner.
    if (x < 52 && y < 82) continue;
    const box = { x: x - clearance, y: y - clearance, width: width + 2 * clearance, height: height + 2 * clearance };
    const blocked = paths.some(points => points.some((point, i) => hitsBox(points[i - 1] ?? point, point, box)));
    if (!blocked) return { x, y, key };
  }
  return null;
}

export function mountMapInset({ map, overview, pane, handle, resizeHandle, autoButton, paths }) {
  let manual = null, position = null, choice = null, drag = null, frame = null, size = null;

  function limits() {
    const left = 10, top = 10;
    const right = overview.clientWidth - pane.offsetWidth - 10;
    const bottom = overview.clientHeight - pane.offsetHeight - 22; // keep attribution readable
    return right >= left && bottom >= top ? { left, right, top, bottom } : null;
  }

  function move(point) {
    position = point;
    pane.classList.toggle('is-floating', point != null);
    if (point) {
      pane.style.left = point.x + 'px';
      pane.style.top = point.y + 'px';
    }
  }

  function keepInside(point, bounds) {
    move({
      x: Math.max(bounds.left, Math.min(bounds.right, point.x)),
      y: Math.max(bounds.top, Math.min(bounds.bottom, point.y)),
    });
  }

  function setManual(point, bounds) {
    manual = point;
    autoButton.disabled = false;
    keepInside(point, bounds);
  }

  function applySize() {
    if (!size) return;
    const maxWidth = overview.clientWidth - 20;
    const maxHeight = overview.clientHeight - 32;
    const width = Math.max(134, Math.min(maxWidth, size.width));
    const height = Math.max(106, Math.min(maxHeight, size.height));
    pane.style.setProperty('--ride-detail-width', width + 'px');
    pane.style.setProperty('--ride-detail-height', height + 'px');
  }

  function resizeTo(width, height, origin) {
    size = { width, height };
    applySize();
    const bounds = limits();
    if (origin && bounds) keepInside(origin, bounds);
    else move(null);
  }

  function place() {
    if (pane.hidden || drag) return;
    applySize();
    const bounds = limits();
    if (!bounds) { move(null); return; }
    if (manual) { setManual(manual, bounds); return; }
    const next = chooseInset(bounds, pane.offsetWidth, pane.offsetHeight, paths(), choice);
    choice = next?.key;
    move(next);
  }

  function refresh() {
    if (pane.hidden || frame != null) return;
    frame = requestAnimationFrame(() => { frame = null; place(); });
  }

  for (const target of [handle, resizeHandle]) {
    const resizing = target === resizeHandle;
    target.addEventListener('pointerdown', e => {
      if (e.button !== 0 || drag || (!resizing && !limits())) return;
      drag = {
        id: e.pointerId, x: e.clientX, y: e.clientY, origin: position,
        width: pane.offsetWidth, height: pane.offsetHeight,
      };
      target.setPointerCapture(e.pointerId);
    });
    target.addEventListener('pointermove', e => {
      if (e.pointerId !== drag?.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (resizing) {
        resizeTo(drag.width + dx, drag.height + dy, drag.origin);
        return;
      }
      if (Math.abs(dx) + Math.abs(dy) < 3 && !manual) return;
      const bounds = limits();
      if (!bounds) return;
      const origin = drag.origin ?? { x: bounds.right, y: bounds.top };
      setManual({ x: origin.x + dx, y: origin.y + dy }, bounds);
    });
    target.addEventListener('lostpointercapture', e => {
      if (e.pointerId === drag?.id) { drag = null; refresh(); }
    });
    target.addEventListener('keydown', e => {
      const step = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[e.key];
      if (!step) return;
      e.preventDefault();
      if (resizing) {
        resizeTo(pane.offsetWidth + step[0], pane.offsetHeight + step[1], position);
        refresh();
        return;
      }
      const bounds = limits();
      if (!bounds) return;
      const origin = position ?? { x: bounds.right, y: bounds.top };
      setManual({ x: origin.x + step[0], y: origin.y + step[1] }, bounds);
    });
  }
  autoButton.addEventListener('click', () => {
    manual = null;
    autoButton.disabled = true;
    refresh();
  });
  map.on('moveend zoomend', refresh);

  return {
    refresh,
    destroy() {
      map.off('moveend zoomend', refresh);
      if (frame != null) cancelAnimationFrame(frame);
    },
  };
}
