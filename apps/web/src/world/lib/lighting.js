// Lighting presets and color definitions for the 3D environment

// Default overcast arctic lighting preset
export const BRIGHT = {
  sky: {
    zenith: [0x52, 0x64, 0x7a],
    azure: [0x74, 0x86, 0x9a],
    haze: [0x9e, 0xae, 0xbe],
  },
  sun: [0.235, 0.88],

  aurora: {
    enabled: false,
    core: [0xb4, 0xff, 0xf0],
    deep: [0x38, 0xa8, 0xc0],
    strength: 1.35,
    base: 0.0,
    top: 0.30,
    envGain: 1.4,
  },

  paintedCloud: { enabled: false, color: [0xfd, 0xfe, 0xff] },

  clouds: {
    lit: [0xdc, 0xe6, 0xf0],
    shade: [0x64, 0x74, 0x86],
    coverage: 0.52,
    softness: 0.22,
    opacity: 0.95,
    speed: [0.18, 0.11, 0.06],
    scale: [0.45, 0.95, 2.0],
    horizonFade: 0.04,
  },

  env: { ground: [0xd8, 0xe2, 0xec], sunU: 0.235, sunV: 0.44 },
  fog: { color: '#dde6ef', density: 0.0 },
  rock: { slope: [0.80, 0.94], zone: [150, 320] },

  ambient: { color: '#c4d6e8', intensity: 0.26 },
  hemi: { sky: '#d6e6f6', ground: '#f0f5fa', intensity: 0.85 },
  key: { position: [95, 165, -170], color: '#fff6ed', intensity: 4.2 },

  alpen: {
    enabled: false,
    color: [1.0, 0.58, 0.31],
    intensity: 1.9,
    floor: 190,
    full: 330,
    direction: [0.86, 0.2, -0.47],
    focus: 2.6,
  },

  mist: { color: [0.98, 0.99, 1.0], density: 0.0035, height: 48, base: 14, gain: 0.45 },
  igloo: {
    glow: '#ffaa44',
    strength: 0.95,
    lamp: { color: '#ffaa44', intensity: 850 },
    porch: { color: '#ffa034', intensity: 650 },
  },
  particles: false,
  heatHaze: false,
  snow: { normalScale: 0.18 },

  grade: {
    exposure: 0.96,
    bloom: { intensity: 1.1, threshold: 0.82, smoothing: 0.25 },
    vignette: { offset: 0.38, darkness: 0.30 },
  },
};

// Alternative daylight lighting preset
export const DAY = {
  sky: {
    zenith: [0x14, 0x3a, 0x84],
    azure: [0x3c, 0x6c, 0xb0],
    haze: [0xb4, 0xcb, 0xe3],
  },
  sun: [0.3068, 0.767],
  paintedCloud: { enabled: true, color: [252, 253, 255] },
  env: { ground: [0xd2, 0xd8, 0xe2], sunU: 0.3068, sunV: 0.383 },
  fog: { color: '#a6c0dc', density: 0.0006 },
  ambient: { color: '#8fa9c8', intensity: 0.04 },
  hemi: { sky: '#5384c6', ground: '#cbd5e3', intensity: 0.40 },
  key: { position: [101, 111, -272], color: '#fff6ec', intensity: 11.8 },
  mist: { color: [0.94, 0.96, 0.99], density: 0.0007, height: 70, base: 14, gain: 0.4 },
  igloo: {
    glow: '#eaf4ff',
    strength: 0.65,
    lamp: { color: '#ffdfb2', intensity: 750 },
    porch: { color: '#ffe6c4', intensity: 380 },
  },
  grade: {
    exposure: 0.82,
    bloom: { intensity: 1.15, threshold: 0.8, smoothing: 0.28 },
    vignette: { offset: 0.26, darkness: 0.52 },
  },
};

/**
 * Unit vector toward a sun given as equirect [u, v], where v runs 0 at the
 * zenith to 1 at the horizon — the convention Sky and Clouds paint with.
 */
export function sunVector([u, v]) {
  const azimuth = (u - 0.5) * 2 * Math.PI;
  const elevation = (1 - v) * (Math.PI / 2);
  return [
    Math.cos(elevation) * Math.cos(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.sin(azimuth),
  ];
}

// Low in the valley right of the opening view (see valley() in terrain.js).
const SUNSET_SUN = [0.265, 0.945];
const SUNSET_DIR = sunVector(SUNSET_SUN);

// Golden hour over the fjord: indigo overhead, violet haze, the sun going
// down behind the right-hand range and everything it touches turning amber.
export const SUNSET = {
  ...BRIGHT,
  sky: {
    zenith: [0x22, 0x30, 0x6e],
    azure: [0x4e, 0x58, 0x9a],
    haze: [0x96, 0x94, 0xc4],
    // Sunward glow: colour at the sun's bearing, how wide it spreads (radians
    // of azimuth) and how much of the sky's height it climbs.
    glow: [0xff, 0x8e, 0x44],
    glowWidth: 0.62,
    glowHeight: 0.26,
    glowStrength: 1.0,
  },
  sun: SUNSET_SUN,
  sunColor: [255, 214, 140],

  clouds: {
    lit: [0xa8, 0x90, 0xb8],
    shade: [0x3c, 0x38, 0x6c],
    glow: [0xff, 0x80, 0x3c],
    coverage: 0.56,
    softness: 0.14,
    opacity: 1,
    speed: [0.12, 0.08, 0.05],
    scale: [1.1, 2.4, 5.2],
    stretch: 4,
    horizonFade: 0.06,
  },

  env: { ground: [0x8e, 0x96, 0xb4], sunU: SUNSET_SUN[0], sunV: 0.43 },
  fog: { color: '#b3a6c6', density: 0.0 },
  rock: { slope: [0.66, 0.88], zone: [150, 320] },
  // Aerial perspective the far ranges fade into.
  haze: [0.62, 0.62, 0.82],
  hazeAmount: 0.12,

  ambient: { color: '#a8b6e0', intensity: 0.18 },
  hemi: { sky: '#d6e0fa', ground: '#8494bc', intensity: 0.9 },
  key: {
    position: SUNSET_DIR.map((c) => c * 320),
    color: '#ffb066',
    intensity: 5.2,
  },

  // A soft fill from the camera's side. The sun is low behind the scene, so
  // the flat snow facing the viewer would otherwise get almost no light.
  fill: { position: [-140, 170, 460], color: '#e2e8ff', intensity: 1.35 },

  alpen: {
    enabled: true,
    color: [1.0, 0.56, 0.32],
    intensity: 0.55,
  },

  mist: { color: [0.92, 0.86, 0.9], density: 0.0022, height: 48, base: 14, gain: 0.4, amount: 0.04 },
  igloo: {
    glow: '#ffa040',
    strength: 1.15,
    lamp: { color: '#ffa844', intensity: 1150 },
    porch: { color: '#ff9c38', intensity: 950 },
  },
  snow: { normalScale: 0.22 },

  water: {
    deep: [0.004, 0.022, 0.055],
    shallow: [0.015, 0.075, 0.1],
    reflect: 0.9,
  },

  // The sun as a bright disc in the sky (HDR, so it blooms), and its halo.
  sunDisc: { radius: 1.25, core: 16, halo: 2.4, haloWidth: 7 },

  grade: {
    exposure: 1.06,
    bloom: { intensity: 1.1, threshold: 0.82, smoothing: 0.25 },
    vignette: { offset: 0.3, darkness: 0.34 },
  },
};

// A clear afternoon going gold: pale blue overhead, the sun low in the valley
// on the right, white ranges with blue shadows and glacier ice at their feet,
// and the fjord frozen over.
const GLACIER_SUN = [0.265, 0.93];
const GLACIER_DIR = sunVector(GLACIER_SUN);

export const GLACIER = {
  ...SUNSET,
  sky: {
    zenith: [0x2c, 0x5c, 0xae],
    azure: [0x78, 0xa2, 0xd8],
    haze: [0xdc, 0xe6, 0xf2],
    glow: [0xff, 0xdc, 0xa8],
    glowWidth: 0.3,
    glowHeight: 0.12,
    glowStrength: 0.75,
  },
  sun: GLACIER_SUN,
  sunColor: [255, 232, 186],

  clouds: {
    lit: [0xfa, 0xfb, 0xfd],
    shade: [0x9c, 0xb0, 0xd0],
    glow: [0xff, 0xe2, 0xb4],
    coverage: 0.6,
    softness: 0.16,
    opacity: 0.8,
    speed: [0.1, 0.07, 0.04],
    scale: [1.1, 2.4, 5.2],
    stretch: 4,
    horizonFade: 0.06,
  },

  env: { ground: [0xe2, 0xea, 0xf4], sunU: GLACIER_SUN[0], sunV: 0.43 },
  fog: { color: '#dbe5f0', density: 0.0 },
  rock: { slope: [0.5, 0.7], zone: [150, 320], show: 0.55, tone: [0.3, 0.34, 0.42] },
  haze: [0.8, 0.86, 0.94],
  hazeAmount: 0.2,

  ambient: { color: '#c8d8f0', intensity: 0.2 },
  hemi: { sky: '#e4eefc', ground: '#c4d2e6', intensity: 1.2 },
  key: {
    position: GLACIER_DIR.map((c) => c * 320),
    color: '#fff0da',
    intensity: 4.6,
  },
  fill: { position: [-140, 170, 460], color: '#f2f6ff', intensity: 2.1 },

  alpen: {
    enabled: true,
    color: [1.0, 0.8, 0.55],
    intensity: 0.16,
  },

  // Blue ice on the steep lower faces of the ranges: the glacier fronts.
  glacier: { light: [0.62, 0.8, 0.95], deep: [0.3, 0.52, 0.76], amount: 0.9 },

  // Drifting snow carried on the breeze.
  mist: { color: [0.96, 0.98, 1.0], density: 0.0022, height: 48, base: 14, gain: 0.4, amount: 0.13 },
  snow: { normalScale: 0.24 },

  // The fjord frozen over, with open water only in a lead along the dock.
  water: {
    deep: [0.01, 0.045, 0.08],
    shallow: [0.03, 0.11, 0.15],
    reflect: 0.9,
  },
  ice: {
    color: [0.46, 0.6, 0.76],
    deep: [0.24, 0.38, 0.56],
    snow: [0.9, 0.93, 0.97],
    reflect: 0.8,
  },

  sunDisc: { radius: 1.1, core: 18, halo: 2.8, haloWidth: 6 },

  grade: {
    exposure: 1.02,
    bloom: { intensity: 1.0, threshold: 0.86, smoothing: 0.25 },
    vignette: { offset: 0.34, darkness: 0.26 },
  },
};

// Early morning over the frozen fjord: the sun just clear of the valley floor,
// peach and gold along the horizon under a pale morning blue, rose light on
// the peaks and cool blue shade everywhere the sun has not reached yet.
const SUNRISE_SUN = [0.265, 0.955];
const SUNRISE_DIR = sunVector(SUNRISE_SUN);

export const SUNRISE = {
  ...GLACIER,
  sky: {
    zenith: [0x26, 0x4e, 0x96],
    azure: [0x6e, 0x94, 0xc8],
    // Dusty rose round the horizon; the orange belongs to the sun's side.
    haze: [0xd6, 0xbc, 0xc4],
    glow: [0xff, 0x96, 0x44],
    glowWidth: 0.95,
    glowHeight: 0.26,
    glowStrength: 1.0,
  },
  sun: SUNRISE_SUN,
  sunColor: [255, 190, 110],

  // Broken cloud across the sky, lit gold from beneath near the sun and
  // slate-blue in its own shade.
  clouds: {
    lit: [0xff, 0xd6, 0xb0],
    shade: [0x6a, 0x74, 0x9a],
    glow: [0xff, 0x94, 0x48],
    coverage: 0.46,
    softness: 0.14,
    opacity: 0.95,
    speed: [0.1, 0.07, 0.04],
    scale: [1.1, 2.4, 5.2],
    stretch: 4,
    horizonFade: 0.06,
  },

  env: { ground: [0xe0, 0xe2, 0xee], sunU: SUNRISE_SUN[0], sunV: 0.43 },
  fog: { color: '#e6e0ea', density: 0.0 },
  // Aerial perspective: the far ranges fall back into cool blue air.
  haze: [0.76, 0.83, 0.95],
  hazeAmount: 0.34,

  // Less sky fill and ambient than before, so what the low sun does not
  // reach stays cool blue against its gold: the contrast of first light.
  ambient: { color: '#a8bce6', intensity: 0.1 },
  hemi: { sky: '#c8d8f6', ground: '#9aaed4', intensity: 0.7 },
  key: {
    position: SUNRISE_DIR.map((c) => c * 320),
    color: '#ffac5c',
    intensity: 6.6,
  },
  fill: { position: [-140, 170, 460], color: '#dfe6ff', intensity: 1.3 },

  // Rocky ranges: dark stone showing on every steep face, snow on the rest.
  // Full snow on the ranges: no rock showing through it.
  rock: { slope: [0.62, 0.84], zone: [150, 320], show: 0, tone: [0.034, 0.031, 0.036] },

  // First light catching the high snow rose-gold.
  alpen: {
    enabled: true,
    color: [1.0, 0.6, 0.42],
    intensity: 0.62,
  },

  // Morning mist lying low on the fjord and along the feet of the ranges,
  // warm where the sun catches it.
  mist: { color: [1.0, 0.95, 0.92], density: 0.0024, height: 48, base: 14, gain: 0.4, amount: 0.17 },

  // Blue glacial ice for the igloo's blocks, and the fire inside it.
  iglooTint: '#88acdc',
  igloo: {
    glow: '#ff8a2a',
    strength: 1.4,
    lamp: { color: '#ff9030', intensity: 1600 },
    porch: { color: '#ff8424', intensity: 1400 },
  },

  // A large low sun, hot at the core, in a wide golden halo.
  sunDisc: { radius: 1.3, core: 30, halo: 1.6, haloWidth: 7 },

  // Darker, glossier ice in the foreground for depth under the bright sky.
  ice: {
    color: [0.3, 0.45, 0.64],
    deep: [0.12, 0.23, 0.4],
    snow: [0.9, 0.94, 0.99],
    reflect: 0.9,
  },
  // The open water in front: deep and dark, a mirror for the sky and sun.
  water: {
    deep: [0.006, 0.03, 0.075],
    shallow: [0.012, 0.06, 0.11],
    reflect: 0.78,
  },
  snow: { normalScale: 0.45 },

  grade: {
    exposure: 0.94,
    bloom: { intensity: 1.0, threshold: 0.95, smoothing: 0.2 },
    vignette: { offset: 0.3, darkness: 0.44 },
    // Photographic finish: a firmer curve, a touch more colour, fine grain.
    contrast: 0.16,
    saturation: 0.14,
    grain: 0.035,
  },
};

// Pure cinematic snow and diffuse blue-white daylight preset matching reference image
export const ARCTIC_HERO = {
  sky: {
    zenith: [0xd2, 0xe0, 0xf0],
    azure: [0xdd, 0xe8, 0xf5],
    haze: [0xe6, 0xf0, 0xf9],
    glow: null,
  },
  sun: [0.25, 0.45],
  sunColor: [248, 252, 255],
  env: { ground: [0xe2, 0xed, 0xf8], sunU: 0.25, sunV: 0.45 },
  fog: { color: '#e2edf8', density: 0.0012 },
  haze: [0.88, 0.93, 0.98],
  hazeAmount: 0.22,
  ambient: { color: '#d5e6f8', intensity: 0.65 },
  hemi: { sky: '#ecf5fd', ground: '#cfe0f2', intensity: 0.85 },
  key: {
    position: [35, 95, 330],
    color: '#f6faff',
    intensity: 1.85,
  },
  fill: { position: [-120, 65, 200], color: '#d8e8fa', intensity: 0.8 },
  alpen: { enabled: false },
  mist: { color: [0.93, 0.96, 0.99], density: 0.0018, height: 45, base: 8, gain: 0.35, amount: 0.12 },
  iglooTint: '#d8e7f5',
  igloo: {
    glow: '#ffaa44',
    strength: 1.0,
    lamp: { color: '#ff9834', intensity: 1400 },
    porch: { color: '#ffa244', intensity: 1300 },
  },
  snow: { normalScale: 0.22 },
  grade: {
    exposure: 0.98,
    bloom: { intensity: 0.38, threshold: 0.84, smoothing: 0.25 },
    vignette: { offset: 0.32, darkness: 0.28 },
    contrast: 0.04,
    saturation: 0.02,
    grain: 0.0,
  },
};

// Active lighting profile used by scene
export const LOOK = ARCTIC_HERO;

/** Unit vector toward the active look's sun. */
export const SUN_DIR = [0.12, 0.88, 0.45];

// Converts RGB [0-255] to hex string
export const hex = (c) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

// Converts RGB [0-255] to normalized float [0-1]
export const unit = (c) => c.map((v) => v / 255);
