import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImageParams, parseVideoParams, MAX_EDGE } from '../server/params.js';

test('defaults when nothing is asked', () => {
  assert.deepEqual(parseImageParams({}), { w: null, h: null, fit: 'inside', fm: null, q: 80, dpr: 1, up: false, active: false });
  assert.deepEqual(parseVideoParams({}), { t: 0, active: false });
});

test('values are parsed, clamped and normalised', () => {
  const p = parseImageParams({ w: '400', h: '0', fit: 'cover', fm: 'JPG', q: '150', dpr: '9', up: '1' });
  assert.deepEqual(p, { w: 400, h: 1, fit: 'cover', fm: 'jpeg', q: 100, dpr: 3, up: true, active: true });
  assert.equal(parseImageParams({ w: '99999' }).w, MAX_EDGE);
  assert.equal(parseImageParams({ w: '-5' }).w, 1);
  assert.equal(parseImageParams({ w: 'abc' }).w, null);
  assert.equal(parseImageParams({ q: '0' }).q, 1);
  assert.equal(parseImageParams({ fit: 'stretch' }).fit, 'inside');
  assert.equal(parseImageParams({ fm: 'bmp' }).fm, null);
  assert.equal(parseImageParams({ fm: 'constructor' }).fm, null, 'inherited names are not formats');
  assert.equal(parseImageParams({ fm: '__proto__' }).active, false);
  assert.equal(parseImageParams({ up: 'yes' }).up, false);
  assert.equal(parseImageParams({ dpr: '1.5' }).dpr, 1.5);
  assert.equal(parseImageParams({ dpr: '1.5' }).active, true);
});

test('unknown parameters are ignored and leave the request inactive', () => {
  assert.equal(parseImageParams({ foo: 'bar', width: '3' }).active, false);
  assert.equal(parseImageParams({ q: '50' }).active, true);
  assert.equal(parseImageParams({ dpr: '2' }).active, true);
  assert.equal(parseImageParams({ fm: 'webp' }).active, true);
});

test('video time', () => {
  assert.deepEqual(parseVideoParams({ t: '3.5' }), { t: 3.5, active: true });
  assert.deepEqual(parseVideoParams({ t: '-2' }), { t: 0, active: true });
  assert.deepEqual(parseVideoParams({ t: 'x' }), { t: 0, active: true });
});
