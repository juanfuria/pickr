import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildQuery, parseQuery, DEFAULTS } from '../public/url.js';
import { parseImageParams } from '../server/params.js';
import { isValidId } from '../server/ids.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the home page builds the shortest query that means the same thing', () => {
  assert.equal(buildQuery(DEFAULTS), '');
  assert.equal(buildQuery({ ...DEFAULTS, w: 800, fm: 'webp' }), 'w=800&fm=webp');
  assert.equal(buildQuery({ ...DEFAULTS, w: 800, q: 80, dpr: 1, fit: 'inside', up: false }), 'w=800');
  assert.equal(buildQuery({ ...DEFAULTS, w: 400, fit: 'cover' }), 'w=400', 'fit means nothing without both sides');
  assert.equal(buildQuery({ ...DEFAULTS, w: 400, h: 400, fit: 'cover' }), 'w=400&h=400&fit=cover');
  assert.equal(buildQuery({ ...DEFAULTS, w: 400, fm: 'png', q: 50 }), 'w=400&fm=png', 'png ignores quality');
  assert.equal(buildQuery({ ...DEFAULTS, w: 400, q: 55, dpr: 1.5, up: true }), 'w=400&q=55&dpr=1.5&up=1');
  assert.equal(buildQuery({ ...DEFAULTS, w: 800, lego: 48 }), 'w=800&lego=48');
});

test('the home page reads a shared hash back, clamped like the server', () => {
  const s = { ...DEFAULTS, w: 640, h: 480, fit: 'fill', fm: 'avif', q: 42, dpr: 2, up: true, lego: 32 };
  assert.deepEqual(parseQuery(buildQuery(s)), s);
  assert.deepEqual(parseQuery(''), DEFAULTS);
  assert.deepEqual(parseQuery('#w=800'), { ...DEFAULTS, w: 800 });
  const odd = parseQuery('w=99999&q=0&dpr=9&fit=sideways&fm=gif&up=yes&junk=1&lego=999');
  assert.deepEqual(odd, { ...DEFAULTS, w: 4096, q: 1, dpr: 3, lego: 128 });
  assert.equal(parseQuery('lego=0').lego, 1);
});

test('whatever the home page builds, the server reads the same values', () => {
  const s = { ...DEFAULTS, w: 1200, h: 300, fit: 'cover', fm: 'webp', q: 65, dpr: 1.5, up: true, lego: 40 };
  const p = parseImageParams(Object.fromEntries(new URLSearchParams(buildQuery(s))));
  assert.deepEqual(
    { w: p.w, h: p.h, fit: p.fit, fm: p.fm, q: p.q, dpr: p.dpr, up: p.up, lego: p.lego },
    { w: 1200, h: 300, fit: 'cover', fm: 'webp', q: 65, dpr: 1.5, up: true, lego: 40 },
  );
});

test('the home page loads only its own files and names a real demo image', async () => {
  const html = await readFile(join(ROOT, 'public', 'index.html'), 'utf8');
  assert.match(html, /<script type="module" src="\/_\/home\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\/_\/home\.css">/);
  for (const [, attr, url] of html.matchAll(/\b(src|href)="([^"]*)"/g)) {
    if (attr === 'href' && /^https:\/\/github\.com\//.test(url)) continue; // plain links out are fine
    assert.ok(url.startsWith('/') && !url.startsWith('//'), `${attr}="${url}" leaves the site`);
  }
  const file = html.match(/data-file="([^"]+)"/)[1];
  const [id, ext] = file.split('.');
  assert.ok(isValidId(id) && /^[a-z0-9]+$/.test(ext), `demo image ${file}`);
});

test('the home page cannot shadow a file: no id starts with an underscore', () => {
  assert.equal(isValidId('_'), false);
  assert.equal(isValidId('_x'), false);
});

test('nginx serves the home page with its own policy, and every location that sets headers repeats HSTS', async () => {
  const vhost = await readFile(join(ROOT, 'deploy', 'nginx', 'i.juan.is.conf'), 'utf8');
  const home = vhost.match(/location = \/ \{[\s\S]*?\n    \}/)?.[0];
  const assets = vhost.match(/location \^~ \/_\/ \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(home && assets, 'location = / and location ^~ /_/ exist');
  assert.match(home, /root \/opt\/pickr\/public;/);
  assert.match(assets, /alias \/opt\/pickr\/public\/;/);
  assert.match(home, /Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'/);
  const hsts = 'add_header Strict-Transport-Security "max-age=31536000" always;';
  const serverLevel = vhost.replace(/^    location [^{\n]+\{[\s\S]*?\n    \}/gm, '');
  assert.ok(serverLevel.includes(`    ${hsts}`), 'HSTS at server level');
  // nginx drops inherited add_header lines in any block that sets its own, so each such location repeats HSTS
  for (const block of vhost.match(/^    location [^{\n]+\{[\s\S]*?\n    \}/gm)) {
    if (/add_header/.test(block)) assert.ok(block.includes(hsts), `HSTS missing in: ${block.split('\n')[0]}`);
  }
});

test('the welder works while a render is on its way, and stands still for reduced motion', async () => {
  const html = await readFile(join(ROOT, 'public', 'index.html'), 'utf8');
  const css = await readFile(join(ROOT, 'public', 'home.css'), 'utf8');
  const welder = html.match(/<img class="welder" src="\/([^".]+)\.gif"/);
  assert.ok(welder && isValidId(welder[1]), 'the welder is a pickr file on this host');
  assert.match(html, /<source media="\(prefers-reduced-motion: reduce\)" srcset="\/[A-Za-z0-9]+\.png">\s*<img class="welder"/);
  assert.match(css, /\.canvas\.busy ~ picture \.welder/, 'only on duty while rendering');
});
