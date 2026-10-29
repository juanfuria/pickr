import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { authenticate } from './auth.js';
import { purgeVariants } from './cache.js';
import apiRoutes from './api.js';
import renderRoutes from './render-routes.js';

export async function buildApp({ db, root, publicUrl, purgeUrl, purge = null, logger = false, maxBytes = 1024 ** 3, renderLimiter = undefined }) {
  // forceCloseConnections: a request answered before its body was read (a 400 on a wrong-field upload) keeps its
  // socket half-open; without this, close() waits on it and a restart hangs until systemd's stop timeout.
  const app = Fastify({ logger, bodyLimit: 1024 * 1024, trustProxy: '127.0.0.1', forceCloseConnections: true });
  await app.register(multipart, { limits: { files: 1, fileSize: maxBytes, fields: 10 } });
  app.decorateRequest('account', null);

  app.addHook('onRequest', async (req, reply) => {
    // Check the matched route as well as the raw URL: the router decodes percent-escapes, so /%61pi/files would
    // otherwise reach an API handler without a key.
    if (!req.url.startsWith('/api/') && !(req.routeOptions?.url ?? '').startsWith('/api/')) return;
    const a = authenticate(db, req.headers.authorization);
    if (!a) return reply.code(401).send({ error: 'missing or invalid key' });
    req.account = a;
  });

  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: 'not found' }));
  app.setErrorHandler((err, req, reply) => {
    const status = err.status ?? err.statusCode ?? 500;
    const fault = status >= 500 && status !== 503; // 503 is "busy", expected under load: not a fault, not masked
    if (fault) req.log.error(err);
    else if (err.detail || status === 503) req.log.warn({ status, detail: err.detail }, err.message);
    // An error is never cacheable, whatever Cache-Control the route had already set (Fastify keeps it on errors).
    reply.header('Cache-Control', 'no-store');
    if (err.retryAfter) reply.header('Retry-After', String(err.retryAfter));
    reply.code(status).send({ error: fault ? 'internal error' : err.message });
  });

  const doPurge = purge ?? ((id, ext) => purgeVariants(purgeUrl, id, ext));
  await app.register(apiRoutes, { db, root, publicUrl, purge: doPurge });
  await app.register(renderRoutes, { db, root, renderLimiter });
  return app;
}
