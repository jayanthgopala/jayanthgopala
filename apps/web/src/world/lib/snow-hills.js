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
  const body = Math.exp(-0.55 * Math.pow(t, 1.7 - 0.3 * peak));

  // Fluting: noise sampled around the hill and only slowly outward, so its
  // features stretch into spokes running straight down every face.
  const theta = Math.atan2(ez, ex);
  const ring = 2.3;
  const flute = fluteFbm(
    Math.cos(theta) * ring + t * 0.55 + seed * 7.1,
    Math.sin(theta) * ring - t * 0.4 - seed * 3.3
  );
  // Ridged, so gullies are rounded troughs between sharper ribs.
  const rib = 1 - Math.abs(flute);
  const flank = body * (1 - body) * 4; // strongest mid-slope, nothing at crown or foot
  const lee = smoothstep(-0.2, 0.6, along);

  // Broken shoulders, so the crest line is not one smooth arc.
  const knobs = warpFbm(ex * 1.4 + seed * 5.3, ez * 1.4 - seed * 2.9) * body * body;

  return m.h * (body + (rib * rib - 0.45) * flank * (0.055 + 0.04 * lee + 0.03 * peak) + knobs * 0.03);
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

/** Long, uneven swells joining the far hills into one snowfield. */
export function snowSwell(x, z) {
  return (warpFbm(x * 0.0042 + 2.2, z * 0.005 - 6.4) * 0.5 + 0.5) * 13;
}
