import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Uniform, Vector2, Vector3, Vector4 } from 'three';
import { BlendFunction, Effect, EffectAttribute, EffectPass } from 'postprocessing';
import { useWorldScroll } from '../scroll/ScrollProvider.jsx';
import { CUT_PARALLAX } from '../chapters.js';
import { createCutTexture } from '../lib/cut-texture.js';
import { ICE_PAGE } from '../lib/ice-page.js';

/**
 * THE CUT FROM THE WORLD TO THE WORK PAGE.
 *
 * Ported from the reference's own composite shader rather than built by eye,
 * and the behaviour it has to reproduce is specific:
 *
 *   - The world slides UP and out of the frame while the page rises in from
 *     below, both on a squared ease over the same 40% of the frame height.
 *   - The seam between them is a DIAGONAL front, lower-left first, broken into
 *     rectangular chunks by a block texture so the wipe arrives as blocks rather
 *     than as a line.
 *   - Along that seam both pictures are pushed a little further, torn sideways
 *     into horizontal bands, and split into a rainbow — the world fringing more
 *     as it leaves, the page less as it arrives, so the page lands sharp.
 *
 * SCRUBBED, NOT PLAYED. Every term is a pure function of scroll position, so the
 * cut stops where the scroll stops and runs backwards when the scroll does —
 * which is what the reference does, and why it reads as a place you move
 * through rather than an animation you trigger.
 *
 * THE PAGE IS DRAWN HERE. Scene two is the ice ground from lib/ice-page.js,
 * evaluated per fragment, because a wipe can only reveal something it can
 * sample. The text lives in the DOM above it (WorkPage.jsx), riding the same
 * parallax.
 *
 * ON THE LENS, NOT THE SUBJECT. It is a screen-space pass; the igloo is never
 * touched, scaled or lit by it.
 */

/** Extra vertical shove along the seam, as a fraction of the frame. From the reference. */
const DISPLACE = 0.025;
/** Sideways tear at the seam — the horizontal stretch bands. */
const STRETCH = 0.05;
/**
 * Chromatic spread. With the 12x modulator in the middle of the frame, a
 * full-strength fringe splits the channels by about 3.5% of the frame at its
 * outer reach — wide enough to read as a rainbow smear, which is what the
 * reference shows, rather than as a lens defect.
 */
const SPREAD = 0.012;

const f = (n) => n.toFixed(4);

const FRAGMENT = /* glsl */ `
  #define PARALLAX ${f(CUT_PARALLAX)}
  #define DISPLACE ${f(DISPLACE)}
  #define STRETCH ${f(STRETCH)}
  #define SPREAD ${f(SPREAD)}

  uniform sampler2D tCut;
  uniform float uCut;
  uniform float uAspect;
  uniform float uReduced;
  uniform vec2 uViewport;

  uniform vec3 uIceBase;
  uniform vec4 uIceDot;
  uniform vec2 uIceDotSize;
  uniform vec4 uGlowCentre;
  uniform vec4 uGlowEdge;
  uniform vec4 uWashTop;
  uniform vec4 uWashBottom;
  uniform float uWashClear;

  float hash21( vec2 p ) {
    vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
    p3 += dot( p3, p3.yzx + 33.33 );
    return fract( ( p3.x + p3.y ) * p3.z );
  }

  /*
   * The reference's falloff(): a front sweeping across x as progress runs
   * 0 -> 1, soft over "margin". Exactly 0 everywhere at progress 0 and exactly
   * 1 everywhere at progress 1, for any x in 0..1.
   */
  float sweep( float x, float margin, float progress ) {
    float front = mix( -margin, 1.0, progress );
    return clamp( ( front + margin - x ) / margin, 0.0, 1.0 );
  }

  vec3 toLinear( vec3 c ) {
    return mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( 0.04045, c ) );
  }

  /* A CSS gradient layer over what is below it: stops interpolated
     premultiplied, the way browsers do. */
  vec3 overGradient( vec4 a, vec4 b, float t, vec3 below ) {
    vec3 pm = mix( a.rgb * a.a, b.rgb * b.a, t );
    return pm + below * ( 1.0 - mix( a.a, b.a, t ) );
  }

  /*
   * The page's ground. Built in CSS pixels from the top-left, in sRGB, in
   * the layer order of the stylesheet it replaces — then converted to linear,
   * because the chain is linear until the final pass encodes for the display.
   */
  vec3 iceGround( vec2 uv ) {
    vec2 px = vec2( uv.x, 1.0 - uv.y ) * uViewport;
    vec3 c = uIceBase;

    vec2 cell = px - uIceDotSize.y * floor( px / uIceDotSize.y + 0.5 );
    float dotMask = 1.0 - smoothstep( uIceDotSize.x - 0.5, uIceDotSize.x + 0.5, length( cell ) );
    c = mix( c, uIceDot.rgb, uIceDot.a * dotMask );

    vec2 halfSize = uViewport * 0.5;
    float r = clamp( length( px - halfSize ) / length( halfSize ), 0.0, 1.0 );
    c = overGradient( uGlowCentre, uGlowEdge, r, c );

    float y = clamp( px.y / uViewport.y, 0.0, 1.0 );
    c = y < uWashClear
      ? overGradient( uWashTop, vec4( 0.0 ), y / uWashClear, c )
      : overGradient( vec4( 0.0 ), uWashBottom, ( y - uWashClear ) / ( 1.0 - uWashClear ), c );

    return toLinear( c );
  }

  /* Five taps across the spectrum, red to blue, along the line from the frame
     centre. The weights sum to (2.5, 2.0, 2.5), so a zero spread is the plain
     sample. */
  vec3 spectralWorld( vec2 uv, float spread ) {
    vec2 dir = uv - 0.5;
    vec3 sum = vec3( 0.0 );
    for ( int i = 0; i < 5; i++ ) {
      float t = float( i ) * 0.25;
      vec3 w = vec3( 1.0 - t, 1.0 - abs( t * 2.0 - 1.0 ), t );
      sum += texture2D( inputBuffer, clamp( uv - dir * spread * ( t - 0.5 ), 0.0, 1.0 ) ).rgb * w;
    }
    return sum / vec3( 2.5, 2.0, 2.5 );
  }

  vec3 spectralIce( vec2 uv, float spread ) {
    vec2 dir = uv - 0.5;
    vec3 sum = vec3( 0.0 );
    for ( int i = 0; i < 5; i++ ) {
      float t = float( i ) * 0.25;
      vec3 w = vec3( 1.0 - t, 1.0 - abs( t * 2.0 - 1.0 ), t );
      sum += iceGround( uv - dir * spread * ( t - 0.5 ) ) * w;
    }
    return sum / vec3( 2.5, 2.0, 2.5 );
  }

  void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
    float p = uCut;

    // The world, untouched, for the whole journey before the cut.
    if ( p <= 0.0 ) {
      outputColor = inputColor;
      return;
    }

    // The page, and nothing else, once it has fully arrived.
    if ( p >= 1.0 ) {
      outputColor = vec4( iceGround( uv ), 1.0 );
      return;
    }

    // Reduced motion: the same two pictures, crossfaded. No travel, no tearing.
    if ( uReduced > 0.5 ) {
      outputColor = vec4( mix( inputColor.rgb, iceGround( uv ), p ), 1.0 );
      return;
    }

    // Square blocks on screen: the texture is sampled in aspect-corrected space.
    vec2 uvTex = vec2( ( uv.x - 0.5 ) * uAspect + 0.5, uv.y );
    vec3 blk = texture2D( tCut, uvTex ).rgb;

    /*
     * The diagonal. Height plus a share of the horizontal position, jittered
     * by the block texture's blue channel so the front is ragged — lower-left
     * is covered first, upper-right last. Normalised back to 0..1 so the three
     * sweeps below start and finish exactly with the scroll.
     */
    float slope = 0.2 * uAspect;
    float x = uv.y + ( uv.x + ( blk.b * 2.0 - 1.0 ) * 0.4 ) * slope;
    float xn = ( x + 0.4 * slope ) / ( 1.0 + 1.8 * slope );

    float blurField = sweep( xn, 2.0, p );   // broad: how hard each side fringes
    float shoveField = sweep( xn, 0.9, p );  // medium: the seam push
    float cutField = sweep( xn, 0.2, p );    // narrow: the wipe itself

    float shove = sweep( blk.g, 1.0, shoveField );
    float cut = sweep( blk.r, 2.0, cutField );

    // Horizontal bands slide sideways only on the seam itself.
    float seam = cutField * ( 1.0 - cutField ) * 4.0;
    float tear = ( blk.g * 2.0 - 1.0 ) * STRETCH * seam;

    /*
     * STATIC GRAIN, where the reference animates its blue noise. The grain
     * breaks the five taps up so they read as a smear rather than as five
     * ghost images — but a still page parked mid-cut must be still, and a
     * per-frame offset would make it crawl.
     */
    float grainWorld = hash21( gl_FragCoord.xy );
    float grainPage = hash21( gl_FragCoord.yx + 19.19 );

    // 12 through the middle of the frame, easing to 0 at its very edge.
    float edge = ( 1.0 - smoothstep( 0.7, 1.0, abs( uv.x * 2.0 - 1.0 ) ) )
               * ( 1.0 - smoothstep( 0.7, 1.0, abs( uv.y * 2.0 - 1.0 ) ) );
    float modulator = 12.0 * edge;

    vec3 world = vec3( 0.0 );
    vec3 page = vec3( 0.0 );

    if ( cut < 1.0 ) {
      vec2 at = uv - vec2( tear, PARALLAX * p * p + DISPLACE * shove );
      world = spectralWorld( at, SPREAD * modulator * blurField * grainWorld );
    }

    if ( cut > 0.0 ) {
      float q = 1.0 - p;
      vec2 at = uv + vec2( tear * 0.5, PARALLAX * q * q + DISPLACE * ( 1.0 - shove ) );
      page = spectralIce( at, SPREAD * modulator * ( 1.0 - blurField ) * grainPage );
    }

    outputColor = vec4( clamp( mix( world, page, cut ), 0.0, 1.0 ), 1.0 );
  }
`;

const rgb = (c) => new Vector3(c[0] / 255, c[1] / 255, c[2] / 255);
const rgba = (c) => new Vector4(c[0] / 255, c[1] / 255, c[2] / 255, c[3]);

class IceCutEffect extends Effect {
  constructor(texture) {
    super('IceCutEffect', FRAGMENT, {
      blendFunction: BlendFunction.NORMAL,
      /* CONVOLUTION: it samples inputBuffer away from the current fragment.
         See TravelGlitch for what goes wrong without it. */
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([
        ['tCut', new Uniform(texture)],
        ['uCut', new Uniform(0)],
        ['uAspect', new Uniform(1.777)],
        ['uReduced', new Uniform(0)],
        ['uViewport', new Uniform(new Vector2(1, 1))],
        ['uIceBase', new Uniform(rgb(ICE_PAGE.base))],
        ['uIceDot', new Uniform(rgba([...ICE_PAGE.dot.color, ICE_PAGE.dot.alpha]))],
        ['uIceDotSize', new Uniform(new Vector2(ICE_PAGE.dot.radius, ICE_PAGE.dot.spacing))],
        ['uGlowCentre', new Uniform(rgba(ICE_PAGE.glow.centre))],
        ['uGlowEdge', new Uniform(rgba(ICE_PAGE.glow.edge))],
        ['uWashTop', new Uniform(rgba(ICE_PAGE.wash.top))],
        ['uWashBottom', new Uniform(rgba(ICE_PAGE.wash.bottom))],
        ['uWashClear', new Uniform(ICE_PAGE.wash.clearAt)],
      ]),
    });
  }
}

/**
 * The cut, as the last pass in the chain.
 *
 * LAST, because it is not the camera. Bloom, the tone map, the vignette and the
 * travel fringe are all the world being photographed; this is one picture being
 * exchanged for another, and the page it brings in must not be bloomed, tone
 * mapped or vignetted on the way.
 *
 * ITS OWN EffectPass, for the same reason TravelGlitch builds one: a
 * convolution effect cannot share a pass with the ChromaticAberration before
 * it, and handing it to the composer bare would throw and take the Canvas down.
 */
export default function IceCut() {
  const { cut } = useWorldScroll();
  const camera = useThree((s) => s.camera);
  const texture = useMemo(() => createCutTexture(), []);
  const effect = useMemo(() => new IceCutEffect(texture), [texture]);
  const pass = useMemo(() => new EffectPass(camera, effect), [camera, effect]);
  const reduced = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );

  useEffect(() => () => pass.dispose(), [pass]);
  useEffect(() => () => texture.dispose(), [texture]);

  /* Dev only: the cut is a scroll position, which makes a single frame of it
     hard to hold still and look at. window.__cutHold = 0.5 pins the shader
     there; null hands it back to the scroll. Same channel as __glitchHold. */
  if (import.meta.env.DEV) window.__iceCut = effect;

  useFrame((state) => {
    const u = effect.uniforms;
    const hold = import.meta.env.DEV ? window.__cutHold : null;
    u.get('uCut').value = typeof hold === 'number' ? hold : cut.current;
    u.get('uAspect').value = state.size.width / Math.max(1, state.size.height);
    u.get('uViewport').value.set(state.size.width, state.size.height);
    u.get('uReduced').value = reduced ? 1 : 0;
  });

  return <primitive object={pass} dispose={null} />;
}

/**
 * Stops rendering the world once the page has covered it.
 *
 * With the cut complete every pixel on the canvas is the ice ground, which
 * does not change. Rendering the terrain, the igloo and the whole post chain
 * underneath it sixty times a second to throw every one of those pixels away
 * is the most expensive nothing on the site. So the loop drops to 'demand' and
 * the canvas keeps showing the last frame it drew — the finished page — until
 * the scroll comes back up into the cut.
 *
 * Driven from its own rAF rather than useFrame, because once the R3F loop is
 * parked useFrame is exactly the thing that no longer runs.
 */
export function CutFrameGate() {
  const { cut } = useWorldScroll();
  const setFrameloop = useThree((s) => s.setFrameloop);
  const invalidate = useThree((s) => s.invalidate);
  const size = useThree((s) => s.size);

  useEffect(() => {
    let frame = 0;
    let held = false;
    let covered = 0;

    const tick = () => {
      if (cut.current >= 1) {
        /* A few frames at full cover first, so the frame left on the canvas is
           the finished page and not the last step of the wipe. */
        covered += 1;
        if (!held && covered > 3) {
          held = true;
          setFrameloop('demand');
        }
      } else {
        covered = 0;
        if (held) {
          held = false;
          setFrameloop('always');
          /* A parked loop does not restart on its own when the mode changes. */
          invalidate();
        }
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      setFrameloop('always');
    };
  }, [cut, setFrameloop, invalidate]);

  /* A resize clears the canvas. While the loop is parked nothing would redraw
     it, so ask for exactly one frame. */
  useEffect(() => {
    invalidate();
  }, [size, invalidate]);

  return null;
}
