import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRect, clampRect, drawRect, moveRect, resizeRect, mapToSource } from '../public/rect.js';

const W = 4000, H = 3000;

test('the default box is the middle half of the picture', () => {
  assert.deepEqual(defaultRect(W, H), { x: 1000, y: 750, w: 2000, h: 1500 });
  assert.deepEqual(defaultRect(1, 1), { x: 0, y: 0, w: 1, h: 1 });
  assert.deepEqual(defaultRect(3, 3), { x: 1, y: 1, w: 2, h: 2 });
});

test('a box is whole pixels, inside the picture, never empty', () => {
  assert.deepEqual(clampRect({ x: -5, y: 10.6, w: 99999, h: 0 }, W, H), { x: 0, y: 11, w: 4000, h: 1 });
  assert.deepEqual(clampRect({ x: 3999, y: 2999, w: 50, h: 50 }, W, H), { x: 3999, y: 2999, w: 1, h: 1 });
  assert.deepEqual(clampRect({ x: 5000, y: 5000, w: 10, h: 10 }, W, H), { x: 3999, y: 2999, w: 1, h: 1 });
  assert.deepEqual(clampRect({ x: NaN, y: undefined, w: NaN, h: 'x' }, W, H), { x: 0, y: 0, w: 1, h: 1 }, 'an empty field counts as nothing');
  assert.deepEqual(clampRect({ x: 100, y: 100, w: 200, h: 100 }, W, H), { x: 100, y: 100, w: 200, h: 100 }, 'a good box is left alone');
});

test('drawing from one point to another gives the box between them, whichever way the drag went', () => {
  assert.deepEqual(drawRect({ x: 100.4, y: 200 }, { x: 50, y: 260.7 }, W, H), { x: 50, y: 200, w: 50, h: 61 });
  assert.deepEqual(drawRect({ x: 10, y: 10 }, { x: 10, y: 10 }, W, H), { x: 10, y: 10, w: 1, h: 1 }, 'a click is a one-pixel box');
  assert.deepEqual(drawRect({ x: 3900, y: 2900 }, { x: 9999, y: 9999 }, W, H), { x: 3900, y: 2900, w: 100, h: 100 }, 'a drag off the edge stops at the edge');
  assert.deepEqual(drawRect({ x: -50, y: -50 }, { x: 20, y: 30 }, W, H), { x: 0, y: 0, w: 20, h: 30 });
});

test('moving keeps the size and stops at the edges', () => {
  const r = { x: 100, y: 100, w: 200, h: 100 };
  assert.deepEqual(moveRect(r, -500, 50, W, H), { x: 0, y: 150, w: 200, h: 100 });
  assert.deepEqual(moveRect(r, 5000, 5000, W, H), { x: 3800, y: 2900, w: 200, h: 100 });
  assert.deepEqual(moveRect(r, 10.4, -0.6, W, H), { x: 110, y: 99, w: 200, h: 100 });
});

test('resizing pulls the bottom-right corner, keeps the origin, never inverts', () => {
  const r = { x: 100, y: 100, w: 200, h: 100 };
  assert.deepEqual(resizeRect(r, { x: 400.4, y: 250 }, W, H), { x: 100, y: 100, w: 300, h: 150 });
  assert.deepEqual(resizeRect(r, { x: 50, y: 5000 }, W, H), { x: 100, y: 100, w: 1, h: 2900 });
});

test('a point on the little picture maps to the pixels of the big one', () => {
  assert.deepEqual(mapToSource({ px: 120, py: 45 }, { width: 480, height: 360 }, W, H), { x: 1000, y: 375 });
  assert.deepEqual(mapToSource({ px: 0, py: 0 }, { width: 480, height: 360 }, W, H), { x: 0, y: 0 });
  assert.deepEqual(mapToSource({ px: 10, py: 10 }, { width: 0, height: 0 }, W, H), { x: 0, y: 0 }, 'a picture that has not laid out yet maps to the corner, not NaN');
});
