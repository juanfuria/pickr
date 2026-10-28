import { now } from './db.js';

const parseRow = r => (r ? { ...r, meta: JSON.parse(r.meta ?? '{}') } : null);

// accounts
export function createAccount(db, name, at = now()) {
  const r = db.prepare('INSERT INTO accounts (name, created_at) VALUES (?, ?)').run(name, at);
  return getAccount(db, Number(r.lastInsertRowid));
}
export function getAccount(db, id) {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) ?? null;
}
export function getAccountByName(db, name) {
  return db.prepare('SELECT * FROM accounts WHERE name = ?').get(name) ?? null;
}
export function listAccounts(db) {
  return db.prepare('SELECT * FROM accounts ORDER BY id').all();
}

// keys
const KEY_COLS = 'id, account_id, label, created_at, last_used_at, revoked_at';
export function insertKey(db, { accountId, keyHash, label, at = now() }) {
  const r = db.prepare('INSERT INTO keys (account_id, key_hash, label, created_at) VALUES (?, ?, ?, ?)').run(accountId, keyHash, label, at);
  return db.prepare(`SELECT ${KEY_COLS} FROM keys WHERE id = ?`).get(Number(r.lastInsertRowid));
}
export function findKeyByHash(db, keyHash) {
  return db.prepare(`SELECT ${KEY_COLS} FROM keys WHERE key_hash = ? AND revoked_at IS NULL`).get(keyHash) ?? null;
}
export function listKeys(db, accountId) {
  return db.prepare(`SELECT ${KEY_COLS} FROM keys WHERE account_id = ? ORDER BY id`).all(accountId);
}
export function revokeKey(db, accountId, keyId, at = now()) {
  return db.prepare('UPDATE keys SET revoked_at = ? WHERE id = ? AND account_id = ? AND revoked_at IS NULL').run(at, keyId, accountId).changes === 1;
}
export function touchKey(db, keyId, at = now()) {
  db.prepare('UPDATE keys SET last_used_at = ? WHERE id = ?').run(at, keyId);
}

// files
export function insertFile(db, f) {
  db.prepare(`INSERT INTO files (id, account_id, kind, mime, ext, bytes, sha256, width, height, duration, original_name, taken_at, meta, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(f.id, f.accountId, f.kind, f.mime, f.ext, f.bytes, f.sha256, f.width ?? null, f.height ?? null, f.duration ?? null,
         f.originalName ?? null, f.takenAt ?? null, JSON.stringify(f.meta ?? {}), f.createdAt ?? now());
  return getFile(db, f.id);
}
export function getFile(db, id) {
  return parseRow(db.prepare('SELECT * FROM files WHERE id = ?').get(id));
}
export function getLiveFile(db, id) {
  return parseRow(db.prepare('SELECT * FROM files WHERE id = ? AND deleted_at IS NULL').get(id));
}
export function findLiveBySha(db, accountId, sha256) {
  return parseRow(db.prepare('SELECT * FROM files WHERE account_id = ? AND sha256 = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1').get(accountId, sha256));
}
export function listFiles(db, accountId, { kind = null, since = null, before = null, beforeId = null, limit = 100 } = {}) {
  const where = ['account_id = ?', 'deleted_at IS NULL'];
  const args = [accountId];
  if (kind) { where.push('kind = ?'); args.push(kind); }
  if (since) { where.push('created_at >= ?'); args.push(since); }
  if (before && beforeId) { where.push('(created_at < ? OR (created_at = ? AND id < ?))'); args.push(before, before, beforeId); }
  else if (before) { where.push('created_at < ?'); args.push(before); }
  args.push(limit);
  return db.prepare(`SELECT * FROM files WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`).all(...args).map(parseRow);
}
export function markDeleted(db, id, at = now()) {
  db.prepare('UPDATE files SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(at, id);
}
// Restore claims the row: only a trashed row flips back, and the caller learns whether it won (the sweep may have
// claimed the same row first from another process).
export function markRestored(db, id) {
  return db.prepare('UPDATE files SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL').run(id).changes === 1;
}
// The sweep claims a row the same way: one conditional delete, true only if the row was still trashed and old enough.
export function claimTrashed(db, id, cutoffIso) {
  return db.prepare('DELETE FROM files WHERE id = ? AND deleted_at IS NOT NULL AND deleted_at < ?').run(id, cutoffIso).changes === 1;
}
export function deleteFileRow(db, id) {
  db.prepare('DELETE FROM files WHERE id = ?').run(id);
}
export function updateName(db, id, name) {
  db.prepare('UPDATE files SET original_name = ? WHERE id = ?').run(name, id);
}
export function setOwner(db, id, accountId) {
  db.prepare('UPDATE files SET account_id = ? WHERE id = ?').run(accountId, id);
}
export function trashedBefore(db, cutoffIso) {
  return db.prepare('SELECT * FROM files WHERE deleted_at IS NOT NULL AND deleted_at < ? ORDER BY deleted_at').all(cutoffIso).map(parseRow);
}
export function accountStats(db, accountId) {
  const r = db.prepare('SELECT COUNT(*) AS files, COALESCE(SUM(bytes), 0) AS bytes FROM files WHERE account_id = ? AND deleted_at IS NULL').get(accountId);
  return { files: Number(r.files), bytes: Number(r.bytes) };
}
