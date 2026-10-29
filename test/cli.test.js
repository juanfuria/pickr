import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeApp, fixture } from './helpers.js';

const run = promisify(execFile);
const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'pickr.js');

test('init, up, ls, rm, restore, keys, me', async () => {
  const { app, key, root, cleanup } = await makeApp({ publicUrl: 'http://127.0.0.1' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const cfg = join(root, 'cli.json');
  const cli = (...args) => run(process.execPath, [BIN, ...args], { env: { ...process.env, PICKR_CONFIG: cfg, PATH: '/nonexistent' } });

  await cli('init', url, key);
  assert.equal(((await stat(cfg)).mode & 0o777), 0o600);
  assert.deepEqual(JSON.parse(await readFile(cfg, 'utf8')), { url, key });

  const up = await cli('up', fixture('alpha.png'), fixture('doc.pdf'));
  const urls = up.stdout.trim().split('\n');
  assert.equal(urls.length, 2);
  assert.match(urls[0], /\.png$/);
  assert.match(urls[1], /\.pdf$/);

  const upJson = JSON.parse((await cli('up', '--json', fixture('alpha.png'))).stdout);
  assert.equal(upJson[0].existing, true);

  const ls = (await cli('ls')).stdout;
  assert.equal(ls.trim().split('\n').length, 2);
  assert.match(ls, /alpha\.png/);
  const lsJson = JSON.parse((await cli('ls', '--json', '--kind', 'file')).stdout);
  assert.equal(lsJson.length, 1);
  assert.equal(lsJson[0].ext, 'pdf');

  const id = lsJson[0].id;
  assert.equal((await cli('rm', id)).stdout, `${id} moved to trash\n`);
  assert.equal(JSON.parse((await cli('ls', '--json')).stdout).length, 1);
  assert.equal((await cli('restore', id)).stdout, `${id} restored\n`);
  await assert.rejects(cli('rm', 'zzzzzzzzzzzz'), e => /not found/.test(e.stderr) && e.code === 1);

  assert.match((await cli('keys')).stdout, /test/);
  assert.match((await cli('me')).stdout, /juan/);
  await assert.rejects(cli('bogus'), e => e.code === 1);
  await cleanup();
});
