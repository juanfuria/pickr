import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, readdir } from 'node:fs/promises';
import { makeApp, multipart, fixture } from './helpers.js';
import { filePath, trashPath } from '../server/store.js';
import { createAccount, insertKey } from '../server/repo.js';
import { generateKey } from '../server/auth.js';

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

test('a percent-encoded /api path still needs a key and writes nothing', async () => {
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

test('an upload over the size limit is a 413 and leaves nothing', async () => {
  const { app, key, root, cleanup } = await makeApp({ maxBytes: 1000 });
  const r = await upload(app, key, 'photo.jpg');
  assert.equal(r.statusCode, 413);
  assert.deepEqual(await readdir(`${root}/tmp`), []);
  assert.deepEqual(await readdir(`${root}/files`), []);
  await cleanup();
});
