import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, stat, chmod } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeApp, fixture } from './helpers.js';

const run = promisify(execFile);
const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'pickr.js');

test('init, up, ls, rm, restore, keys, me', async t => {
  const { app, key, root, cleanup } = await makeApp({ publicUrl: 'http://127.0.0.1' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  t.after(cleanup); // a failing assertion must not leave the server running, or the run hangs instead of failing
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const cfg = join(root, 'cli.json');
  // every call, success or failure, is checked: the key never appears in stdout or stderr
  const cli = async (...args) => {
    let r;
    try {
      r = await run(process.execPath, [BIN, ...args], { env: { ...process.env, PICKR_CONFIG: cfg, PATH: '/nonexistent' } });
    } catch (e) {
      assert.ok(!`${e.stdout}${e.stderr}`.includes(key), `the key was printed by: pickr ${args[0]}`);
      throw e;
    }
    assert.ok(!`${r.stdout}${r.stderr}`.includes(key), `the key was printed by: pickr ${args[0]}`);
    return r;
  };

  await cli('init', url, key);
  assert.equal(((await stat(cfg)).mode & 0o777), 0o600);
  assert.deepEqual(JSON.parse(await readFile(cfg, 'utf8')), { url, key });
  await chmod(cfg, 0o644);
  await cli('init', url, key);
  assert.equal(((await stat(cfg)).mode & 0o777), 0o600, 're-running init tightens an existing config');
  await assert.rejects(cli('up', join(root, 'missing.jpg')), e => e.code === 1 && /ENOENT/.test(e.stderr) && !/\n\s+at /.test(e.stderr), 'one line, no stack');
  await assert.rejects(cli('init', key, url), e => e.code === 1 && /pickr init URL KEY/.test(e.stderr), 'swapped arguments are refused');
  await assert.rejects(cli('init', 'http://example.com', key), e => e.code === 1, 'plain http only for this machine');
  await assert.rejects(cli('init', url, 'pk_short'), e => e.code === 1, 'a malformed key is refused');
  assert.deepEqual(JSON.parse(await readFile(cfg, 'utf8')), { url, key }, 'a refused init leaves the config alone');
  await writeFile(cfg, JSON.stringify({ url: key, key: url }));
  await assert.rejects(cli('me'), e => e.code === 1 && /no usable config/.test(e.stderr), 'a swapped hand-edited config is refused');
  await cli('init', url, key);

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
  await assert.rejects(cli('constructor'), e => e.code === 1, 'inherited names are not commands');
});
