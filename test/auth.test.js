import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRoot } from './helpers.js';
import { generateKey, hashKey, authenticate } from '../server/auth.js';
import { createAccount, insertKey, listKeys, revokeKey } from '../server/repo.js';

test('generateKey makes a pk_ key and its sha256', () => {
  const { key, hash } = generateKey();
  assert.match(key, /^pk_[A-Za-z0-9_-]{43}$/);
  assert.equal(hash, hashKey(key));
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(generateKey().key, key);
});

test('authenticate accepts a live key, rejects bad headers and revoked keys, throttles touch', async () => {
  const { db, cleanup } = await makeRoot();
  const a = createAccount(db, 'juan');
  const { key, hash } = generateKey();
  const k = insertKey(db, { accountId: a.id, keyHash: hash, label: 'test' });

  assert.equal(authenticate(db, undefined), null);
  assert.equal(authenticate(db, 'Basic abc'), null);
  assert.equal(authenticate(db, 'Bearer pk_wrong'), null);

  const t0 = new Date('2026-01-01T00:00:00.000Z');
  assert.deepEqual(authenticate(db, `Bearer ${key}`, t0), { accountId: a.id, keyId: k.id });
  assert.equal(listKeys(db, a.id)[0].last_used_at, t0.toISOString());

  const t1 = new Date(t0.getTime() + 30_000);
  authenticate(db, `bearer ${key}`, t1);
  assert.equal(listKeys(db, a.id)[0].last_used_at, t0.toISOString(), 'not touched within a minute');

  const t2 = new Date(t0.getTime() + 61_000);
  authenticate(db, `Bearer ${key}`, t2);
  assert.equal(listKeys(db, a.id)[0].last_used_at, t2.toISOString());

  revokeKey(db, a.id, k.id);
  assert.equal(authenticate(db, `Bearer ${key}`), null);
  await cleanup();
});
