import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MAX_EDGE } from './params.js';

const run = promisify(execFile);
const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif' };
const QUALITY = new Set(['jpeg', 'webp', 'avif']);

export async function renderImage(input, p, { maxEdge = MAX_EDGE } = {}) {
  const meta = await sharp(input).metadata();
  if (!meta.width || !meta.height) throw new Error('unreadable image');
  const pages = meta.pages ?? 1;
  const animated = pages > 1 && (p.fm === null || p.fm === 'webp');
  const inputFormat = meta.format === 'heif' ? 'avif' : meta.format;
  const fmt = p.fm ?? (inputFormat in MIME ? inputFormat : 'png');

  let img = sharp(input, { animated, failOn: 'error' }).rotate();
  const w = p.w ? Math.min(p.w * p.dpr, maxEdge) : null;
  const h = p.h ? Math.min(p.h * p.dpr, maxEdge) : null;
  if (w || h) {
    img = img.resize({ width: w ?? undefined, height: h ?? undefined, fit: p.fit, withoutEnlargement: !p.up });
  } else {
    img = img.resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true });
  }
  img = img.toFormat(fmt, QUALITY.has(fmt) ? { quality: p.q } : {});
  const body = await img.toBuffer();
  return { body, mime: MIME[fmt] };
}

export async function posterFrame(path, t) {
  try {
    const { stdout } = await run('ffmpeg', ['-v', 'error', '-ss', String(Math.max(0, t)), '-i', path, '-frames:v', '1', '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '3', 'pipe:1'],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
    return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  } catch (e) {
    // Past the end of the clip ffmpeg encodes nothing and may exit non-zero; that is "no frame", not a failure.
    if (e.stdout && e.stdout.length === 0) return Buffer.alloc(0);
    throw e;
  }
}
