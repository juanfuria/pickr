import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImageParams, parseVideoParams, MAX_EDGE, MAX_LEGO } from '../server/params.js';

test('defaults when nothing is asked', () => {
  assert.deepEqual(parseImageParams({}), { w: null, h: null, fit: 'inside', fm: null, q: 80, dpr: 1, up: false, lego: null, rect: null, active: false });
  assert.deepEqual(parseVideoParams({}), { t: 0, active: false });
});

test('values are parsed, clamped and normalised', () => {
  const p = parseImageParams({ w: '400', h: '0', fit: 'cover', fm: 'JPG', q: '150', dpr: '9', up: '1' });
  assert.deepEqual(p, { w: 400, h: 1, fit: 'cover', fm: 'jpeg', q: 100, dpr: 3, up: true, lego: null, rect: null, active: true });
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

test('lego: bricks along the long side, clamped, active on its own', () => {
  assert.equal(parseImageParams({ lego: '48' }).lego, 48);
  assert.equal(parseImageParams({ lego: '0' }).lego, 1);
  assert.equal(parseImageParams({ lego: '99999' }).lego, MAX_LEGO);
  assert.equal(MAX_LEGO, 128);
  assert.equal(parseImageParams({ lego: 'many' }).lego, null);
  assert.equal(parseImageParams({ lego: 'many' }).active, false);
  assert.equal(parseImageParams({ lego: '48' }).active, true);
});

test('rect: four non-negative integers in pixels, active on its own, anything else ignored', () => {
  assert.deepEqual(parseImageParams({ rect: '10,20,300,400' }).rect, { x: 10, y: 20, w: 300, h: 400 });
  assert.equal(parseImageParams({ rect: '10,20,300,400' }).active, true);
  assert.deepEqual(parseImageParams({ rect: '0,0,1,1' }).rect, { x: 0, y: 0, w: 1, h: 1 });
  for (const bad of ['10,20,300', '10,20,300,400,5', '-1,0,10,10', '1.5,0,10,10', 'a,b,c,d', '', ' 0,0,10,10', '0,0,10,10 ', '0;0;10;10']) {
    assert.equal(parseImageParams({ rect: bad }).rect, null, `rect=${JSON.stringify(bad)}`);
    assert.equal(parseImageParams({ rect: bad }).active, false, `rect=${JSON.stringify(bad)} is inactive`);
  }
  assert.equal(parseImageParams({ rect: '0,0,0,10' }).rect, null, 'an empty rectangle is no rectangle');
  assert.equal(parseImageParams({ rect: '0,0,10,0' }).rect, null, 'an empty rectangle is no rectangle');
  assert.equal(parseImageParams({ rect: ['1,1,1,1', '2,2,2,2'] }).rect, null, 'a repeated parameter is ignored');
});
