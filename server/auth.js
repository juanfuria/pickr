import { createHash, randomBytes } from 'node:crypto';
import { findKeyByHash, touchKey } from './repo.js';

export function hashKey(key) {
  return createHash('sha256').update(key).digest('hex');
}

export function generateKey() {
  const key = 'pk_' + randomBytes(32).toString('base64url');
  return { key, hash: hashKey(key) };
}

export function authenticate(db, header, at = new Date()) {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  if (!m) return null;
  const row = findKeyByHash(db, hashKey(m[1]));
  if (!row) return null;
  const last = row.last_used_at ? Date.parse(row.last_used_at) : 0;
  if (at.getTime() - last >= 60_000) touchKey(db, row.id, at.toISOString());
  return { accountId: row.account_id, keyId: row.id };
}
