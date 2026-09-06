/**
 * 2D simplex noise, and fBm built on it.
 *
 * WHY THIS RUNS ON THE CPU RATHER THAN IN A VERTEX SHADER. Displacing the
 * terrain in GLSL is faster and is the obvious first instinct. It also makes the
 * terrain height unknowable to JavaScript, and three separate systems need to
 * ask "how high is the ground at (x, z)?" — the camera rig, so the shot never
 * clips through a ridge; object scattering, so rocks sit on the surface instead
 * of hovering; and the character, so his feet touch. Reading heights back from
 * the GPU to answer that is far more expensive than the displacement ever was.
 *
 * So the ground is generated once, at init, from this function, and everything
 * that needs to know where the ground is calls the same function. One source of
 * truth for the shape of the world.
 *
 * Deterministic and seeded — the world must be identical on every load, or the
 * camera path authored against one terrain would cut through a different one.
 *
 * Simplex rather than Perlin because Perlin's gradients align to a square grid
 * and leave visible axis-aligned streaking in wide-open terrain, which is
 * exactly the shot we are building.
 */

/* Skew factors for the 2D simplex lattice. */
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

const GRAD = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

/**
 * A permutation table from a seed.
 *
 * Fisher-Yates driven by a small deterministic PRNG, so a given seed always
 * gives the same terrain. Doubled to 512 entries so index arithmetic never has
 * to wrap with a modulo in the inner loop.
 */
function buildPerm(seed) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) p[i] = i;

  // Mulberry32. Small, fast, and good enough to shuffle 256 values.
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
    // Skew the input space to decide which simplex cell we are in.
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);

    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);

    // Which of the two triangles of the cell.
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;

    let n = 0;

    // Each corner contributes a radially symmetric falloff times a gradient.
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

    // Scaled to roughly [-1, 1].
    return 70 * n;
  };
}

/**
 * Fractional Brownian motion: several octaves of noise summed at halving
 * amplitude and doubling frequency.
 *
 * One octave of simplex is a field of smooth blobs — it reads as a duvet, not
 * as ground. The large octaves give the landforms, the small ones give the
 * surface its grain, and the ratio between them (persistence) is what decides
 * whether the terrain looks like dunes or like rubble.
 */
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

    // Normalised, so changing the octave count does not change the terrain's
    // overall height and invalidate a camera path authored against it.
    return sum / norm;
  };
}
