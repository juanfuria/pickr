import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('API.md documents every route the app serves', async () => {
  const api = await readFile(join(ROOT, 'API.md'), 'utf8');
  const src = await readFile(join(ROOT, 'server', 'api.js'), 'utf8');
  for (const [, method, path] of src.matchAll(/app\.(get|post|patch|delete)\('([^']+)'/g)) {
    assert.ok(api.includes(path), `${method.toUpperCase()} ${path} missing from API.md`);
  }
});

test('shell scripts parse and are executable', async () => {
  for (const s of ['deploy/install.sh', 'deploy/deploy.sh', 'deploy/smoke.sh', 'test/fixtures/make.sh']) {
    await run('bash', ['-n', join(ROOT, s)]);
    assert.ok((await stat(join(ROOT, s))).mode & 0o100, `${s} is not executable`);
  }
});

test('nginx rewrites and the app agree on the render prefix', async () => {
  const vhost = await readFile(join(ROOT, 'deploy', 'nginx', 'i.juan.is.conf'), 'utf8');
  const routes = await readFile(join(ROOT, 'server', 'render-routes.js'), 'utf8');
  assert.match(vhost, /rewrite \^\(\.\*\)\$ \/_render\$1 last;/);
  assert.match(routes, /'\/_render\/:name'/);
  const purge = await readFile(join(ROOT, 'deploy', 'nginx', 'purge.conf'), 'utf8');
  assert.match(purge, /listen 127\.0\.0\.1:8081;/);
  assert.match(purge, /proxy_cache_key \$uri\$is_args\$args;/);
  const render = vhost.match(/location \/_render\/ \{[\s\S]*?\n    \}/)[0];
  assert.doesNotMatch(render, /limit_req/, 'cache hits are never rate-limited');
  assert.match(render, /proxy_no_cache \$arg_dl;/, 'downloads are never cached');
  assert.match(render, /proxy_max_temp_file_size 0;/, 'downloads are never spooled to disk');
  const install = await readFile(join(ROOT, 'deploy', 'install.sh'), 'utf8');
  assert.match(install, /if ! nginx -t; then\n\s+rollback/, 'a config nginx rejects is rolled back');
  const unit = await readFile(join(ROOT, 'deploy', 'systemd', 'pickr.service'), 'utf8');
  assert.match(unit, /^UMask=0077$/m, 'the database and trash are private to the service');
  const http = await readFile(join(ROOT, 'deploy', 'nginx', 'pickr.conf'), 'utf8');
  assert.match(http, /svg\|html\?/, 'HTML is sandboxed like SVG');
});
