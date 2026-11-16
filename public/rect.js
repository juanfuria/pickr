// The minimap's geometry: boxes in pixels of the upright original, whole, inside the picture, never empty.
// Pure, so the tests can import it the way they import url.js.

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export function clampRect(r, W, H) {
  const x = clamp(Math.round(num(r.x)), 0, W - 1);
  const y = clamp(Math.round(num(r.y)), 0, H - 1);
  const w = clamp(Math.round(num(r.w)), 1, W - x);
  const h = clamp(Math.round(num(r.h)), 1, H - y);
  return { x, y, w, h };
}

// The middle half of the picture: something to start from when the control is switched on.
export function defaultRect(W, H) {
  return clampRect({ x: W / 4, y: H / 4, w: W / 2, h: H / 2 }, W, H);
}

// From one point to another, whichever way the drag went. A click is a one-pixel box.
export function drawRect(a, b, W, H) {
  const x1 = clamp(Math.round(Math.min(a.x, b.x)), 0, W - 1);
  const y1 = clamp(Math.round(Math.min(a.y, b.y)), 0, H - 1);
  const x2 = clamp(Math.round(Math.max(a.x, b.x)), 0, W);
  const y2 = clamp(Math.round(Math.max(a.y, b.y)), 0, H);
  return clampRect({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, W, H);
}

// Shift, keeping the size: the box stops at the edges rather than shrinking.
export function moveRect(r, dx, dy, W, H) {
  return { ...r, x: clamp(Math.round(r.x + dx), 0, W - r.w), y: clamp(Math.round(r.y + dy), 0, H - r.h) };
}

// The bottom-right corner follows the pointer; the origin stays put.
export function resizeRect(r, p, W, H) {
  return clampRect({ x: r.x, y: r.y, w: Math.round(p.x) - r.x, h: Math.round(p.y) - r.y }, W, H);
}

// A pointer position on the little picture, as a point on the big one.
export function mapToSource(p, box, W, H) {
  return { x: box.width ? (p.px / box.width) * W : 0, y: box.height ? (p.py / box.height) * H : 0 };
}
