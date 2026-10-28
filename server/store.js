import { mkdir, rename, unlink, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { trashedBefore, deleteFileRow } from './repo.js';

export const filePath = (root, id, ext) => join(root, 'files', `${id}.${ext}`);
export const trashPath = (root, id, ext) => join(root, 'trash', `${id}.${ext}`);
export const tmpDir = root => join(root, 'tmp');
export const newTmpPath = root => join(tmpDir(root), `${process.pid}-${randomUUID()}`);

export async function ensureLayout(root) {
  for (const d of ['files', 'trash', 'tmp']) await mkdir(join(root, d), { recursive: true, mode: 0o750 });
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
  for (const r of trashedBefore(db, cutoff)) {
    await unlink(trashPath(root, r.id, r.ext)).catch(() => {});
    deleteFileRow(db, r.id);
    await purge(r.id, r.ext);
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
  return { removed, tmpRemoved };
}
