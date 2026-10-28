import { test } from 'node:test';
import assert from 'node:assert/strict';
import { httpError, contentDisposition } from '../server/http.js';

test('httpError carries a status', () => {
  const e = httpError(404, 'not found');
  assert.ok(e instanceof Error);
  assert.equal(e.status, 404);
  assert.equal(e.message, 'not found');
});

test('contentDisposition survives hostile names', () => {
  assert.equal(contentDisposition('talk-slides.pdf'), `attachment; filename="talk-slides.pdf"; filename*=UTF-8''talk-slides.pdf`);
  assert.equal(contentDisposition('/imagenes/Absurdios/advert.jpg'), `attachment; filename="advert.jpg"; filename*=UTF-8''advert.jpg`);
  assert.equal(contentDisposition('../../etc/passwd'), `attachment; filename="passwd"; filename*=UTF-8''passwd`);
  const v = contentDisposition('a"b\r\nX-Evil: 1.pdf');
  assert.doesNotMatch(v, /[\r\n"]{2}|\r|\n/);
  assert.match(v, /^attachment; filename="a_b__X-Evil: 1\.pdf"; filename\*=UTF-8''a_b__X-Evil%3A%201\.pdf$/);
  assert.equal(contentDisposition('año.png'), `attachment; filename="a_o.png"; filename*=UTF-8''a%C3%B1o.png`);
  assert.equal(contentDisposition(''), `attachment; filename="file"; filename*=UTF-8''file`);
  assert.equal(contentDisposition(null), `attachment; filename="file"; filename*=UTF-8''file`);
  assert.ok(contentDisposition('x'.repeat(500)).length < 450);
});
