// Pre-bakes world textures and eroded terrain heightfield to static assets in public/baked/
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './png.mjs';
import { ICE_SETS, ICE_MAPS } from '../src/world/lib/ice-sets.js';
import { makeIceMapData } from '../src/world/lib/ice-texture.js';
import { buildField, ERODE_SEGMENTS } from '../src/world/lib/terrain.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'baked');
mkdirSync(OUT, { recursive: true });

const kb = (n) => (n / 1024).toFixed(0).padStart(5) + ' KB';
let bytes = 0;

const write = (name, buffer) => {
  writeFileSync(join(OUT, name), buffer);
  bytes += buffer.length;
  console.log('  ' + kb(buffer.length) + '  ' + name);
};

// Packs RGBA data into the required channel count
function pack(rgba, size, channels) {
  if (channels === 4) return Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length);
  const out = Buffer.alloc(size * size * channels);
  for (let i = 0, o = 0; i < size * size; i += 1) {
    out[o] = rgba[i * 4];
    if (channels === 3) {
      out[o + 1] = rgba[i * 4 + 1];
      out[o + 2] = rgba[i * 4 + 2];
    }
    o += channels;
  }
  return out;
}

const manifest = { version: 1, sets: {}, heightfield: null };

console.log('\nMaterial maps');
for (const [name, params] of Object.entries(ICE_SETS)) {
  const started = Date.now();
  const data = makeIceMapData(params);
  console.log('\n  ' + name + '  (' + params.variant + ', ' + params.size + 'px, generated in ' +
    ((Date.now() - started) / 1000).toFixed(1) + 's)');

  for (const { key, channels } of ICE_MAPS) {
    write(name + '-' + key + '.png', encodePng(pack(data[key], data.size, channels), data.size, data.size, channels));
  }

  // Quantile thresholds for shader elevation and patch styling
  manifest.sets[name] = {
    size: data.size,
    reliefStops: data.reliefStops,
    patchStops: data.patchStops,
  };
}

// Quantise heightfield to 16-bit binary buffer
console.log('\nHeightfield');
const started = Date.now();
const field = buildField();
console.log('  eroded in ' + ((Date.now() - started) / 1000).toFixed(1) + 's  (' +
  ERODE_SEGMENTS + ' segments, ' + field.data.length.toLocaleString() + ' samples)');

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
write('heightfield.bin', Buffer.from(quantised.buffer));

manifest.heightfield = {
  n: field.n,
  cell: field.cell,
  x0: field.x0,
  z0: field.z0,
  min,
  max,
  step: span / 65535,
};

write('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));

console.log('\n  ' + kb(bytes) + '  total, written to public/baked/\n');
