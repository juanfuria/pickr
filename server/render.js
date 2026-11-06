import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MAX_EDGE } from './params.js';

const run = promisify(execFile);
const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif' };
const QUALITY = new Set(['jpeg', 'webp', 'avif']);
const ANIMATED_IN = new Set(['gif', 'webp']);
// Memory and time on a one-core, 833 MB box: an encoder's cost grows with output area, AVIF's most of all.
const FORMAT_EDGE = { avif: 1600, webp: 2560 };
const MAX_FRAMES = 100;
const MAX_FRAME_PIXELS = 16_000_000; // all frames of an animation together, decoded and resized
const TIMEOUT = { seconds: 20 };
const BRICK = 30; // pixels per brick when no size is asked, as in Legofy (github.com/JuanPotato/Legofy, MIT)
const MAX_LEGO_PIXELS = 16_000_000;

// One 1x1 brick in greys. Hard-light leaves a colour alone under 50% grey (#808080), so the flat face takes the
// picture's colour exactly; lighter greys lift it and darker ones sink it, on black and white bricks too.
function brickTile(size) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
<defs>
<radialGradient id="top" cx="0.38" cy="0.34" r="0.75"><stop offset="0" stop-color="#a2a2a2"/><stop offset="1" stop-color="#828282"/></radialGradient>
<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.5"/></filter>
</defs>
<rect width="100" height="100" fill="#808080"/>
<polygon points="0,0 100,0 95,5 5,5" fill="#a4a4a4"/>
<polygon points="0,0 5,5 5,95 0,100" fill="#989898"/>
<polygon points="100,0 100,100 95,95 95,5" fill="#6a6a6a"/>
<polygon points="0,100 5,95 95,95 100,100" fill="#5c5c5c"/>
<circle cx="55" cy="56" r="29" fill="#4e4e4e" filter="url(#soft)"/>
<circle cx="51.5" cy="52.5" r="28" fill="#686868"/>
<circle cx="49" cy="49" r="28" fill="url(#top)"/>
<path d="M 25.5 60 A 26 26 0 0 1 60 23.5" fill="none" stroke="#c8c8c8" stroke-width="2.5" stroke-linecap="round"/>
</svg>`);
}

// The picture as N bricks along its long side: shrink to one pixel per brick, blow each pixel up into a square,
// and lay the brick over every square. Returns raw upright pixels for the usual resize and encode to finish.
async function legoPicture(input, p, meta) {
  const swap = (meta.orientation ?? 1) >= 5;
  const fw = meta.width;
  const fh = meta.pageHeight ?? meta.height;
  const [W, H] = swap ? [fh, fw] : [fw, fh];
  const cols = W >= H ? p.lego : Math.max(1, Math.round((p.lego * W) / H));
  const rows = H > W ? p.lego : Math.max(1, Math.round((p.lego * H) / W));
  const want = Math.max(p.w ? (p.w * p.dpr) / cols : 0, p.h ? (p.h * p.dpr) / rows : 0);
  const fits = Math.min(Math.floor(MAX_EDGE / Math.max(cols, rows)), Math.floor(Math.sqrt(MAX_LEGO_PIXELS / (cols * rows))));
  const size = Math.max(1, Math.min(want ? Math.ceil(want) : BRICK, fits));

  const grid = await sharp(input, { failOn: 'error' }).timeout(TIMEOUT).rotate()
    .resize(cols, rows, { fit: 'fill' })
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
    .raw().toBuffer({ resolveWithObject: true });
  const raw = { width: grid.info.width, height: grid.info.height, channels: grid.info.channels };
  const lego = await sharp(grid.data, { raw }).timeout(TIMEOUT)
    .resize(cols * size, rows * size, { kernel: 'nearest' })
    .composite([{ input: brickTile(size), tile: true, gravity: 'northwest', blend: 'hard-light' }])
    .removeAlpha()
    .raw().toBuffer({ resolveWithObject: true });
  return { data: lego.data, raw: { width: lego.info.width, height: lego.info.height, channels: lego.info.channels } };
}

export async function renderImage(input, p, { maxEdge = MAX_EDGE, maxFramePixels = MAX_FRAME_PIXELS } = {}) {
  const meta = await sharp(input).metadata();
  if (!meta.width || !meta.height) throw new Error('unreadable image');
  const pages = meta.pages ?? 1;
  // Only animated inputs animate (a multi-page TIFF is pages, not frames), and only into a format that can animate.
  // Lego is a still of the first frame.
  const animated = !p.lego && pages > 1 && ANIMATED_IN.has(meta.format) && (p.fm === null || p.fm === 'webp');
  const enlarge = p.up && !animated; // an animation is never enlarged: the frame budget counts input pixels
  const inputFormat = meta.format === 'heif' ? 'avif' : meta.format;
  const fmt = p.fm ?? (inputFormat in MIME ? inputFormat : 'png');
  const edge = Math.min(maxEdge, FORMAT_EDGE[fmt] ?? maxEdge);
  const frameHeight = meta.pageHeight ?? meta.height;
  const frames = animated
    ? Math.max(1, Math.min(pages, MAX_FRAMES, Math.floor(maxFramePixels / (meta.width * frameHeight))))
    : 1;

  let img;
  if (p.lego) {
    const lego = await legoPicture(input, p, meta);
    img = sharp(lego.data, { raw: lego.raw }).timeout(TIMEOUT);
  } else {
    img = sharp(input, { pages: frames, failOn: 'error' }).rotate().timeout(TIMEOUT);
  }
  const w = p.w ? Math.min(Math.round(p.w * p.dpr), edge) : null;
  const h = p.h ? Math.min(Math.round(p.h * p.dpr), edge) : null;
  if (w && h) {
    img = img.resize({ width: w, height: h, fit: p.fit, withoutEnlargement: !enlarge });
  } else if (w || h) {
    // One axis given: the other is bounded by the edge so an upscale of a thin image can never explode the free side.
    img = img.resize({ width: w ?? edge, height: h ?? edge, fit: 'inside', withoutEnlargement: !enlarge });
  } else {
    img = img.resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true });
  }
  const options = fmt === 'avif' ? { quality: p.q, effort: 2 } : QUALITY.has(fmt) ? { quality: p.q } : {};
  img = img.toFormat(fmt, options);
  const body = await img.toBuffer();
  return { body, mime: MIME[fmt] };
}

export async function posterFrame(path, t) {
  try {
    // -nostdin so a stray prompt can never block; 30 s is more than any sane poster frame needs on this box.
    const { stdout } = await run('ffmpeg', ['-nostdin', '-v', 'error', '-ss', String(Math.max(0, t)), '-i', path, '-frames:v', '1', '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '3', 'pipe:1'],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 30_000 });
    return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  } catch (e) {
    // Past the end of the clip ffmpeg encodes nothing and exits non-zero; that is "no frame", not a failure.
    // A missing binary (ENOENT) or a signal is a failure and must surface.
    if (typeof e.code === 'number' && e.stdout && e.stdout.length === 0) return Buffer.alloc(0);
    throw e;
  }
}
