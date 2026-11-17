// The marks of the page, all made from public/brick.png: the favicon as svg and as a 32px png, the apple icon on
// paper, and the sharing card. Run `npm run marks` when the brick changes and commit what it writes. Juan's clean
// brick replaces the stand-in cut from the world's lego template with no change here: everything takes its size
// from the file. The tests point MARKS_OUT at a scratch folder holding a brick, and CHROME at a stand-in.
import { readFile, writeFile, unlink, access, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = process.env.MARKS_OUT ?? join(ROOT, 'public');
const PAPER = '#f4f1e8';
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const done = (f) => console.log(`public/${f}`);

// Nothing is written until Chrome is known to be there: half a set of marks is worse than none.
await access(chrome).catch(() => { throw new Error('Chrome not found; set CHROME to its binary'); });

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
// Last time's card goes first, so a Chrome that writes nothing cannot pass it off as today's; Chrome gets a profile
// of its own, so headless never hands the job to a Chrome that is already running and quietly exits.
const card = join(PUB, 'card.png');
await unlink(card).catch(() => {});
const profile = await mkdtemp(join(tmpdir(), 'sen-chrome-'));
try {
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,630',
    '--virtual-time-budget=2000', `--user-data-dir=${profile}`, `--screenshot=${card}`,
    pathToFileURL(join(ROOT, 'art', 'card.html')).href,
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
} finally {
  await rm(profile, { recursive: true, force: true });
}
await access(card).catch(() => { throw new Error('Chrome wrote no card'); });

// What came out has to be a card: the right size, not one flat colour, and red where the brick should be.
const refuse = async (why) => { await unlink(card); throw new Error(why); };
const shot = await sharp(card).metadata();
if (shot.width !== 1200 || shot.height !== 630) await refuse(`the card came out ${shot.width}x${shot.height}, not 1200x630`);
const { channels } = await sharp(card).stats();
if (!channels.some((c) => c.stdev > 20)) await refuse('the card came out blank');
const leftHalf = await sharp(card).extract({ left: 0, top: 0, width: 600, height: 630 }).toBuffer(); // stats() reads the input, so cut first
const left = (await sharp(leftHalf).stats()).channels;
if (left[0].mean < left[2].mean + 20) await refuse('the card came out without the brick');
done('card.png');
