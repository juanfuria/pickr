import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { authenticate } from './auth.js';
import { purgeVariants } from './cache.js';
import apiRoutes from './api.js';
import renderRoutes from './render-routes.js';

export async function buildApp({ db, root, publicUrl, purgeUrl, purge = null, logger = false, maxBytes = 1024 ** 3 }) {
  const app = Fastify({ logger, bodyLimit: 1024 * 1024, trustProxy: '127.0.0.1' });
  await app.register(multipart, { limits: { files: 1, fileSize: maxBytes, fields: 10 } });
  app.decorateRequest('account', null);

  app.addHook('onRequest', async (req, reply) => {
    // The router decodes percent-escapes before matching (/%61pi/files reaches /api/files), so the raw URL alone would
    // let an encoded path skip this check: the matched route decides as well.
    if (!req.url.startsWith('/api/') && !req.routeOptions.url?.startsWith('/api/')) return;
    const a = authenticate(db, req.headers.authorization);
    if (!a) return reply.code(401).send({ error: 'missing or invalid key' });
    req.account = a;
  });

  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: 'not found' }));
  app.setErrorHandler((err, req, reply) => {
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    else if (err.detail) req.log.warn({ status, detail: err.detail }, err.message);
    reply.code(status).send({ error: status >= 500 ? 'internal error' : err.message });
  });

  const doPurge = purge ?? ((id, ext) => purgeVariants(purgeUrl, id, ext));
  await app.register(apiRoutes, { db, root, publicUrl, purge: doPurge });
  await app.register(renderRoutes, { db, root });
  return app;
}
