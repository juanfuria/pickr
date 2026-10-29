import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, rename, stat, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { readMeta, kindFromMime, stripImage, stripVideo, personalTags } from './metadata.js';
import { measureImage, measureVideo } from './measure.js';
import { newId, isValidId } from './ids.js';
import { filePath, ensureSpace } from './store.js';
import { findLiveBySha, insertFile, deleteFileRow } from './repo.js';
import { httpError } from './http.js';
import { now } from './db.js';

export async function sha256File(path) {
  const h = createHash('sha256');
  await pipeline(createReadStream(path), h);
  return h.digest('hex');
}

// An import may keep its old extension when it names the same thing (jpeg for jpg, mp4 for a 3gp or mov the strip
// remuxes into mp4), so old URLs keep working. New uploads never pass a hint: the uploader's name never decides.
const SAME = [['jpg', 'jpeg', 'jpe'], ['tif', 'tiff'], ['mp4', 'm4v', '3gp', 'mov']];
export function chooseExt(detected, hint) {
  const h = String(hint ?? '').toLowerCase();
  if (!h || h === detected) return detected;
  return SAME.some(g => g.includes(detected) && g.includes(h)) ? h : detected;
}

export async function ingest({ db, root, tmpPath, accountId, originalName = null, id = null, createdAt = null, dedupe = true, extHint = null }) {
  try {
    if (id !== null && !isValidId(id)) throw httpError(400, 'invalid id');
    const size = (await stat(tmpPath)).size;
    if (size === 0) throw httpError(422, 'empty file');
    await ensureSpace(root, size);

    let info;
    try { info = await readMeta(tmpPath); } catch (e) { throw failed('unreadable file', e, tmpPath); }
    const kind = kindFromMime(info.mime);
    // The extension is exiftool's verdict or 'bin': never the uploader's name, which nginx would otherwise turn into a
    // content type (an unknown blob called x.html must not be served as text/html).
    const ext = chooseExt(info.ext ?? 'bin', extHint);

    let mime = info.mime;
    if (kind === 'video' || (kind === 'image' && info.mime !== 'image/svg+xml')) {
      const what = kind === 'video' ? 'video' : 'image';
      try {
        if (kind === 'video') await stripVideo(tmpPath, ext); else await stripImage(tmpPath);
      } catch (e) { throw failed(`cannot strip metadata from this ${what}`, e, tmpPath); }
      // Fail closed: whatever the format, nothing personal may reach disk.
      let after;
      try { after = await readMeta(tmpPath); } catch (e) { throw failed(`cannot strip metadata from this ${what}`, e, tmpPath); }
      const left = personalTags(after.meta);
      if (left.length) throw failed(`cannot strip metadata from this ${what}`, new Error(`Error: kept ${left.join(', ')}`), tmpPath);
      mime = after.mime;
    }

    const sha256 = await sha256File(tmpPath);
    if (dedupe) {
      const existing = findLiveBySha(db, accountId, sha256);
      // A row whose file never reached files/ (a crash between insert and rename) must not be handed out again.
      if (existing && await stat(filePath(root, existing.id, existing.ext)).then(() => true, () => false)) {
        await unlink(tmpPath);
        return { file: existing, existing: true };
      }
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
      id: fileId, accountId, kind, mime, ext, bytes, sha256, width, height, duration,
      originalName: originalName ?? null, takenAt: info.takenAt, meta: info.meta, createdAt: createdAt ?? now(),
    });
    try {
      await chmod(tmpPath, 0o640);
      await rename(tmpPath, filePath(root, fileId, ext));
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

// The client gets a fixed message; the tool's own line travels on err.detail for the server log, with the temp path
// blanked and warnings skipped in favour of the first "Error" line.
function failed(message, e, path) {
  if (e?.signal || e?.code === 'ENOENT') throw e; // killed (memory) or a missing tool: the box, not the file
  const lines = String(e?.stderr || e?.message || e).split('\n').map(l => l.trim()).filter(Boolean);
  const line = lines.find(l => /^Error/i.test(l)) ?? lines[lines.length - 1] ?? '';
  const err = httpError(422, message);
  err.detail = line.split(path).join('<file>').slice(0, 200);
  return err;
}
const numberOrNull = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
