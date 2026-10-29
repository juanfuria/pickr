import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRoot, fixture } from './helpers.js';
import { openDb } from '../server/db.js';
import { getFile, listFiles, getAccountByName } from '../server/repo.js';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, '..', 'bin', 'pickr-admin.js');
const admin = (root, args) => run(process.execPath, ['--disable-warning=ExperimentalWarning', BIN, ...args], { env: { ...process.env, PICKR_ROOT: root, PICKR_PURGE_URL: 'http://127.0.0.1:1' } });

test('import-legacy keeps ids, owners and dates; is idempotent; reports failures', async () => {
  const { root, db, cleanup } = await makeRoot();
  db.close();
  await admin(root, ['account', 'add', 'juan']);
  await admin(root, ['account', 'add', 'legacy']);
  const img = join(root, 'legacy-img');
  const files = join(root, 'legacy-file');
  await mkdir(img); await mkdir(files);
  await copyFile(fixture('photo.jpg'), join(img, 'pickr_0114fd6c.jpg'));
  await copyFile(fixture('alpha.png'), join(img, 'pickr_01f23883.png'));
  await copyFile(fixture('doc.pdf'), join(files, 'pickr_211a3549.pdf'));
  await copyFile(fixture('bitmap.bmp'), join(img, 'pickr_deadbeef.bmp'));
  await copyFile(fixture('alpha.png'), join(img, 'weird name.png'));
  const tsv = join(root, 'pickr_files.tsv');
  await writeFile(tsv, '5\t10\tpickr_0114fd6c.jpg\t2012-06-18 09:02:43\n6\t11\tpickr_01f23883.png\t0000-00-00 00:00:00\n');

  await copyFile(fixture('photo.jpg'), join(img, 'pickr_1bb8ddb6.jpeg'));
  await copyFile(fixture('alpha.png'), join(img, 'pickr_2ca83b06.jpg'));
  const r = await admin(root, ['import-legacy', '--tsv', tsv, '--dir', img, '--dir', files, '--map', '10=juan', '--default', 'legacy']);
  assert.match(r.stdout, /imported=5 skipped=0 failed=2/);
  assert.doesNotMatch(r.stdout, /ext-changed: pickr_1bb8ddb6\.jpeg/, '.jpeg is kept as an equivalent of jpg');
  assert.match(r.stdout, /ext-changed: pickr_2ca83b06\.jpg -> pickr_2ca83b06\.png/, 'a real format change is reported');
  assert.match(r.stdout, /failed: pickr_deadbeef\.bmp/);
  assert.match(r.stdout, /failed: weird name\.png invalid id/);

  const db2 = openDb(join(root, 'pickr.sqlite'));
  const juan = getAccountByName(db2, 'juan');
  const legacy = getAccountByName(db2, 'legacy');
  const a = getFile(db2, 'pickr_0114fd6c');
  assert.equal(a.account_id, juan.id);
  assert.equal(a.created_at, '2012-06-18T09:02:43.000Z');
  assert.equal(a.original_name, 'pickr_0114fd6c.jpg');
  const b = getFile(db2, 'pickr_01f23883');
  assert.equal(b.account_id, legacy.id, 'userid 11 is not mapped → default');
  assert.notEqual(b.created_at.slice(0, 4), '0000');
  assert.equal(getFile(db2, 'pickr_211a3549').account_id, legacy.id, 'no row → default');
  db2.close();

  const again = await admin(root, ['import-legacy', '--tsv', tsv, '--dir', img, '--dir', files, '--map', '10=juan', '--default', 'legacy']);
  assert.match(again.stdout, /imported=0 skipped=5 failed=2/);
  await cleanup();
});

test('import-blog maps present refs, lists dead ones, is idempotent; rewrite-sql orders and escapes', async () => {
  const { root, db, cleanup } = await makeRoot();
  db.close();
  await admin(root, ['account', 'add', 'juan']);
  const blog = join(root, 'blog');
  await mkdir(join(blog, 'imagenes', "o'hara"), { recursive: true });
  await mkdir(join(blog, 'archivos'), { recursive: true });
  await copyFile(fixture('photo.jpg'), join(blog, 'imagenes', "o'hara", 'advert.jpg'));
  await copyFile(fixture('alpha.png'), join(blog, 'imagenes', 'advert.jpg.png'));
  await copyFile(fixture('doc.pdf'), join(blog, 'archivos', 'charla.pdf'));
  const refs = join(root, 'refs.txt');
  await writeFile(refs, "/imagenes/o'hara/advert.jpg\n/imagenes/advert.jpg.png\n/archivos/charla.pdf\n/imagenes/missing.gif\n");
  const mapping = join(root, 'mapping.tsv');
  const dead = join(root, 'dead.txt');

  const r = await admin(root, ['import-blog', '--root', blog, '--refs', refs, '--account', 'juan', '--mapping', mapping, '--dead', dead]);
  assert.match(r.stdout, /mapped=3 dead=1/);
  assert.equal(await readFile(dead, 'utf8'), '/imagenes/missing.gif\n');
  const lines = (await readFile(mapping, 'utf8')).trim().split('\n').map(l => l.split('\t'));
  assert.equal(lines.length, 3);
  assert.match(lines.find(l => l[0] === '/archivos/charla.pdf')[1], /^https:\/\/i\.juan\.is\/[0-9A-Za-z]{12}\.pdf$/);
  const db2 = openDb(join(root, 'pickr.sqlite'));
  assert.equal(listFiles(db2, 1).length, 3);
  assert.ok(listFiles(db2, 1).some(f => f.original_name === "/imagenes/o'hara/advert.jpg"));
  db2.close();

  const again = await admin(root, ['import-blog', '--root', blog, '--refs', refs, '--account', 'juan', '--mapping', mapping, '--dead', dead]);
  assert.match(again.stdout, /mapped=3 dead=1/);
  const db3 = openDb(join(root, 'pickr.sqlite'));
  assert.equal(listFiles(db3, 1).length, 3, 'no duplicates on a re-run');
  db3.close();

  const sql = (await admin(root, ['rewrite-sql', '--mapping', mapping, '--host', 'https://i.juan.is'])).stdout;
  assert.match(sql, /^START TRANSACTION;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /REGEXP_REPLACE\(contenido, 'https\?:\/\/\(www\\\\\.\)\?pickr\\\\\.me\/t\//);
  assert.match(sql, /pickr\\\\\.me\/\[if\]\/', 'https:\/\/i\.juan\.is\/'\)/);
  const iAdvert = sql.indexOf("'/imagenes/advert.jpg.png'");
  const iOhara = sql.indexOf("'/imagenes/o''hara/advert.jpg'");
  assert.ok(iOhara > 0 && iAdvert > 0, 'both paths present, quote doubled');
  assert.ok(sql.indexOf("REPLACE(contenido, '/imagenes/o''hara/advert.jpg'") < sql.indexOf("REPLACE(contenido, '/archivos/charla.pdf'"), 'longer paths first');
  assert.match(sql, /UPDATE post SET especial = REPLACE\(especial, '\/archivos\/charla\.pdf'/);
  await cleanup();
});

test('extract-refs prints distinct sorted paths', async () => {
  const script = join(HERE, '..', 'migrate', 'extract-refs.js');
  const input = `<img src="/imagenes/b.jpg"> <a href='/archivos/a.pdf'>x</a> /imagenes/b.jpg <img src="http://pickr.me/i/x.jpg"> /imagenes/c d.png\\`;
  // execFile ignores `input`; the synchronous form writes it to the child's stdin and closes it
  const stdout = execFileSync(process.execPath, [script], { input, encoding: 'utf8' });
  assert.equal(stdout, '/archivos/a.pdf\n/imagenes/b.jpg\n/imagenes/c\n');
});
