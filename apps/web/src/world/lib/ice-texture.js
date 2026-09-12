import { CanvasTexture, RepeatWrapping, SRGBColorSpace, LinearFilter } from 'three';
import { makeNoise2D, makeFbm } from './noise.js';

const noise = makeNoise2D(9182736);

// Procedural multi-scale noise octave generators
const macroFbm = makeFbm(noise, { octaves: 3, lacunarity: 1.8, persistence: 0.52 });
const mediumFbm = makeFbm(noise, { octaves: 3, lacunarity: 2.0, persistence: 0.48 });
const fineFbm = makeFbm(noise, { octaves: 2, lacunarity: 2.2, persistence: 0.4 });

const MEDIUM_SCALE = 2.7;
const FINE_SCALE = 4.2;
const MICRO_SCALE = 15;
const MICRO_WEIGHT = 0.1;

// Surface frost grain parameters
const GRAIN_AMP = 15 / 255;
const GRAIN_TINT = [0.92, 0.95, 1.0];
const FROST_COLOR = [220 / 255, 225 / 255, 235 / 255];
const FROST_WASH = 0.04;

const W_MACRO = 0.63;
const W_MEDIUM = 0.29;
const W_FINE = 0.08;
const CONTRAST = 1.3;

// Torus coordinate mapping for seamless 2D wrapping
function torusCoordinates(u, v, frequency) {
  const a = u * Math.PI * 2;
  const b = v * Math.PI * 2;
  const r = frequency / (Math.PI * 2);

  return {
    x: Math.cos(a) * r,
    y: Math.sin(a) * r,
    z: Math.cos(b) * r,
    w: Math.sin(b) * r,
  };
}

// Samples noise with periodic 4-way corner cross-fade for seamless tiling
function layerAt(fbm, u, v, frequency, offset) {
  const s = frequency;
  const x = u * s + offset;
  const y = v * s + offset;

  const n00 = fbm(x, y);
  const n10 = fbm(x - s, y);
  const n01 = fbm(x, y - s);
  const n11 = fbm(x - s, y - s);

  const blended =
    n00 * (1 - u) * (1 - v) +
    n10 * u * (1 - v) +
    n01 * (1 - u) * v +
    n11 * u * v;

  return (blended + 1) * 0.5;
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const sstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Deterministic 2D coordinate hash
function hash21(x, y) {
  let px = (x * 127.1 + y * 311.7) % 1;
  let py = (x * 269.5 + y * 183.3) % 1;
  if (px < 0) px += 1;
  if (py < 0) py += 1;
  const d = px * px + py * py + 74.7;
  const r = (px + d) * (py + d) * 43758.5453;
  return r - Math.floor(r);
}

// Domain-warped rocky terrain height with shallow crevices
function marsHeightAt(u, v, frequency) {
  const wx = layerAt(macroFbm, u, v, frequency * 0.85, 3.1) - 0.5;
  const wy = layerAt(macroFbm, u, v, frequency * 0.85, 61.7) - 0.5;
  const uu = u + wx * 0.02;
  const vv = v + wy * 0.02;

  const large = layerAt(macroFbm, uu, vv, frequency, 0);
  const medium = layerAt(mediumFbm, uu, vv, frequency * 3.4, 17.3);
  const fine = layerAt(fineFbm, uu, vv, frequency * 16, 41.7);

  let value = large * 0.5 + medium * 0.35 + fine * 0.15;

  const crev = layerAt(mediumFbm, uu, vv, frequency * 4.2, 91.3);
  value -= sstep(0.58, 0.68, crev) * 0.075;

  return clamp01(sstep(0.1, 0.9, value));
}

// Procedural stone placement on wrapping grid
function stonesAt(u, v, cells, salt, threshold, radius) {
  const gx = u * cells;
  const gy = v * cells;
  const cx = Math.floor(gx);
  const cy = Math.floor(gy);

  let best = 0;
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      const ix = (((cx + ox) % cells) + cells) % cells;
      const iy = (((cy + oy) % cells) + cells) % cells;

      if (hash21(ix + salt, iy + salt * 2) < threshold) continue;

      const jx = hash21(ix + salt + 3.1, iy + salt + 8.7);
      const jy = hash21(ix + salt + 17.3, iy + salt + 5.9);
      const px = cx + ox + 0.5 + (jx - 0.5) * 0.6;
      const py = cy + oy + 0.5 + (jy - 0.5) * 0.6;

      const dx = gx - px;
      const dy = gy - py;
      const r = radius * (0.55 + hash21(ix + salt + 41, iy + salt + 23) * 0.75);
      const d = Math.sqrt(dx * dx + dy * dy) / r;
      if (d >= 1) continue;

      const h = Math.pow(1 - d * d, 0.6);
      if (h > best) best = h;
    }
  }
  return best;
}

function heightAt(u, v, frequency) {
  const fold = (fbm, f, offset) => Math.abs(layerAt(fbm, u, v, f, offset) * 2 - 1);

  const a = fold(macroFbm, frequency, 0);
  const b = fold(mediumFbm, frequency * 2.1, 17.3);
  const c = fold(fineFbm, frequency * 4.4, 41.7);

  const turb = 1 - (a * 0.44 + b * 0.34 + c * 0.22);
  return Math.min(1, Math.max(0, 0.5 + (turb - 0.5) * 1.45));
}

function unusedSmoothHeightAt(u, v, frequency) {
  const macro = layerAt(macroFbm, u, v, frequency, 0);
  const medium = layerAt(mediumFbm, u, v, frequency * MEDIUM_SCALE, 17.3);
  const fine = layerAt(fineFbm, u, v, frequency * FINE_SCALE, 41.7);

  const mixed = macro * W_MACRO + medium * W_MEDIUM + fine * W_FINE;
  const stretched = 0.5 + (mixed - 0.5) * CONTRAST;

  return Math.min(1, Math.max(0, stretched));
}

const PIT_COUNT = 32;
const PIT_MIN = 0.045;
const PIT_MAX = 0.125;
const PIT_EDGE = 0.62;
const PIT_DEPTH = 0.2;
const MATRIX_WEIGHT = 0.08;

function mulberry32(a) {
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ridged noise fold for rocky relief
function rockHeightAt(u, v, frequency) {
  const ridged = (fbm, f, offset) => {
    const n = layerAt(fbm, u, v, f, offset) * 2 - 1;
    return 1 - Math.abs(n);
  };

  const macro = ridged(macroFbm, frequency, 0);
  const medium = ridged(mediumFbm, frequency * MEDIUM_SCALE, 17.3);
  const fine = ridged(fineFbm, frequency * FINE_SCALE, 41.7);

  const mixed = macro * 0.44 + medium * 0.33 + fine * 0.23;
  return Math.min(1, Math.max(0, 0.5 + (mixed - 0.5) * 1.55));
}

// Rock relief generation with multi-frequency folds
function rockReliefAt(u, v, frequency) {
  const fold = (fbm, f, offset) => 1 - Math.abs(layerAt(fbm, u, v, f, offset) * 2 - 1);

  const a = fold(macroFbm, frequency, 0);
  const b = fold(mediumFbm, frequency * 2.6, 17.3);
  const c = fold(fineFbm, frequency * 6.1, 41.7);

  const mixed = a * 0.58 + b * 0.28 + c * 0.14;
  return clamp01(sstep(0.2, 0.86, mixed));
}

// Cellular Voronoi fracture network
function crackAt(u, v, cells) {
  const wx = layerAt(macroFbm, u, v, 2.4, 311.7) - 0.5;
  const wy = layerAt(macroFbm, u, v, 2.4, 907.1) - 0.5;
  const gx = (u + wx * 0.18) * cells;
  const gy = (v + wy * 0.18) * cells;

  const cx = Math.floor(gx);
  const cy = Math.floor(gy);

  let f1 = 1e9;
  let f2 = 1e9;

  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      const ix = (((cx + ox) % cells) + cells) % cells;
      const iy = (((cy + oy) % cells) + cells) % cells;

      const jx = cx + ox + 0.5 + (hash21(ix + 0.3, iy + 7.1) - 0.5) * 0.86;
      const jy = cy + oy + 0.5 + (hash21(ix + 5.7, iy + 2.9) - 0.5) * 0.86;

      const dx = gx - jx;
      const dy = gy - jy;
      const d = Math.sqrt(dx * dx + dy * dy);

      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }

  const present = sstep(0.44, 0.72, layerAt(mediumFbm, u, v, 3.1, 55.3));
  return (1 - sstep(0.0, 0.016, f2 - f1)) * present;
}

// Builds procedural height, relief, frost, patch, and crack maps
function buildFields(size, frequency, rock, pebbles) {
  const cloud = new Float32Array(size * size);
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const u = i / size;
      const v = j / size;
      cloud[j * size + i] = rock ? rockHeightAt(u, v, frequency) : marsHeightAt(u, v, frequency);
    }
  }

  const micro = new Float32Array(size * size);
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const g = layerAt(fineFbm, i / size, j / size, frequency * MICRO_SCALE, 77.1);
      micro[j * size + i] = (g - 0.5) * MICRO_WEIGHT;
    }
  }

  const frost = new Float32Array(size * size);
  {
    let sum = 0;
    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        const u = i / size;
        const v = j / size;
        const f =
          layerAt(fineFbm, u, v, frequency * 17, 5.7) * 0.5 +
          layerAt(mediumFbm, u, v, frequency * 6.2, 29.1) * 0.32 +
          layerAt(macroFbm, u, v, frequency * 2.3, 53.9) * 0.18;
        frost[j * size + i] = f;
        sum += f;
      }
    }
    const mean = sum / frost.length;
    let varSum = 0;
    for (let n = 0; n < frost.length; n += 1) {
      const d = frost[n] - mean;
      varSum += d * d;
    }
    const sd = Math.sqrt(varSum / frost.length) || 1e-6;
    for (let n = 0; n < frost.length; n += 1) frost[n] = (frost[n] - mean) / sd;
  }

  const rockField = new Float32Array(size * size);
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      rockField[j * size + i] = rockReliefAt(i / size, j / size, frequency);
    }
  }

  const relief = new Float32Array(size * size);
  for (let n = 0; n < relief.length; n += 1) {
    if (rock) {
      relief[n] = clamp01(rockField[n] * 1.0 + micro[n] * 0.3);
    } else {
      relief[n] = clamp01(cloud[n] * 0.70 + 0.30 + micro[n] * 0.10);
    }
  }

  const patch = new Float32Array(size * size);
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const u = i / size;
      const v = j / size;
      patch[j * size + i] = clamp01(
        layerAt(macroFbm, u, v, frequency * 1.5, 131.7) * 0.6 +
          layerAt(mediumFbm, u, v, frequency * 3.4, 57.3) * 0.4
      );
    }
  }

  const cracks = new Float32Array(size * size);
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      cracks[j * size + i] = crackAt(i / size, j / size, 4);
    }
  }

  return { cloud, relief, frost, patch, cracks };
}

const sample = (field, size, i, j) =>
  field[((j + size) % size) * size + ((i + size) % size)];

// Generates procedural texture buffers for build baking and runtime fallback
export function makeIceMapData({
  size = 512,
  frequency = 1.4,
  repeat = 1,
  bump = 2.6,
  variant = 'ice',
  pebbles = 0,
} = {}) {
  const rock = variant === 'rock';
  const { cloud, relief, frost, patch, cracks } = buildFields(size, frequency, rock, pebbles);

  // Roughness texture packing: R = patch field, G = roughness, B = crack network
  const rimg = { data: new Uint8ClampedArray(size * size * 4) };

  for (let n = 0; n < cloud.length; n += 1) {
    const h = relief[n];
    const rough = rock ? 0.4 + h * 0.55 : 0.46 + h * 0.52;
    const v = Math.round(Math.min(1, rough) * 255);

    rimg.data[n * 4] = Math.round(patch[n] * 255);
    rimg.data[n * 4 + 1] = v;
    rimg.data[n * 4 + 2] = Math.round((1 - cracks[n]) * 255);
    rimg.data[n * 4 + 3] = 255;
  }

  // Albedo / Color map generation
  const cimg = { data: new Uint8ClampedArray(size * size * 4) };

  const deep = rock ? [0.42, 0.41, 0.39] : [0.47, 0.5, 0.57];
  const bright = rock ? [0.6, 0.59, 0.56] : [0.6, 0.63, 0.7];

  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const n = j * size + i;
      const h = cloud[n];
      const t = Math.min(1, Math.max(0, h));
      const grain = frost[n] * GRAIN_AMP;

      const o = n * 4;
      for (let c = 0; c < 3; c += 1) {
        let v = deep[c] + (bright[c] - deep[c]) * t + grain * GRAIN_TINT[c];
        v = v * (1 - FROST_WASH) + FROST_COLOR[c] * FROST_WASH;
        cimg.data[o + c] = Math.round(Math.min(1, Math.max(0, v)) * 255);
      }
      cimg.data[o + 3] = 255;
    }
  }

  // Normal map calculation via Sobel filter
  const nimg = { data: new Uint8ClampedArray(size * size * 4) };

  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const tl = sample(relief, size, i - 1, j - 1);
      const t = sample(relief, size, i, j - 1);
      const tr = sample(relief, size, i + 1, j - 1);
      const l = sample(relief, size, i - 1, j);
      const r = sample(relief, size, i + 1, j);
      const bl = sample(relief, size, i - 1, j + 1);
      const b = sample(relief, size, i, j + 1);
      const br = sample(relief, size, i + 1, j + 1);

      const dx = tl + 2 * l + bl - (tr + 2 * r + br);
      const dy = tl + 2 * t + tr - (bl + 2 * b + br);

      const nx = dx * bump;
      const ny = dy * bump;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);

      const o = (j * size + i) * 4;
      nimg.data[o] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      nimg.data[o + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      nimg.data[o + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255);
      nimg.data[o + 3] = 255;
    }
  }

  const sorted = Float32Array.from(relief).sort();
  const at = (q) => sorted[Math.floor((sorted.length - 1) * q)];

  // Ambient occlusion generation from quantiles
  const aoDark = at(0.01);
  const aoOpen = at(0.4);
  const aoSpan = aoOpen - aoDark || 1;

  const aimg = { data: new Uint8ClampedArray(size * size * 4) };

  for (let n = 0; n < relief.length; n += 1) {
    const t = Math.min(1, Math.max(0, (relief[n] - aoDark) / aoSpan));
    const soft = t * t * (3 - 2 * t);
    const v = Math.round((0.55 + 0.45 * soft) * 255);
    aimg.data[n * 4] = v;
    aimg.data[n * 4 + 1] = v;
    aimg.data[n * 4 + 2] = v;
    aimg.data[n * 4 + 3] = 255;
  }

  const sortedPatch = Float32Array.from(patch).sort();
  const patchAt = (q) => sortedPatch[Math.floor((sortedPatch.length - 1) * q)];

  return {
    size,
    rough: rimg.data,
    color: cimg.data,
    normal: nimg.data,
    ao: aimg.data,
    reliefStops: {
      p10: at(0.1),
      p25: at(0.25),
      p35: at(0.35),
      p50: at(0.5),
      p75: at(0.75),
      p90: at(0.9),
    },
    patchStops: {
      p05: patchAt(0.05),
      p20: patchAt(0.2),
      p35: patchAt(0.35),
      p50: patchAt(0.5),
      p70: patchAt(0.7),
      p88: patchAt(0.88),
    },
  };
}

// Configures wrapping, repeat, and anisotropic filtering on ice textures
export function applyIceSettings(tex, repeat = 1) {
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 16;
  return tex;
}

// Sets correct colorSpace and uv channels on maps
export function tagIceMaps({ roughnessMap, normalMap, colorMap, aoMap, reliefStops, patchStops }) {
  colorMap.colorSpace = SRGBColorSpace;
  aoMap.channel = 0;
  return { roughnessMap, normalMap, colorMap, aoMap, reliefStops, patchStops };
}

// Instantiates CanvasTexture objects from raw RGBA buffers
export function iceMapsFromData(data, repeat = 1) {
  const { size } = data;

  const toTexture = (buffer) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    img.data.set(buffer);
    ctx.putImageData(img, 0, 0);
    return applyIceSettings(new CanvasTexture(canvas), repeat);
  };

  return tagIceMaps({
    roughnessMap: toTexture(data.rough),
    normalMap: toTexture(data.normal),
    colorMap: toTexture(data.color),
    aoMap: toTexture(data.ao),
    reliefStops: data.reliefStops,
    patchStops: data.patchStops,
  });
}

// Generates procedural texture maps directly in browser
export function makeIceMaps(options = {}) {
  return iceMapsFromData(makeIceMapData(options), options.repeat ?? 1);
}
