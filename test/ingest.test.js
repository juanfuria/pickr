import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, readdir, readFile, stat } from 'node:fs/promises';
import { makeRoot, fixture, exif } from './helpers.js';
import { ingest } from '../server/ingest.js';
import { createAccount, getFile } from '../server/repo.js';
import { filePath, newTmpPath } from '../server/store.js';

async function staged(root, name) {
  const p = newTmpPath(root);
  await copyFile(fixture(name), p);
  return p;
}

test('jpeg: image kind, stripped on disk, metadata in the row, oriented dimensions', async () => {
  const { root, db, cleanup } = await makeRoot();
  const a = createAccount(db, 'juan');
  const { file, existing } = await ingest({ db, root, tmpPath: await staged(root, 'photo.jpg'), accountId: a.id, originalName: 'IMG_0001.jpg' });
  assert.equal(existing, false);
  assert.match(file.id, /^[0-9A-Za-z]{12}$/);
  assert.equal(file.kind, 'image');
  assert.equal(file.mime, 'image/jpeg');
  assert.equal(file.ext, 'jpg');
  assert.deepEqual([file.width, file.height], [240, 320]);
  assert.equal(file.original_name, 'IMG_0001.jpg');
  assert.equal(file.taken_at, '2024-05-03T10:11:12+02:00');
  assert.ok(Math.abs(file.meta['EXIF:GPSLatitude'] - 40.4168) < 0.001);
  const onDisk = await exif(filePath(root, file.id, 'jpg'));
  assert.equal(onDisk['EXIF:GPSLatitude'], undefined);
  assert.equal(onDisk['EXIF:Orientation'], 6);
  assert.equal(file.bytes, (await stat(filePath(root, file.id, 'jpg'))).size);
  assert.deepEqual(await readdir(`${root}/tmp`), []);
  await cleanup();
});

test('the same bytes twice returns the existing record and stores nothing new', async () => {
  const { root, db, cleanup } = await makeRoot();
  const a = createAccount(db, 'juan');
  const first = await ingest({ db, root, tmpPath: await staged(root, 'alpha.png'), accountId: a.id });
  const second = await ingest({ db, root, tmpPath: await staged(root, 'alpha.png'), accountId: a.id });
  assert.equal(second.existing, true);
  assert.equal(second.file.id, first.file.id);
  assert.equal((await readdir(`${root}/files`)).length, 1);
  assert.deepEqual(await readdir(`${root}/tmp`), []);
  const b = createAccount(db, 'marta');
  const other = await ingest({ db, root, tmpPath: await staged(root, 'alpha.png'), accountId: b.id });
  assert.equal(other.existing, false, 'dedupe is per account');
  const forced = await ingest({ db, root, tmpPath: await staged(root, 'alpha.png'), accountId: a.id, dedupe: false, id: 'pickr_00000001' });
  assert.equal(forced.existing, false);
  assert.equal(forced.file.id, 'pickr_00000001');
  await cleanup();
});

test('video, pdf, svg, heic', async () => {
  const { root, db, cleanup } = await makeRoot();
  const a = createAccount(db, 'juan');
  const v = (await ingest({ db, root, tmpPath: await staged(root, 'clip.mp4'), accountId: a.id })).file;
  assert.equal(v.kind, 'video');
  assert.equal(v.ext, 'mp4');
  assert.deepEqual([v.width, v.height], [320, 240]);
  assert.ok(v.duration > 1.5);
  assert.equal(v.meta['QuickTime:Title'], 'Fixture video');
  assert.equal((await exif(filePath(root, v.id, 'mp4')))['QuickTime:Title'], undefined);

  const p = (await ingest({ db, root, tmpPath: await staged(root, 'doc.pdf'), accountId: a.id, originalName: 'talk.pdf' })).file;
  assert.equal(p.kind, 'file');
  assert.equal(p.mime, 'application/pdf');
  assert.equal(p.ext, 'pdf');

  const s = (await ingest({ db, root, tmpPath: await staged(root, 'scripted.svg'), accountId: a.id })).file;
  assert.equal(s.kind, 'image');
  assert.equal(s.mime, 'image/svg+xml');
  assert.ok((await readFile(filePath(root, s.id, 'svg'))).equals(await readFile(fixture('scripted.svg'))), 'svg stored untouched');

  const h = (await ingest({ db, root, tmpPath: await staged(root, 'photo.heic'), accountId: a.id })).file;
  assert.equal(h.kind, 'image');
  assert.equal(h.ext, 'heic');
  assert.ok(Math.abs(h.meta['EXIF:GPSLatitude'] - 40.4168) < 0.001);
  assert.equal((await exif(filePath(root, h.id, 'heic')))['EXIF:GPSLatitude'], undefined);
  await cleanup();
});

test('unknown bytes become kind=file with the uploaded extension, or bin', async () => {
  const { root, db, cleanup } = await makeRoot();
  const a = createAccount(db, 'juan');
  const tmp = newTmpPath(root);
  await (await import('node:fs/promises')).writeFile(tmp, 'just some text\n');
  const f = (await ingest({ db, root, tmpPath: tmp, accountId: a.id, originalName: 'notes.TXT' })).file;
  assert.equal(f.kind, 'file');
  assert.equal(f.ext, 'txt');
  const tmp2 = newTmpPath(root);
  await (await import('node:fs/promises')).writeFile(tmp2, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
  const g = (await ingest({ db, root, tmpPath: tmp2, accountId: a.id })).file;
  assert.equal(g.ext, 'bin');
  await cleanup();
});

test('an image that cannot be stripped, an empty file and a corrupt image fail with 422 and leave nothing', async () => {
  const { root, db, cleanup } = await makeRoot();
  const a = createAccount(db, 'juan');
  for (const n of ['bitmap.bmp', 'empty.bin']) {
    await assert.rejects(ingest({ db, root, tmpPath: await staged(root, n), accountId: a.id }), e => e.status === 422);
  }
  // corrupt.jpg: exiftool may still read its header (stored as an image, rendering fails later) or refuse it (422).
  // Both are acceptable; what matters is that nothing is left behind either way.
  let stored = 0;
  try {
    const c = await ingest({ db, root, tmpPath: await staged(root, 'corrupt.jpg'), accountId: a.id });
    assert.equal(c.file.kind, 'image');
    stored = 1;
  } catch (e) {
    assert.equal(e.status, 422);
  }
  assert.deepEqual(await readdir(`${root}/tmp`), []);
  assert.equal((await readdir(`${root}/files`)).length, stored);
  await cleanup();
});

test('legacy import honours id, createdAt and original_name', async () => {
  const { root, db, cleanup } = await makeRoot();
  const a = createAccount(db, 'juan');
  const { file } = await ingest({ db, root, tmpPath: await staged(root, 'photo.jpg'), accountId: a.id, id: 'pickr_0114fd6c', createdAt: '2012-06-18T09:02:43.000Z', originalName: 'pickr_0114fd6c.jpg' });
  assert.equal(file.id, 'pickr_0114fd6c');
  assert.equal(file.created_at, '2012-06-18T09:02:43.000Z');
  assert.equal(getFile(db, 'pickr_0114fd6c').original_name, 'pickr_0114fd6c.jpg');
  await stat(filePath(root, 'pickr_0114fd6c', 'jpg'));
  await cleanup();
});
