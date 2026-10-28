import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, stat, utimes, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { makeRoot } from './helpers.js';
import { filePath, trashPath, tmpDir, newTmpPath, ensureLayout, moveToTrash, restoreFromTrash, sweep } from '../server/store.js';
import { createAccount, insertFile, markDeleted, getFile } from '../server/repo.js';

const row = (id, accountId, over = {}) => ({ id, accountId, kind: 'file', mime: 'text/plain', ext: 'txt', bytes: 1, sha256: id.padEnd(64, '0'), createdAt: '2026-01-01T00:00:00.000Z', meta: {}, ...over });

test('paths and layout', async () => {
  const { root, cleanup } = await makeRoot();
  assert.equal(filePath(root, 'abc', 'jpg'), join(root, 'files', 'abc.jpg'));
  assert.equal(trashPath(root, 'abc', 'jpg'), join(root, 'trash', 'abc.jpg'));
  assert.equal(tmpDir(root), join(root, 'tmp'));
  assert.ok(newTmpPath(root).startsWith(join(root, 'tmp') + '/'));
  assert.notEqual(newTmpPath(root), newTmpPath(root));
  await ensureLayout(root);
  for (const d of ['files', 'trash', 'tmp']) assert.ok((await stat(join(root, d))).isDirectory());
  await cleanup();
});

test('trash and restore move the file', async () => {
  const { root, cleanup } = await makeRoot();
  await writeFile(filePath(root, 'abc', 'txt'), 'x');
  await moveToTrash(root, 'abc', 'txt');
  await stat(trashPath(root, 'abc', 'txt'));
  await assert.rejects(stat(filePath(root, 'abc', 'txt')));
  await restoreFromTrash(root, 'abc', 'txt');
  await stat(filePath(root, 'abc', 'txt'));
  await cleanup();
});

test('sweep removes old trash rows and files, purges, and clears stale tmp', async () => {
  const { root, db, cleanup } = await makeRoot();
  const a = createAccount(db, 'juan');
  insertFile(db, row('old0000000000', a.id));
  insertFile(db, row('new0000000000', a.id));
  for (const id of ['old0000000000', 'new0000000000']) await writeFile(trashPath(root, id, 'txt'), 'x');
  markDeleted(db, 'old0000000000', '2026-01-01T00:00:00.000Z');
  markDeleted(db, 'new0000000000', '2026-01-20T00:00:00.000Z');
  const stale = join(tmpDir(root), 'stale');
  const fresh = join(tmpDir(root), 'fresh');
  await writeFile(stale, 'x');
  await writeFile(fresh, 'x');
  const old = new Date('2026-01-01T00:00:00.000Z');
  await utimes(stale, old, old);
  const purged = [];
  const r = await sweep({ db, root, now: new Date('2026-02-05T00:00:00.000Z'), trashDays: 30, purge: async (id, ext) => purged.push(`${id}.${ext}`) });
  assert.deepEqual(r, { removed: 1, tmpRemoved: 1 });
  assert.equal(getFile(db, 'old0000000000'), null);
  assert.equal(getFile(db, 'new0000000000').deleted_at, '2026-01-20T00:00:00.000Z');
  await assert.rejects(stat(trashPath(root, 'old0000000000', 'txt')));
  await stat(trashPath(root, 'new0000000000', 'txt'));
  assert.deepEqual(purged, ['old0000000000.txt']);
  assert.deepEqual(await readdir(tmpDir(root)), ['fresh']);
  await cleanup();
});
