import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRoot } from './helpers.js';
import * as repo from '../server/repo.js';

const fileRow = (over = {}) => ({
  id: 'abcdefghijkl', accountId: 1, kind: 'image', mime: 'image/jpeg', ext: 'jpg', bytes: 10, sha256: 'a'.repeat(64),
  width: 1, height: 1, duration: null, originalName: 'x.jpg', takenAt: null, meta: { 'File:MIMEType': 'image/jpeg' },
  createdAt: '2026-01-01T00:00:00.000Z', ...over,
});

test('accounts: create, get, by name, list, unique', async () => {
  const { db, cleanup } = await makeRoot();
  const a = repo.createAccount(db, 'juan');
  assert.equal(a.name, 'juan');
  assert.equal(repo.getAccount(db, a.id).name, 'juan');
  assert.equal(repo.getAccountByName(db, 'juan').id, a.id);
  assert.equal(repo.getAccountByName(db, 'nobody'), null);
  repo.createAccount(db, 'marta');
  assert.deepEqual(repo.listAccounts(db).map(x => x.name), ['juan', 'marta']);
  assert.throws(() => repo.createAccount(db, 'juan'));
  await cleanup();
});

test('keys: insert, find live only, list without hash, revoke once, touch', async () => {
  const { db, cleanup } = await makeRoot();
  const a = repo.createAccount(db, 'juan');
  const k = repo.insertKey(db, { accountId: a.id, keyHash: 'h1', label: 'laptop' });
  assert.equal(repo.findKeyByHash(db, 'h1').id, k.id);
  assert.equal(repo.findKeyByHash(db, 'nope'), null);
  assert.equal(Object.hasOwn(repo.listKeys(db, a.id)[0], 'key_hash'), false);
  repo.touchKey(db, k.id, '2026-01-02T00:00:00.000Z');
  assert.equal(repo.listKeys(db, a.id)[0].last_used_at, '2026-01-02T00:00:00.000Z');
  assert.equal(repo.revokeKey(db, a.id, k.id), true);
  assert.equal(repo.revokeKey(db, a.id, k.id), false);
  assert.equal(repo.findKeyByHash(db, 'h1'), null);
  assert.equal(repo.revokeKey(db, 999, k.id), false);
  await cleanup();
});

test('files: insert, get, live, sha lookup, list order and filters, delete/restore, name, owner, stats', async () => {
  const { db, cleanup } = await makeRoot();
  const a = repo.createAccount(db, 'juan');
  const b = repo.createAccount(db, 'marta');
  const f1 = repo.insertFile(db, fileRow({ id: 'f1aaaaaaaaaa', accountId: a.id, createdAt: '2026-01-01T00:00:00.000Z' }));
  assert.deepEqual(f1.meta, { 'File:MIMEType': 'image/jpeg' });
  repo.insertFile(db, fileRow({ id: 'f2aaaaaaaaaa', accountId: a.id, kind: 'video', ext: 'mp4', mime: 'video/mp4', sha256: 'b'.repeat(64), bytes: 20, createdAt: '2026-02-01T00:00:00.000Z' }));
  repo.insertFile(db, fileRow({ id: 'f3aaaaaaaaaa', accountId: b.id, sha256: 'c'.repeat(64), createdAt: '2026-03-01T00:00:00.000Z' }));

  assert.equal(repo.getLiveFile(db, 'f1aaaaaaaaaa').id, 'f1aaaaaaaaaa');
  assert.equal(repo.findLiveBySha(db, a.id, 'a'.repeat(64)).id, 'f1aaaaaaaaaa');
  assert.equal(repo.findLiveBySha(db, b.id, 'a'.repeat(64)), null);

  assert.deepEqual(repo.listFiles(db, a.id).map(r => r.id), ['f2aaaaaaaaaa', 'f1aaaaaaaaaa']);
  assert.deepEqual(repo.listFiles(db, a.id, { kind: 'video' }).map(r => r.id), ['f2aaaaaaaaaa']);
  assert.deepEqual(repo.listFiles(db, a.id, { since: '2026-01-15' }).map(r => r.id), ['f2aaaaaaaaaa']);
  assert.deepEqual(repo.listFiles(db, a.id, { before: '2026-02-01T00:00:00.000Z' }).map(r => r.id), ['f1aaaaaaaaaa']);
  assert.deepEqual(repo.listFiles(db, a.id, { limit: 1 }).map(r => r.id), ['f2aaaaaaaaaa']);

  repo.markDeleted(db, 'f1aaaaaaaaaa', '2026-04-01T00:00:00.000Z');
  assert.equal(repo.getLiveFile(db, 'f1aaaaaaaaaa'), null);
  assert.equal(repo.getFile(db, 'f1aaaaaaaaaa').deleted_at, '2026-04-01T00:00:00.000Z');
  assert.equal(repo.findLiveBySha(db, a.id, 'a'.repeat(64)), null);
  assert.deepEqual(repo.trashedBefore(db, '2026-05-01T00:00:00.000Z').map(r => r.id), ['f1aaaaaaaaaa']);
  assert.deepEqual(repo.trashedBefore(db, '2026-03-01T00:00:00.000Z'), []);
  repo.markRestored(db, 'f1aaaaaaaaaa');
  assert.equal(repo.getLiveFile(db, 'f1aaaaaaaaaa').deleted_at, null);

  repo.updateName(db, 'f1aaaaaaaaaa', 'renamed.jpg');
  assert.equal(repo.getFile(db, 'f1aaaaaaaaaa').original_name, 'renamed.jpg');
  repo.setOwner(db, 'f1aaaaaaaaaa', b.id);
  assert.equal(repo.getFile(db, 'f1aaaaaaaaaa').account_id, b.id);
  assert.deepEqual(repo.accountStats(db, a.id), { files: 1, bytes: 20 });
  assert.deepEqual(repo.accountStats(db, b.id), { files: 2, bytes: 20 });

  repo.deleteFileRow(db, 'f1aaaaaaaaaa');
  assert.equal(repo.getFile(db, 'f1aaaaaaaaaa'), null);
  await cleanup();
});
