// The URL grammar as the home page speaks it: the shortest query that means the same thing to the server,
// so equal pictures share one cache entry. Pure, so the tests can import it.

export const DEFAULTS = Object.freeze({ w: null, h: null, fit: 'inside', fm: null, q: 80, dpr: 1, up: false, lego: null, rect: null, ar: null, crop: null, fp: null });
export const CROPS = ['centre', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'entropy', 'attention'];
export const FITS = ['inside', 'cover', 'fill'];
export const FORMATS = ['jpg', 'webp', 'avif', 'png'];
const MAX_EDGE = 4096;
const MAX_LEGO = 128;

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

// rect=x,y,w,h, the same grammar as the server: four non-negative integers, an empty rectangle is none.
export function parseRect(text) {
  const m = /^(\d+),(\d+),(\d+),(\d+)$/.exec(String(text ?? ''));
  if (!m) return null;
  const [x, y, w, h] = m.slice(1).map(Number);
  return w < 1 || h < 1 ? null : { x, y, w, h };
}

// ar=W:H as typed, kept when it is two positive numbers; the server turns it into a ratio.
export function parseAspect(text) {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(text ?? ''));
  return m && Number(m[1]) > 0 && Number(m[2]) > 0 ? m[0] : null;
}

const dec = (n) => Number(n.toFixed(3)); // three decimals of a fraction are a pixel on anything up to 1000 wide

export function buildQuery(s) {
  const out = [];
  if (s.rect) out.push(['rect', `${s.rect.x},${s.rect.y},${s.rect.w},${s.rect.h}`]); // the cut comes first, as it happens first
  if (s.ar !== null) out.push(['ar', s.ar]);
  if (s.w !== null) out.push(['w', s.w]);
  if (s.h !== null) out.push(['h', s.h]);
  if (s.w !== null && s.h !== null && s.fit !== DEFAULTS.fit) out.push(['fit', s.fit]);
  // a word needs a shape to anchor; a point beats a word
  const shaped = s.ar !== null || (s.w !== null && s.h !== null && s.fit === 'cover');
  if (s.fp) {
    out.push(['fp-x', dec(s.fp.x)], ['fp-y', dec(s.fp.y)]);
    if (s.fp.z !== 1) out.push(['fp-z', dec(s.fp.z)]);
  } else if (s.crop !== null && shaped) out.push(['crop', s.crop]);
  if (s.fm !== null) out.push(['fm', s.fm]);
  if (s.q !== DEFAULTS.q && s.fm !== 'png') out.push(['q', s.q]);
  if (s.dpr !== DEFAULTS.dpr) out.push(['dpr', s.dpr]);
  if (s.up) out.push(['up', 1]);
  if (s.lego !== null) out.push(['lego', s.lego]);
  return out.map(([k, v]) => `${k}=${v}`).join('&');
}

export function parseQuery(text) {
  const p = new URLSearchParams(String(text).replace(/^[#?]/, ''));
  const int = (k, min, max) => {
    const n = Number.parseInt(p.get(k) ?? '', 10);
    return Number.isFinite(n) ? clamp(n, min, max) : null;
  };
  const dpr = Number.parseFloat(p.get('dpr') ?? '');
  const word = (p.get('crop') ?? '').toLowerCase().replace(/^center$/, 'centre');
  const crop = CROPS.includes(word) ? word : null;
  const fpKeys = ['fp-x', 'fp-y', 'fp-z'].filter(k => p.has(k));
  const fpVals = fpKeys.map(k => Number.parseFloat(p.get(k)));
  let fp = null;
  if (fpKeys.length && fpVals.every(Number.isFinite)) {
    const get = (k, min, max, def) => (fpKeys.includes(k) ? clamp(fpVals[fpKeys.indexOf(k)], min, max) : def);
    fp = { x: get('fp-x', 0, 1, 0.5), y: get('fp-y', 0, 1, 0.5), z: get('fp-z', 1, 100, 1) };
  }
  return {
    w: int('w', 1, MAX_EDGE),
    h: int('h', 1, MAX_EDGE),
    fit: FITS.includes(p.get('fit')) ? p.get('fit') : DEFAULTS.fit,
    fm: FORMATS.includes(p.get('fm')) ? p.get('fm') : null,
    q: int('q', 1, 100) ?? DEFAULTS.q,
    dpr: Number.isFinite(dpr) ? clamp(dpr, 1, 3) : DEFAULTS.dpr,
    up: p.get('up') === '1',
    lego: int('lego', 1, MAX_LEGO),
    rect: parseRect(p.get('rect')),
    ar: parseAspect(p.get('ar')),
    crop: fp ? null : crop,
    fp,
  };
}

// A file on this host as the file field takes it: "id.ext", "/id.ext?w=800", a full address, or a playground link
// with #f=. Gives the file and whatever query came with it, or null when there is no file in the text.
const fileName = (s) => (/^[A-Za-z0-9][A-Za-z0-9_]*\.[a-z0-9]+$/.test(s ?? '') ? s : null);
export function parseAddress(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  const [front, hash = ''] = s.split('#');
  const h = new URLSearchParams(hash);
  if (h.has('f')) {
    const file = fileName(h.get('f'));
    if (!file) return null;
    h.delete('f');
    return { file, query: decodeURIComponent(h.toString()) };
  }
  const [path, query = ''] = front.split('?');
  const file = fileName(path.slice(path.lastIndexOf('/') + 1));
  return file ? { file, query } : null;
}
