// Every colour and level that decides what hour the scene is set at, in one place.
// They used to live in the file that used them, which meant a look-dev pass had to touch five files to move one stop.

// High key, a white mountain in white air. Scale comes from the dissolve, not contrast, a form that fades has no edge to measure.
// Nearly white sky, heavy haze doing the real work, soft neutral key, nothing saturated. Compressed range is the point.
export const BRIGHT = {
  // Zenith to horizon, nearly inverted against a clear sky, there's so much water that the pale end reaches almost to the top.
  sky: {
    zenith: [0x52, 0x64, 0x7a],
    azure: [0x74, 0x86, 0x9a],
    haze: [0x9e, 0xae, 0xbe],
  },
  sun: [0.235, 0.88],

  // Off. Sky.jsx drives the texture and the env map from one function so the curtain and its cast can't drift, which is worth keeping.
  // An aurora needs a dark sky though, against this one it'd be a green stain across the brightest part of frame.
  aurora: {
    enabled: false,
    core: [0xb4, 0xff, 0xf0],
    deep: [0x38, 0xa8, 0xc0],
    strength: 1.35,
    base: 0.0,
    top: 0.30,
    envGain: 1.4,
  },

  // Off. The sky texture is built once on the CPU, right for a gradient and wrong for weather. Clouds.jsx moves instead.
  paintedCloud: { enabled: false, color: [0xfd, 0xfe, 0xff] },

  // Three layers at three speeds is the whole trick, one scrolling field reads as a texture dragged across the sky.
  // speed is field-widths per second and is tiny, a feature takes about a minute to cross. High softness is most of what makes overcast.
  clouds: {
    lit: [0xdc, 0xe6, 0xf0],
    shade: [0x64, 0x74, 0x86],
    coverage: 0.52,
    softness: 0.22,
    opacity: 0.95, // ceiling, so the dome never fully hides the ramp behind it
    speed: [0.18, 0.11, 0.06],
    scale: [0.45, 0.95, 2.0],
    horizonFade: 0.04, // fades before the skyline so it never fights the terrain's haze
  },

  // Lower half nearly matches the upper, which is what an overcast snowfield is. That's why the reference has no shadows.
  env: { ground: [0xd8, 0xe2, 0xec], sunU: 0.235, sunV: 0.44 },

  // Taken to 0 once and the hills stopped reading as background, full contrast at 600 units out is a cut-out beside the subject.
  // Depth in a still frame isn't geometry, it's contrast lost to distance. Keep colour within a couple of points of sky.haze.
  fog: { color: '#dde6ef', density: 0.0 },

  // Where rock shows through. slope is the window in the normal's Y, zone the distance gate.
  // Solved off photos of Icelandic ranges, what those have isn't more rock but rock in the right places.
  // The near field stays excluded, the drift under the igloo is wind-packed snow with no stone in it.
  rock: { slope: [0.80, 0.94], zone: [150, 320] },

  ambient: { color: '#c4d6e8', intensity: 0.26 }, // floor so crevices aren't black, the IBL does the real work
  hemi: { sky: '#d6e6f6', ground: '#f0f5fa', intensity: 0.85 },
  key: { position: [95, 165, -170], color: '#fff6ed', intensity: 4.2 },

  // Off. It's a sunrise effect and this is flat overcast, which must not have a warm accent on the peaks.
  alpen: {
    enabled: false,
    color: [1.0, 0.58, 0.31],
    intensity: 1.9,
    floor: 190,
    full: 330,
    direction: [0.86, 0.2, -0.47],
    focus: 2.6,
  },

  // The air the reference actually has. Four passes drew shapes, plume, banks, filaments, ribbons, all rejected.
  // There is no shape in it, anything with an outline reads as a graphic laid over the picture.
  // Terrain.jsx's raymarched layer already does it, accumulating along the view ray and pooling in the hollows.
  // height 48 keeps it under the igloo's crown at 56 so it stays ground layer and never reads as weather.
  mist: { color: [0.98, 0.99, 1.0], density: 0.0035, height: 48, base: 14, gain: 0.45 },
  igloo: {
    glow: '#ffaa44',
    strength: 0.95,
    lamp: { color: '#ffaa44', intensity: 850 },
    porch: { color: '#ffa034', intensity: 650 },
  },
  particles: false,

  // Off. A post effect has no position so it bent the igloo and the far ranges equally, and read as a fault in the display.
  heatHaze: false,

  // Dropped from 1.35, which read as frost on a lens. That value was solved under a strong key where a normal map catches and loses it.
  // Flat overcast models nothing by direction, so every perturbation shows at once as texture. The landforms are geometry and untouched.
  snow: { normalScale: 0.18 },

  grade: {
    exposure: 0.96,
    bloom: { intensity: 1.1, threshold: 0.82, smoothing: 0.25 },
    vignette: { offset: 0.38, darkness: 0.30 },
  },
};

// The original daylight set, kept as the record, imported by nothing.
// Key and fill are a pair solved against each other, and sky.haze and fog.color track each other. Restore together or not at all.
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

// The set the scene is built from
export const LOOK = BRIGHT;

// [r,g,b] 0-255 to '#rrggbb'
export const hex = (c) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

// [r,g,b] 0-255 to the 0-1 triple a shader uniform wants
export const unit = (c) => c.map((v) => v / 255);
