import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, readdir } from 'node:fs/promises';
import { makeApp, multipart, fixture } from './helpers.js';
import { filePath, trashPath } from '../server/store.js';
import { createAccount, insertKey } from '../server/repo.js';
import { generateKey } from '../server/auth.js';
import { httpError } from '../server/http.js';

const auth = key => ({ authorization: `Bearer ${key}` });

async function upload(app, key, name, field = 'file') {
  const mp = multipart(field, name, await readFile(fixture(name)));
  return app.inject({ method: 'POST', url: '/api/files', headers: { ...auth(key), ...mp.headers }, payload: mp.payload });
}

test('authentication is required on /api and errors are json', async () => {
  const { app, cleanup } = await makeApp();
  const r = await app.inject({ method: 'GET', url: '/api/files' });
  assert.equal(r.statusCode, 401);
  assert.deepEqual(r.json(), { error: 'missing or invalid key' });
  assert.equal((await app.inject({ method: 'GET', url: '/api/files', headers: auth('pk_nope') })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/nope' })).statusCode, 404);
  await cleanup();
});

test('a percent-encoded /api path cannot skip authentication', async () => {
  const { app, root, cleanup } = await makeApp();
  for (const url of ['/%61pi/files', '/ap%69/me', '/%61pi/keys']) {
    assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401, url);
  }
  const mp = multipart('file', 'x.bin', Buffer.alloc(4096, 1));
  const r = await app.inject({ method: 'POST', url: '/%61pi/files', headers: mp.headers, payload: mp.payload });
  assert.equal(r.statusCode, 401);
  assert.deepEqual(await readdir(`${root}/tmp`), []);
  await cleanup();
});

test('upload, dedupe, get with meta, list, patch', async () => {
  const { app, key, root, cleanup } = await makeApp();
  const r = await upload(app, key, 'photo.jpg');
  assert.equal(r.statusCode, 201);
  const f = r.json();
  assert.equal(f.existing, false);
  assert.equal(f.url, `https://i.test/${f.id}.jpg`);
  assert.equal(f.kind, 'image');
  assert.deepEqual([f.width, f.height], [240, 320]);
  assert.equal(Object.hasOwn(f, 'meta'), false);
  await stat(filePath(root, f.id, 'jpg'));

  const again = await upload(app, key, 'photo.jpg');
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().existing, true);
  assert.equal(again.json().id, f.id);

  const one = await app.inject({ method: 'GET', url: `/api/files/${f.id}`, headers: auth(key) });
  assert.equal(one.statusCode, 200);
  assert.equal(one.json().meta['EXIF:Make'], 'TestCam');

  await upload(app, key, 'clip.mp4');
  const list = (await app.inject({ method: 'GET', url: '/api/files', headers: auth(key) })).json();
  assert.equal(list.files.length, 2);
  assert.equal(list.files[0].kind, 'video');
  const vids = (await app.inject({ method: 'GET', url: '/api/files?kind=video', headers: auth(key) })).json();
  assert.equal(vids.files.length, 1);
  const limited = (await app.inject({ method: 'GET', url: '/api/files?limit=1', headers: auth(key) })).json();
  assert.equal(limited.files.length, 1);

  const patched = await app.inject({ method: 'PATCH', url: `/api/files/${f.id}`, headers: auth(key), payload: { original_name: 'sunset.jpg' } });
  assert.equal(patched.statusCode, 200);
  assert.equal(patched.json().original_name, 'sunset.jpg');
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/files/${f.id}`, headers: auth(key), payload: { original_name: 7 } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/files/${f.id}`, headers: auth(key), payload: { kind: 'video' } })).statusCode, 400);
  assert.deepEqual(await readdir(`${root}/tmp`), []);
  await cleanup();
});

test('bad uploads: no file field, wrong field, unprocessable', async () => {
  const { app, key, cleanup } = await makeApp();
  assert.equal((await app.inject({ method: 'POST', url: '/api/files', headers: auth(key), payload: { a: 1 } })).statusCode, 400);
  assert.equal((await upload(app, key, 'photo.jpg', 'image')).statusCode, 400);
  const r = await upload(app, key, 'bitmap.bmp');
  assert.equal(r.statusCode, 422);
  assert.match(r.json().error, /strip/);
  assert.equal((await upload(app, key, 'empty.bin')).statusCode, 422);
  await cleanup();
});

test('delete to trash purges, restore brings back, ownership is a 404', async () => {
  const { app, key, root, db, purged, cleanup } = await makeApp();
  const f = (await upload(app, key, 'alpha.png')).json();
  const del = await app.inject({ method: 'DELETE', url: `/api/files/${f.id}`, headers: auth(key) });
  assert.equal(del.statusCode, 204);
  await stat(trashPath(root, f.id, 'png'));
  assert.deepEqual(purged, [`${f.id}.png`]);
  assert.equal((await app.inject({ method: 'GET', url: `/api/files/${f.id}`, headers: auth(key) })).statusCode, 404);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/files/${f.id}`, headers: auth(key) })).statusCode, 404);
  const back = await app.inject({ method: 'POST', url: `/api/files/${f.id}/restore`, headers: auth(key) });
  assert.equal(back.statusCode, 200);
  assert.equal(back.json().deleted_at, null);
  await stat(filePath(root, f.id, 'png'));
  assert.equal((await app.inject({ method: 'POST', url: `/api/files/${f.id}/restore`, headers: auth(key) })).statusCode, 404);

  const marta = createAccount(db, 'marta');
  const k2 = generateKey();
  insertKey(db, { accountId: marta.id, keyHash: k2.hash, label: 'm' });
  for (const [method, url] of [['GET', `/api/files/${f.id}`], ['PATCH', `/api/files/${f.id}`], ['DELETE', `/api/files/${f.id}`], ['POST', `/api/files/${f.id}/restore`]]) {
    const r = await app.inject({ method, url, headers: auth(k2.key), payload: method === 'PATCH' ? { original_name: 'x' } : undefined });
    assert.equal(r.statusCode, 404, `${method} ${url}`);
  }
  assert.equal((await app.inject({ method: 'GET', url: '/api/files', headers: auth(k2.key) })).json().files.length, 0);
  await cleanup();
});

test('delete and restore roll the row back when the file move fails', async () => {
  const { app, key, root, db, cleanup } = await makeApp();
  const { unlink } = await import('node:fs/promises');
  const { getFile } = await import('../server/repo.js');
  const f = (await upload(app, key, 'alpha.png')).json();
  await unlink(filePath(root, f.id, 'png')); // simulate a move that cannot happen
  const del = await app.inject({ method: 'DELETE', url: `/api/files/${f.id}`, headers: auth(key) });
  assert.equal(del.statusCode, 500);
  assert.equal(getFile(db, f.id).deleted_at, null, 'the row stays live when the file did not move');

  const g = (await upload(app, key, 'doc.pdf')).json();
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/files/${g.id}`, headers: auth(key) })).statusCode, 204);
  const trashedAt = getFile(db, g.id).deleted_at;
  await unlink(trashPath(root, g.id, 'pdf'));
  const back = await app.inject({ method: 'POST', url: `/api/files/${g.id}/restore`, headers: auth(key) });
  assert.equal(back.statusCode, 500);
  assert.equal(getFile(db, g.id).deleted_at, trashedAt, 'the row stays trashed, with its original date, when the file did not move');
  await cleanup();
});

test('keys: list, create shown once, revoke including the one in use, me', async () => {
  const { app, key, cleanup } = await makeApp();
  const list = (await app.inject({ method: 'GET', url: '/api/keys', headers: auth(key) })).json();
  assert.equal(list.keys.length, 1);
  assert.equal(Object.hasOwn(list.keys[0], 'key'), false);
  assert.equal(Object.hasOwn(list.keys[0], 'key_hash'), false);
  const made = await app.inject({ method: 'POST', url: '/api/keys', headers: auth(key), payload: { label: 'phone' } });
  assert.equal(made.statusCode, 201);
  assert.match(made.json().key, /^pk_/);
  assert.equal(made.json().label, 'phone');
  assert.equal((await app.inject({ method: 'POST', url: '/api/keys', headers: auth(key), payload: {} })).statusCode, 400);
  const me = (await app.inject({ method: 'GET', url: '/api/me', headers: auth(made.json().key) })).json();
  assert.equal(me.account, 'juan');
  assert.deepEqual([me.files, me.bytes], [0, 0]);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/keys/${made.json().id}`, headers: auth(key) })).statusCode, 204);
  assert.equal((await app.inject({ method: 'GET', url: '/api/me', headers: auth(made.json().key) })).statusCode, 401);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/keys/${made.json().id}`, headers: auth(key) })).statusCode, 404);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/keys/${list.keys[0].id}`, headers: auth(key) })).statusCode, 204, 'self-revocation');
  assert.equal((await app.inject({ method: 'GET', url: '/api/me', headers: auth(key) })).statusCode, 401);
  await cleanup();
});

test('a wrong-field upload with a large body does not stall close()', async () => {
  const { app, key, cleanup } = await makeApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const mp = multipart('image', 'big.bin', Buffer.alloc(2 * 1024 * 1024, 7));
  const r = await fetch(`${url}/api/files`, { method: 'POST', headers: { authorization: `Bearer ${key}`, ...mp.headers }, body: mp.payload });
  assert.equal(r.status, 400);
  const closed = await Promise.race([cleanup().then(() => 'closed'), new Promise(res => setTimeout(() => res('stalled'), 3000))]);
  assert.equal(closed, 'closed');
});

test('an upload over the size limit is a 413 and leaves nothing', async () => {
  const { app, key, root, cleanup } = await makeApp({ maxBytes: 1000 });
  const r = await upload(app, key, 'photo.jpg');
  assert.equal(r.statusCode, 413);
  assert.deepEqual(await readdir(`${root}/tmp`), []);
  assert.deepEqual(await readdir(`${root}/files`), []);
  await cleanup();
});

test('a 507 is not a fault: the client is told the server is short of space', async () => {
  const { app, cleanup } = await makeApp();
  // A throwaway route, added before the first inject makes the app ready: what is under test is the error handler,
  // and a full disk cannot be arranged deterministically.
  app.get('/full', async () => { throw httpError(507, 'not enough space on the server'); });
  const r = await app.inject({ method: 'GET', url: '/full' });
  assert.equal(r.statusCode, 507);
  assert.deepEqual(r.json(), { error: 'not enough space on the server' });
  assert.equal(r.headers['cache-control'], 'no-store');
  await cleanup();
});
