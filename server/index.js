import { join } from 'node:path';
import sharp from 'sharp';
import { config } from './config.js';
import { openDb } from './db.js';
import { ensureLayout } from './store.js';
import { buildApp } from './app.js';

sharp.concurrency(1);
// no libvips operation cache: memory stays proportional to the render in flight
sharp.cache(false);

await ensureLayout(config.root);
const db = openDb(join(config.root, 'pickr.sqlite'));
const app = await buildApp({ db, root: config.root, publicUrl: config.publicUrl, purgeUrl: config.purgeUrl, logger: true });
await app.listen({ port: config.port, host: '127.0.0.1' });

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => { await app.close(); db.close(); process.exit(0); });
}
