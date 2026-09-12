import { PlaneGeometry } from 'three';
import { makeNoise2D, makeFbm } from './noise.js';
import { createRng, erodeStep } from './erosion.js';

const SEED = 20260824;
const noise = makeNoise2D(SEED);

// Procedural noise octave configurations
const drift = makeFbm(noise, { octaves: 3, lacunarity: 2.0, persistence: 0.45 });
const mountain = makeFbm(noise, { octaves: 3, lacunarity: 1.95, persistence: 0.42 });

export const TERRAIN_SIZE = 2600;
export const MOUND_AT = [-30, 252];

// Background mountain range depth and height thresholds
const MID_NEAR = -500;
const MID_FAR = -1100;
const MID_HEIGHT = 210;

const FAR_NEAR = -900;
const FAR_FAR = -1550;
const FAR_HEIGHT = 430;

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Rotates and stretches sample coordinates for directional dune structures
const anisotropic = (fbm, f, ox, oz, rot, stretch, px, pz) => {
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const ax = (px * cr + pz * sr) / stretch;
  const az = -px * sr + pz * cr;
  return fbm(ax * f + ox, az * f + oz);
};

// Computes raw procedural height prior to hydraulic erosion
function rawHeight(x, z) {
  // Near-field wind-aligned dunes and drifts
  const drifts = anisotropic(drift, 0.0042, 0, 0, 0.28, 4.2, x, z) * 19;

  // Domain-warped sculpted drifts
  const dwx = drift(x * 0.0042 + 51.3, z * 0.0042 - 12.7) * 46;
  const dwz = drift(x * 0.0042 - 87.1, z * 0.0042 + 33.9) * 46;
  const sculpt = drift((x + dwx) * 0.0125, (z + dwz) * 0.0125) * 2.2;

  // Central hero mound elevation under the igloo
  const dx = x - MOUND_AT[0];
  const dz = z - MOUND_AT[1];
  const mound = 16.0 * Math.exp(-(dx * dx + dz * dz) / (2 * 58 * 58));
  const sculpted = sculpt * smoothstep(20, 90, Math.hypot(dx, dz));

  const dune = (f, ox, oz, rot, stretch, px = x, pz = z) => {
    const n = anisotropic(mountain, f, ox, oz, rot, stretch, px, pz);
    const t = Math.min(1, Math.max(0, n * 0.5 + 0.5));
    const s2 = t * t * (3 - 2 * t);
    const env =
      0.45 + 0.55 * Math.abs(anisotropic(drift, f * 0.32, ox, -oz, rot, stretch, px, pz));
    return s2 * env;
  };

  const dome = (f, ox, oz, px = x, pz = z) => {
    const n = mountain(px * f + ox, pz * f + oz);
    const t = Math.min(1, Math.max(0, n * 0.5 + 0.5));
    const s2 = t * t * (3 - 2 * t);
    const env = 0.45 + 0.55 * Math.abs(drift(px * f * 0.32 + ox, pz * f * 0.32 - oz));
    return s2 * env;
  };

  // Large-scale coordinate warp
  const WARP = 44;
  const wx = x + drift(x * 0.0019 + 19.3, z * 0.0019 - 7.1) * WARP;
  const wz = z + drift(x * 0.0019 - 41.7, z * 0.0019 + 63.9) * WARP;

  const hummockRamp = smoothstep(150, 320, Math.sqrt(dx * dx + dz * dz));
  const hillEnv = 0.25 + 0.75 * smoothstep(0.3, 0.75, drift(x * 0.0016 + 55, z * 0.0016 - 31) * 0.5 + 0.5);

  const hummocks =
    (dune(0.0016, 7.3, -21.5, 0.24, 4.4, wx, wz) * 88 +
      dune(0.0052, 61.7, 13.1, -0.38, 3.2, wx, wz) * 20 +
      dome(0.012, 5.2, 44.8) * 4) *
    hillEnv *
    hummockRamp;

  // Hand-placed landform features
  const placedHill = (cx, cz, radius, height) => {
    const px = x - cx;
    const pz = z - cz;
    const d = Math.sqrt(px * px + pz * pz) / radius;
    if (d >= 1) return 0;
    const c = Math.cos((Math.PI / 2) * d);
    return height * c * c;
  };

  // Structured mountain mass with orientation, lean, spurs, and ridge carving
  const massif = (cx, cz, radius, height, seed, opts) => {
    const aspect = (opts && opts.aspect) || 1.0;
    const rot = (opts && opts.rot) || 0;
    const lean = (opts && opts.lean) || 0;
    const carveAmt = opts && opts.carve !== undefined ? opts.carve : 0.34;
    const spurAmt = opts && opts.spur !== undefined ? opts.spur : 0.30;
    const round = opts && opts.round !== undefined ? opts.round : 0.0;

    const gx = x - cx;
    const gz = z - cz;

    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    const lx = (gx * cr + gz * sr) - lean * radius;
    const lz = (-gx * sr + gz * cr) * aspect;

    const r = Math.sqrt(lx * lx + lz * lz);
    if (r >= radius) return 0;

    const u = r / radius;
    const theta = Math.atan2(lz, lx);

    const c = Math.cos((Math.PI / 2) * u);
    const profile = Math.pow(c, 2.4 - 1.25 * round);
    const flank = Math.sin(Math.PI * u);
    const crown = smoothstep(0.09, 0.40 + 0.18 * round, u);
    const mod = flank * crown;

    const spur =
      Math.cos(theta * 4 + seed) +
      0.58 * Math.cos(theta * 7 - seed * 1.7) +
      0.31 * Math.cos(theta * 11 + seed * 0.6);

    const crestLine = Math.pow(Math.abs(Math.cos(theta)), 2.2);

    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = 2.4 / radius;
    for (let i = 0; i < 3; i += 1) {
      const n = 1 - Math.abs(mountain(lx * f + seed * 17.3 * (i + 1), lz * f - seed * 9.1 * (i + 1)));
      sum += n * n * amp;
      norm += amp;
      amp *= 0.44;
      f *= 2.19;
    }
    const carve = (sum / norm - 0.52) * 1.9;

    const shape =
      profile *
      (1 +
        spur * spurAmt * (1 - 0.62 * round) * mod +
        crestLine * 0.20 * (1 - 0.78 * round) * mod +
        carve * carveAmt * (1 - 0.55 * round) * mod);

    return shape > 0 ? height * shape : 0;
  };

  // Asymmetric bowl depression around the igloo site
  const bowlRim = (() => {
    const bx = x - MOUND_AT[0];
    const bz = z - MOUND_AT[1];
    const d = Math.sqrt(bx * bx + bz * bz);
    if (d < 34 || d > 130) return 0;

    const t2 = (d - 34) / (130 - 34);
    const radial = Math.sin(Math.PI * t2);

    const facing = bz / (d || 1);
    const open = Math.max(0, facing * 0.5 + 0.5);
    const gate = Math.pow(1 - open, 1.6);

    return radial * gate * 21;
  })();

  const hills =
    massif(-380, -300, 430, 104, 1.7, {
      aspect: 1.14,
      rot: 0.42,
      lean: 0.20,
      round: 0.92,
      spur: 0.26,
      carve: 0.2,
    }) +
    massif(400, -172, 336, 108, 3.3, { aspect: 1.22, rot: -0.55, lean: 0.24, round: 0.86, spur: 0.2, carve: 0.16 }) +
    placedHill(30, -330, 150, 24) +
    placedHill(-105, -430, 165, 27) +
    placedHill(175, -390, 140, 20) +
    placedHill(109, -90, 150, 26) +
    placedHill(-215, 20, 115, 38) +
    placedHill(288, 35, 105, 34) +
    placedHill(-145, 300, 80, 17) +
    placedHill(155, 308, 68, 14) +
    placedHill(-60, 288, 52, 10);

  const crest = (f, ox, oz) => {
    let sum = 0;
    let amp = 1;
    let freq = f;
    let norm = 0;
    for (let i = 0; i < 3; i += 1) {
      const n = 1 - Math.abs(mountain(wx * freq + ox * (i + 1), wz * freq + oz * (i + 1)));
      sum += n * n * amp;
      norm += amp;
      amp *= 0.42;
      freq *= 2.11;
    }
    const v = sum / norm;
    const t = Math.max(0, (v - 0.28) / 0.46);
    const shaped = t < 1 ? t * t * (3 - 2 * t) : 1 + (t - 1) * 0.55;
    const env = 0.42 + 0.58 * Math.abs(drift(wx * f * 0.4 + ox, wz * f * 0.4 - oz));
    return shaped * env;
  };

  const mid = smoothstep(MID_NEAR, MID_FAR, z);
  const far = smoothstep(FAR_NEAR, FAR_FAR, z);

  let peaks = 0;
  const range = (h) => {
    if (h > peaks) peaks = h;
  };

  // Layer A: near mountain range
  range(massif(-780, -560, 560, 286, 1.7, { aspect: 1.26, rot: 0.38, lean: 0.22, round: 0.9, spur: 0.30, carve: 0.22 }));
  range(massif(-170, -600, 400, 106, 4.1, { aspect: 1.12, rot: -0.52, lean: -0.22, round: 0.82, spur: 0.28, carve: 0.22 }));
  range(massif(880, -520, 470, 196, 2.9, { aspect: 1.24, rot: 0.86, lean: 0.14, round: 0.5, spur: 0.26, carve: 0.24 }));

  // Layer B: midground wall
  range(massif(-1010, -905, 660, 330, 5.3, { aspect: 1.18, rot: -0.24, lean: 0.26, round: 0.88, spur: 0.29, carve: 0.22 }));
  range(massif(-400, -1010, 570, 288, 0.9, { aspect: 1.34, rot: 0.62, lean: -0.16, round: 0.44, spur: 0.21, carve: 0.30 }));
  range(massif(800, -950, 650, 372, 3.6, { aspect: 1.08, rot: -0.78, lean: 0.21, round: 0.42, spur: 0.27, carve: 0.26 }));
  range(massif(1420, -985, 630, 282, 6.2, { aspect: 1.26, rot: 0.41, lean: -0.24, round: 0.84, spur: 0.29, carve: 0.22 }));

  // Layer C: distant summits framed through col
  range(massif(-1340, -1360, 860, 470, 2.2, { aspect: 1.15, rot: 0.29, lean: -0.20, round: 0.8, spur: 0.28, carve: 0.22 }));
  range(massif(-520, -1465, 780, 336, 5.9, { aspect: 1.28, rot: -0.66, lean: 0.24, round: 0.12, spur: 0.3, carve: 0.3 }));
  range(massif(330, -1390, 900, 440, 1.1, { aspect: 1.10, rot: 0.71, lean: -0.15, round: 0.78, spur: 0.28, carve: 0.22 }));
  range(massif(1900, -1430, 880, 452, 4.7, { aspect: 1.22, rot: -0.35, lean: 0.18, round: 0.46, spur: 0.24, carve: 0.22 }));

  // Subtle ridge weathering on prominent peaks
  if (peaks > 0 && mid > 0) {
    const weathering = crest(0.0014, 17, -44) - 0.5;
    peaks *= 1 + weathering * 0.055 * mid;
  }

  // Base floor elevation under the ranges
  if (mid > 0) peaks = Math.max(peaks, (26 + 44 * far) * mid);

  // Gentle height terracing
  const terraced = (h) => {
    const STEP = 11;
    const SHARP = 4.6;
    const f = h / STEP;
    const i = Math.floor(f);
    const rise = Math.min(1, (f - i) * SHARP);
    return (i + rise) * STEP;
  };

  const cut = hummocks + (terraced(hummocks) - hummocks) * 0.07;

  // Crag and rocky ridge contours
  const cragDist = Math.sqrt(dx * dx + dz * dz);
  const cragRamp = smoothstep(150, 340, cragDist);
  const ridged = (f, ox, oz) => 1 - Math.abs(mountain(wx * f + ox, wz * f + oz));

  const ramp = (v) => {
    const t = Math.min(1, Math.max(0, (v - 0.28) / 0.44));
    return t * t * (3 - 2 * t);
  };

  const crag =
    (ramp(ridged(0.0034, 91.3, -17.7)) * 8 +
      ramp(ridged(0.0082, 13.9, 44.1)) * 5.5 +
      ridged(0.0195, -63.1, 8.5) * 1.8) *
    cragRamp *
    hillEnv;

  const front = drifts + sculpted + mound + cut + hills + bowlRim + crag;
  return Math.max(front, peaks);
}

// Igloo foundation pad and perimeter snow bank settings
const PAD_RADIUS = 32;
const PAD_FALLOFF = 60;
const BANK_PEAK = 38;
const BANK_WIDTH = 10;
const BANK_HEIGHT = 4.5;
const BANK_INNER = 31;
const BANK_RAMP = 8;

let padY = null;

export const ERODE_SEGMENTS = 512;
export const TERRAIN_CENTER_Z = -300;
const ERODE_NORM = TERRAIN_SIZE / ERODE_SEGMENTS;
const ERODE_DROPLETS = 24000;

const ERODE_PARAMS = {
  erodeSpeed: 0.15,
  depositSpeed: 0.15,
  maxChangePerStep: 0.03,
  minSedimentCapacity: 0.002,
  maxLifetime: 46,
  inertia: 0.06,
};

let field = null;

// Procedural erosion generator; used during build baking or fallback
export function buildField() {
  const n = ERODE_SEGMENTS + 1;
  const cell = TERRAIN_SIZE / ERODE_SEGMENTS;
  const x0 = -TERRAIN_SIZE / 2;
  const z0 = TERRAIN_CENTER_Z - TERRAIN_SIZE / 2;
  const data = new Float32Array(n * n);

  for (let iy = 0; iy < n; iy += 1) {
    for (let ix = 0; ix < n; ix += 1) {
      data[iy * n + ix] = rawHeight(x0 + ix * cell, z0 + iy * cell) / ERODE_NORM;
    }
  }

  const rng = createRng(0x5eed1);
  for (let i = 0; i < ERODE_DROPLETS; i += 1) erodeStep(data, n, rng, ERODE_PARAMS);

  // Mean filtering pass for smooth snow contours
  {
    const pre = new Float32Array(data);
    for (let iy = 1; iy < n - 1; iy += 1) {
      for (let ix = 1; ix < n - 1; ix += 1) {
        const i = iy * n + ix;
        const ring =
          pre[i - n - 1] + pre[i - n] + pre[i - n + 1] +
          pre[i - 1] + pre[i + 1] +
          pre[i + n - 1] + pre[i + n] + pre[i + n + 1];
        data[i] = pre[i] * 0.44 + (ring / 8) * 0.56;
      }
    }
  }

  // 3x3 median filter to eliminate individual cell spikes
  const src = new Float32Array(data);
  const win = new Float64Array(9);
  for (let iy = 1; iy < n - 1; iy += 1) {
    for (let ix = 1; ix < n - 1; ix += 1) {
      const i = iy * n + ix;
      win[0] = src[i - n - 1]; win[1] = src[i - n]; win[2] = src[i - n + 1];
      win[3] = src[i - 1];     win[4] = src[i];     win[5] = src[i + 1];
      win[6] = src[i + n - 1]; win[7] = src[i + n]; win[8] = src[i + n + 1];
      for (let a = 1; a < 9; a += 1) {
        const v = win[a];
        let b = a - 1;
        while (b >= 0 && win[b] > v) { win[b + 1] = win[b]; b -= 1; }
        win[b + 1] = v;
      }
      data[i] = win[4];
    }
  }

  return { data, n, cell, x0, z0 };
}

// Ingests pre-baked heightfield binary from build asset
export function setBakedField(data) {
  if (!data) return;
  const n = ERODE_SEGMENTS + 1;
  if (data.length !== n * n) {
    throw new Error(`baked heightfield is ${data.length} samples, expected ${n * n}`);
  }
  field = {
    data,
    n,
    cell: TERRAIN_SIZE / ERODE_SEGMENTS,
    x0: -TERRAIN_SIZE / 2,
    z0: TERRAIN_CENTER_Z - TERRAIN_SIZE / 2,
  };
}

// Bilinear interpolation across eroded heightfield grid
function erodedHeight(x, z) {
  if (field === null) field = buildField();
  const { data, n, cell, x0, z0 } = field;

  const gx = (x - x0) / cell;
  const gy = (z - z0) / cell;

  if (gx < 0 || gy < 0 || gx >= n - 1 || gy >= n - 1) return rawHeight(x, z);

  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = gx - ix;
  const fy = gy - iy;

  const h00 = data[iy * n + ix];
  const h10 = data[iy * n + ix + 1];
  const h01 = data[(iy + 1) * n + ix];
  const h11 = data[(iy + 1) * n + ix + 1];

  return (
    (h00 * (1 - fx) * (1 - fy) +
      h10 * fx * (1 - fy) +
      h01 * (1 - fx) * fy +
      h11 * fx * fy) *
    ERODE_NORM
  );
}

// Resolves final ground height including igloo pad and drift banking
export function heightAt(x, z) {
  const dx = x - MOUND_AT[0];
  const dz = z - MOUND_AT[1];
  const d = Math.hypot(dx, dz);
  if (d >= PAD_FALLOFF) return erodedHeight(x, z);

  if (padY === null) padY = erodedHeight(MOUND_AT[0], MOUND_AT[1]);

  const k = 1 - smoothstep(PAD_RADIUS, PAD_FALLOFF, d);
  const h = erodedHeight(x, z);
  const levelled = h + (padY - h) * k;

  const t = (d - BANK_PEAK) / BANK_WIDTH;
  const bank =
    BANK_HEIGHT *
    Math.exp(-0.5 * t * t) *
    smoothstep(BANK_INNER, BANK_INNER + BANK_RAMP, d);

  return levelled + bank;
}

// Generates displaced terrain mesh geometry
export function buildTerrainGeometry(segments = 512, centerZ = TERRAIN_CENTER_Z) {
  const geometry = new PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, centerZ);

  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
  }

  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
