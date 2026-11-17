import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildQuery, parseQuery, DEFAULTS } from '../public/url.js';
import { parseImageParams } from '../server/params.js';
import { isValidId } from '../server/ids.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LINE = 'A small file host. Give it a file and it comes back with a shorter name, and does as its address says.';

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
    if (attr === 'href' && /^https:\/\/(github\.com\/|i\.juan\.is\/$)/.test(url)) continue; // links out, and the canonical
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

test('on a wide screen the title, picture and facts stay put while the controls scroll', async () => {
  const html = await readFile(join(ROOT, 'public', 'index.html'), 'utf8');
  const css = await readFile(join(ROOT, 'public', 'home.css'), 'utf8');
  assert.match(html, /<div class="side">\s*<header class="intro">[\s\S]*<section class="stage"[\s\S]*<\/section>\s*<\/div>\s*<form class="controls"/, 'title and stage share one column');
  const start = css.indexOf('@media (min-width: 900px)');
  assert.ok(start >= 0, 'there is a wide layout');
  const wide = css.slice(start, css.indexOf('\n}\n', start));
  assert.match(wide, /\.side \{[^}]*position: sticky/, "the left side sticks");
  assert.match(wide, /grid-template-areas: "side controls";/, "one row: the column and the controls, nothing under them");
  assert.doesNotMatch(wide, /\.controls \{[^}]*position: sticky/, 'the controls scroll with the page');
});

test('the brick and the marks made from it are in place', async () => {
  const sharp = (await import('sharp')).default;
  const meta = (f) => sharp(join(ROOT, 'public', f)).metadata();
  const brick = await meta('brick.png');
  assert.equal(brick.hasAlpha, true, 'the brick alone, on nothing');
  const icon = await meta('icon-32.png');
  assert.equal(Math.max(icon.width, icon.height), 32, 'the 32px icon fits a 32px square on its long side');
  const apple = await meta('apple-touch-icon.png');
  assert.deepEqual([apple.width, apple.height, apple.hasAlpha], [180, 180, false], 'the apple icon is a flat 180px square');
  const svg = await readFile(join(ROOT, 'public', 'icon.svg'), 'utf8');
  assert.match(svg, new RegExp(`^<svg [^>]*viewBox="0 0 ${brick.width} ${brick.height}"`), 'the svg icon is the brick at its own size');
  assert.ok(svg.includes('data:image/png;base64,'), 'with the brick inside it');
});

test('the sharing card is 1200 by 630 and says what the page says', async () => {
  const sharp = (await import('sharp')).default;
  const card = await sharp(join(ROOT, 'public', 'card.png')).metadata();
  assert.deepEqual([card.width, card.height], [1200, 630]);
  const { channels } = await sharp(join(ROOT, 'public', 'card.png')).stats();
  assert.ok(channels.some((c) => c.stdev > 20), 'not one flat colour');
  const html = await readFile(join(ROOT, 'art', 'card.html'), 'utf8');
  assert.match(html, /<h1>Sen<\/h1>/);
  assert.ok(html.includes(`<p>${LINE}</p>`), 'the card carries the line, verbatim');
  assert.doesNotMatch(html, /i\.juan\.is/, 'no address on the card');
});

test('the head names the page Sen and carries its marks and card', async () => {
  const sharp = (await import('sharp')).default;
  const html = await readFile(join(ROOT, 'public', 'index.html'), 'utf8');
  const head = html.slice(0, html.indexOf('</head>'));
  assert.match(head, /<title>Sen<\/title>/);
  assert.ok(head.includes(`<meta name="description" content="${LINE}">`));
  assert.match(head, /<meta name="theme-color" content="#f4f1e8" media="\(prefers-color-scheme: light\)">/);
  assert.match(head, /<meta name="theme-color" content="#0e1120" media="\(prefers-color-scheme: dark\)">/);
  assert.match(head, /<link rel="icon" href="\/_\/icon\.svg" type="image\/svg\+xml">/);
  assert.match(head, /<link rel="icon" href="\/_\/icon-32\.png" type="image\/png" sizes="32x32">/);
  assert.match(head, /<link rel="apple-touch-icon" href="\/_\/apple-touch-icon\.png">/);
  assert.match(head, /<link rel="canonical" href="https:\/\/i\.juan\.is\/">/);
  for (const [p, v] of [['type', 'website'], ['title', 'Sen'], ['description', LINE], ['url', 'https://i.juan.is/'], ['image', 'https://i.juan.is/_/card.png'], ['image:width', '1200'], ['image:height', '630'], ['locale', 'en_GB']]) {
    assert.ok(head.includes(`<meta property="og:${p}" content="${v}">`), `og:${p}`);
  }
  assert.match(head, /<meta property="og:image:alt" content="[^"]+">/);
  assert.match(head, /<meta name="twitter:card" content="summary_large_image">/);
  assert.doesNotMatch(head, /<title>[^<]*i\.juan\.is/, 'no address in the title');
  const card = await sharp(join(ROOT, 'public', 'card.png')).metadata();
  assert.deepEqual([card.width, card.height], [1200, 630], 'the stated size is the real size');
});

test('the header is the brick in one column and the name and line in the other', async () => {
  const sharp = (await import('sharp')).default;
  const html = await readFile(join(ROOT, 'public', 'index.html'), 'utf8');
  const css = await readFile(join(ROOT, 'public', 'home.css'), 'utf8');
  const brick = await sharp(join(ROOT, 'public', 'brick.png')).metadata();
  const header = html.match(/<header class="intro">[\s\S]*?<\/header>/)[0];
  assert.ok(header.includes(`<img class="brick" src="/_/brick.png" alt="" width="${brick.width}" height="${brick.height}">`), 'the brick, at its real size, decorative');
  assert.match(header, /<div>\s*<h1>Sen<\/h1>\s*<p>/, 'name over line, in their own column');
  assert.ok(header.includes(`<p>${LINE} The uploads are private; the <a href="https://github.com/juanfuria/pickr/blob/main/API.md">API</a> and the <a href="https://github.com/juanfuria/pickr">code</a> are public. Move something and watch the address change.</p>`), "the uploads line lives under the title now");
  assert.doesNotMatch(html, /<footer/, "and the footer that held it is gone");
  assert.doesNotMatch(header, /i\.juan\.is/, 'no address in the header');
  assert.match(css, /\.intro \{[^}]*grid-template-columns: auto 1fr/);
  assert.match(css, /\.intro \.brick \{[^}]*height: 104px/);
  assert.match(css, /@media \(max-width: 559px\) \{[\s\S]*?\.intro \.brick \{[^}]*height: 72px/);
  assert.doesNotMatch(css, /h1::after/, 'the red egg is gone');
});
