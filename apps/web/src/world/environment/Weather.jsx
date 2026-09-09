import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  LinearFilter,
  NormalBlending,
  RedFormat,
  ShaderMaterial,
  UnsignedByteType,
} from 'three';
import { MOUND_AT, TERRAIN_SIZE, TERRAIN_CENTER_Z, heightAt } from '../lib/terrain.js';
import { LOOK } from '../lib/lighting.js';

/**
 * Weather: WIND, as moving air made of things you can see moving.
 *
 * THE WHOLE FILE IS THE ANSWER TO ONE REQUIREMENT, so it is worth stating it
 * before the code. The scene has to read as a cold, windy place, and the
 * movement has to be legible as TRANSPORT — grains of loose snow being carried
 * horizontally through the air — rather than as snowfall, and emphatically
 * rather than as fog.
 *
 * WHAT WAS HERE BEFORE, AND WHY IT WAS NOT ENOUGH. Two things: a light vertical
 * snowfall, and a volumetric wisp march living over in Terrain.jsx that panned
 * a shallow noise medium across the near ground. The march is the one that
 * actually carried the sensation of wind, and a raymarched medium is a fog by
 * construction however fast it is scrolled — it has no grain, no edge, and
 * nothing in it for the eye to track. It has been turned down to a join (see
 * FOG_WISP_DENSITY) and the wind is now entirely here.
 *
 * THREE LAYERS, EACH DOING A DIFFERENT PART OF THE JOB.
 *
 *   DRIFT    The airborne stream: grains crossing the whole frame at height,
 *            fast, with turbulence. This is what says "the air is moving".
 *   SWEEP    The boundary layer: fine snow scoured off the surface and driven
 *            along it in short streaks. This is what says the wind is moving
 *            ACROSS THE SNOW rather than through empty sky, and it is the layer
 *            the brief singles out as most important.
 *   FALL     A little actual snowfall, kept deliberately faint. Its job is to
 *            be the slow, mostly-vertical thing the other two are read AGAINST
 *            — with nothing falling, a purely horizontal field reads as a
 *            texture being panned rather than as weather.
 *
 * ALL THREE ARE COMPUTED IN THE VERTEX SHADER, and that is the structural
 * change from the version this replaces.
 *
 * The old system walked a Float32Array on the CPU every frame, integrated a
 * velocity per grain and uploaded the whole buffer — which is one full
 * geometry upload per frame and a main-thread cost linear in the particle
 * count, and it is why the count had to stay in the low thousands. Here each
 * particle's position is a pure FUNCTION of (its seed, the clock): the shader
 * evaluates it from scratch every frame, the attribute buffers are uploaded
 * once at startup and never touched again, and per frame the CPU writes exactly
 * one uniform. Ten thousand particles cost the same on the CPU as ten.
 *
 * The recycling comes free with it. Integrating a position means you have to
 * detect when a grain leaves the volume and teleport it back; evaluating one
 * means wrapping the downwind coordinate with mod(), which is seamless by
 * construction, has no bookkeeping, and cannot drift out of the slab over a
 * long session the way an accumulating sum can.
 *
 * The approach follows the two references the brief points at — achrefelouafi's
 * SnowSystemThreeJS for the Points-plus-ShaderMaterial shape of the thing, and
 * the shader-motion gist for driving position from time and a per-particle
 * seed. Neither is copied: both are snowfall systems, gravity-first and
 * camera-local, and what is wanted here is horizontal transport tied to a place
 * in the world.
 */

/* -------------------------------------------------------------------------
   THE WIND ITSELF

   One direction and one speed, shared by every layer, because they are all the
   same wind. Anything that disagreed here would be immediately visible as two
   weather systems in one shot.
   ---------------------------------------------------------------------- */

/**
 * Predominantly +X, which is left to right across this frame, with a slight
 * downward component and a lean toward the camera.
 *
 * HORIZONTAL OVERWHELMS VERTICAL AND THAT IS THE POINT — the Y term is a
 * twentieth of the X term. What separates blown snow from falling snow is not
 * speed, it is ANGLE: a grain that falls as far as it travels sideways reads as
 * snowfall in a breeze no matter how fast it is going, and one that travels
 * twenty times further than it falls reads as being carried, which is what is
 * wanted.
 *
 * The small +Z is what keeps it from looking like a wipe. A stream running
 * exactly across the lens is a flat plane of motion with no depth in it; angled
 * a little toward the camera, near grains cross the frame visibly faster than
 * far ones, and that parallax is most of what makes the air read as a volume.
 */
const WIND = [1.0, -0.05, 0.3];

/**
 * Base speed in world units per second.
 *
 * MUST STAY IN AGREEMENT WITH FOG_WISP_DRIFT IN Terrain.jsx, which is 34 on X.
 * That march is turned nearly off now, but if it is ever brought back the two
 * have to move together — grains crossing the frame at a visibly different rate
 * from the air they are supposed to be suspended in is the one mistake that
 * gives the whole effect away.
 */
const WIND_SPEED = 34;

/** Where the hero object stands; the eddy is built around it. */
const EDDY_AT = [MOUND_AT[0], MOUND_AT[1]];

/*
 * THE LENS, as three numbers, so the particle bands can be sized from it.
 *
 * These duplicate what CAMERA_POINTS in chapters.js sets up, and the duplication
 * is deliberate rather than an import: the curve is a spline the rig walks, so
 * there is no single "the camera is here" value to read off it, and what this
 * needs is the OPENING frame specifically — the shot the composition is solved
 * for. If that first control point moves, these move with it.
 *
 * WEDGE_TAN is tan of the horizontal half-angle: a 42-degree vertical field on
 * a 2.4:1 frame gives 42.7 degrees each side. WEDGE_YAW is the tangent of how
 * far the axis leans left, from the camera at x 12.8 looking at x -24.4 across
 * 172 units of depth.
 */
/* -------------------------------------------------------------------------
   THE GROUND, AS A TEXTURE THE VERTEX SHADER CAN READ

   THIS IS WHAT MAKES THE SURFACE LAYER A SURFACE LAYER. Without it a
   "ground-level" slab is a horizontal sheet at one absolute altitude, and this
   landscape runs from y 0 in the hollows to y 65 on the near hills — so a sheet
   thin enough to hug the ground somewhere is buried under it everywhere else,
   and thick enough to clear the hills is a cloud. The first pass at the sweep
   layer sat at y 35..65 over ground at y 16 and was invisible: not too faint,
   simply underground.

   So the terrain is sampled once into a small single-channel texture and read
   in the vertex shader, and every grain's height is measured from the ground
   beneath it rather than from zero. The layer then pours over the drifts,
   thins on the crests and pools in the hollows on its own, which is both what
   blown snow does and the "concentrated around ridges and exposed areas" the
   brief asks for — as a consequence of the terrain rather than as a hand-placed
   effect.

   128 SQUARE IS DELIBERATELY COARSE. That is a sample every twenty units, which
   is smoother than the mesh — and it should be. What this positions is a body
   of air, and air does not have metre-scale detail in its lower boundary; it
   rides over the bumps. A high-resolution lookup would make the layer follow
   every ripple and read as snow painted onto the surface rather than moving
   over it.

   Built from heightAt(), which is a bilinear read out of the baked heightfield
   once that has loaded, so this is sixteen thousand array lookups at startup.
   ---------------------------------------------------------------------- */

const HEIGHT_TEX = 256;
/** The quantisation range. The field runs 0..~650; this covers it with room. */
const HEIGHT_MAX = 720;

function buildHeightTexture() {
  const n = HEIGHT_TEX;
  const data = new Uint8Array(n * n);
  const x0 = -TERRAIN_SIZE / 2;
  const z0 = TERRAIN_CENTER_Z - TERRAIN_SIZE / 2;
  const step = TERRAIN_SIZE / (n - 1);

  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const h = heightAt(x0 + i * step, z0 + j * step);
      data[j * n + i] = Math.max(0, Math.min(255, Math.round((h / HEIGHT_MAX) * 255)));
    }
  }

  const tex = new DataTexture(data, n, n, RedFormat, UnsignedByteType);
  /* Linear so the layer glides rather than stepping between samples, and
     clamped because a grain at the edge of the plate must not read a height
     from the far side of the world. */
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

const CAM_X = 12.8;
const CAM_Z = 422;
const WEDGE_TAN = 0.923;
const WEDGE_YAW = 0.216;
const WEDGE_MARGIN = 1.5;

/* -------------------------------------------------------------------------
   SHADER
   ---------------------------------------------------------------------- */

/**
 * Shared by all three layers, because they differ only in their numbers.
 *
 * WHAT EACH ATTRIBUTE CARRIES.
 *
 *   position   the grain's home in the slab, which is where it sits at t=0 and
 *              the origin its whole trajectory is measured from.
 *   aSeed      x  speed multiplier      — shear, so the stream is not a sheet
 *              y  turbulence phase      — so no two grains wobble together
 *              z  turbulence amplitude  — so some are thrown about and some are
 *                                         barely disturbed
 *   aSize      point size in world units, spread wide on purpose: a stream in
 *              which every grain is the same size has a comb-like regularity to
 *              it that no amount of positional randomness removes.
 */
const WIND_VERT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uWind;
  uniform float uSpeed;
  uniform vec3 uSpan;
  uniform vec3 uCentre;
  uniform float uPixelScale;
  uniform float uEddyStrength;
  uniform float uEddyRadius;
  uniform vec2 uEddyAt;
  uniform float uTurbRate;
  uniform float uNearFade;
  uniform sampler2D uHeight;
  uniform vec2 uTerrainOrigin;
  uniform vec2 uTerrainSize;
  uniform float uFollow;
  uniform float uFloor;

  attribute vec3 aSeed;
  attribute float aSize;
  /*
   * THE GRAIN'S OWN WRAP BAND: x is its left edge, y its width.
   *
   * PER PARTICLE, NOT PER LAYER, AND THE FIRST PASS SHOWS WHY IT HAS TO BE.
   * That version wrapped every grain in one 1500-unit slab, which is correct
   * physics and a waste of a particle budget: the lens is a CONE, so at the
   * igloo's depth it is only 350 units across, and seven grains in eight were
   * being simulated in air that is not in the picture. The stream measured
   * dense and looked like scattered specks.
   *
   * Each grain now gets a band sized from the frustum at its OWN depth — wide
   * at the back, narrow at the front — so the budget is spent where the camera
   * is pointing and the density on screen is even from front to back rather
   * than piling up at the horizon.
   */
  attribute vec2 aBand;

  uniform vec3 uGust;

  /*
   * A SMALL VALUE NOISE, FOR GUSTING.
   *
   * A field of identical grains at uniform density is a texture, and a texture
   * that translates is a pan. What makes real blown snow read as WIND is that
   * it is not uniform: it arrives in tongues and sheets with clear air between
   * them, and those patches travel downwind with the grains in them.
   *
   * So the alpha is modulated by a slowly drifting field, evaluated at the
   * grain's own position. Grains inside a patch draw near full strength and
   * overlap into a visible veil; grains between patches nearly vanish. That is
   * also what buys the effect its legibility over sunlit snow, where a single
   * white grain against a near-white surface has almost no contrast to work
   * with and twenty stacked ones do.
   */
  float wHash( vec2 p ) {
    return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
  }

  float wNoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix(
      mix( wHash( i ), wHash( i + vec2( 1.0, 0.0 ) ), u.x ),
      mix( wHash( i + vec2( 0.0, 1.0 ) ), wHash( i + vec2( 1.0, 1.0 ) ), u.x ),
      u.y
    );
  }

  varying float vAlpha;

  void main() {
    vec3 p = position;

    /* Per-grain speed. Centred on 1 and spread wide: without shear the field
       translates as a rigid body, and a rigid body is a texture, not a fluid. */
    float speed = uSpeed * aSeed.x;

    /*
     * THE TRANSPORT, AND THE WRAP IS THE RECYCLING.
     *
     * Displacement along the wind is just speed * time — no integration, so no
     * accumulated rounding — and mod() folds it back into the slab. A grain
     * leaving the downwind face reappears at the upwind one at exactly the same
     * height and depth, which is invisible because the two faces are off screen
     * either side of the picture.
     *
     * The wrap is applied on X ONLY. It is the axis with a constant velocity on
     * it, so the field is genuinely periodic there and folding it changes
     * nothing. Y and Z carry oscillations that already return to where they
     * started, so they need no wrap and would only get a seam from one.
     */
    float travel = speed * uTime;
    p.x = mod( p.x + travel * uWind.x - aBand.x, aBand.y ) + aBand.x;

    /* The slight settle, and the lean toward the lens. Both oscillate against
       the turbulence below rather than accumulating, for the same reason. */
    p.y += sin( uTime * 0.13 + aSeed.y ) * 2.0 + uWind.y * speed * 3.0;
    p.z += sin( uTime * 0.19 + aSeed.y * 1.7 ) * 6.0 + uWind.z * speed * 2.0;

    /*
     * TURBULENCE. Two sines at incommensurate rates on the two free axes, out
     * of phase per grain, so the stream frays as it crosses instead of arriving
     * as a wall. Read off the absolute clock rather than summed per frame — a
     * sum walks grains out of the slab over a long session and a sine cannot.
     *
     * The vertical term is the larger of the two: what blown snow does is boil,
     * lifting and dropping as it goes, and a stream that only wanders sideways
     * reads as a flag rather than as air.
     */
    float w = uTime * uTurbRate;
    /* THE VERTICAL TERM IS THE SMALLEST OF THE THREE NOW, down from 1.35.
       A grain that rises and falls as much as it wanders sideways reads as
       something floating, and floating plus a downward drift reads as snowfall.
       Wind-borne snow shears and frays along its own direction; it barely
       bobs. */
    p.y += sin( w * 1.7 + aSeed.y ) * aSeed.z * 0.55;
    p.z += sin( w * 1.1 + aSeed.y * 1.9 ) * aSeed.z * 2.30;
    p.x += sin( w * 0.7 + aSeed.y * 2.7 ) * aSeed.z * 1.10;

    /*
     * THE EDDY ROUND THE MOUND.
     *
     * A tangential push decaying with radius, so grains passing the dome are
     * swept AROUND it rather than through it, plus an upward kick which is the
     * wake — air deflected over an obstacle is where a real spindrift plume
     * comes from. It is what ties the wind to the one object in the scene
     * instead of leaving it a field that happens to be in front of a building.
     */
    /*
     * SEAT THE GRAIN ON THE GROUND UNDER IT.
     *
     * position.y holds a height ABOVE LOCAL GROUND rather than a world Y, so
     * this is where it becomes a world position — and it happens after the
     * transport and the turbulence, because the ground the grain is over is the
     * ground where it has arrived, not where it started.
     *
     * uFollow is how much of the terrain the layer inherits. At 1 the sheet is
     * pinned to the surface, which is what the sweep wants. Below 1 it flattens
     * out with height, which is what the airborne layer wants: air lifting over
     * a ridge rises by less than the ridge does, and a high layer that tracked
     * the ground exactly would drape over the hills like a blanket.
     */
    vec2 huv = ( p.xz - uTerrainOrigin ) / uTerrainSize;
    float ground = texture2D( uHeight, huv ).r * ${HEIGHT_MAX.toFixed(1)};
    p.y += uFloor + ground * uFollow;

    vec2 rel = p.xz - uEddyAt;
    float rd = max( length( rel ), 1.0 );
    float curl = exp( -rd / uEddyRadius ) * uEddyStrength;
    p.x += -rel.y / rd * curl;
    p.z += rel.x / rd * curl;
    p.y += curl * 0.22;

    vec4 mv = modelViewMatrix * vec4( p, 1.0 );
    float dist = -mv.z;

    /*
     * FADES, AND THERE ARE THREE OF THEM BECAUSE THERE ARE THREE WAYS FOR A
     * PARTICLE TO LOOK WRONG.
     *
     *   near   A grain a couple of units off the lens covers a quarter of the
     *          screen and reads as a smear on the glass. Fading them out is
     *          cheaper and more robust than trying to keep the slab clear of
     *          the camera, which the camera move makes impossible anyway.
     *   far    Beyond a few hundred units a grain is well under a pixel, and a
     *          sub-pixel bright point does not shrink, it TWINKLES — it aliases
     *          in and out as the camera moves. Fading them out is the fix.
     *   edge   The upwind and downwind faces of the slab are off screen, but
     *          the Z faces are not, and a stream with a hard end to it reads as
     *          a box. This tapers the last tenth at each end.
     */
    float near = smoothstep( 0.0, uNearFade, dist );
    /*
        PUSHED BACK, from 260..900. White grains are nearly invisible over
        sunlit snow and unmissable against dark rock, so the stretch of the
        field that actually SELLS the wind is the part crossing the mountains —
        and at the old range that part was already faded out. The stops now sit
        beyond the middle distance, so the stream stays legible all the way to
        the ranges and only dies where a grain would be sub-pixel and start to
        twinkle.
     */
    float far = 1.0 - smoothstep( 620.0, 1500.0, dist );
    float edge = 1.0 - smoothstep( 0.34, 0.5, abs( p.z - uCentre.z ) / uSpan.z );
    /*
     * THE GUST FIELD. Stretched 2.6:1 ACROSS the wind, because a patch of blown
     * snow is drawn out along the direction it is travelling — a round patch
     * reads as a cloud sitting still, and an elongated one reads as something
     * being carried. It scrolls at the wind's own speed (uGust.x is the spatial
     * scale, and the time term is that scale times the wind), so the patches
     * travel with the grains inside them instead of sliding through them.
     */
    vec2 gq = vec2( p.x * uGust.x - uTime * uGust.x * uSpeed, p.z * uGust.x * 2.6 );
    float gust = wNoise( gq ) * 0.66 + wNoise( gq * 2.7 + 11.3 ) * 0.34;
    gust = smoothstep( uGust.y, uGust.z, gust );

    vAlpha = near * far * edge * mix( 0.16, 1.0, gust );

    gl_Position = projectionMatrix * mv;

    /*
     * Size attenuation by hand rather than through pointsMaterial, because the
     * fades above need the distance anyway and this keeps one source for it.
     *
     * BOTH ENDS ARE CLAMPED, AND THE FLOOR IS THE IMPORTANT ONE.
     *
     * A STREAKED sprite is only as legible as its SHORT axis. At uStreak 5 a
     * six-pixel point is a streak one pixel thick, which after antialiasing is
     * a faint grey nothing — which is exactly how the first tuning of this
     * failed: the grains measured present and could not be seen. So the sprite
     * has to stay comfortably above uStreak pixels across for the thin axis to
     * survive, hence a floor of 3 rather than 1.
     *
     * The ceiling is the opposite failure, and it is also the layer's whole
     * fill cost. Size goes as 1/distance, so a grain that drifts within a few
     * units of the lens grows without bound and lands as a white slab across
     * the frame — and a point sprite is a SQUARE, of which a 5:1 streak uses
     * about a fifth, so every pixel of that square is shaded and four fifths of
     * them are discarded. At an uncapped size a few hundred near grains were
     * costing more fill than the entire landscape behind them.
     *
     * 26 pixels is where the near grains still read as streaks and the layer
     * stops being the most expensive thing in the frame.
     */
    /* CEILING DOWN TO 17, from 26. The brief asks for most particles to be
       tiny and only the occasional close one to be clearly visible, and the
       ceiling is exactly the control for that: it is what a grain a few units
       off the lens is allowed to become. */
    gl_PointSize = clamp( aSize * uPixelScale / max( dist, 1.0 ), 2.5, 17.0 );
  }
`;

const WIND_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uStreak;

  varying float vAlpha;

  void main() {
    /*
     * THE SPRITE IS DRAWN HERE RATHER THAN SAMPLED FROM A TEXTURE, which buys
     * the one thing a texture could not: a per-layer aspect ratio out of one
     * material.
     *
     * uStreak stretches the falloff along X, so the same shader gives the
     * airborne layer a round grain and the ground layer a horizontal streak —
     * which is what a particle moving fast enough to blur within a frame looks
     * like, and what the brief asks for on the surface layer specifically.
     * Point sprites cannot be rotated, but they do not need to be: the wind is
     * horizontal and so is the streak.
     */
    /*
     * THE SQUASH IS ON Y, AND DIVIDING X INSTEAD IS WHY THIS NOTE EXISTS.
     *
     * The first pass wrote d.x /= uStreak, which is the intuitive way to make
     * something wider — and it makes the ellipse wider than the sprite quad it
     * has to live inside, so every grain came out CLIPPED to the quad's left
     * and right edges. The frame filled with little white rectangles.
     *
     * A point sprite is a fixed square; the only way to get a long thin shape
     * out of one is to keep the long axis at the square's full width and shrink
     * the SHORT axis inside it. Multiplying d.y does that, so the streak spans
     * the whole sprite and is one uStreak-th as thick, with nothing touching
     * the edge of the quad.
     */
    vec2 d = gl_PointCoord - 0.5;
    d.y *= uStreak;
    float r = length( d ) * 2.0;
    if ( r > 1.0 ) discard;

    /* A defined core with a soft skirt. A wide gradient at this size is a grey
       smudge and the stream loses its grain; a hard edge is a digital speck. */
    float a = pow( 1.0 - r, 1.8 );

    gl_FragColor = vec4( uColor, a * uOpacity * vAlpha );
    #include <colorspace_fragment>
  }
`;

/**
 * Build one layer.
 *
 * `span` and `centre` describe the slab it lives in, and everything else is the
 * character of the snow in it.
 */
function useWindLayer({
  count,
  span,
  centre,
  follow,
  floorAt,
  gust,
  heightTexture,
  size,
  sizeSpread,
  speedSpread,
  turbulence,
  turbRate,
  lift,
  color,
  opacity,
  streak,
  eddyStrength,
  eddyRadius,
  nearFade,
  blending,
}) {
  return useMemo(() => {
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const bands = new Float32Array(count * 2);

    /* A fixed sequence rather than Math.random, so a reload gives the same
       weather. Debugging a look you cannot reproduce is not debugging. */
    let s = 0x9e3779b9;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };

    for (let i = 0; i < count; i += 1) {
      /*
       * Height distribution is the layer's most characteristic property, and it
       * is set by `lift`: a power applied to a uniform sample. At 1 the grains
       * fill the slab evenly, which is a suspended cloud. Above 1 they crowd
       * the floor, which is what scoured snow does — what holds a grain up is
       * turbulence near the surface and there is less of it further up, so
       * density falls off fast with height.
       */
      const h = Math.pow(rand(), lift);

      const z = centre[2] + (rand() - 0.5) * span[2];

      /*
       * THE BAND, solved from the lens rather than chosen.
       *
       * The opening shot sits at z 422 looking 12.2 degrees left of -Z with a
       * horizontal half-angle of 42.7, so at depth d the picture is d * 0.923
       * wide either side of an axis that has itself moved d * 0.216 to the
       * left. WEDGE_MARGIN widens it by half again, which covers the camera
       * retreating to z 660 over the scroll — the frustum grows as it goes
       * back, and a band sized for the opening frame alone would leave the
       * later acts with a stripe of weather down the middle of an empty shot.
       *
       * The floor keeps the very nearest grains from being wrapped inside a
       * band a few units wide, which would read as a shimmering curtain hung
       * in front of the lens.
       */
      const depth = Math.max(40, CAM_Z - z);
      const half = Math.max(90, depth * WEDGE_TAN * WEDGE_MARGIN);
      const axis = CAM_X - depth * WEDGE_YAW;

      positions[i * 3] = axis + (rand() - 0.5) * 2 * half;
      /* A height ABOVE LOCAL GROUND, not a world Y — see the shader. */
      positions[i * 3 + 1] = h * span[1];
      positions[i * 3 + 2] = z;

      bands[i * 2] = axis - half;
      bands[i * 2 + 1] = half * 2;

      seeds[i * 3] = 1 - speedSpread + rand() * speedSpread * 2;
      seeds[i * 3 + 1] = rand() * Math.PI * 2;
      seeds[i * 3 + 2] = turbulence * (0.35 + rand() * 1.3);

      sizes[i] = size * (1 - sizeSpread + rand() * sizeSpread * 2);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new BufferAttribute(seeds, 3));
    geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));
    geometry.setAttribute('aBand', new BufferAttribute(bands, 2));

    const material = new ShaderMaterial({
      vertexShader: WIND_VERT,
      fragmentShader: WIND_FRAG,
      transparent: true,
      /* No depth write: these overlap constantly, and a transparent surface
         that writes depth punches holes in the ones behind it. They still TEST
         against depth, so a grain behind the igloo is correctly hidden. */
      depthWrite: false,
      blending,
      uniforms: {
        uTime: { value: 0 },
        uWind: { value: [WIND[0], WIND[1], WIND[2]] },
        uSpeed: { value: WIND_SPEED },
        uSpan: { value: span },
        uCentre: { value: centre },
        uPixelScale: { value: 600 },
        uEddyStrength: { value: eddyStrength },
        uEddyRadius: { value: eddyRadius },
        uEddyAt: { value: EDDY_AT },
        uTurbRate: { value: turbRate },
        uNearFade: { value: nearFade },
        uHeight: { value: heightTexture },
        uFollow: { value: follow },
        uGust: { value: gust },
        uFloor: { value: floorAt },
        uTerrainOrigin: {
          value: [-TERRAIN_SIZE / 2, TERRAIN_CENTER_Z - TERRAIN_SIZE / 2],
        },
        uTerrainSize: { value: [TERRAIN_SIZE, TERRAIN_SIZE] },
        uColor: { value: new Color(color) },
        uOpacity: { value: opacity },
        uStreak: { value: streak },
      },
    });

    return { geometry, material };
  }, [
    count, span, centre, follow, floorAt, gust, heightTexture, size, sizeSpread,
    speedSpread, turbulence, turbRate, lift, color, opacity, streak,
    eddyStrength, eddyRadius, nearFade, blending,
  ]);
}

function WindLayer(props) {
  const { geometry, material } = useWindLayer(props);
  const ref = useRef(null);

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
    /*
     * Point size is in PIXELS, so the same world-space grain has to be scaled
     * by the drawing buffer or it changes physical size with the window. Height
     * rather than width, because the vertical field of view is the fixed one.
     */
    material.uniforms.uPixelScale.value =
      state.size.height * state.viewport.dpr * 0.55;
  });

  return (
    <points
      ref={ref}
      geometry={geometry}
      material={material}
      /* The slab is authored in world space and is larger than the frustum in
         every direction, so a bounding-sphere test can only ever cull it
         wrongly — and it is one draw call either way. */
      frustumCulled={false}
      /* Drawn after the landscape so the stream reads in front of it. Points
         have no meaningful depth sort among themselves anyway. */
      renderOrder={2}
    />
  );
}

/* -------------------------------------------------------------------------
   THE SNOWFLAKE SPRITE — still a texture, because it is a different shape

   The two wind layers draw their own sprite in the fragment shader so they can
   share one material at two aspect ratios. Snowfall wants an actual soft round
   flake and no stretch at all, and at 400 of them the extra texture is nothing.
   ---------------------------------------------------------------------- */

function makeFlakeTexture() {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

/** How many flakes. Deliberately low — this is the reference against which the
    horizontal layers read as horizontal, not the weather. */
/*
 * CUT TO 110, from 380, AND THE REASON IS THE WHOLE POINT OF THIS FILE.
 *
 * This layer exists to be the slow mostly-vertical thing the horizontal layers
 * are read against — with nothing falling at all, a purely lateral field can
 * read as a texture being panned. That argument is still good and the quantity
 * was wrong: at 380 it was no longer the reference, it was the effect. It is
 * the only layer with a downward velocity and it was the most visible one, so
 * the first thing the eye found in the frame was snow falling.
 *
 * A third as many, smaller, fainter, and carried at three quarters of the wind
 * rather than a third — so even these cross the frame far faster than they
 * descend.
 */
const FLAKES = 110;
const FALL_SPREAD = [420, 150, 520];
const FALL_CENTRE = [0, 60, 120];

function Snowfall() {
  const { geometry, texture, speeds } = useMemo(() => {
    const positions = new Float32Array(FLAKES * 3);
    const rates = new Float32Array(FLAKES * 3);

    for (let i = 0; i < FLAKES; i += 1) {
      positions[i * 3] = FALL_CENTRE[0] + (Math.random() - 0.5) * FALL_SPREAD[0];
      positions[i * 3 + 1] = FALL_CENTRE[1] + (Math.random() - 0.5) * FALL_SPREAD[1];
      positions[i * 3 + 2] = FALL_CENTRE[2] + (Math.random() - 0.5) * FALL_SPREAD[2];

      rates[i * 3] = 1.6 + Math.random() * 2.4; // fall speed
      rates[i * 3 + 1] = Math.random() * Math.PI * 2; // sway phase
      rates[i * 3 + 2] = 0.4 + Math.random() * 0.9; // sway width
    }

    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    return { geometry: g, texture: makeFlakeTexture(), speeds: rates };
  }, []);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const pos = geometry.attributes.position;
    const arr = pos.array;
    const t = state.clock.elapsedTime;

    const floor = FALL_CENTRE[1] - FALL_SPREAD[1] / 2;
    const ceiling = FALL_CENTRE[1] + FALL_SPREAD[1] / 2;

    for (let i = 0; i < FLAKES; i += 1) {
      const y = i * 3 + 1;
      arr[y] -= speeds[i * 3] * dt;

      /*
       * CARRIED BY THE SAME WIND, at a fraction of its speed. A flake falling
       * straight down beside a stream travelling at 34 units a second does not
       * read as gentler weather, it reads as a bug — everything in the air is
       * in the same air. A third of the speed is the difference between a large
       * flake, which has enough mass and drag to lag, and a grain, which does
       * not.
       */
      arr[i * 3] += WIND[0] * WIND_SPEED * 0.75 * dt;
      arr[i * 3] += Math.sin(t * 0.5 + speeds[y]) * speeds[i * 3 + 2] * dt;

      if (arr[y] < floor) {
        arr[y] = ceiling;
        arr[i * 3] = FALL_CENTRE[0] + (Math.random() - 0.5) * FALL_SPREAD[0];
        arr[i * 3 + 2] = FALL_CENTRE[2] + (Math.random() - 0.5) * FALL_SPREAD[2];
      }
      /* Wrapped downwind as well, now that they are being blown along it. */
      if (arr[i * 3] > FALL_CENTRE[0] + FALL_SPREAD[0] / 2) {
        arr[i * 3] -= FALL_SPREAD[0];
      }
    }
    pos.needsUpdate = true;
  });

  return (
    <points geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        map={texture}
        size={0.34}
        sizeAttenuation
        transparent
        opacity={0.3}
        depthWrite={false}
        color="#ffffff"
      />
    </points>
  );
}

/* -------------------------------------------------------------------------
   THE LAYERS

   Both slabs are authored around the igloo at z 252 rather than around the
   camera. The movement has to be legible against the darker mountains, and
   that means putting the grains in the open ground the mountains stand behind;
   a field centred on the lens spends most of its particles in the empty air to
   either side, where nothing is looking.
   ---------------------------------------------------------------------- */

/*
 * COUNTS. The brief's range is 2000 to 10000 and asks for many small subtle
 * grains rather than a few large obvious flakes, which is the correct instinct:
 * what makes a stream read as a stream is the number of things in it, and what
 * makes it read as a snowstorm is how visible each one is. So these are near
 * the top of the range and individually very faint.
 *
 * The count is nearly free here — position is a function of time evaluated on
 * the GPU, so the CPU cost is one uniform write per layer per frame regardless.
 * What it does cost is overdraw, which is why the opacities are where they are.
 */
/*
 * BOTH COUNTS DOWN, 5000 / 7000 -> 3400 / 5000, ALONGSIDE SMALLER AND FAINTER
 * SPRITES.
 *
 * The previous pass chased legibility and found it by making the grains bigger
 * and more numerous, which is the crude way to do it: the air filled with
 * visible objects and the frame stopped being clean. What actually carries the
 * read is the STREAK — a short horizontal dash says "moving fast sideways" at
 * any size, where a round dot has to be large before it says anything.
 *
 * So the size and the count come down and the streak ratios go up. Most grains
 * are now under three pixels and essentially subliminal; the sensation comes
 * from thousands of them travelling together, which is what wind looks like.
 */
/*
 * SETTLED AT 4200 / 6800 AFTER OVERSHOOTING BOTH WAYS.
 *
 * The pass before this one made the grains big and bright enough to read as a
 * blizzard; cutting them to a third of that made them disappear entirely. The
 * band between those two is narrower than it looks, because white snow against
 * white snow has almost no contrast to work with — a grain is only ever visible
 * where it crosses shade, dark rock or sky.
 *
 * The resolution is to spend the budget on NUMBER and STREAK rather than on
 * size and brightness. Every grain stays small and faint; there are enough of
 * them, travelling together and gusting together, that the stream reads even
 * though no single one of them is conspicuous. That is also what the brief
 * describes: most particles tiny, only the occasional near one clearly visible.
 */
const DRIFT_COUNT = 4200;
const SWEEP_COUNT = 6800;

export default function Weather() {
  /*
   * ONE TEXTURE FOR BOTH LAYERS, built here rather than inside useWindLayer so
   * the sixteen thousand height lookups happen once instead of once per layer.
   */
  const heightTexture = useMemo(() => buildHeightTexture(), []);

  /* Frozen at module scope in effect: these are passed by identity into the
     memo above, so a literal here would rebuild the buffers every render. */
  const drift = useMemo(
    () => ({
      count: DRIFT_COUNT,
      /*
       * WIDE, LOW AND DEEP. 1500 units of fetch so grains are on screen for
       * several seconds at 34 units a second — a stream you can follow, rather
       * than specks flicking past — and 170 units tall, which reaches from the
       * valley floor to a little above the igloo's own hills.
       */
      /* span.x is ignored — the wrap band is per grain, see aBand. It is kept
         in the tuple so the three spans read as one shape. */
      span: [0, 150, 860],
      centre: [-30, 104, 60],
      /*
       * HALF THE TERRAIN, so the stream lifts over the hills without draping
       * on them. Over the hollows at ground zero it runs from y 44 up; over the
       * near hills at ground 64 it starts at 76, which is 12 units of clearance
       * rather than the 64 it would have if it followed fully. Air does exactly
       * this: a parcel crossing a ridge rises by a fraction of the ridge.
       */
      follow: 0.5,
      floorAt: 44,
      /*
       * Coarse patches and a low bar, so the airborne layer is present most of
       * the time and only thins out. It is the continuous stream; the sweep
       * below is the one that should come and go.
       */
      gust: [0.0042, 0.30, 0.68],
      size: 1.05,
      sizeSpread: 0.55,
      /* Wide shear. Some grains cross at half the wind and some at half again
         as much, and the spread between them is what reads as a fluid. */
      speedSpread: 0.45,
      turbulence: 1.5,
      turbRate: 1.0,
      /* Mildly bottom-weighted: airborne, but there is still more of it low. */
      lift: 1.5,
      color: '#f2f7fd',
      /* Individually almost invisible, and that is correct — what should be
         visible is the STREAM. A grain you can pick out is a grain the eye
         tracks instead of the flow. */
      opacity: 0.42,
      /* Slightly oval. These are airborne grains, not fast enough at this
         distance to smear into lines, but a touch of stretch along the wind
         gives the field a direction even when it is standing still. */
      streak: 3.2,
      eddyStrength: 15,
      eddyRadius: 120,
      nearFade: 26,
      blending: NormalBlending,
    }),
    []
  );

  const sweep = useMemo(
    () => ({
      count: SWEEP_COUNT,
      /*
       * THE BOUNDARY LAYER. 26 units tall against the drift's 170 — this is
       * snow being scoured along the surface, and it lives in the first few
       * metres of air or it is not that at all.
       *
       * Its centre sits at y 46, which is a little above the ground under the
       * igloo, and the strong `lift` power crowds it downward from there.
       */
      span: [0, 30, 700],
      centre: [-30, 50, 175],
      /* Pinned to the surface, which is the whole definition of this layer. */
      follow: 1.0,
      /* Just clear of the snow. Zero would put half the sprite through it, and
         the height texture is a smoothed read of the mesh, so a few units of
         margin also covers where it undershoots a bump. */
      floorAt: 6.0,
      /*
       * Tighter patches and a much higher bar than the airborne layer's. Snow
       * is only lifted off the surface where the wind is locally strong enough
       * to do it, so the ground layer is mostly clear ground with tongues of
       * drift running through it — which is the thing that reads unmistakably
       * as WIND ACROSS SNOW rather than as a haze lying on it.
       */
      gust: [0.0075, 0.36, 0.72],
      size: 4.2,
      sizeSpread: 0.5,
      speedSpread: 0.5,
      /* Less turbulence than the airborne layer, and slower. Air near a surface
         is dragged by it: the grains hold their line and shiver rather than
         boiling, which is exactly what makes it read as ground-hugging. */
      turbulence: 0.85,
      turbRate: 0.7,
      /* Hard against the floor. Cubing a uniform sample puts three quarters of
         the layer in its bottom half. */
      lift: 3.0,
      color: '#ffffff',
      opacity: 0.58,
      /*
       * THE STREAKS, AND THIS IS THE NUMBER THE BRIEF IS ABOUT.
       *
       * 4.6:1. A grain travelling at 34 units a second and this close to the
       * lens moves several of its own widths within one frame's exposure, so
       * what a camera records is not a dot but a short line — and a short line
       * lying along the wind is the single most direct way to say MOVING AIR.
       * Round particles at the same speed read as a swarm.
       */
      streak: 6.0,
      /* A stronger eddy than the airborne layer's. Surface snow is what the
         dome actually deflects — the drift banked against its wall is made of
         this, and it should visibly curl round the building. */
      eddyStrength: 24,
      eddyRadius: 105,
      nearFade: 46,
      /*
       * NORMAL, NOT ADDITIVE, AND THE ADDITIVE PASS IS WHY THE NOTE IS HERE.
       *
       * Additive is the obvious choice for lit crystals and it is invisible on
       * this scene, for an arithmetic reason: additive can only ever ADD, and
       * the surface this layer crosses is sunlit snow sitting around 240 out of
       * 255. There are fifteen values of headroom, so a white grain at any
       * opacity is a change nobody can see. Every grain that landed on the
       * bright foreground simply did not exist.
       *
       * Normal blending works because it can go both ways relative to what is
       * behind it. Over the blown-out snow a near-white streak is still nearly
       * invisible — which is correct, that is what happens — and over the blue
       * shadows, the mid-ground and the dark rock it reads clearly. So the
       * stream appears where there is contrast to appear against and fades
       * where there is not, which is exactly how real spindrift photographs.
       */
      blending: NormalBlending,
    }),
    []
  );

  return (
    <>
      {/*
        SWITCHED OFF BY LOOK.particles, AND EVERYTHING ABOVE IS KEPT.

        The two wind layers and the snowfall are eleven thousand instanced
        grains, and every constant in this file is an argument about how to make
        them read as a FLOW rather than as specks — the shear across the stream,
        the gust patches, the fractional ridge-following, the opacity low enough
        that no single grain can be tracked. None of that is wrong. It is simply
        answering a question the scene no longer asks: the moving thing in the
        frame is now the rising air in effects/HeatHaze.jsx, and two systems both
        volunteering to be the motion is one too many.

        Gated rather than deleted. The buffers above are built inside useMemo and
        are not touched when this is false, so the cost of keeping it is the
        module staying in the bundle.
      */}
      {LOOK.particles && (
        <>
          <WindLayer {...drift} heightTexture={heightTexture} />
          <WindLayer {...sweep} heightTexture={heightTexture} />
          <Snowfall />
        </>
      )}
    </>
  );
}
