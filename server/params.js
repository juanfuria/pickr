export const MAX_EDGE = 4096;
export const MAX_LEGO = 128; // bricks along the long side
const FITS = new Set(['inside', 'cover', 'fill']);
const FORMATS = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp', avif: 'avif' };

function int(v, min, max) {
  if (v === undefined || v === null) return null;
  const n = Number.parseInt(String(v), 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

// rect=x,y,w,h: four non-negative integers, pixels of the upright original. Anything else is no rectangle.
function rect(v) {
  if (typeof v !== 'string') return null;
  const m = /^(\d+),(\d+),(\d+),(\d+)$/.exec(v);
  if (!m) return null;
  const [x, y, w, h] = m.slice(1).map(Number);
  if (w < 1 || h < 1) return null;
  return { x, y, w, h };
}

// ar=W:H, two positive numbers: the shape of the window cut before the resize.
function aspect(v) {
  if (typeof v !== 'string') return null;
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(v);
  if (!m) return null;
  const a = Number(m[1]) / Number(m[2]);
  return Number.isFinite(a) && a > 0 ? a : null;
}

// crop=: where a cover crop is anchored, or a sharp strategy that looks at the picture. Never faces.
const CROPS = new Set(['centre', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'entropy', 'attention']);
function crop(v) {
  if (typeof v !== 'string') return null;
  const word = v.toLowerCase().replace(/^center$/, 'centre');
  return CROPS.has(word) ? word : null;
}

// fp-x, fp-y: a point as fractions of the picture; fp-z: a zoom. Any of them makes the anchor a point.
function focal(query) {
  const given = ['fp-x', 'fp-y', 'fp-z'].filter(k => query[k] !== undefined);
  if (!given.length) return null;
  const x = num(query['fp-x'], 0, 1);
  const y = num(query['fp-y'], 0, 1);
  const z = num(query['fp-z'], 1, 100);
  if (given.some(k => ({ 'fp-x': x, 'fp-y': y, 'fp-z': z })[k] === null)) return null;
  return { x: x ?? 0.5, y: y ?? 0.5, z: z ?? 1 };
}

function num(v, min, max) {
  if (v === undefined || v === null) return null;
  const n = Number.parseFloat(String(v));
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

export function parseImageParams(query = {}) {
  const ar = aspect(query.ar);
  let w = int(query.w, 1, MAX_EDGE);
  let h = int(query.h, 1, MAX_EDGE);
  // a shape with one side given derives the other, whole and inside the same bounds
  if (ar !== null && w !== null && h === null) h = Math.min(MAX_EDGE, Math.max(1, Math.round(w / ar)));
  if (ar !== null && h !== null && w === null) w = Math.min(MAX_EDGE, Math.max(1, Math.round(h * ar)));
  const fit = FITS.has(query.fit) ? query.fit : 'inside';
  const fmKey = String(query.fm ?? '').toLowerCase();
  const fm = Object.hasOwn(FORMATS, fmKey) ? FORMATS[fmKey] : null;
  const q = int(query.q, 1, 100) ?? 80;
  const dpr = num(query.dpr, 1, 3) ?? 1;
  const up = query.up === '1';
  const lego = int(query.lego, 1, MAX_LEGO);
  const r = rect(query.rect);
  const fp = focal(query);
  const c = fp ? null : crop(query.crop); // a point beats a word
  const active = w !== null || h !== null || fm !== null || int(query.q, 1, 100) !== null || num(query.dpr, 1, 3) !== null
    || lego !== null || r !== null || ar !== null || c !== null || fp !== null;
  return { w, h, fit, fm, q, dpr, up, lego, rect: r, ar, crop: c, fp, active };
}

export function parseVideoParams(query = {}) {
  const active = query.t !== undefined;
  const t = Number.parseFloat(query.t);
  return { t: Number.isFinite(t) && t >= 0 ? t : 0, active };
}
