import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter } from '../server/limiter.js';

const gate = () => { let open; const p = new Promise(r => { open = r; }); return { p, open }; };

test('runs up to concurrency, queues up to queue, rejects 503 beyond', async () => {
  const lim = createLimiter({ concurrency: 1, queue: 1 });
  const a = gate(), b = gate();
  const ra = lim.run(() => a.p);
  const rb = lim.run(() => b.p);
  assert.equal(lim.inFlight, 1);
  assert.equal(lim.waiting, 1);
  await assert.rejects(lim.run(() => 'never'), e => e.status === 503 && e.message === 'busy' && e.retryAfter === 2);
  a.open('A');
  assert.equal(await ra, 'A');
  b.open('B');
  assert.equal(await rb, 'B');
  assert.equal(lim.inFlight, 0);
  assert.equal(lim.waiting, 0);
});

test('a throwing function frees its slot and rejects its caller only', async () => {
  const lim = createLimiter({ concurrency: 1, queue: 5 });
  await assert.rejects(lim.run(() => { throw new Error('boom'); }), /boom/);
  assert.equal(await lim.run(() => 42), 42);
  assert.equal(lim.inFlight, 0);
});
