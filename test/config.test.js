import { test } from 'node:test';
import assert from 'node:assert/strict';

test('config reads env and strips trailing slashes', async () => {
  process.env.PICKR_ROOT = '/tmp/x';
  process.env.PICKR_URL = 'https://i.example/';
  const { config } = await import('../server/config.js');
  assert.equal(config.root, '/tmp/x');
  assert.equal(config.publicUrl, 'https://i.example');
  assert.equal(config.port, 3100);
  assert.equal(config.maxEdge, 4096);
});
