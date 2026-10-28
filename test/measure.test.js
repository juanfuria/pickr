import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { measureImage, measureVideo } from '../server/measure.js';

test('measureImage applies orientation and reports pages', async () => {
  assert.deepEqual(await measureImage(fixture('photo.jpg')), { width: 240, height: 320, format: 'jpeg', pages: 1 });
  const gif = await measureImage(fixture('animated.gif'));
  assert.equal(gif.format, 'gif');
  assert.ok(gif.pages > 1);
  assert.equal(await measureImage(fixture('corrupt.jpg')), null);
  assert.equal(await measureImage(fixture('doc.pdf')), null);
  const heic = await measureImage(fixture('photo.heic'));
  assert.ok(heic === null || heic.width > 0, 'heic is either unreadable (prebuilt sharp) or measured');
});

test('measureVideo', async () => {
  const v = await measureVideo(fixture('clip.mp4'));
  assert.equal(v.width, 320);
  assert.equal(v.height, 240);
  assert.ok(v.duration > 1.5 && v.duration < 2.5);
  await assert.rejects(measureVideo(fixture('doc.pdf')));
});
