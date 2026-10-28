import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db.js';

const here = dirname(fileURLToPath(import.meta.url));

export async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'pickr-test-'));
  for (const d of ['files', 'trash', 'tmp']) await mkdir(join(root, d), { recursive: true });
  const db = openDb(join(root, 'pickr.sqlite'));
  return { root, db, cleanup: async () => { db.close(); await rm(root, { recursive: true, force: true }); } };
}

export function fixture(name) {
  return join(here, 'fixtures', name);
}
