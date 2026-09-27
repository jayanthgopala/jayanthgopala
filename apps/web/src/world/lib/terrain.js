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
  grid = null;
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

/**
 * The fjord's surface. The eroded valley floor already dips under it in front
 * of the igloo and in the channel behind, so flooding it leaves the igloo on
 * its shelf with open water around — no re-bake needed.
 */
export const WATER_Y = 12;

// Shore shaping: ground near the waterline is pushed away from it, up into a
// low shelf or down under the surface, so the land meets the water with a
// short drop — the edge of sea ice — rather than a long wet slope.
const SHORE_CENTRE = WATER_Y - 0.3;
const SHORE_LIFT = 0.6;
const SHORE_EDGE = 1.8;
const SHORE_REACH = 3;

function shore(h) {
  const t = h - SHORE_CENTRE;
  if (Math.abs(t) > SHORE_REACH * 3) return h;
  const envelope = Math.exp(-(t * t) / (SHORE_REACH * SHORE_REACH));
  return h + SHORE_LIFT * Math.tanh(t / SHORE_EDGE) * envelope;
}

/**
 * The igloo's island: a flat, ragged floe of land a little wider than it is
 * deep, with open sea all round it — in front, and behind it back to the
 * ranges — before the hills rise again further out.
 */
const ISLAND_AT = [-22, 258];
const ISLAND_RX = 62;
const ISLAND_RZ = 44;
const ISLAND_EDGE = 0.16; // of a radius: how quickly land gives way to sea
const SEA_REACH = [200, 280];

function islandSea(x, z, h) {
  const dx = x - ISLAND_AT[0];
  const dz = z - ISLAND_AT[1];
  const dist = Math.hypot(dx, dz);
  if (dist > SEA_REACH[1]) return h;
  const a = Math.atan2(dz, dx);
  // Broken outline: broad lobes, and a finer jag along the edge.
  const lobes =
    1 +
    noise(Math.cos(a) * 1.1 + 3.7, Math.sin(a) * 1.1 - 1.9) * 0.14 +
    noise(Math.cos(a) * 4.3 - 6.2, Math.sin(a) * 4.3 + 2.4) * 0.05;
  const e = Math.hypot(dx / ISLAND_RX, dz / ISLAND_RZ) / lobes;
  const k = smoothstep(1, 1 + ISLAND_EDGE, e) * (1 - smoothstep(SEA_REACH[0], SEA_REACH[1], dist));
  if (k <= 0) return h;
  // An uneven bed, shallow in places, so a few low ice islets stand in it.
  const bed = WATER_Y - 4 + noise(x * 0.028 + 7.1, z * 0.028 - 3.3) * 3;
  return h + (Math.min(h, bed) - h) * k;
}

/**
 * The igloo stands on a low shelf of sea ice rather than a hill: land around
 * it is pressed down to a few units above the water, keeping only a trace of
 * its relief, so from the water it reads as a flat slab with a short edge.
 */
const SHELF_TOP = WATER_Y + 1.2;
const SHELF_KEEP = 0.12;

function shelf(x, z, h) {
  if (h <= SHELF_TOP) return h;
  const d = Math.hypot(x - MOUND_AT[0], z - MOUND_AT[1]);
  const k = 1 - smoothstep(105, 150, d);
  if (k <= 0) return h;
  const pressed = SHELF_TOP + (h - SHELF_TOP) * SHELF_KEEP;
  return h + (pressed - h) * k;
}

/**
 * A valley cut through the far ranges on the sun's bearing from the opening
 * view, so the sun goes down low between two ranges instead of behind one.
 * Measured from where the opening camera stands.
 */
export const VALLEY_FROM = [22, 362];
export const VALLEY_U = 0.265;
const VALLEY_AZIMUTH = (VALLEY_U - 0.5) * 2 * Math.PI;
const VALLEY_CORE = 0.04; // radians either side at full depth
const VALLEY_EDGE = 0.24; // radians where the flanks rejoin the range

function valley(x, z, h) {
  const dx = x - VALLEY_FROM[0];
  const dz = z - VALLEY_FROM[1];
  const dist = Math.hypot(dx, dz);
  if (dist < 380 || h <= WATER_Y) return h;
  let off = Math.abs(Math.atan2(dz, dx) - VALLEY_AZIMUTH);
  if (off > Math.PI) off = 2 * Math.PI - off;
  if (off > VALLEY_EDGE) return h;
  const k = (1 - smoothstep(VALLEY_CORE, VALLEY_EDGE, off)) * smoothstep(380, 700, dist);
  // Pressed toward a low floor that rises gently with distance.
  const floor = WATER_Y + 6 + dist * 0.012;
  return h + (Math.min(h, floor + (h - floor) * 0.12) - h) * k;
}

/**
 * Crags: the eroded ranges come out of the bake smooth and rounded, so their
 * upper slopes get ridged noise on top — sharp crests, gullies and broken
 * buttresses — growing with height so the valley floors stay smooth.
 */
const CRAG_FROM = 45;
const CRAG_FULL = 170;

function crags(x, z, h) {
  if (h < CRAG_FROM) return h;
  const k = smoothstep(CRAG_FROM, CRAG_FULL, h);
  let sum = 0;
  let amp = 1;
  let freq = 0.0042;
  let norm = 0;
  for (let i = 0; i < 3; i += 1) {
    // A rounded crease (soft |v|) so crests are ridges, not knife edges.
    const v = noise(x * freq + i * 17.3, z * freq - i * 9.1);
    const n = 1 - Math.sqrt(v * v + 0.007);
    sum += n * n * amp;
    norm += amp;
    amp *= 0.4;
    freq *= 2.1;
  }
  // Relief grows with height, but only so far: on the tall back ranges it
  // would otherwise stand up as a row of spikes along the skyline.
  return h + (sum / norm - 0.42) * k * Math.min(h * 0.3, 62);
}

/**
 * Glacier fronts: away from the igloo's island, wherever land rises out of
 * the frozen fjord it does so as a wall of ice — the ground steps up almost
 * sheer from the waterline to a snowy terrace, then carries on up the range.
 * The terrain shader colours the wall as blue ice (see the glacier block in
 * environment/Terrain.jsx).
 */
const FRONT_FROM = [190, 280]; // distance from the igloo it grows in over
const FRONT_HEIGHT = 22;
const FRONT_STEP = [WATER_Y + 0.4, WATER_Y + 1.6];

function glacierFront(x, z, h) {
  if (h <= FRONT_STEP[0]) return h;
  const d = Math.hypot(x - MOUND_AT[0], z - MOUND_AT[1]);
  const k = smoothstep(FRONT_FROM[0], FRONT_FROM[1], d);
  if (k <= 0) return h;
  // Taller and shorter along its length, with a broken top edge.
  const tall =
    FRONT_HEIGHT *
    (0.7 + 0.45 * noise(x * 0.006 + 2.3, z * 0.006 - 7.1) + 0.12 * noise(x * 0.05, z * 0.05));
  // Full lift just above the waterline, easing off up the slopes so the
  // ranges above keep their own shape.
  const lift = smoothstep(FRONT_STEP[0], FRONT_STEP[1], h) * (1 - smoothstep(60, 160, h));
  return h + tall * lift * k;
}

/**
 * The land behind the igloo: a snowfield running from the island's back edge
 * up to the foot of the ranges, so the igloo stands on the shore of the ranges
 * rather than on an island. It fans out as it goes back, and stops short of
 * the sun's valley on the right so the frozen fjord still reaches toward it.
 * Returns how much of the snowfield is here (0..1) alongside the height.
 */
const BACK_X = [-240, 10]; // fully snowfield between these
const BACK_FADE = [90, 60]; // fading out over this much further left / right

function backland(x, z, h) {
  const behind = MOUND_AT[1] - z;
  if (behind < -20) return [h, 0];
  const spread = Math.max(0, behind) * 0.25;
  const left = smoothstep(BACK_X[0] - spread - BACK_FADE[0], BACK_X[0] - spread, x);
  const right = 1 - smoothstep(BACK_X[1], BACK_X[1] + BACK_FADE[1], x);
  const w = smoothstep(-20, 20, behind) * left * right;
  if (w <= 0) return [h, 0];
  // Rising gently toward the ranges, rolling a little.
  const target =
    WATER_Y + 1.4 + Math.max(0, behind) * 0.035 + noise(x * 0.012 + 4.4, z * 0.012 - 2.2) * 1.6;
  return [h + Math.max(0, target - h) * w, w];
}

// Resolves final ground height including igloo pad and drift banking
export function heightAt(x, z) {
  const [h, back] = backland(x, z, shelf(x, z, islandSea(x, z, crags(x, z, valley(x, z, padded(x, z))))));
  const shored = shore(h);
  // No ice wall across the snowfield itself.
  return shored + (glacierFront(x, z, shored) - shored) * (1 - back);
}

function padded(x, z) {
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

/**
 * heightAt() over the terrain mesh's own vertices, worked out once. Everything
 * else that needs the ground over a wide area (the water's depth map, the
 * mist, the floes, the scatter) samples this instead of calling heightAt()
 * again, which made up most of the time spent building the world.
 */
const GRID_SEGMENTS = 512;
const GRID_N = GRID_SEGMENTS + 1;
const GRID_STEP = TERRAIN_SIZE / GRID_SEGMENTS;
const GRID_X0 = -TERRAIN_SIZE / 2;
const GRID_Z0 = TERRAIN_CENTER_Z - TERRAIN_SIZE / 2;
let grid = null;

function heightGrid() {
  if (grid) return grid;
  const data = new Float32Array(GRID_N * GRID_N);
  for (let j = 0; j < GRID_N; j += 1) {
    for (let i = 0; i < GRID_N; i += 1) {
      data[j * GRID_N + i] = heightAt(GRID_X0 + i * GRID_STEP, GRID_Z0 + j * GRID_STEP);
    }
  }
  grid = data;
  return grid;
}

/**
 * The ground as the terrain mesh draws it: bilinear between its vertices.
 * Cheap; falls back to heightAt() off the edge of the mesh.
 */
export function groundAt(x, z) {
  const gx = (x - GRID_X0) / GRID_STEP;
  const gz = (z - GRID_Z0) / GRID_STEP;
  if (gx < 0 || gz < 0 || gx >= GRID_N - 1 || gz >= GRID_N - 1) return heightAt(x, z);
  const data = heightGrid();
  const i = Math.floor(gx);
  const j = Math.floor(gz);
  const fx = gx - i;
  const fz = gz - j;
  const a = data[j * GRID_N + i];
  const b = data[j * GRID_N + i + 1];
  const c = data[(j + 1) * GRID_N + i];
  const d = data[(j + 1) * GRID_N + i + 1];
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
}

// Generates displaced terrain mesh geometry
export function buildTerrainGeometry(segments = 512, centerZ = TERRAIN_CENTER_Z) {
  const geometry = new PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, centerZ);

  const pos = geometry.attributes.position;
  // The usual mesh sits exactly on the cached grid, vertex for vertex.
  const cached = segments === GRID_SEGMENTS && centerZ === TERRAIN_CENTER_Z ? heightGrid() : null;
  for (let i = 0; i < pos.count; i += 1) {
    if (cached) {
      pos.setY(i, cached[i]);
      continue;
    }
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
  }

  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
