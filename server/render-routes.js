import { createReadStream } from 'node:fs';
import { splitName } from './ids.js';
import { getLiveFile } from './repo.js';
import { filePath } from './store.js';
import { parseImageParams, parseVideoParams } from './params.js';
import { renderImage, posterFrame } from './render.js';
import { contentDisposition, httpError } from './http.js';
import { createLimiter } from './limiter.js';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const UNRENDERABLE = new Set(['image/heic', 'image/heif']);

// A render that fails because of the input is the client's 422, logged through detail; one our own timeout killed is
// a 422 too (the input took too long). A render that fails because the box is broken (ffmpeg missing, a process
// killed from outside) is a 500, so it is logged as one and never cached.
function renderError(e, message) {
  if (e?.status) throw e; // already an HTTP error (the limiter's 503): pass it through untouched
  if (e?.killed && e?.signal) { const err = httpError(422, message); err.detail = 'timed out'; return err; }
  if (e?.code === 'ENOENT' || e?.signal) throw e;
  const err = httpError(422, message);
  err.detail = String(e?.message ?? e).split('\n')[0].slice(0, 200);
  return err;
}

export default async function renderRoutes(app, { db, root, renderLimiter = createLimiter({ concurrency: 2, queue: 32 }) }) {
  // Cache misses are free to manufacture from the open internet; the limiter bounds what they can cost the box.
  const limited = fn => renderLimiter.run(fn);

  app.get('/_render/:name', async (req, reply) => {
    const parsed = splitName(req.params.name);
    if (!parsed) throw httpError(404, 'not found');
    const row = getLiveFile(db, parsed.id);
    // The name must match the stored name byte for byte (splitName lowercases, nginx's static path does not).
    if (!row || req.params.name !== `${row.id}.${row.ext}`) throw httpError(404, 'not found');
    const src = filePath(root, row.id, row.ext);
    reply.header('Cache-Control', IMMUTABLE);

    const q = req.query;
    if (q.dl === '1') {
      reply.header('Content-Disposition', contentDisposition(row.original_name ?? `${row.id}.${row.ext}`));
      return sendOriginal(reply, row, src);
    }

    const ip = parseImageParams(q);

    if (row.kind === 'image') {
      if (!ip.active) return sendOriginal(reply, row, src);
      // sharp's prebuilt libvips reads HEIC metadata but cannot decode its HEVC pixels: serve the original, no attempt.
      if (UNRENDERABLE.has(row.mime)) {
        req.log.info({ id: row.id, mime: row.mime }, 'format not renderable, serving the original');
        return sendOriginal(reply, row, src);
      }
      let out;
      try { out = await limited(() => renderImage(src, ip)); } catch (e) { throw renderError(e, 'cannot render this image'); }
      return reply.type(out.mime).send(out.body);
    }

    if (row.kind === 'video') {
      const vp = parseVideoParams(q);
      if (!vp.active && !ip.active) return sendOriginal(reply, row, src);
      const t = Math.min(vp.t, Math.max(0, (row.duration ?? 0) - 0.1));
      let jpeg;
      try { jpeg = await limited(() => posterFrame(src, t)); } catch (e) { throw renderError(e, 'cannot extract a frame'); }
      if (!jpeg.length) throw httpError(422, 'no frame at that time');
      if (!ip.active) return reply.type('image/jpeg').send(jpeg);
      let out;
      try { out = await limited(() => renderImage(jpeg, ip)); } catch (e) { throw renderError(e, 'cannot render this frame'); }
      return reply.type(out.mime).send(out.body);
    }

    return sendOriginal(reply, row, src);
  });
}

function sendOriginal(reply, row, src) {
  reply.type(row.mime);
  if (row.mime === 'image/svg+xml') {
    reply.header('Content-Security-Policy', 'sandbox');
    reply.header('X-Content-Type-Options', 'nosniff');
  }
  return reply.send(createReadStream(src));
}
