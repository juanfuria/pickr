// The marks of the page, all made from public/brick.png: the favicon as svg and as a 32px png, and the apple icon
// on paper. Run `npm run marks` when the brick changes and commit what it writes. Juan's clean brick replaces the
// stand-in cut from the world's lego template with no change here: everything takes its size from the file.
import { readFile, writeFile, unlink, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = join(ROOT, 'public');
const PAPER = '#f4f1e8';
const done = (f) => console.log(`public/${f}`);

const brick = await readFile(join(PUB, 'brick.png'));
const { width, height } = await sharp(brick).metadata();

await sharp(brick).resize(32, 32, { fit: 'inside', kernel: 'lanczos3' }).png().toFile(join(PUB, 'icon-32.png'));
done('icon-32.png');

// Apple squares the icon off itself, so it gets a paper background and a little room.
const small = await sharp(brick).resize(148, 148, { fit: 'inside', kernel: 'lanczos3' }).png().toBuffer();
const onPaper = await sharp({ create: { width: 180, height: 180, channels: 4, background: PAPER } })
  .composite([{ input: small, gravity: 'centre' }]).png().toBuffer();
await sharp(onPaper).flatten({ background: PAPER }).removeAlpha().png().toFile(join(PUB, 'apple-touch-icon.png'));
done('apple-touch-icon.png');

// The brick at its own size, in a wrapper that scales anywhere; it is only ever shrunk, so it scales smoothly.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><image width="${width}" height="${height}" href="data:image/png;base64,${brick.toString('base64')}"/></svg>\n`;
await writeFile(join(PUB, 'icon.svg'), svg);
done('icon.svg');

// The sharing card: art/card.html photographed by headless Chrome at 1200 by 630, so it has the page's own fonts.
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
await access(chrome).catch(() => { throw new Error('Chrome not found; set CHROME to its binary'); });
const card = join(PUB, 'card.png');
execFileSync(chrome, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,630',
  '--virtual-time-budget=2000', `--screenshot=${card}`, pathToFileURL(join(ROOT, 'art', 'card.html')).href,
], { stdio: 'ignore' });
const shot = await sharp(card).metadata();
if (shot.width !== 1200 || shot.height !== 630) {
  await unlink(card);
  throw new Error(`the card came out ${shot.width}x${shot.height}, not 1200x630`);
}
done('card.png');
