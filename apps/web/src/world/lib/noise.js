// 2D simplex noise and fBm on top of it.
// This runs on the CPU because displacing in GLSL makes the height unknowable to JavaScript.
// The camera rig, the scatter and the character all need to ask how high the ground is, and reading that back off the GPU costs more.
// Seeded and deterministic, or a camera path authored against one terrain would cut through a different one.
// Simplex not Perlin, Perlin's gradients align to a square grid and streak visibly in wide open terrain.

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

const GRAD = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

// Fisher-Yates off a small PRNG, doubled to 512 entries so the inner loop never needs a modulo to wrap.
function buildPerm(seed) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) p[i] = i;

  // mulberry32, good enough to shuffle 256 values
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let i = 255; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }

  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i += 1) perm[i] = p[i & 255];
  return perm;
}

export function makeNoise2D(seed = 1337) {
  const perm = buildPerm(seed);

  return function noise2D(xin, yin) {
    // skew the input space to find which simplex cell we're in
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);

    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);

    // which of the cell's two triangles
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;

    let n = 0;

    // each corner contributes a radial falloff times a gradient
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      t0 *= t0;
      const g = GRAD[perm[ii + perm[jj]] & 7];
      n += t0 * t0 * (g[0] * x0 + g[1] * y0);
    }

    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      t1 *= t1;
      const g = GRAD[perm[ii + i1 + perm[jj + j1]] & 7];
      n += t1 * t1 * (g[0] * x1 + g[1] * y1);
    }

    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      t2 *= t2;
      const g = GRAD[perm[ii + 1 + perm[jj + 1]] & 7];
      n += t2 * t2 * (g[0] * x2 + g[1] * y2);
    }

    return 70 * n; // roughly [-1, 1]
  };
}

// Octaves summed at halving amplitude and doubling frequency.
// One octave is a field of smooth blobs that reads as a duvet, persistence decides dunes or rubble.
export function makeFbm(noise2D, { octaves = 5, lacunarity = 2, persistence = 0.5 } = {}) {
  return function fbm(x, y) {
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let norm = 0;

    for (let o = 0; o < octaves; o += 1) {
      sum += noise2D(x * frequency, y * frequency) * amplitude;
      norm += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    // normalised, so changing the octave count doesn't change the terrain's height
    return sum / norm;
  };
}
