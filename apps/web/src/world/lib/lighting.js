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

// Active lighting profile used by scene
export const LOOK = BRIGHT;

// Converts RGB [0-255] to hex string
export const hex = (c) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

// Converts RGB [0-255] to normalized float [0-1]
export const unit = (c) => c.map((v) => v / 255);
