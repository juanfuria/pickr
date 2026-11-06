// The URL grammar as the home page speaks it: the shortest query that means the same thing to the server,
// so equal pictures share one cache entry. Pure, so the tests can import it.

export const DEFAULTS = Object.freeze({ w: null, h: null, fit: 'inside', fm: null, q: 80, dpr: 1, up: false });
export const FITS = ['inside', 'cover', 'fill'];
export const FORMATS = ['jpg', 'webp', 'avif', 'png'];
const MAX_EDGE = 4096;

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export function buildQuery(s) {
  const out = [];
  if (s.w !== null) out.push(['w', s.w]);
  if (s.h !== null) out.push(['h', s.h]);
  if (s.w !== null && s.h !== null && s.fit !== DEFAULTS.fit) out.push(['fit', s.fit]);
  if (s.fm !== null) out.push(['fm', s.fm]);
  if (s.q !== DEFAULTS.q && s.fm !== 'png') out.push(['q', s.q]);
  if (s.dpr !== DEFAULTS.dpr) out.push(['dpr', s.dpr]);
  if (s.up) out.push(['up', 1]);
  return out.map(([k, v]) => `${k}=${v}`).join('&');
}

export function parseQuery(text) {
  const p = new URLSearchParams(String(text).replace(/^[#?]/, ''));
  const int = (k, min, max) => {
    const n = Number.parseInt(p.get(k) ?? '', 10);
    return Number.isFinite(n) ? clamp(n, min, max) : null;
  };
  const dpr = Number.parseFloat(p.get('dpr') ?? '');
  return {
    w: int('w', 1, MAX_EDGE),
    h: int('h', 1, MAX_EDGE),
    fit: FITS.includes(p.get('fit')) ? p.get('fit') : DEFAULTS.fit,
    fm: FORMATS.includes(p.get('fm')) ? p.get('fm') : null,
    q: int('q', 1, 100) ?? DEFAULTS.q,
    dpr: Number.isFinite(dpr) ? clamp(dpr, 1, 3) : DEFAULTS.dpr,
    up: p.get('up') === '1',
  };
}
