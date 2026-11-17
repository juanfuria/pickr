import { DEFAULTS, buildQuery, parseQuery, parseAddress } from './url.js';
import { defaultRect, clampRect, drawRect, moveRect, resizeRect, mapToSource } from './rect.js';
import { windowFor } from './window.js';

const $ = (id) => document.getElementById(id);
const main = document.querySelector('main');
const DEFAULT_FILE = main.dataset.file;
let file = DEFAULT_FILE; // the picture on the page; the hash names it when it is not the default
let mapUrl = null;
const DEFAULT_SIZE = { w: Number(main.dataset.width), h: Number(main.dataset.height) };
const ORIGINAL = { ...DEFAULT_SIZE };
const FORMAT_EDGE = { avif: 1600, webp: 2560 };
const DPRS = [1, 1.5, 2, 3];
const FIT_HINTS = {
  inside: 'Fits inside the box and keeps its shape.',
  cover: 'Fills the box and crops whatever spills over.',
  fill: 'Fills the box exactly, stretching if it has to.',
};
const TYPES = { 'image/jpeg': 'JPEG', 'image/webp': 'WebP', 'image/avif': 'AVIF', 'image/png': 'PNG' };

const form = $('controls');
const canvas = $('canvas');
const img = $('picture');
const DEFAULT_ALT = img.alt;
const minimap = $('minimap');
const box = $('box');
const ratio = (ar) => (ar ? ar.split(':').map(Number).reduce((a, b) => a / b) : null);
const frac = (v, def) => { const n = Number.parseFloat(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : def; };
// the picture the window and the point refer to: the rect cut when there is one, else the whole original
const cutOf = (s) => s.rect ?? { x: 0, y: 0, w: ORIGINAL.w, h: ORIGINAL.h };
const windowOf = (s) => { const c = cutOf(s); return windowFor({ ar: ratio(s.ar), w: s.w, h: s.h, fit: s.fit, crop: s.crop, fp: s.fp }, c.w, c.h); };
const STRATEGY_NOTE = { entropy: 'the busiest part', attention: 'the most eye-catching part' };
let state = { ...DEFAULTS };
let shownQuery = null;
let wanted = null;
let inflight = null;
let objectUrl = null;
let timer = null;
let originalBytes = null;

function readForm() {
  const f = form.elements;
  return {
    w: f['w-on'].checked ? Number(f.w.value) : null,
    h: f['h-on'].checked ? Number(f.h.value) : null,
    fit: f.fit.value,
    fm: f.fm.value || null,
    q: Number(f.q.value),
    dpr: Number(f.dpr.value),
    up: f.up.checked,
    lego: f['lego-on'].checked ? Number(f.lego.value) : null,
    rect: f['rect-on'].checked ? clampRect({ x: f['rect-x'].value, y: f['rect-y'].value, w: f['rect-w'].value, h: f['rect-h'].value }, ORIGINAL.w, ORIGINAL.h) : null,
    ar: f.ar.value || null,
    crop: f.anchor.value && f.anchor.value !== 'point' ? f.anchor.value : null,
    fp: f.anchor.value === 'point' ? { x: frac(f['fp-x'].value, 0.5), y: frac(f['fp-y'].value, 0.5), z: Number(f['fp-z'].value) } : null,
  };
}

function writeRect(r) {
  const f = form.elements;
  f['rect-x'].value = r.x;
  f['rect-y'].value = r.y;
  f['rect-w'].value = r.w;
  f['rect-h'].value = r.h;
}

function writeForm(s) {
  const f = form.elements;
  f['w-on'].checked = s.w !== null;
  if (s.w !== null) f.w.value = s.w;
  f['h-on'].checked = s.h !== null;
  if (s.h !== null) f.h.value = s.h;
  f.fit.value = s.fit;
  f.fm.value = s.fm ?? '';
  f.q.value = s.q;
  f.dpr.value = String(DPRS.reduce((a, b) => (Math.abs(b - s.dpr) < Math.abs(a - s.dpr) ? b : a)));
  f.up.checked = s.up;
  f['lego-on'].checked = s.lego !== null;
  if (s.lego !== null) f.lego.value = s.lego;
  f['rect-on'].checked = s.rect !== null;
  if (s.rect !== null) writeRect(s.rect);
  f.ar.value = '';
  if (s.ar !== null) f.ar.value = s.ar; // a shape that is not a pill stays free
  f.anchor.value = '';
  f.anchor.value = s.fp ? 'point' : (s.crop ?? '');
  f['fp-x'].value = s.fp ? s.fp.x : '';
  f['fp-y'].value = s.fp ? s.fp.y : '';
  f['fp-z'].value = s.fp ? Math.min(8, s.fp.z) : 1;
}

function paintControls(s) {
  $('w').disabled = s.w === null;
  $('w-out').textContent = s.w === null ? 'off' : `${s.w} px`;
  $('h').disabled = s.h === null;
  $('h-out').textContent = s.h === null ? 'off' : `${s.h} px`;
  $('fit-set').disabled = s.w === null || s.h === null;
  $('fit-hint').textContent = s.w === null || s.h === null ? 'Needs both a width and a height.' : FIT_HINTS[s.fit];
  $('q').disabled = s.fm === 'png';
  $('q-out').textContent = s.fm === 'png' ? 'n/a' : String(s.q);
  $('q-hint').textContent = s.fm === 'png' ? 'PNG is lossless, so quality does nothing.' : '';
  $('lego').disabled = s.lego === null;
  $('lego-out').textContent = s.lego === null ? 'off' : `${s.lego} ${s.lego === 1 ? 'brick' : 'bricks'}`;
  for (const k of ['x', 'y', 'w', 'h']) $(`rect-${k}`).disabled = s.rect === null;
  $('rect-out').textContent = s.rect === null ? 'off' : `${s.rect.w} × ${s.rect.h}`;
  box.hidden = s.rect === null;
  if (s.rect !== null) {
    box.style.left = `${(s.rect.x / ORIGINAL.w) * 100}%`;
    box.style.top = `${(s.rect.y / ORIGINAL.h) * 100}%`;
    box.style.width = `${(s.rect.w / ORIGINAL.w) * 100}%`;
    box.style.height = `${(s.rect.h / ORIGINAL.h) * 100}%`;
  }
  // shape and anchor
  const point = s.fp !== null;
  const shaped = s.ar !== null || (s.w !== null && s.h !== null && s.fit === 'cover');
  const anchor = form.elements.anchor.value;
  $('fp-z').disabled = !point;
  $('fp-z-out').textContent = point ? `${s.fp.z}×` : 'n/a';
  $('anchor-out').textContent = point ? `${s.fp.x.toFixed(3)}, ${s.fp.y.toFixed(3)}` : '';
  $('anchor-hint').textContent = point ? 'Press on the little picture to place it. Zoom shrinks the window around it.'
    : anchor && !shaped ? 'Needs a shape: pick one, or cover with both a width and a height.'
    : STRATEGY_NOTE[anchor] ? `sharp looks at the picture and finds ${STRATEGY_NOTE[anchor]}.`
    : 'Where the window sits when the picture is bigger than its shape.';
  $('rect-hint').textContent = point ? 'While the anchor is a point, pressing the little picture places the point; the box still follows its corner.'
    : 'A rectangle cut out of the original before anything else. Draw it on the little picture, drag it about, pull its corner.';
  const cut = cutOf(s);
  const win = windowOf(s);
  const winEl = $('win');
  winEl.hidden = win === null;
  if (win !== null) {
    winEl.style.left = `${((cut.x + win.left) / ORIGINAL.w) * 100}%`;
    winEl.style.top = `${((cut.y + win.top) / ORIGINAL.h) * 100}%`;
    winEl.style.width = `${(win.width / ORIGINAL.w) * 100}%`;
    winEl.style.height = `${(win.height / ORIGINAL.h) * 100}%`;
  }
  const pointEl = $('point');
  pointEl.hidden = !point;
  if (point) {
    pointEl.style.left = `${((cut.x + s.fp.x * cut.w) / ORIGINAL.w) * 100}%`;
    pointEl.style.top = `${((cut.y + s.fp.y * cut.h) / ORIGINAL.h) * 100}%`;
  }
}

function paintAddress(query, before) {
  const url = $('url');
  const old = new Set(before ? before.split('&') : []);
  url.replaceChildren();
  const span = (cls, text) => Object.assign(document.createElement('span'), { className: cls, textContent: text });
  const path = span('path', '');
  path.append(span('host', location.host), span('sep', '/'), span('file', file));
  url.append(path);
  // each parameter keeps its separator, so a narrow screen wraps between parameters, never inside one
  query.split('&').filter(Boolean).forEach((pair, i) => {
    const group = span('pair', '');
    group.append(span('sep', i === 0 ? '?' : '&'), span(old.has(pair) ? 'tok' : 'tok fresh', pair));
    url.append(group);
  });
  url.href = addressFor(query);
}

const pathFor = (query) => `/${file}${query ? `?${query}` : ''}`;
const hashFor = (query) => { const parts = [file !== DEFAULT_FILE ? `f=${file}` : '', query].filter(Boolean); return parts.length ? `#${parts.join('&')}` : location.pathname; };
const addressFor = (query) => `${location.origin}${pathFor(query)}`;

function update() {
  const before = buildQuery(state);
  state = readForm();
  const query = buildQuery(state);
  paintControls(state);
  if (query !== before) paintAddress(query, before);
  history.replaceState(null, '', hashFor(query));
  clearTimeout(timer);
  timer = setTimeout(() => load(query), 200);
}

function kb(n) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
}

function setFact(id, text, sub) {
  const dd = $(id);
  dd.replaceChildren(text);
  if (sub) dd.append(sub);
}

function small(text, cls = 'sub') {
  return Object.assign(document.createElement('span'), { className: cls, textContent: text });
}

async function load(query, attempt = 0) {
  wanted = query;
  inflight?.abort();
  if (query === shownQuery && attempt === 0) {
    // back to what is already on screen: drop whatever was on its way
    canvas.classList.remove('busy');
    $('status').textContent = '';
    return;
  }
  const ctrl = new AbortController();
  inflight = ctrl;
  canvas.classList.add('busy');
  $('status').textContent = 'Rendering…';
  const started = performance.now();
  try {
    const res = await fetch(pathFor(query), { signal: ctrl.signal });
    if (res.status === 503 && attempt < 5) {
      const wait = Number(res.headers.get('retry-after')) || 2;
      $('status').textContent = `The server is busy with another picture. Trying again in ${wait} s.`;
      timer = setTimeout(() => load(query, attempt + 1), wait * 1000);
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `${res.status} ${res.statusText}`);
    }
    const blob = await res.blob();
    const ms = performance.now() - started;
    const next = URL.createObjectURL(blob);
    img.src = next;
    await img.decode();
    if (ctrl.signal.aborted || wanted !== query) { URL.revokeObjectURL(next); return; }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = next;
    shownQuery = query;
    show(query, res, blob, ms);
    $('status').textContent = '';
    canvas.classList.remove('busy');
  } catch (err) {
    if (err.name === 'AbortError' || ctrl.signal.aborted) return;
    canvas.classList.remove('busy');
    $('status').textContent = `That didn't work: ${err.message}`;
  }
}

function show(query, res, blob, ms) {
  const s = parseQuery(query);
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  img.style.setProperty('--w', `${nw / s.dpr}px`);

  const share = originalBytes ? small(`${Math.max(1, Math.round((blob.size / originalBytes) * 100))}% of the original`) : null;
  setFact('f-bytes', kb(blob.size), share);
  setFact('f-size', `${nw} × ${nh}`, s.dpr !== 1 ? small(`shown at ${Math.round(nw / s.dpr)} × ${Math.round(nh / s.dpr)}`) : null);
  setFact('f-type', TYPES[blob.type] ?? (blob.type || '?'));

  const cache = res.headers.get('x-cache-status');
  const untouched = !query || res.redirected;
  const badge = untouched
    ? small('original file', 'badge orig')
    : cache === 'HIT' ? small('from the cache', 'badge hit') : small('rendered now', 'badge miss');
  setFact('f-time', `${Math.round(ms)} ms`, document.createElement('br'));
  $('f-time').append(badge);

  $('note').textContent = explain(s, query, nw, nh, res.redirected);
}

function explain(s, query, nw, nh, redirected) {
  if (!query) return 'No parameters, so this is the original file, straight off the disk.';
  if (redirected) return 'Nothing here changes the picture, so pickr sends you to the original instead of making a copy.';
  const notes = [];
  const win = windowOf(s);
  const base = win ? { w: win.width, h: win.height, name: 'window' } : s.rect ? { w: s.rect.w, h: s.rect.h, name: 'cut' } : { ...ORIGINAL, name: 'original' };
  if (s.rect) notes.push(`${s.rect.w} × ${s.rect.h} cut from the original at ${s.rect.x},${s.rect.y}, before anything else.`);
  const shaped = s.ar !== null || (s.w !== null && s.h !== null && s.fit === 'cover');
  if (win) {
    const where = s.fp ? (s.fp.z !== 1 ? `zoomed ${s.fp.z}× on the point at ${s.fp.x.toFixed(2)}, ${s.fp.y.toFixed(2)}` : `around the point at ${s.fp.x.toFixed(2)}, ${s.fp.y.toFixed(2)}`)
      : s.crop ? `from the ${s.crop}` : 'around the middle';
    notes.push(`A ${win.width} × ${win.height} window${s.ar ? ` of ${s.ar}` : ''}, ${where}.`);
  } else if (shaped && STRATEGY_NOTE[s.crop]) {
    notes.push(`sharp chose ${STRATEGY_NOTE[s.crop]} (${s.crop}).`);
  }
  const askedW = s.w !== null ? Math.round(s.w * s.dpr) : null;
  if (askedW !== null && nw < askedW) {
    if (!s.up && !s.lego && askedW > base.w) notes.push(`The ${base.name} is ${base.w} px wide, and pickr won't enlarge it unless you allow it.`);
    else if (s.fm && FORMAT_EDGE[s.fm] && askedW > FORMAT_EDGE[s.fm]) notes.push(`${s.fm.toUpperCase()} stops at ${FORMAT_EDGE[s.fm]} px on this little server.`);
    else if (s.lego) notes.push('Lego pictures stop at 16 megapixels on this little server.');
    else if (s.h !== null && s.fit === 'inside') notes.push('With fit=inside it keeps its shape, so the height decided.');
  }
  if (s.lego) {
    const px = Math.max(nw, nh) / s.lego;
    notes.push(`${s.lego} ${s.lego === 1 ? 'brick' : 'bricks'} along the long side, ${px >= 10 ? Math.round(px) : px.toFixed(1)} px each.`);
  }
  if (s.dpr !== 1) notes.push(`At ${s.dpr}× you get ${s.dpr} times the pixels, shown at the size you asked for.`);
  if (s.w === null && s.h === null && s.fm) notes.push('Same size, new format.');
  return notes.join(' ');
}

$('rect-on').addEventListener('change', (e) => {
  if (e.target.checked && form.elements['rect-w'].value === '') writeRect(defaultRect(ORIGINAL.w, ORIGINAL.h));
});
document.querySelector('.xywh').addEventListener('change', () => {
  if (form.elements['rect-on'].checked) writeRect(readForm().rect); // what was typed, settled: whole and inside
});

// The minimap: press on empty picture to draw a box, on the box to move it, on the corner to resize it.
let drag = null;
const mapPoint = (e) => {
  const b = minimap.getBoundingClientRect();
  return mapToSource({ px: e.clientX - b.left, py: e.clientY - b.top }, b, ORIGINAL.w, ORIGINAL.h);
};
const setRect = (r) => { writeRect(r); update(); };
minimap.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  const on = form.elements['rect-on'].checked;
  const p = mapPoint(e);
  const pointMode = form.elements.anchor.value === 'point' && e.target !== $('handle');
  const mode = pointMode ? 'point' : on && e.target === $('handle') ? 'resize' : on && e.target === box ? 'move' : 'draw';
  drag = { mode, start: p, origin: on ? readForm().rect : null };
  minimap.setPointerCapture(e.pointerId);
  if (mode === 'point') return setPoint(p);
  form.elements['rect-on'].checked = true;
  if (mode === 'draw') setRect(drawRect(p, p, ORIGINAL.w, ORIGINAL.h));
});
minimap.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = mapPoint(e);
  if (drag.mode === 'point') return setPoint(p);
  const W = ORIGINAL.w, H = ORIGINAL.h;
  setRect(drag.mode === 'move' ? moveRect(drag.origin, p.x - drag.start.x, p.y - drag.start.y, W, H)
    : drag.mode === 'resize' ? resizeRect(drag.origin, p, W, H)
    : drawRect(drag.start, p, W, H));
});
// the point as fractions of the cut (the rect when there is one), three decimals like the address
function setPoint(p) {
  const c = cutOf(readForm());
  form.elements['fp-x'].value = Math.min(1, Math.max(0, (p.x - c.x) / c.w)).toFixed(3);
  form.elements['fp-y'].value = Math.min(1, Math.max(0, (p.y - c.y) / c.h)).toFixed(3);
  update();
}
for (const type of ['pointerup', 'pointercancel']) minimap.addEventListener(type, () => { drag = null; });

form.addEventListener('input', update);
form.addEventListener('change', update);
form.addEventListener('submit', (e) => e.preventDefault());
form.addEventListener('reset', () => setTimeout(() => { $('file').value = file; update(); })); // the file stays, the parameters go

$('view').addEventListener('click', () => {
  const actual = canvas.dataset.view !== 'actual';
  canvas.dataset.view = actual ? 'actual' : 'fit';
  $('view').setAttribute('aria-pressed', String(actual));
  $('view').textContent = actual ? 'Fit to the frame' : 'Actual pixels';
});

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('url').href);
    $('copy').textContent = 'Copied';
  } catch {
    $('copy').textContent = 'Press ⌘C';
    getSelection().selectAllChildren($('url'));
  }
  setTimeout(() => { $('copy').textContent = 'Copy'; }, 1600);
});

// The original's size makes a render's "% of the original" possible, but never worth a stalled page.
async function measureOriginal() {
  originalBytes = await Promise.race([
    fetch(`/${file}`, { method: 'HEAD' }).then((r) => Number(r.headers.get('content-length')) || null).catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
  ]);
}

// The little picture for the minimap, and with it the original's upright size, which a render says in a header.
// A render that is the original itself (a picture too small to shrink) says nothing, and nor does one cached
// before the header existed: then the size the page already knows serves, or the original is measured itself.
async function loadMap(name, known = null) {
  const res = await fetch(`/${name}?w=480`);
  if (!res.ok) throw new Error(res.status === 404 ? 'No file with that name on this host.' : `That didn't work: ${res.status}`);
  const blob = await res.blob();
  if (!blob.type.startsWith('image/')) throw new Error('That is a file here, but not a picture.');
  const said = /^(\d+)x(\d+)$/.exec(res.headers.get('x-source-size') ?? '');
  const size = said ? { w: Number(said[1]), h: Number(said[2]) }
    : known ?? await createImageBitmap(res.redirected ? blob : await (await fetch(`/${name}`)).blob()).then((b) => ({ w: b.width, h: b.height }));
  const next = URL.createObjectURL(blob);
  if (mapUrl) URL.revokeObjectURL(mapUrl);
  mapUrl = next;
  $('map').src = next;
  return size;
}

// Another picture on this host, from the file field: an id, or an address that may bring parameters of its own.
async function openFile(text) {
  const hint = $('file-hint');
  const parsed = parseAddress(text);
  if (!parsed) { hint.textContent = 'An id with its extension, like 5za4iMSuGLWa.png, or an address on this host.'; return; }
  hint.textContent = 'Looking…';
  try {
    const size = await loadMap(parsed.file, parsed.file === DEFAULT_FILE ? { ...DEFAULT_SIZE } : null);
    file = parsed.file;
    Object.assign(ORIGINAL, size);
    $('file').value = file;
    img.alt = file === DEFAULT_FILE ? DEFAULT_ALT : 'The picture, as the address asks for it';
    hint.textContent = `${size.w} × ${size.h} px`;
    originalBytes = null;
    measureOriginal();
    if (parsed.query) writeForm(parseQuery(parsed.query));
    shownQuery = null;
    state = { ...state, w: -1 }; // force a paint of the address and a fresh render
    update();
  } catch (err) {
    hint.textContent = err.message;
  }
}

$('open').addEventListener('click', () => openFile($('file').value));
$('file').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); openFile($('file').value); } });

// The hash may name the file (#f=id.ext&…). The default's size is on the page; another's comes with its map.
const named = location.hash.includes('f=') ? parseAddress(location.hash) : null;
if (named && named.file !== DEFAULT_FILE) {
  try {
    Object.assign(ORIGINAL, await loadMap(named.file));
    file = named.file;
    img.alt = 'The picture, as the address asks for it';
  } catch (err) {
    $('file-hint').textContent = `${err.message} This is the default instead.`;
  }
} else {
  loadMap(file, { ...DEFAULT_SIZE }).then((size) => Object.assign(ORIGINAL, size)).catch(() => { $('map').src = `/${file}?w=480`; });
}
$('file').value = file;
await measureOriginal();
if (location.hash.length > 1) writeForm(parseQuery(location.hash));
state = { ...DEFAULTS, w: -1 }; // force the first paint
update();
