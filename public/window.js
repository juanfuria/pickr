// The window: a cut taken out of the picture before the resize, asked for by a shape (ar, or a cover resize to both
// sides), an anchor (a crop word or a point) and a zoom. One pure function the page and the server both import,
// so what the minimap draws is what the server cuts.

const ANCHORS = {
  centre: [0.5, 0.5], top: [0.5, 0], bottom: [0.5, 1], left: [0, 0.5], right: [1, 0.5],
  'top-left': [0, 0], 'top-right': [1, 0], 'bottom-left': [0, 1], 'bottom-right': [1, 1],
};
export const STRATEGIES = new Set(['entropy', 'attention']);

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

// The largest box of that shape inside a W x H picture, unrounded.
export function shapeBox(aspect, W, H) {
  return aspect >= W / H ? [W, W / aspect] : [H * aspect, H];
}

// p: parsed image params (ar, w, h, fit, crop, fp). W, H: the picture (after rect). null when nothing is cut.
export function windowFor(p, W, H) {
  if (p.crop && STRATEGIES.has(p.crop)) return null; // sharp looks at the picture itself, on the resize
  const cover = p.w !== null && p.h !== null && p.fit === 'cover';
  const aspect = p.ar ?? (cover ? p.w / p.h : null);
  const anchor = p.fp ? [p.fp.x, p.fp.y] : p.crop ? ANCHORS[p.crop] : null;
  const zoom = p.fp?.z ?? 1;
  if (aspect === null && zoom === 1) return null; // the picture's own shape, whole: nothing to cut
  if (aspect !== null && anchor === null && zoom === 1 && p.ar === null) return null; // a centred cover crop is sharp's own
  // the largest box of that shape inside the picture, then the zoom
  const full = shapeBox(aspect ?? W / H, W, H);
  const width = clamp(Math.round(full[0] / zoom), 1, W);
  const height = clamp(Math.round(full[1] / zoom), 1, H);
  if (width === W && height === H) return null;
  const [ax, ay] = anchor ?? [0.5, 0.5];
  const left = clamp(Math.round(ax * W - width / 2), 0, W - width);
  const top = clamp(Math.round(ay * H - height / 2), 0, H - height);
  return { left, top, width, height };
}
