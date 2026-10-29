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
const MAX_FRAME_PIXELS = 40_000_000; // all frames of an animation together
const TIMEOUT = { seconds: 20 };

export async function renderImage(input, p, { maxEdge = MAX_EDGE, maxFramePixels = MAX_FRAME_PIXELS } = {}) {
  const meta = await sharp(input).metadata();
  if (!meta.width || !meta.height) throw new Error('unreadable image');
  const pages = meta.pages ?? 1;
  // Only animated inputs animate (a multi-page TIFF is pages, not frames), and only into a format that can animate.
  const animated = pages > 1 && ANIMATED_IN.has(meta.format) && (p.fm === null || p.fm === 'webp');
  const inputFormat = meta.format === 'heif' ? 'avif' : meta.format;
  const fmt = p.fm ?? (inputFormat in MIME ? inputFormat : 'png');
  const edge = Math.min(maxEdge, FORMAT_EDGE[fmt] ?? maxEdge);
  const frameHeight = meta.pageHeight ?? meta.height;
  const frames = animated
    ? Math.max(1, Math.min(pages, MAX_FRAMES, Math.floor(maxFramePixels / (meta.width * frameHeight))))
    : 1;

  let img = sharp(input, { pages: frames, failOn: 'error' }).rotate().timeout(TIMEOUT);
  const w = p.w ? Math.min(Math.round(p.w * p.dpr), edge) : null;
  const h = p.h ? Math.min(Math.round(p.h * p.dpr), edge) : null;
  if (w && h) {
    img = img.resize({ width: w, height: h, fit: p.fit, withoutEnlargement: !p.up });
  } else if (w || h) {
    // One axis given: the other is bounded by the edge so an upscale of a thin image can never explode the free side.
    img = img.resize({ width: w ?? edge, height: h ?? edge, fit: 'inside', withoutEnlargement: !p.up });
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
