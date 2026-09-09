/*
 * Heightfield-only bake.
 *
 * bake-world.mjs regenerates the ice map set as well, which is minutes of noise
 * synthesis that has nothing to do with the landform. While the terrain is being
 * shaped, this rewrites heightfield.bin and patches the existing manifest's
 * `heightfield` block in place, leaving `sets` exactly as the full bake left it.
 * Run the full bake before shipping; this is for the iteration loop.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildField, ERODE_SEGMENTS } from '../src/world/lib/terrain.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'baked');
const manifestPath = join(OUT, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const started = Date.now();
const field = buildField();
console.log(`  eroded in ${((Date.now() - started) / 1000).toFixed(1)}s  (${ERODE_SEGMENTS} segments)`);

let min = Infinity;
let max = -Infinity;
for (const v of field.data) {
  if (v < min) min = v;
  if (v > max) max = v;
}
const span = max - min || 1;
const quantised = new Uint16Array(field.data.length);
for (let i = 0; i < field.data.length; i += 1) {
  quantised[i] = Math.round(((field.data[i] - min) / span) * 65535);
}
writeFileSync(join(OUT, 'heightfield.bin'), Buffer.from(quantised.buffer));

manifest.heightfield = {
  n: field.n,
  cell: field.cell,
  x0: field.x0,
  z0: field.z0,
  min,
  max,
  step: span / 65535,
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

console.log(`  height range ${min.toFixed(1)} .. ${max.toFixed(1)}`);
