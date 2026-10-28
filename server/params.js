export const MAX_EDGE = 4096;
const FITS = new Set(['inside', 'cover', 'fill']);
const FORMATS = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp', avif: 'avif' };

function int(v, min, max) {
  if (v === undefined || v === null) return null;
  const n = Number.parseInt(String(v), 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

export function parseImageParams(query = {}) {
  const w = int(query.w, 1, MAX_EDGE);
  const h = int(query.h, 1, MAX_EDGE);
  const fit = FITS.has(query.fit) ? query.fit : 'inside';
  const fm = FORMATS[String(query.fm ?? '').toLowerCase()] ?? null;
  const q = int(query.q, 1, 100) ?? 80;
  const dpr = int(query.dpr, 1, 3) ?? 1;
  const up = query.up === '1';
  const active = w !== null || h !== null || fm !== null || int(query.q, 1, 100) !== null || int(query.dpr, 1, 3) !== null;
  return { w, h, fit, fm, q, dpr, up, active };
}

export function parseVideoParams(query = {}) {
  const active = query.t !== undefined;
  const t = Number.parseFloat(query.t);
  return { t: Number.isFinite(t) && t >= 0 ? t : 0, active };
}
