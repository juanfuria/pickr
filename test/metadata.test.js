import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { fixture, exif } from './helpers.js';
import { readMeta, kindFromMime, takenAtFrom, stripImage, stripVideo } from '../server/metadata.js';
import { measureVideo } from '../server/measure.js';

// Tag names, in any exiftool group, that must never survive a strip, minus two structural survivors that match the
// pattern but carry nothing personal: the colour profile's header constant (we keep the ICC profile on purpose) and the
// mandatory MP4 header dates, which ffmpeg can only zero, never remove.
const PERSONAL = /GPS|Location|Make$|Model$|Serial|Artist|Owner|DateTimeOriginal|CreateDate|Software/i;
const STRUCTURAL = new Set(['ICC_Profile:DeviceModel']);
const ZEROED = /^QuickTime:(Track|Media)?CreateDate$/;
const personal = m => Object.keys(m).filter(k => PERSONAL.test(k) && !STRUCTURAL.has(k) && !(ZEROED.test(k) && m[k] === '0000:00:00 00:00:00'));

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
  assert.deepEqual(personal(m), [], 'no personal tag in any group');
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
    assert.deepEqual(personal(m), [], `${n}: no personal tag in any group`);
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
  assert.deepEqual(personal(m), []);
  const after = await measureVideo(p);
  assert.equal(after.width, 320);
  assert.ok(Math.abs(after.duration - before.duration) < 0.2);
  await done();
});

test('stripVideo drops attached cover art, which carries its own EXIF', async () => {
  const { p, done } = await scratch('cover.mp4');
  const streamsBefore = await ffprobeStreams(p);
  assert.ok(streamsBefore.some(s => s.disposition?.attached_pic === 1), 'fixture has an attached picture');
  await stripVideo(p);
  const streams = await ffprobeStreams(p);
  assert.equal(streams.filter(s => s.codec_type === 'video').length, 1);
  assert.equal(streams.some(s => s.disposition?.attached_pic === 1), false, 'no attached picture after the strip');
  const m = await exif(p);
  assert.deepEqual(personal(m), []);
  await done();
});

async function ffprobeStreams(path) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', path]);
  return JSON.parse(stdout).streams ?? [];
}
