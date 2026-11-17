import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, copyFile, writeFile, chmod, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'art', 'make-marks.mjs');

// A folder with the brick in it, where the script writes instead of public/.
async function studio() {
  const dir = await mkdtemp(join(tmpdir(), 'marks-'));
  await copyFile(join(ROOT, 'public', 'brick.png'), join(dir, 'brick.png'));
  return dir;
}

// Runs the script with a stand-in Chrome; returns what it said on stderr when it refused, or null when it finished.
function run(dir, chrome) {
  try {
    execFileSync(process.execPath, [SCRIPT], { env: { ...process.env, MARKS_OUT: dir, CHROME: chrome }, stdio: ['ignore', 'ignore', 'pipe'] });
    return null;
  } catch (e) {
    return e.stderr.toString();
  }
}

const exists = (p) => access(p).then(() => true, () => false);

test('without Chrome the marks script stops before writing anything', async () => {
  const dir = await studio();
  try {
    const err = run(dir, join(dir, 'no-such-chrome'));
    assert.match(err, /Chrome not found/);
    assert.equal(await exists(join(dir, 'icon-32.png')), false, 'no icon written');
    assert.equal(await exists(join(dir, 'card.png')), false, 'no card written');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a Chrome that writes nothing leaves no card behind, old or new', async () => {
  const dir = await studio();
  try {
    await writeFile(join(dir, 'card.png'), 'stale'); // last time's card, which must not pass as today's
    const err = run(dir, '/usr/bin/true');
    assert.match(err, /wrote no card/);
    assert.equal(await exists(join(dir, 'card.png')), false, 'the stale card is gone, not reported as made');
    assert.equal(await exists(join(dir, 'icon-32.png')), true, 'the icons were made, Chrome exists');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a blank 1200 by 630 render is refused', async () => {
  const sharp = (await import('sharp')).default;
  const dir = await studio();
  try {
    const flat = join(dir, 'flat.png');
    await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#0e1120' } }).png().toFile(flat);
    const fake = join(dir, 'chrome.sh');
    await writeFile(fake, `#!/bin/sh\nfor a in "$@"; do case "$a" in --screenshot=*) cp "${flat}" "\${a#--screenshot=}";; esac; done\n`);
    await chmod(fake, 0o755);
    const err = run(dir, fake);
    assert.match(err, /blank/);
    assert.equal(await exists(join(dir, 'card.png')), false, 'the blank card is not left for a commit');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
