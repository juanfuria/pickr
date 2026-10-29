import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRoot } from './helpers.js';
import { openDb } from '../server/db.js';
import { listAccounts, listKeys, insertFile, markDeleted, getFile, createAccount } from '../server/repo.js';
import { authenticate } from '../server/auth.js';
import { trashPath } from '../server/store.js';

const run = promisify(execFile);
const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'pickr-admin.js');
const admin = (root, args, env = {}) => run(process.execPath, ['--disable-warning=ExperimentalWarning', BIN, ...args], { env: { ...process.env, PICKR_ROOT: root, PICKR_PURGE_URL: 'http://127.0.0.1:1', ...env } });

test('accounts and keys', async () => {
  const { root, db, cleanup } = await makeRoot();
  db.close();
  assert.match((await admin(root, ['account', 'add', 'juan'])).stdout, /^account juan id=1\n$/);
  await admin(root, ['account', 'add', 'marta']);
  await assert.rejects(admin(root, ['account', 'add', 'juan']), e => /exists/.test(e.stderr));
  assert.equal((await admin(root, ['account', 'list'])).stdout, 'juan id=1\nmarta id=2\n');

  const { stdout } = await admin(root, ['key', 'add', 'marta', "Marta's laptop"]);
  const key = stdout.trim().split('\n').pop();
  assert.match(key, /^pk_/);
  const db2 = openDb(join(root, 'pickr.sqlite'));
  assert.deepEqual(authenticate(db2, `Bearer ${key}`), { accountId: 2, keyId: 1 });
  assert.equal(listKeys(db2, 2)[0].label, "Marta's laptop");
  await admin(root, ['key', 'revoke', '1']);
  assert.equal(authenticate(db2, `Bearer ${key}`), null);
  await assert.rejects(admin(root, ['key', 'revoke', '1']));
  await assert.rejects(admin(root, ['key', 'add', 'nobody', 'x']));
  db2.close();
  await cleanup();
});

test('chown and sweep', async () => {
  const { root, db, cleanup } = await makeRoot();
  const a = createAccount(db, 'juan');
  const b = createAccount(db, 'marta');
  insertFile(db, { id: 'f1aaaaaaaaaa', accountId: a.id, kind: 'file', mime: 'text/plain', ext: 'txt', bytes: 1, sha256: '1'.repeat(64), meta: {}, createdAt: '2026-01-01T00:00:00.000Z' });
  await writeFile(trashPath(root, 'f1aaaaaaaaaa', 'txt'), 'x');
  markDeleted(db, 'f1aaaaaaaaaa', '2026-01-02T00:00:00.000Z');
  db.close();
  await admin(root, ['file', 'chown', 'f1aaaaaaaaaa', 'marta']);
  const db2 = openDb(join(root, 'pickr.sqlite'));
  assert.equal(getFile(db2, 'f1aaaaaaaaaa').account_id, b.id);
  db2.close();
  assert.equal((await admin(root, ['sweep'], { PICKR_NOW: '2026-01-20T00:00:00.000Z' })).stdout, 'removed=0 tmp=0 failed=0\n');
  assert.equal((await admin(root, ['sweep'], { PICKR_NOW: '2026-03-01T00:00:00.000Z' })).stdout, 'removed=1 tmp=0 failed=0\n');
  await assert.rejects(admin(root, ['bogus']));
  await cleanup();
});
