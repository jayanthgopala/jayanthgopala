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
    horizonFade: 0.03,
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

// Active lighting profile used by scene
export const LOOK = SUNSET;

/** Unit vector toward the active look's sun. */
export const SUN_DIR = sunVector(LOOK.sun);

// Converts RGB [0-255] to hex string
export const hex = (c) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

// Converts RGB [0-255] to normalized float [0-1]
export const unit = (c) => c.map((v) => v / 255);
