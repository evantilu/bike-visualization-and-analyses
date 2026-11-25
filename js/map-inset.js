// Prefer a clear spot for the detail map and always keep it inside the overview.
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
  let manual = null, position = null, choice = null, drag = null, frame = null;

  function limits() {
    const left = 10, top = 10;
    return {
      left, top,
      right: Math.max(left, overview.clientWidth - pane.offsetWidth - 10),
      bottom: Math.max(top, overview.clientHeight - pane.offsetHeight - 22),
    };
  }

  function move(point) {
    position = point;
    pane.style.left = point.x + 'px';
    pane.style.top = point.y + 'px';
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

  function resizeTo(width, height, origin) {
    // CSS caps the requested size against the current overview, including after a viewport resize.
    pane.style.setProperty('--ride-detail-width', Math.max(134, width) + 'px');
    pane.style.setProperty('--ride-detail-height', Math.max(106, height) + 'px');
    const bounds = limits();
    setManual(origin ?? { x: bounds.right, y: bounds.top }, bounds);
  }

  function place() {
    if (pane.hidden || drag) return;
    const bounds = limits();
    if (manual) { setManual(manual, bounds); return; }
    const next = chooseInset(bounds, pane.offsetWidth, pane.offsetHeight, paths(), choice);
    choice = next?.key;
    keepInside(next ?? position ?? { x: bounds.right, y: bounds.top }, bounds);
  }

  function refresh() {
    if (pane.hidden || frame != null) return;
    frame = requestAnimationFrame(() => { frame = null; place(); });
  }

  for (const target of [handle, resizeHandle]) {
    const resizing = target === resizeHandle;
    target.addEventListener('pointerdown', e => {
      if (e.button !== 0 || drag) return;
      drag = {
        id: e.pointerId, x: e.clientX, y: e.clientY, origin: position,
        width: pane.offsetWidth, height: pane.offsetHeight,
      };
      target.setPointerCapture(e.pointerId);
    });
    target.addEventListener('pointermove', e => {
      if (e.pointerId !== drag?.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) < 3 && !manual) return;
      if (resizing) {
        resizeTo(drag.width + dx, drag.height + dy, drag.origin);
        return;
      }
      const bounds = limits();
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
