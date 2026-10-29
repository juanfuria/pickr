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
// Documents a browser would run: when Node serves them (downloads), they are sandboxed and never live on this origin.
const ACTIVE = new Set(['image/svg+xml', 'text/html', 'application/xhtml+xml', 'text/xml', 'application/xml', 'text/xsl']);

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

export default async function renderRoutes(app, { db, root, renderLimiter = createLimiter({ concurrency: 1, queue: 32 }) }) {
  // Cache misses are free to manufacture from the open internet; the limiter bounds what they can cost the box.
  const limited = (req, fn) => renderLimiter.run(() => {
    // the client may have left while this waited in the queue: do not spend the box on nobody
    if (req.raw.socket?.destroyed === true) throw httpError(499, 'client closed the request');
    return fn();
  });

  app.get('/_render/:name', async (req, reply) => {
    const parsed = splitName(req.params.name);
    if (!parsed) throw httpError(404, 'not found');
    const row = getLiveFile(db, parsed.id);
    // The name must match the stored name byte for byte (splitName lowercases, nginx's static path does not).
    if (!row || req.params.name !== `${row.id}.${row.ext}`) throw httpError(404, 'not found');
    const src = filePath(root, row.id, row.ext);
    // When the answer is the original, send the client to nginx's static copy instead of streaming the whole file
    // through Node and into the cache under a junk query. Short-lived: a later version may give that query a meaning.
    const original = () => reply.header('Cache-Control', 'public, max-age=86400').redirect(`/${row.id}.${row.ext}`, 302);
    // A render can outlive a DELETE: its purge has already run, so output for a file that is gone must never be cached.
    const stillLive = () => { if (!getLiveFile(db, row.id)) throw httpError(404, 'not found'); };
    reply.header('Cache-Control', IMMUTABLE);

    const q = req.query;
    if (q.dl === '1') {
      reply.header('Content-Disposition', contentDisposition(row.original_name ?? `${row.id}.${row.ext}`));
      return sendOriginal(reply, row, src);
    }

    const ip = parseImageParams(q);

    if (row.kind === 'image') {
      // sharp's prebuilt libvips reads HEIC metadata but cannot decode its HEVC pixels: the original, no attempt.
      if (!ip.active || UNRENDERABLE.has(row.mime)) return original();
      let out;
      try { out = await limited(req, () => renderImage(src, ip)); } catch (e) { throw renderError(e, 'cannot render this image'); }
      stillLive();
      return reply.type(out.mime).send(out.body);
    }

    if (row.kind === 'video') {
      const vp = parseVideoParams(q);
      if (!vp.active && !ip.active) return original();
      // An unknown duration clamps nothing: a time past the end finds no frame, which is already a 422.
      const t = row.duration ? Math.min(vp.t, Math.max(0, row.duration - 0.1)) : vp.t;
      let jpeg;
      try { jpeg = await limited(req, () => posterFrame(src, t)); } catch (e) { throw renderError(e, 'cannot extract a frame'); }
      if (!jpeg.length) throw httpError(422, 'no frame at that time');
      if (!ip.active) {
        stillLive();
        return reply.type('image/jpeg').send(jpeg);
      }
      let out;
      try { out = await limited(req, () => renderImage(jpeg, ip)); } catch (e) { throw renderError(e, 'cannot render this frame'); }
      stillLive();
      return reply.type(out.mime).send(out.body);
    }

    return original();
  });
}

// Only downloads (?dl=1) reach this: everything else that is "the original" is a redirect to nginx's static copy.
function sendOriginal(reply, row, src) {
  reply.type(row.mime);
  reply.header('X-Content-Type-Options', 'nosniff');
  if (ACTIVE.has(row.mime)) reply.header('Content-Security-Policy', 'sandbox');
  return reply.send(createReadStream(src));
}
