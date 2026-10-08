import { makeNoise2D, makeFbm } from './noise.js';
import { WIND_DIR } from './wind.js';

// Wind-built snow hills for the arctic stage. Each hill in the table keeps its
// place and crown height; what changes is how it is shaped:
//
// - its outline is warped, so no hill is a clean ellipse;
// - it is wind-loaded: the windward side is a long easy rise and the lee side,
//   where the snow is dropped, falls away steeper under a defined crest;
// - its flanks are fluted: shallow gullies running down the fall line, the
//   way snow settles and slides on any real slope.

const noise = makeNoise2D(20261006);
const warpFbm = makeFbm(noise, { octaves: 3, lacunarity: 2.03, persistence: 0.5 });
const fluteFbm = makeFbm(noise, { octaves: 2, lacunarity: 2.1, persistence: 0.4 });

// Snow is carried downwind, so the lee side faces along WIND_DIR.
const [WX, WZ] = WIND_DIR;
const LEE = 1.38; // lee face: shorter, steeper
const WINDWARD = 0.84; // windward face: longer, gentler

// Past this many radii a hill adds nothing worth computing.
const REACH = 3.2;

const smoothstep = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * One shared warp per ground point, scaled per hill by its size, so hills
 * near each other bend the same way, as one snowfield would.
 */
export function hillWarp(x, z) {
  return [warpFbm(x * 0.0036 + 13.1, z * 0.0036 - 4.7), warpFbm(x * 0.0036 - 27.9, z * 0.0036 + 8.3)];
}

/** Height one hill adds at (x, z). `warp` comes from hillWarp(). */
export function hillRise(x, z, m, seed, warp) {
  const ex = (x + warp[0] * m.rx * 0.24 - m.x) / m.rx;
  const ez = (z + warp[1] * m.rz * 0.24 - m.z) / m.rz;

  // Split into along-wind and across-wind, and squeeze the lee half.
  const along = ex * WX + ez * WZ;
  const across = -ex * WZ + ez * WX;
  const a = along * (along > 0 ? LEE : WINDWARD);
  const t = Math.sqrt(a * a + across * across);
  if (t > REACH) return 0;

  // Fuller in the shoulders than a bell curve, with a firmer crown. The tall
  // far ranges come to real summits rather than domes.
  const peak = smoothstep(120, 185, m.h);
  const body = Math.exp(-0.55 * Math.pow(t, 1.7 - 0.45 * peak));

  // Fluting: noise sampled around the hill and only slowly outward, so its
  // features stretch into spokes running straight down every face.
  const theta = Math.atan2(ez, ex);
  // Tall summits get fewer, broader ridges.
  const ring = 2.3 - 1.1 * peak;
  const flute = fluteFbm(
    Math.cos(theta) * ring + t * 0.55 + seed * 7.1,
    Math.sin(theta) * ring - t * 0.4 - seed * 3.3
  );
  // Ridged, so gullies are rounded troughs between ribs; the ribs' crests are
  // rounded too (a soft |x|), so on the coarse far mesh they never come to
  // little spiky teeth.
  const rib = 1 - Math.sqrt(flute * flute + 0.05);
  const flank = body * (1 - body) * 4; // strongest mid-slope, nothing at crown or foot
  const lee = smoothstep(-0.2, 0.6, along);

  // Broken shoulders, so the crest line is not one smooth arc.
  const knobs = warpFbm(ex * 1.4 + seed * 5.3, ez * 1.4 - seed * 2.9) * body * body;

  return m.h * (body + (rib * rib - 0.45) * flank * (0.055 + 0.04 * lee + 0.06 * peak) + knobs * 0.03);
}

/**
 * Low wind drifts on the open snow: long, flat-backed tails stretched along
 * the wind, each ending in a short steeper face. Replaces the old sine waves,
 * which read as rippling cloth.
 */
export function snowDrifts(x, z) {
  const along = x * WX + z * WZ;
  const across = -x * WZ + z * WX;
  // Each drift's face is pushed downwind by its own height: that is what
  // steepens the front and lays the back out long.
  const base = warpFbm(along * 0.006, across * 0.022);
  const pushed = warpFbm((along - base * 30) * 0.006, across * 0.022);
  const fine = fluteFbm(along * 0.02 + 3.1, across * 0.07 - 1.7);
  return pushed * 0.75 + fine * 0.22;
}

/**
 * The hills' surface, laid gently over open ground: broad soft rolls, and on
 * them the same ridged flutes the hills' flanks carry, stretched along the
 * wind. Low and smooth: a few units at most, never lumps.
 */
export function plainTexture(x, z) {
  const along = x * WX + z * WZ;
  const across = -x * WZ + z * WX;
  const roll = warpFbm(along * 0.006 + 21.7, across * 0.011 - 9.3);
  const flute = 1 - Math.abs(fluteFbm(across * 0.035 + 4.1, along * 0.012 - 7.7));
  return roll * 3.4 + (flute * flute - 0.45) * 2.6;
}

const landFbm = makeFbm(noise, { octaves: 3, lacunarity: 2.05, persistence: 0.5 });

/**
 * The land's snow: soft rounded dunes, smooth humps of a few sizes laid on
 * gentle wind-carved waves. No sharp edges, and calm enough to leave clean
 * open snow between them.
 */
export function landRidges(x, z) {
  const along = x * WX + z * WZ;
  const across = -x * WZ + z * WX;
  const wx = warpFbm(x * 0.012 + 3.3, z * 0.012 - 1.7) * 9;
  const wz = warpFbm(x * 0.012 - 8.1, z * 0.012 + 5.2) * 9;
  // Soft rounded profile: a wide smoothstep, then eased again, so every hump
  // has round shoulders and no flat top or hard rim.
  const dune = (v) => {
    const k = Math.min(1, Math.max(0, (v + 0.3) / 0.85));
    const s = k * k * (3 - 2 * k);
    return s * s * (3 - 2 * s);
  };
  const big = dune(warpFbm((x + wx) * 0.017 + 1.3, (z + wz) * 0.019 - 4.1));
  const small = dune(warpFbm((x - wz) * 0.04 + 5.7, (z + wx) * 0.04 - 2.2));
  const wave = warpFbm(across * 0.02 + 7.1, along * 0.007 - 3.3);
  return big * 4.6 + small * 0.9 + wave * 0.6 - 1.8;
}

/** Long, uneven swells joining the far hills into one snowfield. */
export function snowSwell(x, z) {
  // Broader and taller rolls, so the band behind the igloo reads as hills
  // under the mist rather than open plain.
  return (warpFbm(x * 0.0062 + 2.2, z * 0.0075 - 6.4) * 0.5 + 0.5) * 30;
}

// The reference picture's humps, each projected from where its crest sits in
// that frame onto the ground seen from the opening camera ([-34, 21, 382] ->
// [-40, 15, 252], fov 38). x, z centre; h crown; r radius across the view.
const REF_HUMPS = [
  { x: -79, z: 321, h: 11.3, r: 20 },
  { x: -70, z: 310, h: 4.4, r: 10 },
  { x: -61, z: 291, h: 3.1, r: 10 },
  { x: -39, z: 318, h: 2.8, r: 12 },
  { x: -13, z: 317, h: 3.7, r: 10 },
  { x: 4, z: 308, h: 4.1, r: 10 },
  { x: 24, z: 295, h: 4.5, r: 10 },
  { x: 12, z: 270, h: 3.3, r: 13 },
  { x: 35, z: 260, h: 3.8, r: 13 },
  { x: -79, z: 326, h: 3.9, r: 9 },
  { x: -27, z: 327, h: 2.5, r: 12 },
  { x: -81, z: 252, h: 5.2, r: 14 },
  { x: -127, z: 184, h: 5.9, r: 18 },
  { x: -13, z: 288, h: 2.1, r: 10 },
  { x: -84, z: 209, h: 5.8, r: 15 },
  { x: 18, z: 175, h: 4.6, r: 18 },
];

/**
 * Rounded humps at the reference's places: wide across the view, shallower in
 * depth, with round crowns and soft feet. Where two overlap the taller wins,
 * so they read as separate mounds rather than one swollen lump.
 */
export function refHumps(x, z) {
  let top = 0;
  for (const m of REF_HUMPS) {
    const ex = (x - m.x) / (m.r * 1.25);
    const ez = (z - m.z) / (m.r * 0.85);
    const t2 = ex * ex + ez * ez;
    if (t2 > 9) continue;
    top = Math.max(top, m.h * Math.exp(-1.9 * t2));
  }
  return top;
}

const hash2 = (i, j, k) => {
  const v = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * The field of separate snow mounds the reference is covered in: one rounded
 * mound per cell at a random spot and size, so they never line up. Each is
 * steeper on its lee (camera-facing, away-from-light) side, so it has a lit
 * crown and a shaded face, with hollows left between them.
 */
export function snowMounds(x, z) {
  // Outlines bent by a shared warp, so no mound is a clean oval.
  const wx = x + warpFbm(x * 0.05 + 4.1, z * 0.05 - 2.3) * 4.5;
  const wz = z + warpFbm(x * 0.05 - 7.7, z * 0.05 + 1.9) * 3.0;
  const cell = 17;
  const ci = Math.floor(wx / cell);
  const cj = Math.floor(wz / cell);
  let top = 0;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const i = ci + di;
      const j = cj + dj;
      const cx = (i + 0.1 + 0.8 * hash2(i, j, 1)) * cell;
      const cz = (j + 0.1 + 0.8 * hash2(i, j, 2)) * cell;
      // Mostly middling, now and then a big one.
      const k = hash2(i, j, 3);
      const size = 0.45 + 0.55 * k + 0.6 * k * k * k;
      const h = (2.6 + 3.4 * hash2(i, j, 4)) * size;
      const rx = cell * 0.75 * size * (1.0 + 0.7 * hash2(i, j, 5));
      const rz = cell * 0.38 * size;
      const ex = (wx - cx) / rx;
      let ez = (wz - cz) / rz;
      // Lee side faces the lens (+z): shorter and steeper.
      if (ez > 0) ez *= 1.8;
      const t2 = ex * ex + ez * ez;
      if (t2 > 6) continue;
      // Firmer crown than a bell: wind-cut, not a bubble.
      top = Math.max(top, h * Math.exp(-1.5 * Math.pow(t2, 0.8)));
    }
  }
  // Small wind-scoured roughness on every surface.
  const grain = fluteFbm(x * 0.16 + 9.1, z * 0.22 - 3.7) * 0.35;
  return top + grain;
}
