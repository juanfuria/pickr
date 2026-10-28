import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newId, isValidId, splitName } from '../server/ids.js';

test('newId is 12 base62 characters and does not repeat', () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const id = newId();
    assert.match(id, /^[0-9A-Za-z]{12}$/);
    seen.add(id);
  }
  assert.equal(seen.size, 1000);
});

test('isValidId accepts new and legacy ids, rejects traversal and junk', () => {
  assert.equal(isValidId('7xKq2mN9pAb3'), true);
  assert.equal(isValidId('pickr_0114fd6c'), true);
  assert.equal(isValidId('..'), false);
  assert.equal(isValidId('../x'), false);
  assert.equal(isValidId('-leading'), false);
  assert.equal(isValidId(''), false);
  assert.equal(isValidId('a'.repeat(65)), false);
  assert.equal(isValidId(42), false);
});

test('splitName separates id and lowercase extension or returns null', () => {
  assert.deepEqual(splitName('pickr_0114fd6c.jpg'), { id: 'pickr_0114fd6c', ext: 'jpg' });
  assert.deepEqual(splitName('7xKq2mN9pAb3.MP4'), { id: '7xKq2mN9pAb3', ext: 'mp4' });
  assert.equal(splitName('noext'), null);
  assert.equal(splitName('.hidden'), null);
  assert.equal(splitName('../pickr.sqlite'), null);
  assert.equal(splitName('id.tar.gz'), null, 'ids never contain dots');
  assert.equal(splitName('id.' + 'x'.repeat(9)), null);
});
