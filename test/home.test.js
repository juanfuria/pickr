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
  assert.equal(buildQuery({ ...DEFAULTS, rect: { x: 10, y: 20, w: 300, h: 400 } }), 'rect=10,20,300,400');
  assert.equal(buildQuery({ ...DEFAULTS, rect: { x: 0, y: 0, w: 1, h: 1 }, w: 50 }), 'rect=0,0,1,1&w=50', 'the cut comes first, as it happens first');
  assert.equal(buildQuery({ ...DEFAULTS, ar: '16:9', w: 800 }), 'ar=16:9&w=800');
  assert.equal(buildQuery({ ...DEFAULTS, ar: '1:1', crop: 'top' }), 'ar=1:1&crop=top');
  assert.equal(buildQuery({ ...DEFAULTS, w: 400, h: 400, fit: 'cover', crop: 'attention' }), 'w=400&h=400&fit=cover&crop=attention');
  assert.equal(buildQuery({ ...DEFAULTS, fp: { x: 0.25, y: 0.5, z: 1 } }), 'fp-x=0.25&fp-y=0.5', 'no zoom, no fp-z');
  assert.equal(buildQuery({ ...DEFAULTS, fp: { x: 0.5, y: 0.5, z: 2 } }), 'fp-x=0.5&fp-y=0.5&fp-z=2');
  assert.equal(buildQuery({ ...DEFAULTS, fp: { x: 0.123456, y: 0.5, z: 1.25 } }), 'fp-x=0.123&fp-y=0.5&fp-z=1.25', 'three decimals are plenty');
  assert.equal(buildQuery({ ...DEFAULTS, crop: 'top', fp: { x: 0.5, y: 0.5, z: 2 } }), 'fp-x=0.5&fp-y=0.5&fp-z=2', 'a point beats a word, so the word is not sent');
  assert.equal(buildQuery({ ...DEFAULTS, w: 400, crop: 'top' }), 'w=400', 'a word without a shape means nothing, so it is not sent');
});

test('the home page reads a shared hash back, clamped like the server', () => {
  const s = { ...DEFAULTS, w: 640, h: 480, fit: 'fill', fm: 'avif', q: 42, dpr: 2, up: true, lego: 32 };
  assert.deepEqual(parseQuery(buildQuery(s)), s);
  assert.deepEqual(parseQuery(''), DEFAULTS);
  assert.deepEqual(parseQuery('#w=800'), { ...DEFAULTS, w: 800 });
  const odd = parseQuery('w=99999&q=0&dpr=9&fit=sideways&fm=gif&up=yes&junk=1&lego=999');
  assert.deepEqual(odd, { ...DEFAULTS, w: 4096, q: 1, dpr: 3, lego: 128 });
  assert.equal(parseQuery('lego=0').lego, 1);
  assert.deepEqual(parseQuery('rect=10,20,300,400').rect, { x: 10, y: 20, w: 300, h: 400 });
  assert.deepEqual(parseQuery('rect=10%2C20%2C300%2C400').rect, { x: 10, y: 20, w: 300, h: 400 }, 'an encoded comma is a comma');
  for (const bad of ['1,2,3', '1,2,3,4,5', '-1,0,10,10', '1.5,0,10,10', 'a,b,c,d', '0,0,0,10', '0,0,10,0']) {
    assert.equal(parseQuery(`rect=${bad}`).rect, null, `rect=${bad}`);
  }
  assert.equal(parseQuery('ar=16:9').ar, '16:9');
  assert.equal(parseQuery('ar=16%3A9').ar, '16:9');
  assert.equal(parseQuery('ar=16:0').ar, null);
  assert.equal(parseQuery('ar=wide').ar, null);
  assert.equal(parseQuery('crop=top').crop, 'top');
  assert.equal(parseQuery('crop=center').crop, 'centre');
  assert.equal(parseQuery('crop=faces').crop, null);
  assert.deepEqual(parseQuery('fp-x=0.25').fp, { x: 0.25, y: 0.5, z: 1 });
  assert.deepEqual(parseQuery('fp-z=3').fp, { x: 0.5, y: 0.5, z: 3 });
  assert.deepEqual(parseQuery('fp-x=9&fp-y=-1&fp-z=0').fp, { x: 1, y: 0, z: 1 }, 'clamped like the server');
  assert.deepEqual(parseQuery('fp-x=0.3&crop=top').crop, null, 'a point beats a word');
  assert.equal(parseQuery('fp-x=nope').fp, null);
});

test('whatever the home page builds, the server reads the same values', () => {
  const s = { ...DEFAULTS, w: 1200, h: 300, fit: 'cover', fm: 'webp', q: 65, dpr: 1.5, up: true, lego: 40, rect: { x: 5, y: 6, w: 700, h: 800 }, ar: '2:1', fp: { x: 0.25, y: 0.75, z: 2 } };
  const p = parseImageParams(Object.fromEntries(new URLSearchParams(buildQuery(s))));
  assert.deepEqual(
    { w: p.w, h: p.h, fit: p.fit, fm: p.fm, q: p.q, dpr: p.dpr, up: p.up, lego: p.lego, rect: p.rect, ar: p.ar, crop: p.crop, fp: p.fp },
    { w: 1200, h: 300, fit: 'cover', fm: 'webp', q: 65, dpr: 1.5, up: true, lego: 40, rect: { x: 5, y: 6, w: 700, h: 800 }, ar: 2, crop: null, fp: { x: 0.25, y: 0.75, z: 2 } },
  );
  const word = parseImageParams(Object.fromEntries(new URLSearchParams(buildQuery({ ...DEFAULTS, ar: '1:1', crop: 'top-left' }))));
  assert.deepEqual([word.ar, word.crop], [1, 'top-left']);
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

test('the minimap is on the page, takes its picture from data-file, and home.js drives it through the CSSOM', async () => {
  const html = await readFile(join(ROOT, 'public', 'index.html'), 'utf8');
  const js = await readFile(join(ROOT, 'public', 'home.js'), 'utf8');
  assert.match(html, /<input type="checkbox" id="rect-on" name="rect-on">/);
  for (const id of ['rect-x', 'rect-y', 'rect-w', 'rect-h', 'rect-out', 'minimap', 'map', 'box', 'handle']) assert.ok(html.includes(`id="${id}"`), `#${id}`);
  assert.match(html, /<img id="map" alt=""/);
  assert.doesNotMatch(html, /<img id="map"[^>]*\ssrc=/, 'the demo image is named once, in data-file');
  assert.match(js, /from '\.\/rect\.js'/);
  assert.doesNotMatch(js, /setAttribute\('style'/, 'the CSP has no unsafe-inline: the box is positioned through the CSSOM');
});

test('the shape and anchor controls are on the page, with the point placed by the minimap', async () => {
  const html = await readFile(join(ROOT, 'public', 'index.html'), 'utf8');
  const js = await readFile(join(ROOT, 'public', 'home.js'), 'utf8');
  for (const v of ['', '1:1', '4:3', '3:2', '16:9', '9:16']) assert.ok(html.includes(`<input type="radio" name="ar" value="${v}"`), `ar pill ${v || 'free'}`);
  for (const v of ['', 'top', 'bottom', 'left', 'right', 'entropy', 'attention', 'point']) assert.ok(html.includes(`<input type="radio" name="anchor" value="${v}"`), `anchor pill ${v || 'centre'}`);
  assert.match(html, /<input type="range" id="fp-z" name="fp-z" min="1" max="8" step="0\.1" value="1"/);
  assert.match(html, /<input type="hidden" id="fp-x" name="fp-x">/);
  assert.match(html, /<input type="hidden" id="fp-y" name="fp-y">/);
  for (const id of ['point', 'win', 'anchor-out', 'anchor-hint']) assert.ok(html.includes(`id="${id}"`), `#${id}`);
  assert.match(js, /from '\.\/window\.js'/, 'the page draws the window the server will cut');
});
