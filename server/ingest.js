import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, rename, stat, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { extname } from 'node:path';
import { readMeta, kindFromMime, stripImage, stripVideo } from './metadata.js';
import { measureImage, measureVideo } from './measure.js';
import { newId, isValidId } from './ids.js';
import { filePath } from './store.js';
import { findLiveBySha, insertFile, deleteFileRow } from './repo.js';
import { httpError } from './http.js';
import { now } from './db.js';

export async function sha256File(path) {
  const h = createHash('sha256');
  await pipeline(createReadStream(path), h);
  return h.digest('hex');
}

function extFromName(name) {
  const e = extname(String(name ?? '')).slice(1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(e) ? e : null;
}

export async function ingest({ db, root, tmpPath, accountId, originalName = null, id = null, createdAt = null, dedupe = true }) {
  try {
    if (id !== null && !isValidId(id)) throw httpError(400, 'invalid id');
    if ((await stat(tmpPath)).size === 0) throw httpError(422, 'empty file');

    let info;
    try { info = await readMeta(tmpPath); } catch (e) { throw httpError(422, `unreadable file: ${e.message}`); }
    const kind = kindFromMime(info.mime);
    const ext = info.ext ?? extFromName(originalName) ?? 'bin';

    if (kind === 'image' && info.mime !== 'image/svg+xml') {
      try { await stripImage(tmpPath); } catch (e) { throw httpError(422, `cannot strip metadata from this image: ${firstLine(e)}`); }
    }
    if (kind === 'video') {
      try { await stripVideo(tmpPath, ext); } catch (e) { throw httpError(422, `cannot strip metadata from this video: ${firstLine(e)}`); }
    }

    const sha256 = await sha256File(tmpPath);
    if (dedupe) {
      const existing = findLiveBySha(db, accountId, sha256);
      if (existing) { await unlink(tmpPath); return { file: existing, existing: true }; }
    }

    let width = null, height = null, duration = null;
    if (kind === 'image') {
      const m = await measureImage(tmpPath);
      width = m?.width ?? numberOrNull(info.meta['File:ImageWidth'] ?? info.meta['EXIF:ExifImageWidth']);
      height = m?.height ?? numberOrNull(info.meta['File:ImageHeight'] ?? info.meta['EXIF:ExifImageHeight']);
    } else if (kind === 'video') {
      try { ({ width, height, duration } = await measureVideo(tmpPath)); } catch { /* stored without dimensions */ }
    }

    const fileId = id ?? newId();
    const bytes = (await stat(tmpPath)).size;
    const row = insertFile(db, {
      id: fileId, accountId, kind, mime: info.mime, ext, bytes, sha256, width, height, duration,
      originalName: originalName ?? null, takenAt: info.takenAt, meta: info.meta, createdAt: createdAt ?? now(),
    });
    try {
      await rename(tmpPath, filePath(root, fileId, ext));
      await chmod(filePath(root, fileId, ext), 0o640);
    } catch (e) {
      deleteFileRow(db, fileId);
      throw e;
    }
    return { file: row, existing: false };
  } catch (e) {
    await unlink(tmpPath).catch(() => {});
    throw e;
  }
}

const firstLine = e => String(e?.stderr || e?.message || e).split('\n')[0].slice(0, 200);
const numberOrNull = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
