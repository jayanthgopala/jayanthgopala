import { DataTexture, LinearFilter, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three';
import { makeFbm, makeNoise2D } from './noise.js';

// The block texture that breaks the cut into chunks. Generated from a seed, nothing downloaded.
// r: where the cut arrives first. One value per rectangle so the wipe crosses a block at once and reads as fragments.
// g: the seam push. Soft horizontal streaks, hard-edged bands here showed as dead straight lines on screen.
// b: the front's raggedness, smooth low frequency noise.
// g and b tile seamlessly, a jump in either draws a vertical line down the wipe at every repeat.

const SIZE = 256;

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stretch a field so its values span the whole 0..1 range the shader sweeps
function normalise(field) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < field.length; i += 1) {
    if (field[i] < min) min = field[i];
    if (field[i] > max) max = field[i];
  }
  const span = max - min || 1;
  for (let i = 0; i < field.length; i += 1) field[i] = (field[i] - min) / span;
}

function blockField(rand, noise) {
  const field = new Float32Array(SIZE * SIZE);

  const fill = (x, y, w, h) => {
    // neighbours share a coarse noise term so blocks cluster instead of flickering as salt and pepper
    const cluster = noise((x + w / 2) / 72, (y + h / 2) / 72);
    const value = 0.5 + 0.34 * cluster + 0.32 * (rand() - 0.5);
    for (let j = y; j < y + h; j += 1) {
      for (let i = x; i < x + w; i += 1) field[j * SIZE + i] = value;
    }
  };

  const split = (x, y, w, h) => {
    const area = w * h;
    // random floor on block size, so there are large slabs and small chips rather than one uniform grain
    const floor = 24 + rand() * 1800;
    const canW = w >= 12;
    const canH = h >= 3;
    if (area <= floor || (!canW && !canH)) {
      fill(x, y, w, h);
      return;
    }

    // wide and flat is the look, cut across when a block is too square and down when it's become a sliver
    const aspect = w / h;
    let across;
    if (!canW) across = true;
    else if (!canH) across = false;
    else if (aspect > 9) across = false;
    else if (aspect < 1.6) across = true;
    else across = rand() < 0.62;

    if (across) {
      const cut = Math.max(1, Math.min(h - 1, Math.round(h * (0.3 + rand() * 0.4))));
      split(x, y, w, cut);
      split(x, y + cut, w, h - cut);
    } else {
      const cut = Math.max(4, Math.min(w - 4, Math.round(w * (0.25 + rand() * 0.5))));
      split(x, y, cut, h);
      split(x + cut, y, w - cut, h);
    }
  };

  split(0, 0, SIZE, SIZE);
  normalise(field);
  return field;
}

// Blended with copies of itself shifted by one tile, so at every edge the blend is the copy continuing on the far side.
function seamless(at) {
  const field = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const u = x / SIZE;
      const v = y / SIZE;
      field[y * SIZE + x] =
        at(x, y) * (1 - u) * (1 - v) +
        at(x - SIZE, y) * u * (1 - v) +
        at(x, y - SIZE) * (1 - u) * v +
        at(x - SIZE, y - SIZE) * u * v;
    }
  }
  normalise(field);
  return field;
}

export function createCutTexture(seed = 4051) {
  const rand = mulberry32(seed);
  const r = blockField(rand, makeNoise2D(seed + 1));
  const streaks = makeFbm(makeNoise2D(seed + 3), { octaves: 3 }); // stretched about 14:1, streaks not blobs
  const g = seamless((x, y) => streaks(x / 70, y / 5));
  const slope = makeFbm(makeNoise2D(seed + 2), { octaves: 3 });
  const b = seamless((x, y) => slope(x / 88, y / 88));

  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    data[i * 4] = Math.round(r[i] * 255);
    data[i * 4 + 1] = Math.round(g[i] * 255);
    data[i * 4 + 2] = Math.round(b[i] * 255);
    data[i * 4 + 3] = 255;
  }

  const texture = new DataTexture(data, SIZE, SIZE, RGBAFormat, UnsignedByteType);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  // Linear, not nearest. Razor sharp block edges are exactly what read as a straight line across the wipe.
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
