import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { fixture, exif } from './helpers.js';

const run = promisify(execFile);
import { readMeta, kindFromMime, takenAtFrom, stripImage, stripVideo, personalTags } from '../server/metadata.js';
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

test('readMeta rejects an empty file but names unknown bytes a plain file', async () => {
  await assert.rejects(readMeta(fixture('empty.bin')));
  const dir = await mkdtemp(join(tmpdir(), 'pickr-meta-'));
  const p = join(dir, 'blob');
  await (await import('node:fs/promises')).writeFile(p, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
  assert.deepEqual(await readMeta(p), { meta: {}, mime: 'application/octet-stream', ext: null, takenAt: null });
  await rm(dir, { recursive: true, force: true });
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
  assert.deepEqual(personalTags((await readMeta(p)).meta), [], 'no personal tag in any group');
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
    assert.deepEqual(personalTags((await readMeta(p)).meta), [], `${n}: no personal tag in any group`);
    await done();
  }
  const { p, done } = await scratch('bitmap.bmp');
  await assert.rejects(stripImage(p));
  await done();
});

test('stripImage removes IFD0 personal tags from a TIFF', async () => {
  const { p, done } = await scratch('tagged.tif');
  assert.ok(personalTags((await readMeta(p)).meta).length > 0, 'the fixture carries personal tags');
  await stripImage(p);
  assert.deepEqual(personalTags((await readMeta(p)).meta), []);
  await done();
});

test('personalTags flags what must not survive and spares the two structural survivors', () => {
  assert.deepEqual(personalTags({ 'IFD0:Make': 'X', 'EXIF:XPAuthor': 'Y', 'IFD0:DocumentName': '/Users/a' }), ['IFD0:Make', 'EXIF:XPAuthor', 'IFD0:DocumentName']);
  assert.deepEqual(personalTags({ 'ICC_Profile:ProfileCopyright': 'Apple', 'ICC_Profile:DeviceModel': 'ctrl', 'QuickTime:CreateDate': '0000:00:00 00:00:00' }), []);
  assert.deepEqual(personalTags({ 'QuickTime:CreateDate': '2024:05:03 10:11:12' }), ['QuickTime:CreateDate']);
});

test('stripVideo drops container metadata and keeps streams and duration', async () => {
  const { p, done } = await scratch('clip.mp4');
  const before = await measureVideo(p);
  await stripVideo(p);
  const m = await exif(p);
  assert.equal(m['QuickTime:Title'], undefined);
  assert.deepEqual(personalTags((await readMeta(p)).meta), []);
  const after = await measureVideo(p);
  assert.equal(after.width, 320);
  assert.ok(Math.abs(after.duration - before.duration) < 0.2);
  await done();
});

test('stripVideo leaves no encoder stamp in a MOV', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pickr-meta-'));
  const p = join(dir, 'clip.mov');
  await run('ffmpeg', ['-y', '-v', 'error', '-i', fixture('clip.mp4'), '-c', 'copy', p]);
  await stripVideo(p, 'mov');
  const after = await readMeta(p);
  assert.deepEqual(personalTags(after.meta), []);
  assert.equal(after.mime, 'video/quicktime');
  await rm(dir, { recursive: true, force: true });
});

test('stripVideo leaves nothing behind when ffmpeg cannot write the container', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pickr-meta-'));
  const p = join(dir, 'clip');
  // msvideo1 cannot be copied into an MP4 container: ffmpeg creates the output, then fails writing the header
  await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x48:rate=5', '-t', '1', '-c:v', 'msvideo1', `${p}.avi`]);
  await (await import('node:fs/promises')).rename(`${p}.avi`, p);
  const before = await readFile(p);
  await assert.rejects(stripVideo(p, 'mp4'));
  assert.deepEqual((await readdir(dir)), ['clip'], 'no .strip output left next to the source');
  assert.ok(before.equals(await readFile(p)), 'the source is untouched');
  await rm(dir, { recursive: true, force: true });
});

test('stripVideo drops attached cover art, which carries its own EXIF', async () => {
  const { p, done } = await scratch('cover.mp4');
  const streamsBefore = await ffprobeStreams(p);
  assert.ok(streamsBefore.some(s => s.disposition?.attached_pic === 1), 'fixture has an attached picture');
  await stripVideo(p);
  const streams = await ffprobeStreams(p);
  assert.equal(streams.filter(s => s.codec_type === 'video').length, 1);
  assert.equal(streams.some(s => s.disposition?.attached_pic === 1), false, 'no attached picture after the strip');
  assert.deepEqual(personalTags((await readMeta(p)).meta), []);
  await done();
});

async function ffprobeStreams(path) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', path]);
  return JSON.parse(stdout).streams ?? [];
}
