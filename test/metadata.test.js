import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { fixture, exif } from './helpers.js';
import { readMeta, kindFromMime, takenAtFrom, stripImage, stripVideo } from '../server/metadata.js';
import { measureVideo } from '../server/measure.js';

async function scratch(name) {
  const dir = await mkdtemp(join(tmpdir(), 'pickr-meta-'));
  const p = join(dir, name);
  await copyFile(fixture(name), p);
  return { p, done: () => rm(dir, { recursive: true, force: true }) };
}

test('readMeta: jpeg with GPS and dates', async () => {
  const r = await readMeta(fixture('photo.jpg'));
  assert.equal(r.mime, 'image/jpeg');
  assert.equal(r.ext, 'jpg');
  assert.ok(Math.abs(r.meta['EXIF:GPSLatitude'] - 40.4168) < 0.001);
  assert.equal(r.meta['EXIF:Make'], 'TestCam');
  assert.equal(r.takenAt, '2024-05-03T10:11:12+02:00');
  assert.equal(Object.hasOwn(r.meta, 'SourceFile'), false);
  assert.equal(Object.hasOwn(r.meta, 'File:Directory'), false);
});

test('readMeta: video, pdf, svg, heic, bmp', async () => {
  const v = await readMeta(fixture('clip.mp4'));
  assert.equal(v.mime, 'video/mp4');
  assert.equal(v.ext, 'mp4');
  assert.equal(v.meta['QuickTime:Title'], 'Fixture video');
  assert.equal(v.takenAt, '2024-05-03T10:11:12Z');
  assert.equal((await readMeta(fixture('doc.pdf'))).mime, 'application/pdf');
  assert.equal((await readMeta(fixture('scripted.svg'))).mime, 'image/svg+xml');
  assert.equal((await readMeta(fixture('photo.heic'))).mime, 'image/heic');
  assert.equal((await readMeta(fixture('bitmap.bmp'))).mime, 'image/bmp');
});

test('readMeta rejects an empty file', async () => {
  await assert.rejects(readMeta(fixture('empty.bin')));
});

test('kindFromMime and takenAtFrom', () => {
  assert.equal(kindFromMime('image/heic'), 'image');
  assert.equal(kindFromMime('image/svg+xml'), 'image');
  assert.equal(kindFromMime('video/quicktime'), 'video');
  assert.equal(kindFromMime('application/pdf'), 'file');
  assert.equal(kindFromMime(undefined), 'file');
  assert.equal(takenAtFrom({ 'EXIF:DateTimeOriginal': '2020-01-02T03:04:05', 'EXIF:OffsetTimeOriginal': '-05:00' }), '2020-01-02T03:04:05-05:00');
  assert.equal(takenAtFrom({ 'QuickTime:CreateDate': '2020-01-02T03:04:05' }), '2020-01-02T03:04:05Z');
  assert.equal(takenAtFrom({ 'EXIF:DateTimeOriginal': '0000:00:00 00:00:00' }), null);
  assert.equal(takenAtFrom({}), null);
});

test('stripImage removes everything but ICC and orientation and keeps pixels byte-identical', async () => {
  const { p, done } = await scratch('photo.jpg');
  const before = await sharp(p).raw().toBuffer();
  await stripImage(p);
  const m = await exif(p);
  assert.equal(m['EXIF:GPSLatitude'], undefined);
  assert.equal(m['EXIF:Make'], undefined);
  assert.equal(m['EXIF:DateTimeOriginal'], undefined);
  assert.equal(m['EXIF:Artist'], undefined);
  assert.equal(m['EXIF:Orientation'], 6);
  assert.match(String(m['ICC_Profile:ProfileDescription'] ?? ''), /P3/i);
  const after = await sharp(p).raw().toBuffer();
  assert.ok(before.equals(after));
  await done();
});

test('stripImage works on png and heic, rejects bmp', async () => {
  for (const n of ['alpha.png', 'photo.heic']) {
    const { p, done } = await scratch(n);
    await stripImage(p);
    const m = await exif(p);
    assert.equal(m['EXIF:GPSLatitude'], undefined, n);
    assert.equal(m['EXIF:Make'], undefined, n);
    await done();
  }
  const { p, done } = await scratch('bitmap.bmp');
  await assert.rejects(stripImage(p));
  await done();
});

test('stripVideo drops container metadata and keeps streams and duration', async () => {
  const { p, done } = await scratch('clip.mp4');
  const before = await measureVideo(p);
  await stripVideo(p);
  const m = await exif(p);
  assert.equal(m['QuickTime:Title'], undefined);
  assert.equal(Object.keys(m).some(k => /GPS|Location/i.test(k)), false);
  const after = await measureVideo(p);
  assert.equal(after.width, 320);
  assert.ok(Math.abs(after.duration - before.duration) < 0.2);
  await done();
});
