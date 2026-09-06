/**
 * Runs the world's generators once, at build time, and writes the answer out.
 *
 * WHAT THIS IS FOR. Measured on a desktop CPU, starting the world cost 16.9
 * seconds of synchronous single-threaded JavaScript: 15.2s generating four sets
 * of 512x512 material maps and 1.5s running 24,000 erosion droplets over the
 * heightfield. On a low-end phone that is three to five times worse, which is
 * why the site did not merely load slowly there — it never finished, because
 * the browser gives up on a main thread that has been blocked that long.
 *
 * None of that work is variable. There is no Math.random anywhere in the
 * generation path and the erosion is seeded (createRng(0x5eed1)), so every
 * visitor on every load was recomputing a byte-identical result from scratch.
 * That is the definition of something that should be computed once.
 *
 * THE TRADE, STATED PLAINLY. This replaces ~17s of blocked main thread with
 * roughly 2MB of download. Those are not comparable costs: the download happens
 * off-thread, in parallel, in native code, and a slow device decodes a PNG
 * almost as fast as a fast one because the decoder is not JavaScript. It is the
 * reason a site shipping far heavier assets than this one loads on hardware
 * where this one did not.
 *
 * The generators are not deleted and are not dead code — they are what this
 * script runs, and what the runtime falls back to if the baked output is
 * missing. Change a number in ice-texture.js, re-run this, and the site follows.
 *
 *   npm run bake -w @portfolio/web
 */
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

/**
 * The generator hands back RGBA because that is what a canvas wants. Two of
 * these four maps do not need all of it — the alpha is a constant 255
 * everywhere, and the AO map's green and blue are copies of its red — so the
 * channels that carry nothing are dropped before they are stored rather than
 * compressed very well and then decoded back into memory on every visit.
 */
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

  /* The quantiles travel with the maps. They are derived from the same fields
     and callers threshold against them, so a baked set without them is not a
     usable set — see the note in ice-texture.js on what guessing them cost. */
  manifest.sets[name] = {
    size: data.size,
    reliefStops: data.reliefStops,
    patchStops: data.patchStops,
  };
}

/**
 * THE HEIGHTFIELD, QUANTISED TO 16 BITS AND NOT STORED AS A PNG.
 *
 * A PNG would be the obvious container and it is a trap: canvas decodes 16-bit
 * PNGs down to 8 bits, so the precision would be silently halved somewhere
 * inside the browser with nothing to indicate it had happened. A raw array read
 * through fetch().arrayBuffer() has no such opinion.
 *
 * 16 bits is not a compromise here. The field spans a known range, so a step is
 * that range over 65535 — thousandths of a world unit against a terrain 2600
 * units across and cells five units wide. The vertex normals are computed from
 * this and cannot see a difference that small.
 */
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
  /* Worst-case error introduced by the quantisation, in the field's own units,
     recorded so a future reader can check it against what they need rather than
     take the paragraph above on trust. */
  step: span / 65535,
};

write('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));

console.log('\n  ' + kb(bytes) + '  total, written to public/baked/\n');
