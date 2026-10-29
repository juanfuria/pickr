import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { ingest } from './ingest.js';
import { newTmpPath, moveToTrash, restoreFromTrash } from './store.js';
import { httpError } from './http.js';
import { generateKey } from './auth.js';
import {
  getLiveFile, getFile, listFiles, markDeleted, markRestored, updateName, accountStats, getAccount,
  listKeys, insertKey, revokeKey,
} from './repo.js';

export function toPublic(row, publicUrl) {
  return {
    id: row.id, url: `${publicUrl}/${row.id}.${row.ext}`, kind: row.kind, mime: row.mime, ext: row.ext, bytes: row.bytes,
    width: row.width, height: row.height, duration: row.duration, original_name: row.original_name, taken_at: row.taken_at,
    created_at: row.created_at, deleted_at: row.deleted_at,
  };
}

export default async function apiRoutes(app, { db, root, publicUrl, purge }) {
  const pub = row => toPublic(row, publicUrl);
  const owned = (req, { live = true } = {}) => {
    const row = live ? getLiveFile(db, req.params.id) : getFile(db, req.params.id);
    if (!row || row.account_id !== req.account.accountId) throw httpError(404, 'not found');
    return row;
  };

  app.post('/api/files', async (req, reply) => {
    if (!req.isMultipart()) throw httpError(400, 'multipart upload with a "file" field required');
    const part = await req.file();
    if (!part || part.fieldname !== 'file') throw httpError(400, 'multipart upload with a "file" field required');
    const tmp = newTmpPath(root);
    try {
      await pipeline(part.file, createWriteStream(tmp, { mode: 0o600 }));
    } catch (e) {
      await unlink(tmp).catch(() => {});
      throw e;
    }
    if (part.file.truncated) {
      await unlink(tmp).catch(() => {});
      throw httpError(413, 'file too large');
    }
    const { file, existing } = await ingest({ db, root, tmpPath: tmp, accountId: req.account.accountId, originalName: part.filename });
    return reply.code(existing ? 200 : 201).send({ ...pub(file), existing });
  });

  app.get('/api/files', async req => {
    const { kind, since, before, before_id: beforeId } = req.query;
    const limit = Math.min(500, Math.max(1, Number.parseInt(req.query.limit ?? '100', 10) || 100));
    return { files: listFiles(db, req.account.accountId, { kind: kind || null, since: since || null, before: before || null, beforeId: beforeId || null, limit }).map(pub) };
  });

  app.get('/api/files/:id', async req => {
    const row = owned(req);
    return { ...pub(row), meta: row.meta };
  });

  app.patch('/api/files/:id', async req => {
    const row = owned(req);
    const body = req.body ?? {};
    const keys = Object.keys(body);
    if (keys.length !== 1 || keys[0] !== 'original_name' || typeof body.original_name !== 'string' || body.original_name.length > 255) {
      throw httpError(400, 'only original_name (a string up to 255 characters) can be changed');
    }
    updateName(db, row.id, body.original_name);
    return pub(getFile(db, row.id));
  });

  app.delete('/api/files/:id', async (req, reply) => {
    const row = owned(req);
    markDeleted(db, row.id);
    try {
      await moveToTrash(root, row.id, row.ext);
    } catch (e) {
      markRestored(db, row.id); // the file is still where it was; the row must say so
      throw e;
    }
    if (!(await purge(row.id, row.ext))) req.log.error({ id: row.id }, 'cache purge failed: variants may stay public until the next sweep');
    return reply.code(204).send();
  });

  app.post('/api/files/:id/restore', async req => {
    const row = owned(req, { live: false });
    // Claim the row first: the nightly sweep claims trashed rows the same way from its own process, so only one wins.
    if (!row.deleted_at || !markRestored(db, row.id)) throw httpError(404, 'not found');
    try {
      await restoreFromTrash(root, row.id, row.ext);
    } catch (e) {
      markDeleted(db, row.id, row.deleted_at); // the file never left trash/; keep the original trash date
      throw e;
    }
    return pub(getFile(db, row.id));
  });

  app.get('/api/keys', async req => ({ keys: listKeys(db, req.account.accountId) }));

  app.post('/api/keys', async (req, reply) => {
    const label = req.body?.label;
    if (typeof label !== 'string' || !label.trim() || label.length > 100) throw httpError(400, 'label (a short string) required');
    const { key, hash } = generateKey();
    const row = insertKey(db, { accountId: req.account.accountId, keyHash: hash, label: label.trim() });
    return reply.code(201).send({ ...row, key });
  });

  app.delete('/api/keys/:id', async (req, reply) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || !revokeKey(db, req.account.accountId, id)) throw httpError(404, 'not found');
    return reply.code(204).send();
  });

  app.get('/api/me', async req => {
    const account = getAccount(db, req.account.accountId);
    return { account: account.name, ...accountStats(db, account.id) };
  });
}
