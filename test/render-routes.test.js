import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { makeApp, multipart, fixture } from './helpers.js';
import { updateName } from '../server/repo.js';
import { filePath } from '../server/store.js';

async function put(app, key, name) {
  const mp = multipart('file', name, await readFile(fixture(name)));
  return (await app.inject({ method: 'POST', url: '/api/files', headers: { authorization: `Bearer ${key}`, ...mp.headers }, payload: mp.payload })).json();
}
const get = (app, url) => app.inject({ method: 'GET', url });

test('original when no parameter applies; variants when they do; headers', async () => {
  const { app, key, cleanup } = await makeApp();
  const f = await put(app, key, 'photo.jpg');
  const orig = await get(app, `/_render/${f.id}.jpg?foo=bar`);
  assert.equal(orig.statusCode, 200);
  assert.equal(orig.headers['content-type'], 'image/jpeg');
  assert.equal(orig.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.equal(orig.rawPayload.length, f.bytes);

  const small = await get(app, `/_render/${f.id}.jpg?w=100`);
  assert.equal(small.statusCode, 200);
  assert.equal(small.headers['content-type'], 'image/jpeg');
  const m = await sharp(small.rawPayload).metadata();
  assert.deepEqual([m.width, m.height], [100, 133]);

  const webp = await get(app, `/_render/${f.id}.jpg?w=50&fm=webp`);
  assert.equal(webp.headers['content-type'], 'image/webp');
  await cleanup();
});

test('404 for unknown, wrong extension, wrong case, no extension, traversal', async () => {
  const { app, key, cleanup } = await makeApp();
  const f = await put(app, key, 'photo.jpg');
  for (const url of [`/_render/${f.id}.png?w=10`, `/_render/${f.id}.JPG?w=10`, `/_render/${f.id}?w=10`, '/_render/zzzzzzzzzzzz.jpg?w=10', '/_render/..%2Fpickr.sqlite?w=1', '/_render/../pickr.sqlite?w=1', '/_render/.sqlite?w=1']) {
    const r = await get(app, url);
    assert.equal(r.statusCode, 404, url);
    assert.deepEqual(r.json(), { error: 'not found' }, url);
  }
  await cleanup();
});

test('deleted files are 404 even with parameters', async () => {
  const { app, key, cleanup } = await makeApp();
  const f = await put(app, key, 'alpha.png');
  await app.inject({ method: 'DELETE', url: `/api/files/${f.id}`, headers: { authorization: `Bearer ${key}` } });
  assert.equal((await get(app, `/_render/${f.id}.png?w=10`)).statusCode, 404);
  await cleanup();
});

test('a corrupt image is a 422; an image sharp cannot read (heic) falls back to the original', async () => {
  const { app, key, root, cleanup } = await makeApp();
  const c = await put(app, key, 'photo.jpg');
  // simulate on-disk damage: keep the header, cut the body
  await writeFile(filePath(root, c.id, 'jpg'), (await readFile(fixture('photo.jpg'))).subarray(0, 2000));
  const r = await get(app, `/_render/${c.id}.jpg?w=10`);
  assert.equal(r.statusCode, 422);
  assert.equal(r.headers['cache-control'], 'no-store', 'errors are never cacheable');
  assert.equal((await get(app, '/_render/zzzzzzzzzzzz.jpg?w=10')).headers['cache-control'], 'no-store');
  const h = await put(app, key, 'photo.heic');
  const hr = await get(app, `/_render/${h.id}.heic?w=10`);
  assert.equal(hr.statusCode, 200);
  assert.equal(hr.headers['content-type'], 'image/heic', 'the original, untouched');
  assert.equal(hr.rawPayload.length, h.bytes);
  await cleanup();
});

test('video: poster frame with t, composable, clamped; plain query serves the original', async () => {
  const { app, key, cleanup } = await makeApp();
  const v = await put(app, key, 'clip.mp4');
  const poster = await get(app, `/_render/${v.id}.mp4?t=1`);
  assert.equal(poster.statusCode, 200);
  assert.equal(poster.headers['content-type'], 'image/jpeg');
  const m = await sharp(poster.rawPayload).metadata();
  assert.deepEqual([m.width, m.height], [320, 240]);
  const thumb = await get(app, `/_render/${v.id}.mp4?t=1&w=64`);
  assert.deepEqual([(await sharp(thumb.rawPayload).metadata()).width], [64]);
  const implied = await get(app, `/_render/${v.id}.mp4?w=64`);
  assert.equal(implied.headers['content-type'], 'image/jpeg');
  const late = await get(app, `/_render/${v.id}.mp4?t=999`);
  assert.equal(late.statusCode, 200, 't is clamped to the duration');
  const orig = await get(app, `/_render/${v.id}.mp4?foo=1`);
  assert.equal(orig.headers['content-type'], 'video/mp4');
  await cleanup();
});

test('when the render limiter is full the client gets a 503 with Retry-After, never cached', async () => {
  const { httpError } = await import('../server/http.js');
  const busy = { run: () => { const e = httpError(503, 'busy'); e.retryAfter = 2; return Promise.reject(e); } };
  const { app, key, cleanup } = await makeApp({ renderLimiter: busy });
  const f = await put(app, key, 'photo.jpg');
  const r = await get(app, `/_render/${f.id}.jpg?w=10`);
  assert.equal(r.statusCode, 503);
  assert.deepEqual(r.json(), { error: 'busy' });
  assert.equal(r.headers['retry-after'], '2');
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal((await get(app, `/_render/${f.id}.jpg?foo=1`)).statusCode, 200, 'originals never touch the limiter');
  await cleanup();
});

test('a broken box is a 500, not a cached 422: missing ffmpeg', async () => {
  const { app, key, cleanup } = await makeApp();
  const v = await put(app, key, 'clip.mp4');
  const saved = process.env.PATH;
  process.env.PATH = '/nonexistent';
  try {
    const r = await get(app, `/_render/${v.id}.mp4?t=1`);
    assert.equal(r.statusCode, 500);
    assert.deepEqual(r.json(), { error: 'internal error' });
    assert.equal(r.headers['cache-control'], 'no-store');
  } finally {
    process.env.PATH = saved;
  }
  await cleanup();
});

test('files: dl=1 with a hostile name, svg headers', async () => {
  const { app, key, db, cleanup } = await makeApp();
  const p = await put(app, key, 'doc.pdf');
  updateName(db, p.id, 'a"b\r\nX-Evil: 1/../talk.pdf');
  const dl = await get(app, `/_render/${p.id}.pdf?dl=1`);
  assert.equal(dl.statusCode, 200);
  assert.equal(dl.headers['content-type'], 'application/pdf');
  assert.equal(dl.headers['content-disposition'], `attachment; filename="talk.pdf"; filename*=UTF-8''talk.pdf`);
  assert.equal(Object.hasOwn(dl.headers, 'x-evil'), false);
  const inline = await get(app, `/_render/${p.id}.pdf?w=100`);
  assert.equal(inline.headers['content-disposition'], undefined);

  const s = await put(app, key, 'scripted.svg');
  const sr = await get(app, `/_render/${s.id}.svg?dl=1`);
  assert.equal(sr.headers['content-security-policy'], 'sandbox');
  assert.equal(sr.headers['x-content-type-options'], 'nosniff');
  const raster = await get(app, `/_render/${s.id}.svg?w=32`);
  assert.equal(raster.headers['content-type'], 'image/png');
  await cleanup();
});
