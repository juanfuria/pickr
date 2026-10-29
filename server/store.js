import { mkdir, chmod, rename, unlink, readdir, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { trashedBefore, claimTrashed } from './repo.js';
import { httpError } from './http.js';

export const filePath = (root, id, ext) => join(root, 'files', `${id}.${ext}`);
export const trashPath = (root, id, ext) => join(root, 'trash', `${id}.${ext}`);
export const tmpDir = root => join(root, 'tmp');
export const newTmpPath = root => join(tmpDir(root), `${process.pid}-${randomUUID()}`);

export async function ensureLayout(root) {
  for (const d of ['files', 'trash', 'tmp']) await mkdir(join(root, d), { recursive: true, mode: 0o750 });
  // explicit modes: under the service's UMask=0077 a plain mkdir gives 0700, and nginx would 403 every original
  for (const [d, mode] of [['files', 0o750], ['trash', 0o700], ['tmp', 0o700]]) await chmod(join(root, d), mode);
}

export const SPACE_RESERVE = 512 * 1024 ** 2;

// Refuse work that would leave less than the reserve free: a full disk takes the database and every other site on
// the box with it.
export async function ensureSpace(root, bytes, { reserve = SPACE_RESERVE, statfsImpl = statfs } = {}) {
  const s = await statfsImpl(root);
  const free = Number(s.bavail) * Number(s.bsize);
  if (free - bytes < reserve) throw httpError(507, 'not enough space on the server');
}

export async function moveToTrash(root, id, ext) {
  await rename(filePath(root, id, ext), trashPath(root, id, ext));
}

export async function restoreFromTrash(root, id, ext) {
  await rename(trashPath(root, id, ext), filePath(root, id, ext));
}

const DAY = 86_400_000;

export async function sweep({ db, root, now = new Date(), trashDays = 30, purge = async () => {} }) {
  const cutoff = new Date(now.getTime() - trashDays * DAY).toISOString();
  let removed = 0;
  let purgeFailed = 0;
  const failed = [];
  for (const r of trashedBefore(db, cutoff)) {
    // Claim the row before any await: a restore running in the server process claims the same row the same way,
    // so exactly one of them wins and a restored file never loses its row.
    if (!claimTrashed(db, r.id, cutoff)) continue;
    try {
      await unlink(trashPath(root, r.id, r.ext));
    } catch (e) {
      if (e.code !== 'ENOENT') failed.push({ id: r.id, error: e.code ?? String(e) });
    }
    if (!(await purge(r.id, r.ext))) purgeFailed++;
    removed++;
  }
  let tmpRemoved = 0;
  for (const name of await readdir(tmpDir(root))) {
    const p = join(tmpDir(root), name);
    const s = await stat(p).catch(() => null);
    if (s && now.getTime() - s.mtimeMs > DAY) {
      await unlink(p).catch(() => {});
      tmpRemoved++;
    }
  }
  return { removed, tmpRemoved, failed, purgeFailed };
}
