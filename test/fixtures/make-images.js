import sharp from 'sharp';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = name => join(here, name);

await sharp({ create: { width: 320, height: 240, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 12 } } })
  .withIccProfile('p3')
  .jpeg({ quality: 85 })
  .toFile(out('photo.jpg'));

await sharp({ create: { width: 100, height: 80, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 0.5 } } })
  .png()
  .toFile(out('alpha.png'));

await sharp({ create: { width: 5000, height: 3000, channels: 3, background: '#3366aa' } })
  .jpeg({ quality: 60 })
  .toFile(out('big.jpg'));

console.log('images made');
