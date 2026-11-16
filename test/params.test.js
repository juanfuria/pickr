import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImageParams, parseVideoParams, MAX_EDGE, MAX_LEGO } from '../server/params.js';

test('defaults when nothing is asked', () => {
  assert.deepEqual(parseImageParams({}), { w: null, h: null, fit: 'inside', fm: null, q: 80, dpr: 1, up: false, lego: null, rect: null, ar: null, crop: null, fp: null, active: false });
  assert.deepEqual(parseVideoParams({}), { t: 0, active: false });
});

test('values are parsed, clamped and normalised', () => {
  const p = parseImageParams({ w: '400', h: '0', fit: 'cover', fm: 'JPG', q: '150', dpr: '9', up: '1' });
  assert.deepEqual(p, { w: 400, h: 1, fit: 'cover', fm: 'jpeg', q: 100, dpr: 3, up: true, lego: null, rect: null, ar: null, crop: null, fp: null, active: true });
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

test('ar: a shape as W:H, positive numbers, and it derives the missing side', () => {
  assert.equal(parseImageParams({ ar: '16:9' }).ar, 16 / 9);
  assert.equal(parseImageParams({ ar: '1:1' }).ar, 1);
  assert.equal(parseImageParams({ ar: '2.35:1' }).ar, 2.35);
  assert.equal(parseImageParams({ ar: '16:9' }).active, true);
  for (const bad of ['16', '16:0', '0:9', '-1:1', 'a:b', '16/9', '16:9:4', '', ' 16:9']) {
    assert.equal(parseImageParams({ ar: bad }).ar, null, `ar=${JSON.stringify(bad)}`);
    assert.equal(parseImageParams({ ar: bad }).active, false, `ar=${JSON.stringify(bad)} is inactive`);
  }
  const fromW = parseImageParams({ ar: '16:9', w: '1600' });
  assert.deepEqual([fromW.w, fromW.h], [1600, 900], 'h follows w');
  const fromH = parseImageParams({ ar: '16:9', h: '900' });
  assert.deepEqual([fromH.w, fromH.h], [1600, 900], 'w follows h');
  const both = parseImageParams({ ar: '16:9', w: '100', h: '100' });
  assert.deepEqual([both.w, both.h, both.ar], [100, 100, 16 / 9], 'with both sides given, ar shapes the cut and w,h stay');
  assert.deepEqual([parseImageParams({ ar: '1000:1', w: '4096' }).h], [4], 'a derived side is at least 1 and whole');
  assert.equal(parseImageParams({ ar: '1:1000', w: '100' }).h, MAX_EDGE, 'a derived side is capped like a given one');
});

test('crop: an anchor word or a strategy, anything else ignored', () => {
  for (const word of ['centre', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'entropy', 'attention']) {
    assert.equal(parseImageParams({ crop: word }).crop, word, word);
  }
  assert.equal(parseImageParams({ crop: 'center' }).crop, 'centre', 'both spellings');
  assert.equal(parseImageParams({ crop: 'TOP' }).crop, 'top');
  assert.equal(parseImageParams({ crop: 'faces' }).crop, null, 'never faces');
  assert.equal(parseImageParams({ crop: 'faces' }).active, false);
  assert.equal(parseImageParams({ crop: 'constructor' }).crop, null);
  assert.equal(parseImageParams({ crop: 'top' }).active, true);
});

test('fp: a point as fractions, a zoom, defaults for what is missing, clamped; a point beats a crop word', () => {
  assert.deepEqual(parseImageParams({ 'fp-x': '0.25', 'fp-y': '0.75' }).fp, { x: 0.25, y: 0.75, z: 1 });
  assert.deepEqual(parseImageParams({ 'fp-z': '2' }).fp, { x: 0.5, y: 0.5, z: 2 }, 'zoom alone zooms into the middle');
  assert.deepEqual(parseImageParams({ 'fp-x': '0.1' }).fp, { x: 0.1, y: 0.5, z: 1 });
  assert.deepEqual(parseImageParams({ 'fp-x': '7', 'fp-y': '-3', 'fp-z': '0.1' }).fp, { x: 1, y: 0, z: 1 }, 'clamped');
  assert.deepEqual(parseImageParams({ 'fp-z': '999' }).fp.z, 100);
  assert.equal(parseImageParams({ 'fp-x': 'left' }).fp, null);
  assert.equal(parseImageParams({ 'fp-x': 'left' }).active, false);
  assert.equal(parseImageParams({ 'fp-x': '0.3' }).active, true);
  const p = parseImageParams({ 'fp-x': '0.3', crop: 'top' });
  assert.deepEqual([p.fp, p.crop], [{ x: 0.3, y: 0.5, z: 1 }, null]);
});
