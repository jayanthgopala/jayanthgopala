import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Uniform } from 'three';
import { BlendFunction, Effect, EffectAttribute, EffectPass } from 'postprocessing';
import { useWorldScroll } from '../scroll/ScrollProvider.jsx';
import { ACTS } from '../chapters.js';

/**
 * Where the bursts fire: every act boundary, taken from chapters.js rather
 * than written out here so the two cannot drift apart.
 */
const BOUNDARIES = ACTS.slice(1).map((a) => a.start);

/**
 * Half-width of a burst, in progress units.
 * Widen slightly to 0.038 so the transition splash comfortably flourishes
 * when crossing the chapter boundary into "02 THE RETREAT".
 */
const BURST_HALF_WIDTH = 0.038;

/**
 * How much travel is needed to develop the burst fully.
 * Lower threshold so normal scrolling reaches peak flare richness smoothly.
 */
const MOTION_GAIN = 1.6;

/**
 * THE SIGNAL BREAKING UP WHILE THE CAMERA PULLS AWAY.
 *
 * The reference tears its frame into horizontal slabs during a move: bands of
 * the picture slide sideways against each other, the channels come apart into
 * red and cyan at the seams, and coarse blocks of the image smear before the
 * shot settles. It reads as a transmission failing rather than as a lens
 * artefact, and that is the distinction this pass is built around — the two
 * effects already in the chain are both LENS effects. TravelFringe disperses
 * the channels the way glass does, TravelSmear defocuses the way an aperture
 * does, and neither can produce a hard horizontal seam because no lens makes
 * one. A tear is a DATA artefact: whole scanlines arriving at the wrong
 * offset. It needs its own pass and its own vocabulary.
 *
 * WHY NOT THE LIBRARY'S <Glitch>. postprocessing ships GlitchEffect, and it is
 * built for a different job: it fires on its own schedule (GlitchMode.SPORADIC
 * and friends) with its own random burst timing, and drives its displacement
 * from a generated perturbation map. That is right for an ambient malfunction
 * and wrong here, because this has to be a continuous function of how fast the
 * camera is actually travelling — silent when still, building as the move
 * builds, gone when it stops. Driving someone else's burst timer from `flight`
 * fights the effect rather than using it.
 *
 * DRIVEN FROM `flight`, LIKE ITS TWO SIBLINGS, AND FOR THE SAME REASON THE
 * NOTE IN Stage.jsx GIVES: two independent smoothings of the same scroll
 * velocity drift apart under fast movement, and the effects then read as three
 * separate faults instead of one impression of speed. `flight` is derived once
 * in ScrollProvider so all three stay locked together.
 *
 * It is a magnitude, so this fires on travel in either direction. That is
 * deliberate: an effect that appears only on the way out and vanishes on the
 * way back reads as a bug in the page rather than as a property of the move.
 *
 * THE CENTRE IS PROTECTED. Tearing is weighted radially so the middle of the
 * frame stays comparatively intact — which is both what the reference does and
 * what this scene needs, because the igloo sits dead centre for the whole
 * pull-away and is the one thing that must stay readable. Same reasoning as
 * TravelSmear's focus band, applied to a different artefact.
 */

/**
 * Peak sideways displacement of a torn band, in UV.
 *
 * HALVED FROM 0.075, AND THE FIRST VALUE WAS MEASURABLY TOO FAR.
 *
 * The displacement is signed, so this is a half-range: a band moves up to
 * ±TEAR_MAX. At 0.075 that is ±115px on a 1536-wide canvas, and with the
 * block term below it stacked on top the worst case reached ±157px — a tenth
 * of the frame, which is where a picture stops surviving as one image.
 *
 * That number came from the reference's hardest transition, but that is a
 * CUT: two states either side of a frame or two, where nothing has to stay
 * legible. Here the tear is held for as long as the scroll lasts, which is a
 * completely different demand. A displacement that reads as style for three
 * frames reads as a broken framebuffer when it is sustained for a second, and
 * it was in fact reported as exactly that.
 *
 * 0.035 is ±54px, ±75px worst case with the block term. Still unmistakably a
 * tear, but the bands stay close enough to their neighbours that the eye
 * reconstructs one picture across the seam instead of seeing the frame come
 * apart.
 */
const TEAR_MAX = 0.035;

/** Peak channel separation at the frame edge, in UV. ~11px at 1536 wide. */
const SPLIT_MAX = 0.0072;

/**
 * How much of the frame is torn at full travel.
 *
 * A third, down from a half. Tearing every band is a uniform horizontal jitter
 * and the eye reads it as the whole picture vibrating; leaving most of the
 * bands untouched is what makes the displaced ones read as displaced, because
 * there is something still beside them to measure against. At a half the
 * intact bands were no longer the majority and that reference was lost.
 */
const TORN_FRACTION = 0.34;

const FRAGMENT = /* glsl */ `
  uniform float uAmount;
  uniform float uTime;
  uniform float uAspect;

  float h11( float p ) {
    p = fract( p * 0.1031 );
    p *= p + 33.33;
    p *= p + p;
    return fract( p );
  }

  float h21( vec2 p ) {
    vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
    p3 += dot( p3, p3.yzx + 33.33 );
    return fract( ( p3.x + p3.y ) * p3.z );
  }

  void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
    float a = uAmount;

    // Nothing at rest. The opening frame and every settled frame is untouched,
    // and the early-out keeps the cost off the still shot entirely.
    if ( a < 0.002 ) {
      outputColor = inputColor;
      return;
    }

    /*
     * TIME IS QUANTISED, and this is the single thing that decides whether the
     * result reads as digital or as a wobble. Interpolating the displacement
     * smoothly gives a rubbery warp — the bands slide, and sliding is an
     * analogue motion. Real dropped data holds a wrong value for a frame or
     * three and then jumps. Stepping time at 18Hz forces that hold-and-jump,
     * and it is also why the tear pattern has to be a pure function of the
     * step index rather than of continuous time.
     */
    float step1 = floor( uTime * 18.0 );

    /* ── 1. CINEMATIC PRISMATIC DISPERSION & WARP (REF: IGLOO.INC ACT TRANSITION) ─
     * Rather than harsh square block tearing, the reference features:
     * - Prismatic rainbow spectral dispersion arcs (cyan/green/amber/red) radiating from the flanks
     * - Anamorphic radial sweep and soft wavy rippling along the terrain
     * - Center around the igloo preserved with high clarity
     */
    vec2 c = uv - 0.5;
    float r = length( c * vec2( uAspect, 1.0 ) );
    vec2 dir = r > 0.001 ? ( c / r ) : vec2( 0.0 );

    // Center mask: keep igloo crisp and clean, burst flares on outer flanks
    float flareMask = smoothstep( 0.18, 0.65, r );

    // Dynamic wave ripples across horizontal bands
    float wave = sin( uv.y * 24.0 + step1 * 2.1 ) * cos( uv.x * 12.0 - step1 * 1.5 );
    float waveFine = sin( uv.y * 62.0 - step1 * 4.2 );

    // Subtle horizontal motion shear
    float shear = ( wave * 0.014 + waveFine * 0.005 ) * a * flareMask;

    // Prismatic chromatic separation vector: radial + tangential stretch
    vec2 chromOffset = ( dir * 0.038 + vec2( shear, 0.0 ) ) * a * flareMask;

    // Spectral sampling: Red, Yellow/Green, Green/Cyan, Blue for rich rainbow fringes
    vec4 sRed   = texture2D( inputBuffer, clamp( uv - chromOffset * 1.35, 0.0, 1.0 ) );
    vec4 sAmber = texture2D( inputBuffer, clamp( uv - chromOffset * 0.70, 0.0, 1.0 ) );
    vec4 sGreen = texture2D( inputBuffer, clamp( uv, 0.0, 1.0 ) );
    vec4 sCyan  = texture2D( inputBuffer, clamp( uv + chromOffset * 0.70, 0.0, 1.0 ) );
    vec4 sBlue  = texture2D( inputBuffer, clamp( uv + chromOffset * 1.35, 0.0, 1.0 ) );

    // Reconstruct spectral color with vivid chromatic fringe
    vec3 col = vec3(
      sRed.r * 0.70 + sAmber.r * 0.30,
      sAmber.g * 0.25 + sGreen.g * 0.50 + sCyan.g * 0.25,
      sCyan.b * 0.30 + sBlue.b * 0.70
    );

    // Prismatic rainbow flare highlight on the flanks
    float rainbowGlow = a * flareMask * ( 0.6 + 0.4 * sin( r * 14.0 - step1 * 2.0 ) );
    vec3 rainbowTint = 0.5 + 0.5 * cos( vec3( 0.0, 2.0, 4.0 ) + r * 10.0 + uv.x * 4.0 );
    col += rainbowTint * 0.14 * rainbowGlow;

    // Subtle film noise during transition
    float st = h21( uv * vec2( 530.0, 910.0 ) + step1 * 1.7 );
    col += ( st - 0.5 ) * 0.035 * a * flareMask;

    outputColor = vec4( col, inputColor.a );
  }
`;

class TravelGlitchEffect extends Effect {
  constructor() {
    super('TravelGlitchEffect', FRAGMENT, {
      blendFunction: BlendFunction.NORMAL,
      /*
       * CONVOLUTION, because this samples inputBuffer away from the current
       * fragment. Without the attribute postprocessing is free to merge this
       * into a shared EffectPass with its neighbours, and a merged effect sees
       * the running colour of the chain rather than a sampleable texture — the
       * displaced reads would silently come from the wrong image. Declaring it
       * costs one extra pass and is the difference between correct and subtly
       * wrong.
       */
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([
        ['uAmount', new Uniform(0)],
        ['uTime', new Uniform(0)],
        ['uAspect', new Uniform(1.777)],
      ]),
    });
  }
}

/**
 * The tearing pass, wired to scroll velocity.
 *
 * GATED ON POSITION FIRST, SPEED SECOND — AND THE ORDER IS THE WHOLE POINT.
 *
 * This was originally driven off `flight` alone, the same smoothed scroll
 * velocity its two siblings use, which meant it fired on EVERY scroll. That is
 * wrong, and measuring the reference is what showed why. Scrolling igloo.inc
 * through its first scene is completely clean for the whole length of the
 * move — the camera dollies in, nothing tears — and the datamosh appears only
 * in the handful of frames where one scene is exchanged for the next, then is
 * gone again by the time the next scene settles.
 *
 * So the tear is not a property of MOVING. It is a property of ARRIVING
 * SOMEWHERE, and it is there to hide a cut. A tear that fires whenever the
 * page scrolls has no cut to hide and nothing to explain it, which is exactly
 * why it reads as the display being broken rather than as an effect.
 *
 * `bump` is therefore keyed to scroll POSITION and peaks only at an act
 * boundary. `motion` is a secondary gate on velocity, and it exists for one
 * specific failure: parked exactly on a boundary, the position term alone
 * would hold a frozen tear on screen indefinitely. Multiplying by speed means
 * a still page is always clean.
 *
 * Both terms are pure functions of scroll state, so the burst is scrubbable —
 * dragging back up through a boundary replays it identically instead of firing
 * a one-shot timer that only exists going forwards.
 */
export default function TravelGlitch() {
  const { flight, progress } = useWorldScroll();
  const camera = useThree((s) => s.camera);
  const effect = useMemo(() => new TravelGlitchEffect(), []);
  const uniforms = useRef(effect.uniforms);

  /*
   * ITS OWN PASS, EXPLICITLY, AND THIS IS NOT AN OPTIMISATION — IT IS THE
   * DIFFERENCE BETWEEN RENDERING AND THROWING.
   *
   * EffectComposer packs consecutive effects into one shared EffectPass, and
   * postprocessing enforces two rules when it does: a convolution effect may
   * never be merged with anything ("Convolution effects cannot be merged"),
   * and a convolution effect may never share a pass with one that rewrites UVs
   * ("Effects that transform UVs are incompatible with convolution effects").
   *
   * This effect is CONVOLUTION because it samples inputBuffer away from the
   * current fragment, and the effect immediately before it in the chain —
   * TravelFringe, a ChromaticAberration — is a mainUv effect. Handed to the
   * composer as a bare Effect the two land in the same pass, postprocessing
   * throws while building it, and the throw takes the whole Canvas subtree
   * with it: the scene does not degrade, it disappears.
   *
   * Constructing the EffectPass here sidesteps the packer entirely. The
   * composer's collector accepts anything that is `instanceof Pass` and adds
   * it as-is, so this arrives already isolated and the rules cannot be broken.
   */
  const pass = useMemo(() => new EffectPass(camera, effect), [camera, effect]);
  useEffect(() => () => pass.dispose(), [pass]);

  /* Dev only: this pass is only ever on WHILE the page is scrolling, which
     makes it the one effect in the chain that cannot be held still and looked
     at. Pinning the amount from the console is the difference between reading
     a number and checking one — same channel and same reason as __worldGl in
     Stage.jsx. Set window.__glitchHold to a 0-1 value to freeze it there, or
     null to hand it back to the scroll. */
  if (import.meta.env.DEV) window.__travelGlitch = effect;

  useFrame((state) => {
    const u = uniforms.current;
    const t = flight.current;
    const hold = import.meta.env.DEV ? window.__glitchHold : null;
    // Nearest act boundary, in progress units
    const p = progress.current;
    let nearest = Infinity;
    for (let i = 0; i < BOUNDARIES.length; i += 1) {
      const d = Math.abs(p - BOUNDARIES[i]);
      if (d < nearest) nearest = d;
    }

    // Triangular falloff, smoothstepped so the burst has no hard edge on it
    const linear = Math.max(0, 1 - nearest / BURST_HALF_WIDTH);
    const bump = linear * linear * (3 - 2 * linear);

    // Secondary gate: a stationary page is clean wherever it is parked
    const motion = Math.min(1, t * MOTION_GAIN);

    u.get('uAmount').value = typeof hold === 'number' ? hold : bump * motion;
    u.get('uTime').value = state.clock.elapsedTime;
    u.get('uAspect').value = state.size.width / Math.max(1, state.size.height);
  });

  return <primitive object={pass} dispose={null} />;
}

