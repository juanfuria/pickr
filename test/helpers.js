import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openDb } from '../server/db.js';
import { buildApp } from '../server/app.js';
import { createAccount, insertKey } from '../server/repo.js';
import { generateKey } from '../server/auth.js';

const here = dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);

export async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'pickr-test-'));
  for (const d of ['files', 'trash', 'tmp']) await mkdir(join(root, d), { recursive: true });
  const db = openDb(join(root, 'pickr.sqlite'));
  // a test may close the db itself (the admin tests do, to hand the file to a child process); a second close is fine
  const close = () => { try { db.close(); } catch (e) { if (e.code !== 'ERR_INVALID_STATE') throw e; } };
  return { root, db, cleanup: async () => { close(); await rm(root, { recursive: true, force: true }); } };
}

export function fixture(name) {
  return join(here, 'fixtures', name);
}

export async function exif(path) {
  const { stdout } = await run('exiftool', ['-json', '-G', '-n', path]);
  return JSON.parse(stdout)[0];
}

export function multipart(fieldName, filename, bytes, mime = 'application/octet-stream') {
  const boundary = '----pickr' + Math.random().toString(16).slice(2);
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat([head, bytes, tail]) };
}

export async function makeApp(opts = {}) {
  const { root, db, cleanup: cleanRoot } = await makeRoot();
  const account = createAccount(db, 'juan');
  const { key, hash } = generateKey();
  insertKey(db, { accountId: account.id, keyHash: hash, label: 'test' });
  const purged = [];
  const app = await buildApp({ db, root, publicUrl: 'https://i.test', purgeUrl: 'http://purge.invalid', purge: async (id, ext) => { purged.push(`${id}.${ext}`); return true; }, ...opts });
  return { app, db, root, key, account, purged, cleanup: async () => { await app.close(); await cleanRoot(); } };
}
