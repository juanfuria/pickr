import { DEFAULTS, buildQuery, parseQuery } from './url.js';

const $ = (id) => document.getElementById(id);
const main = document.querySelector('main');
const FILE = main.dataset.file;
const ORIGINAL = { w: Number(main.dataset.width), h: Number(main.dataset.height) };
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
  };
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
}

function paintAddress(query, before) {
  const url = $('url');
  const old = new Set(before ? before.split('&') : []);
  url.replaceChildren();
  const span = (cls, text) => Object.assign(document.createElement('span'), { className: cls, textContent: text });
  const path = span('path', '');
  path.append(span('host', location.host), span('sep', '/'), span('file', FILE));
  url.append(path);
  // each parameter keeps its separator, so a narrow screen wraps between parameters, never inside one
  query.split('&').filter(Boolean).forEach((pair, i) => {
    const group = span('pair', '');
    group.append(span('sep', i === 0 ? '?' : '&'), span(old.has(pair) ? 'tok' : 'tok fresh', pair));
    url.append(group);
  });
  url.href = addressFor(query);
}

const pathFor = (query) => `/${FILE}${query ? `?${query}` : ''}`;
const addressFor = (query) => `${location.origin}${pathFor(query)}`;

function update() {
  const before = buildQuery(state);
  state = readForm();
  const query = buildQuery(state);
  paintControls(state);
  if (query !== before) paintAddress(query, before);
  history.replaceState(null, '', query ? `#${query}` : location.pathname);
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

  $('note').textContent = explain(s, query, nw, res.redirected);
}

function explain(s, query, nw, redirected) {
  if (!query) return 'No parameters, so this is the original file, straight off the disk.';
  if (redirected) return 'Nothing here changes the picture, so pickr sends you to the original instead of making a copy.';
  const notes = [];
  const askedW = s.w !== null ? Math.round(s.w * s.dpr) : null;
  if (askedW !== null && nw < askedW) {
    if (!s.up && askedW > ORIGINAL.w) notes.push(`The original is ${ORIGINAL.w} px wide, and pickr won't enlarge it unless you allow it.`);
    else if (s.fm && FORMAT_EDGE[s.fm] && askedW > FORMAT_EDGE[s.fm]) notes.push(`${s.fm.toUpperCase()} stops at ${FORMAT_EDGE[s.fm]} px on this little server.`);
    else if (s.h !== null && s.fit === 'inside') notes.push('With fit=inside it keeps its shape, so the height decided.');
  }
  if (s.dpr !== 1) notes.push(`At ${s.dpr}× you get ${s.dpr} times the pixels, shown at the size you asked for.`);
  if (s.w === null && s.h === null && s.fm) notes.push('Same size, new format.');
  return notes.join(' ');
}

form.addEventListener('input', update);
form.addEventListener('change', update);
form.addEventListener('submit', (e) => e.preventDefault());
form.addEventListener('reset', () => setTimeout(update));

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

originalBytes = await fetch(`/${FILE}`, { method: 'HEAD' })
  .then((r) => Number(r.headers.get('content-length')) || null)
  .catch(() => null);

if (location.hash.length > 1) writeForm(parseQuery(location.hash));
state = { ...DEFAULTS, w: -1 }; // force the first paint
update();
