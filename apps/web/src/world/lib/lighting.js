/**
 * THE LOOK, IN ONE PLACE.
 *
 * Every colour and level that decides what hour this scene is set at used to
 * live in the file that consumed it: the sky ramp in Sky.jsx, the key in
 * Atmosphere.jsx, the mist in Terrain.jsx, the lantern in IglooBlocks.jsx, the
 * grade in Stage.jsx. That is the right place for a constant belonging to one
 * system and the wrong place for one belonging to a TIME OF DAY, because a time
 * of day is a single decision expressed in five files at once — and a look-dev
 * pass that has to touch five files to move one stop is a pass that does not
 * get done.
 *
 * So the values move here and the consumers import them. Nothing else changes:
 * each still owns its own construction, its own shader, and its own argument
 * about why it is built the way it is. What it no longer owns is the hour.
 *
 * WHY DAY IS STILL HERE. Almost every number in it is the result of a
 * MEASUREMENT rather than a preference — the notes in Atmosphere.jsx and
 * Stage.jsx record luminance percentiles sampled against a reference and solved
 * term by term. Changing the look invalidates those VALUES and none of the
 * REASONING. They cost a few hundred bytes and they are kept.
 */

/**
 * HIGH KEY. A WHITE MOUNTAIN IN WHITE AIR.
 *
 * The reference is a photograph with almost no dark end: a snow peak standing in
 * heavy haze under a sky within a few points of paper, everything modelled in
 * pale blue-greys, and the foot of the mountain dissolving into the air rather
 * than meeting a horizon. It is the opposite of a dramatic frame and that is the
 * whole appeal — the scale comes from the DISSOLVE, not from contrast, because a
 * form that fades out has no edge for the eye to measure and so could be any
 * size at all.
 *
 * FOUR THINGS MAKE IT, AND THREE ARE THE OPPOSITE OF THE USUAL ADVICE.
 *
 *   1. THE SKY IS NEARLY WHITE. Not a blue sky brightened — a genuinely pale,
 *      barely-tinted field, coolest at the zenith, near paper at the horizon.
 *   2. THE HAZE IS HEAVY. Density nearly double the daylight value. This is the
 *      term doing the real work: it eats the base of every ridge and turns
 *      distance into white rather than into blue.
 *   3. THE KEY IS SOFT AND NEUTRAL. There is no warm light in the reference and
 *      no hard-edged shadow either. The sun is behind cloud, so the key comes
 *      down and the sky fill goes up — modelling survives as gentle blue-grey
 *      shading in the gullies rather than as light-and-dark.
 *   4. NOTHING IS SATURATED. Every colour sits in a narrow band of cool
 *      near-neutrals. The one blue in the picture is the shadow side of snow.
 *
 * WHAT THIS COSTS: contrast, deliberately. The daylight set was solved to reach
 * a p10-to-p90 luminance spread of about 120 against a reference with hard sun.
 * This look does not want that and could not have it — a white-out has a
 * compressed range by definition, and pushing the key to open it back up is
 * exactly what would break the effect.
 */
export const BRIGHT = {
  /*
   * THE SKY RAMP, zenith to horizon.
   *
   * INVERTED AGAINST A CLEAR-SKY SET, or nearly. In clear air the zenith is the
   * deepest blue and the horizon the palest, because the horizon is seen through
   * the most air. Still true — there is just so much water in this air that the
   * pale end has arrived almost at the top of the dome. End to end the whole
   * ramp is about thirty luminance points.
   */
  sky: {
    zenith: [0x52, 0x64, 0x7a],
    azure: [0x74, 0x86, 0x9a],
    haze: [0x9e, 0xae, 0xbe],
  },
  sun: [0.235, 0.88],

  /*
   * THE AURORA, SWITCHED OFF.
   *
   * KEPT RATHER THAN DELETED, and behind one flag rather than commented out.
   * The generator in Sky.jsx is real work — periodic shafts evaluated by both
   * the background texture and the environment map from ONE function, so the
   * curtain in the sky and the cast it puts on the snow can never drift apart.
   * That is the hard part and it is worth more than the twenty lines it takes.
   * `enabled: false` costs one branch per pixel at texture build time, which
   * happens once at startup.
   *
   * It has no place in THIS look. An aurora needs a dark sky to be seen against;
   * this sky is nearly white, so the curtain would be either invisible or —
   * pushed until it was not — a green stain across the brightest part of the
   * frame. The two ideas are mutually exclusive rather than merely different,
   * which is why this is a flag and not a level.
   */
  aurora: {
    enabled: false,
    core: [0xb4, 0xff, 0xf0],
    deep: [0x38, 0xa8, 0xc0],
    strength: 1.35,
    base: 0.0,
    top: 0.30,
    envGain: 1.4,
  },

  /*
   * THE PAINTED CLOUD FIELD IN THE SKY TEXTURE, SWITCHED OFF.
   *
   * It cannot move. The texture is generated once on the CPU and uploaded, which
   * is exactly right for a gradient and exactly wrong for weather — animating it
   * would mean re-running a 1024x512 noise field and a texture upload every
   * frame, on the main thread, to move something a few pixels.
   *
   * Clouds.jsx replaces it: the same kind of field, evaluated per fragment on
   * the GPU against a clock, on a dome around the camera. See `clouds` below.
   * The painted version stays switched off rather than deleted because the sky
   * texture still needs a cloud term if the dome is ever removed.
   */
  paintedCloud: { enabled: false, color: [0xfd, 0xfe, 0xff] },

  /*
   * THE MOVING CLOUD DOME.
   *
   * THREE LAYERS AT THREE SPEEDS, WHICH IS THE WHOLE TRICK. One scrolling noise
   * field reads as a texture being dragged across the sky — every feature moves
   * at the same rate in the same direction, which nothing in the atmosphere does.
   * Three fields at different scales and different speeds shear against each
   * other continuously, so the SHAPES change as well as their positions, and
   * that is what separates weather from a moving wallpaper.
   *
   * `speed` is in field-widths per second and is deliberately tiny. Cloud that
   * moves at a speed you can watch is cloud in a timelapse; at this rate a
   * feature takes about a minute to cross the frame, which reads as still until
   * you look away and back.
   *
   * `coverage` is the fraction of sky the field is thresholded to cover, and
   * `softness` how wide the ramp at a cloud's edge is. High softness is most of
   * what makes overcast: hard edges would give distinct clouds in a clear sky,
   * which is a different weather from the one in the reference.
   */
  clouds: {
    lit: [0xdc, 0xe6, 0xf0],
    shade: [0x64, 0x74, 0x86],
    coverage: 0.52,
    softness: 0.22,
    /** Overall alpha ceiling, so the dome never fully hides the ramp behind it. */
    opacity: 0.95,
    speed: [0.18, 0.11, 0.06],
    scale: [0.45, 0.95, 2.0],
    /** Below this height above the horizon the dome fades out, so it never
        crosses the skyline and fights the terrain's own haze. */
    horizonFade: 0.04,
  },

  /*
   * SNOW BOUNCE IN THE ENVIRONMENT MAP.
   *
   * The lower half of the IBL, and in a white-out it is nearly the same value as
   * the upper half. Not laziness — it is what an overcast snowfield IS. Light
   * arrives from every direction having bounced between a white ground and a
   * white sky several times, which is precisely why there are no shadows in the
   * reference and why the modelling is so soft.
   */
  env: { ground: [0xd8, 0xe2, 0xec], sunU: 0.235, sunV: 0.44 },

  /*
   * DISTANCE HAZE, AND THIS IS THE TERM THAT MAKES THE PICTURE.
   *
   * Density is nearly double the daylight 0.0006. Every other set treats haze as
   * something to be controlled so the far ranges stay readable; here it is the
   * SUBJECT. The reference's mountain has no visible base — it fades into the
   * air somewhere around its own foot — and that dissolve is what gives it its
   * scale, because a form with no edge gives the eye nothing to measure it
   * against.
   *
   * Kept within a couple of points of `sky.haze`, for the reason that holds at
   * every hour: the far ranges fade INTO the horizon, and any gap between the
   * two colours shows as a band of the wrong value along the skyline.
   */
  /*
   * AERIAL PERSPECTIVE, PUT BACK — AND THE ROUND TRIP IS THE ARGUMENT FOR IT.
   *
   * This was taken to 0. What that produced is worth recording, because it is
   * the clearest demonstration of what haze is actually for: with it gone, the
   * background hills stopped reading as background. They came back at full
   * contrast and full saturation, identical in treatment to the drift under the
   * igloo, so the eye had nothing to tell it they were six hundred units
   * further away — and a ridge that is not further away is a cut-out standing
   * beside the subject rather than the land behind it.
   *
   * Depth in a still image is not geometry. The perspective was already
   * correct and it did nothing on its own. Depth is CONTRAST LOST TO DISTANCE,
   * and haze is the only term in this scene that produces it.
   */
  fog: { color: '#dde6ef', density: 0.0 },

  /*
   * NO VISIBLE AIR EFFECT, AND THIS IS THE RECORD OF SIX ATTEMPTS AT ONE.
   *
   * In order: a rising plume, drifting banks, breeze streaks, flow ribbons of
   * light, hair-thin braided filaments, and those filaments retuned to a few
   * wide soft wisps. Every one was rejected, and the last of them read as smoke
   * — which after all that work is the honest verdict on the whole approach.
   *
   * WHAT THEY ALL SHARED is that they DREW something. Whatever the primitive —
   * noise, ridges, gaussian strands, swept arcs — each put a new object in front
   * of the landscape and asked it to look like air. A drawn thing has a form,
   * and any form in this frame reads as a graphic laid over the picture, because
   * the eye has a snowfield and a mountain range to compare it against and it
   * matches neither.
   *
   * The air that remains is the one that is not drawn at all: the raymarched
   * ground haze in Terrain.jsx (see `mist` below). It is not an object in front
   * of the scene — it is a property OF the scene, accumulated along the view ray
   * through the terrain's own depth, so it has no shape to be wrong.
   *
   * If a visible effect is ever wanted again, the lesson is written above: it
   * must come out of the terrain's own shading rather than being placed in front
   * of it.
   */

  /*
   * WHERE ROCK SHOWS THROUGH THE SNOW.
   *
   * Solved against two photographs of Icelandic ranges rather than by eye. What
   * those have that this scene did not is not MORE rock — it is rock in the
   * right places: snow lodging in the gullies and on the lee faces, stone
   * standing out on the ribs and the steep edges, in strong near-vertical
   * striations that follow the mountain's own structure.
   *
   * The shader already builds exactly that. `bare` is a slope term multiplied by
   * a relief term, which is the correct construction — steep AND convex is where
   * snow cannot hold. Two gates were simply set too conservatively:
   *
   *   `slope` is the window, in the surface normal's Y. At 0.88..0.955 only
   *   ground steeper than about seventeen degrees qualified, which on these
   *   landforms is the cliffs and nothing else. 0.80..0.94 opens it to the
   *   flanks, which is where the reference has most of its stone.
   *
   *   `zone` is the distance gate. Rock began fading in at 230 units and only
   *   reached strength at 430, so the entire mid-ground was unbroken white and
   *   the striation only ever appeared on the back ranges. 150..320 brings it
   *   onto the hills behind the igloo, where the eye actually reads texture.
   *
   * THE NEAR FIELD IS STILL EXCLUDED, and deliberately. Terrain.jsx carries a
   * long argument — had and reversed twice — about a rock floor turning the
   * foreground into a gravel pit. That reasoning is about the drift under the
   * igloo, which is wind-packed snow and has no stone in it at any distance.
   * Nothing here reaches inside 150 units.
   */
  rock: { slope: [0.80, 0.94], zone: [150, 320] },

  /** A floor so crevices are not pure black. The IBL does the real work. */
  ambient: { color: '#c4d6e8', intensity: 0.26 },
  hemi: { sky: '#d6e6f6', ground: '#f0f5fa', intensity: 0.85 },
  key: { position: [95, 165, -170], color: '#fff6ed', intensity: 4.2 },

  /*
   * ALPENGLOW, SWITCHED OFF — same treatment as the aurora and the same reason.
   *
   * The shader term in Terrain.jsx is height-gated warm light standing in for a
   * sun the horizon has not yet cleared. It is a sunrise effect, it needs a
   * sunrise, and there is not one here: this is flat overcast daylight and the
   * one thing it must not have is a warm accent on the peaks. Kept behind the
   * flag because the gating is the difficult part and it works.
   */
  alpen: {
    enabled: false,
    color: [1.0, 0.58, 0.31],
    intensity: 1.9,
    floor: 190,
    full: 330,
    direction: [0.86, 0.2, -0.47],
    focus: 2.6,
  },

  /*
   * GROUND HAZE — AND THIS IS THE "AIR" THE REFERENCE ACTUALLY HAS.
   *
   * Four passes were spent drawing SHAPES: a rising plume, drifting banks,
   * breeze filaments, flow ribbons of light. Every one of them was rejected and
   * they all failed for one reason, which the reference makes obvious once it is
   * looked at rather than reasoned about: THERE IS NO SHAPE IN IT.
   *
   * The moving air on that site is not an object. It has no outline, no edges,
   * no strands, nothing that could be traced. It is a formless veil lying along
   * the ground, thickest in the hollows, thinning as the land rises, drifting
   * slowly enough that you notice it has moved rather than watching it move. Any
   * effect with a discernible form — however soft, however faint, however well
   * coloured — reads as a graphic laid over the picture, because a shape has a
   * boundary and air does not.
   *
   * That is exactly what the raymarched layer in Terrain.jsx already does, and
   * has done since long before any of this. It is evaluated per fragment along
   * the view ray, so it accumulates with the depth of air looked THROUGH; it is
   * keyed to world height, so it pools in the valleys and clears the ridges; and
   * it is driven by the same wind as everything else. It was switched off, not
   * missing.
   *
   * SUBTLE, WHICH IS THE ONLY WAY IT IS RIGHT. gain 0.30 against the white-out
   * pass's 0.5, and a 52-unit scale height rather than 95 so it stays a ground
   * layer instead of climbing to the igloo's crown at 56. It should read as the
   * air being slightly thick near the snow, and never as weather.
   */
  mist: { color: [0.98, 0.99, 1.0], density: 0.0035, height: 48, base: 14, gain: 0.45 },
  igloo: {
    glow: '#ffaa44',
    strength: 0.95,
    lamp: { color: '#ffaa44', intensity: 850 },
    porch: { color: '#ffa034', intensity: 650 },
  },
  particles: false,

  /*
   * THE SCREEN-SPACE HAZE IS GONE, AND THIS IS THE RECORD OF WHY.
   *
   * effects/HeatHaze.jsx displaced the whole frame's UVs to fake rising air. The
   * physics it modelled was right — shimmer is refraction, not something drawn —
   * and the implementation was wrong in a way no tuning could reach, because a
   * post-processing effect HAS NO POSITION. It could not know the igloo was 175
   * units away and the ranges 800, so it bent them equally; nothing occluded it,
   * because it ran after the depth buffer was spent; and it came from nowhere in
   * particular, so it read as a fault in the display.
   *
   * The igloo was the tell. A rigid dome of straight courses is the worst object
   * in any scene to displace: the eye knows precisely what shape it should be,
   * so two per cent of distortion does not read as air, it reads as the building
   * being broken.
   *
   * The file is kept and unmounted. If a shimmer is ever wanted on the far
   * ranges only, the fix is a depth gate — but the smoke below is the thing that
   * was actually being asked for, and it is an object.
   */
  heatHaze: false,

  /*
   * THE PLUME ON THE IGLOO.
   *
   * The coffee-smoke construction: a tall subdivided plane twisted about its own
   * axis, blown sideways, with its body scrolled upward through a tiling noise
   * texture. (That file and its noise-texture helper are gone; see the note
   * for why the noise is a texture rather than a GLSL function.
   *
   * SIZED OFF THE IGLOO, NOT PICKED. The dome is radius 22 and 1.5 radii tall,
   * so `width` at 12 is a little over half its radius — a plume narrower than
   * the thing producing it, which is what a smoke hole gives — and `height` at
   * 52 is about one and a half dome heights, tall enough to leave the top of the
   * structure without dominating the frame. The two igloo numbers are duplicated
   * here so the plume can seat itself on the crown; they have to track the props
   * Igloo.jsx is mounted with.
   *
   * `wind` is the sideways excursion in world units at full height. The lesson's
   * value is 10 on a plume 6 units tall — nearly a right angle, which suits a
   * cup indoors. 18 on a 52-unit plume is a distinct lean rather than a fold.
   */
  /*
   * AIR CURRENTS AS FLOWING RIBBONS OF LIGHT.
   *
   * The flow-ribbon idiom: long tapered curves made of parallel bright strands,
   * perfectly smooth, no grain anywhere. See environment/AirRibbons.jsx for the
   * construction and for why three earlier noise-based attempts could never
   * have reached this — noise's defining property is exactly the irregularity
   * this form has none of.
   *
   * COLOUR IS INVERTED AGAINST THE REFERENCES, DELIBERATELY. Every one of them
   * is bright white or cyan on a dark or saturated blue ground, and they work by
   * being much LIGHTER than their background — they are additive light. This
   * scene is a near-white snowfield, where additive light is invisible, because
   * adding white to white is white. So `core` sits just under the snow's value
   * and `edge` is a definite blue: the ribbons read a step DARKER than the
   * ground, as silk rather than as neon. Same shape language, opposite tonal
   * relationship, and the background is what forces it.
   *
   * PLACEMENT. The band brackets the igloo at (-30, 252) and stays below its
   * crown at 56, so the ribbons pass around and behind the structure without
   * crossing the dome or ever reaching the mountains.
   */

  /*
   * THE SNOW'S NORMAL RELIEF, AND CUTTING IT IS WHAT REMOVES THE FROST.
   *
   * At 1.35 the ground carried a dense fine crackle over its whole surface that
   * read as frost on a lens rather than as snow — a fixed granular pattern
   * sitting ON the picture instead of in it, which is exactly the complaint a
   * screen-door artefact attracts.
   *
   * The value was not wrong when it was set; the note beside it in Terrain.jsx
   * records it being raised from 0.62 specifically to drive the rock's
   * metre-scale relief, which was reading as printed. What changed is the LIGHT.
   * That number was solved under a strong directional key, where a normal map's
   * job is to catch and lose that key across a surface. This look is flat
   * overcast — the fill is nearly as strong as the key, so nothing is modelled
   * by direction any more and every perturbation in the map shows up at once,
   * everywhere, as texture rather than as form.
   *
   * 0.42 keeps the large relief, which is what the raise was for, and drops the
   * fine grain under the threshold where it reads as a pattern. The landforms
   * are geometry and are not touched by this at all.
   */
  snow: { normalScale: 0.18 },

  grade: {
    exposure: 0.96,
    bloom: { intensity: 1.1, threshold: 0.82, smoothing: 0.25 },
    vignette: { offset: 0.38, darkness: 0.30 },
  },
};

/**
 * THE ORIGINAL DAYLIGHT SET, KEPT AS THE RECORD. Not imported by anything.
 *
 * Read the notes in Atmosphere.jsx, Stage.jsx and Terrain.jsx alongside these —
 * that is where the argument for each one lives, and several are worth more than
 * the number they justify. In particular: the key and the fill are a PAIR solved
 * against each other, and the sky's haze stop and the fog colour are a pair that
 * have to track each other. Anyone restoring this set should move them together
 * or not at all.
 */
export const DAY = {
  sky: {
    zenith: [0x14, 0x3a, 0x84],
    azure: [0x3c, 0x6c, 0xb0],
    haze: [0xb4, 0xcb, 0xe3],
  },
  /** Fractions of the frame. Used by a sun glow Sky.jsx no longer draws. */
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

/** The set the scene is built from. */
export const LOOK = BRIGHT;

/** `[r, g, b]` 0-255 to a `#rrggbb` string, for the props that want one. */
export const hex = (c) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** `[r, g, b]` 0-255 to the 0-1 triple a shader uniform wants. */
export const unit = (c) => c.map((v) => v / 255);
