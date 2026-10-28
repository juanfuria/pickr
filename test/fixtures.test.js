import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fixture } from './helpers.js';

const run = promisify(execFile);
const NAMES = ['photo.jpg', 'photo.heic', 'alpha.png', 'big.jpg', 'animated.gif', 'clip.mp4', 'cover.mp4', 'corrupt.jpg', 'empty.bin', 'scripted.svg', 'doc.pdf', 'bitmap.bmp'];

test('every fixture exists', async () => {
  for (const n of NAMES) await stat(fixture(n));
  assert.equal((await stat(fixture('empty.bin'))).size, 0);
});

test('photo.jpg carries GPS, orientation 6 and a P3 profile; the tools are on PATH', async () => {
  const { stdout } = await run('exiftool', ['-json', '-G', '-n', fixture('photo.jpg')]);
  const m = JSON.parse(stdout)[0];
  assert.ok(Math.abs(m['EXIF:GPSLatitude'] - 40.4168) < 0.001);
  assert.equal(m['EXIF:Orientation'], 6);
  assert.match(String(m['ICC_Profile:ProfileDescription'] ?? ''), /P3/i);
  await run('ffprobe', ['-version']);
});
