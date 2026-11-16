import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowFor } from '../public/window.js';
import { parseImageParams } from '../server/params.js';

const W = 4000, H = 3000;
const win = (q) => windowFor(parseImageParams(q), W, H);

test('no shape, no anchor, no zoom: no window, the picture is what it was', () => {
  assert.equal(win({}), null);
  assert.equal(win({ w: '100' }), null);
  assert.equal(win({ w: '100', h: '100', fit: 'cover' }), null, 'a centred cover crop is sharp\'s own');
  assert.equal(win({ w: '100', h: '100', fit: 'inside', crop: 'top' }), null, 'inside never crops, so an anchor means nothing');
  assert.equal(win({ 'fp-x': '0.2', 'fp-y': '0.2' }), null, 'a point without a shape or a zoom changes nothing');
});

test('ar shapes the window as large as fits, centred unless anchored', () => {
  assert.deepEqual(win({ ar: '1:1' }), { left: 500, top: 0, width: 3000, height: 3000 });
  assert.deepEqual(win({ ar: '16:9' }), { left: 0, top: 375, width: 4000, height: 2250 });
  assert.deepEqual(win({ ar: '9:16' }), { left: 1156, top: 0, width: 1688, height: 3000 });
  assert.deepEqual(win({ ar: '1:1', crop: 'top-left' }), { left: 0, top: 0, width: 3000, height: 3000 });
  assert.deepEqual(win({ ar: '1:1', crop: 'right' }), { left: 1000, top: 0, width: 3000, height: 3000 });
  assert.deepEqual(win({ ar: '16:9', crop: 'bottom' }), { left: 0, top: 750, width: 4000, height: 2250 });
  assert.deepEqual(win({ ar: '4:3' }), null, 'the picture\'s own shape is no cut');
});

test('a cover resize to both sides takes its shape from them when anchored', () => {
  assert.deepEqual(win({ w: '100', h: '100', fit: 'cover', crop: 'top' }), { left: 500, top: 0, width: 3000, height: 3000 });
  assert.deepEqual(win({ w: '100', h: '100', fit: 'cover', 'fp-x': '1', 'fp-y': '0.5' }), { left: 1000, top: 0, width: 3000, height: 3000 });
  assert.deepEqual(win({ w: '100', h: '100', ar: '16:9' }), { left: 0, top: 375, width: 4000, height: 2250 }, 'ar wins over w:h for the shape');
});

test('a point zooms by shrinking the window around it, clamped to the picture', () => {
  assert.deepEqual(win({ 'fp-x': '0.25', 'fp-y': '0.25', 'fp-z': '2' }), { left: 0, top: 0, width: 2000, height: 1500 });
  assert.deepEqual(win({ 'fp-x': '1', 'fp-y': '1', 'fp-z': '2' }), { left: 2000, top: 1500, width: 2000, height: 1500 });
  assert.deepEqual(win({ 'fp-z': '2' }), { left: 1000, top: 750, width: 2000, height: 1500 }, 'zoom alone zooms into the middle');
  assert.deepEqual(win({ 'fp-z': '100' }), { left: 1980, top: 1485, width: 40, height: 30 });
  assert.deepEqual(win({ ar: '1:1', 'fp-x': '0.9', 'fp-y': '0.5' }), { left: 1000, top: 0, width: 3000, height: 3000 });
  assert.deepEqual(win({ ar: '1:1', 'fp-x': '0.9', 'fp-y': '0.5', 'fp-z': '3' }), { left: 3000, top: 1000, width: 1000, height: 1000 });
});

test('the strategies are not windows: they ride the resize', () => {
  assert.equal(win({ w: '100', h: '100', fit: 'cover', crop: 'entropy' }), null);
  assert.equal(win({ ar: '1:1', crop: 'attention' }), null);
});

test('a window is never empty, whatever the picture', () => {
  assert.deepEqual(windowFor(parseImageParams({ 'fp-z': '100' }), 3, 2), { left: 1, top: 1, width: 1, height: 1 });
  assert.deepEqual(windowFor(parseImageParams({ ar: '1000:1' }), 3, 2), { left: 0, top: 1, width: 3, height: 1 });
});
