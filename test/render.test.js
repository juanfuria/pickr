import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { fixture, exif } from './helpers.js';
import { renderImage, posterFrame } from '../server/render.js';
import { parseImageParams } from '../server/params.js';

const P = q => parseImageParams(q);
const dims = async body => { const m = await sharp(body).metadata(); return [m.width, m.height, m.format, m.pages ?? 1]; };

test('width, height, fit, dpr, no upscaling, up=1, cap', async () => {
  const src = fixture('photo.jpg'); // 320x240 with orientation 6 → 240x320 upright
  assert.deepEqual(await dims((await renderImage(src, P({ w: '100' }))).body), [100, 133, 'jpeg', 1]);
  assert.deepEqual(await dims((await renderImage(src, P({ h: '100' }))).body), [75, 100, 'jpeg', 1]);
  assert.deepEqual(await dims((await renderImage(src, P({ w: '100', h: '100', fit: 'cover' }))).body), [100, 100, 'jpeg', 1]);
  assert.deepEqual(await dims((await renderImage(src, P({ w: '100', h: '50', fit: 'fill' }))).body), [100, 50, 'jpeg', 1]);
  assert.deepEqual(await dims((await renderImage(src, P({ w: '100', dpr: '2' }))).body), [200, 267, 'jpeg', 1]);
  assert.deepEqual(await dims((await renderImage(src, P({ w: '1000' }))).body), [240, 320, 'jpeg', 1]);
  assert.deepEqual(await dims((await renderImage(src, P({ w: '1000', up: '1' }))).body), [1000, 1333, 'jpeg', 1]);
  const capped = await renderImage(fixture('big.jpg'), P({ q: '50' }));
  assert.deepEqual((await dims(capped.body)).slice(0, 2), [4096, 2458]);
  const edge = await renderImage(fixture('big.jpg'), P({ w: '4096', h: '4096', up: '1' }));
  assert.deepEqual((await dims(edge.body)).slice(0, 2), [4096, 2458]);
  // a thin image upscaled on one axis must not explode the other: 10x100 asked for w=4096&dpr=3&up=1
  const thin = await sharp({ create: { width: 10, height: 100, channels: 3, background: '#000' } }).png().toBuffer();
  const tall = await renderImage(thin, P({ w: '4096', dpr: '3', up: '1' }));
  const [tw, th] = await dims(tall.body);
  assert.ok(tw <= 4096 && th <= 4096, `bounded on both sides, got ${tw}x${th}`);
  assert.equal(th, 4096);
});

test('per-format edge caps bound the encoders', async () => {
  const src = fixture('big.jpg'); // 5000x3000
  const a = await renderImage(src, P({ w: '4096', fm: 'avif' }));
  assert.deepEqual((await dims(a.body)).slice(0, 2), [1600, 960]);
  const wb = await renderImage(src, P({ w: '4096', fm: 'webp' }));
  assert.deepEqual((await dims(wb.body)).slice(0, 2), [2560, 1536]);
  const j = await renderImage(src, P({ w: '4096', fm: 'jpg' }));
  assert.deepEqual((await dims(j.body)).slice(0, 2), [4096, 2458]);
});

test('fractional dpr and capped animation frames', async () => {
  assert.equal((await dims((await renderImage(fixture('photo.jpg'), P({ w: '100', dpr: '1.5' }))).body))[0], 150);
  const capped = await renderImage(fixture('animated.gif'), P({ w: '60' }), { maxFramePixels: 120 * 90 * 2 });
  assert.equal((await dims(capped.body))[3], 2);
});

test('formats, quality and mime', async () => {
  const src = fixture('photo.jpg');
  for (const [fm, format, mime] of [['webp', 'webp', 'image/webp'], ['png', 'png', 'image/png'], ['avif', 'heif', 'image/avif'], ['jpg', 'jpeg', 'image/jpeg']]) {
    const r = await renderImage(src, P({ w: '50', fm }));
    assert.equal(r.mime, mime, fm);
    assert.equal((await dims(r.body))[2], format, fm);
  }
  const hi = await renderImage(src, P({ w: '200', q: '95' }));
  const lo = await renderImage(src, P({ w: '200', q: '20' }));
  assert.ok(lo.body.length < hi.body.length);
  assert.equal((await renderImage(fixture('alpha.png'), P({ w: '50' }))).mime, 'image/png');
  assert.equal((await renderImage(fixture('scripted.svg'), P({ w: '32' }))).mime, 'image/png');
});

test('animation is kept unless the format drops it', async () => {
  const kept = await renderImage(fixture('animated.gif'), P({ w: '60' }));
  assert.equal(kept.mime, 'image/gif');
  assert.ok((await dims(kept.body))[3] > 1);
  const webp = await renderImage(fixture('animated.gif'), P({ w: '60', fm: 'webp' }));
  assert.ok((await dims(webp.body))[3] > 1);
  const still = await renderImage(fixture('animated.gif'), P({ w: '60', fm: 'jpg' }));
  assert.equal((await dims(still.body))[3], 1);
});

test('derivatives carry no metadata', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pickr-render-'));
  const p = join(dir, 'out.jpg');
  await writeFile(p, (await renderImage(fixture('photo.jpg'), P({ w: '100' }))).body);
  const m = await exif(p);
  assert.equal(m['EXIF:GPSLatitude'], undefined);
  assert.equal(m['EXIF:Make'], undefined);
  assert.equal(m['EXIF:Orientation'], undefined, 'pixels are upright, no flag needed');
  await rm(dir, { recursive: true, force: true });
});

test('unreadable input rejects', async () => {
  await assert.rejects(renderImage(fixture('corrupt.jpg'), P({ w: '10' })));
  await assert.rejects(renderImage(fixture('doc.pdf'), P({ w: '10' })));
});

test('a multi-page TIFF rasterises its first page, not a strip of all pages', async () => {
  const page = () => sharp({ create: { width: 120, height: 90, channels: 3, background: '#357' } });
  const pages = await Promise.all([page().png().toBuffer(), page().png().toBuffer(), page().png().toBuffer()]);
  const tiff = await sharp(pages, { join: { animated: true } }).tiff().toBuffer();
  const out = await renderImage(tiff, P({ w: '60' }));
  assert.equal(out.mime, 'image/png');
  assert.deepEqual((await dims(out.body)).slice(0, 2), [60, 45]);
});

test('posterFrame surfaces a missing ffmpeg rather than reporting "no frame"', async () => {
  const { posterFrame: pf } = await import('../server/render.js');
  const saved = process.env.PATH;
  process.env.PATH = '/nonexistent';
  try {
    await assert.rejects(pf(fixture('clip.mp4'), 0), e => e.code === 'ENOENT');
  } finally {
    process.env.PATH = saved;
  }
});

test('poster frames from video, composable with image params', async () => {
  const jpeg = await posterFrame(fixture('clip.mp4'), 1);
  assert.equal(jpeg[0], 0xff);
  assert.equal(jpeg[1], 0xd8);
  assert.deepEqual((await dims(jpeg)).slice(0, 2), [320, 240]);
  const small = await renderImage(jpeg, P({ w: '64' }));
  assert.deepEqual((await dims(small.body)).slice(0, 2), [64, 48]);
  assert.equal((await posterFrame(fixture('clip.mp4'), 500)).length, 0);
});
