import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Uniform, Vector2, Vector3, Vector4 } from 'three';
import { BlendFunction, Effect, EffectAttribute, EffectPass } from 'postprocessing';
import { useWorldScroll } from '../scroll/ScrollProvider.jsx';
import { CUT_PARALLAX } from '../chapters.js';
import { createCutTexture } from '../lib/cut-texture.js';
import { ICE_PAGE } from '../lib/ice-page.js';

// Transition wipe and smear parameters
const DISPLACE = 0.025;
const STRETCH = 0.075;
const SMEAR = 0.05;
const SPREAD = 0.01;
const HAZE = 0.14;

const f = (n) => n.toFixed(4);

const FRAGMENT = /* glsl */ `
  #define PARALLAX ${f(CUT_PARALLAX)}
  #define DISPLACE ${f(DISPLACE)}
  #define STRETCH ${f(STRETCH)}
  #define SMEAR ${f(SMEAR)}
  #define SPREAD ${f(SPREAD)}
  #define HAZE ${f(HAZE)}
  #define TAPS 12

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

  // Smooth value noise for seamless procedural streaks
  float vnoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    f = f * f * ( 3.0 - 2.0 * f );
    float a = hash21( i );
    float b = hash21( i + vec2( 1.0, 0.0 ) );
    float c = hash21( i + vec2( 0.0, 1.0 ) );
    float d = hash21( i + vec2( 1.0, 1.0 ) );
    return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
  }

  // Smooth linear ramp clamped to [0, 1]
  float sweep( float x, float margin, float progress ) {
    float front = mix( -margin, 1.0, progress );
    return clamp( ( front + margin - x ) / margin, 0.0, 1.0 );
  }

  vec3 toLinear( vec3 c ) {
    return mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( 0.04045, c ) );
  }

  // Blends two color stops with premultiplied alpha
  vec3 overGradient( vec4 a, vec4 b, float t, vec3 below ) {
    vec3 pm = mix( a.rgb * a.a, b.rgb * b.a, t );
    return pm + below * ( 1.0 - mix( a.a, b.a, t ) );
  }

  // Generates the ice background surface for the work page in linear space
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

  // Spectral tint weight function
  vec3 spectrum( float t ) {
    return vec3( 1.0 - t, 1.0 - abs( t * 2.0 - 1.0 ), t ) + 0.1;
  }

  // Multi-tap directional smear with chromatic dispersion for the 3D world scene
  vec3 smearWorld( vec2 uv, vec2 drag, float spread, float jitter ) {
    vec2 dir = uv - 0.5;
    vec3 sum = vec3( 0.0 );
    vec3 weight = vec3( 0.0 );
    for ( int i = 0; i < TAPS; i++ ) {
      float t = ( float( i ) + jitter ) / float( TAPS );
      vec3 w = spectrum( t );
      vec2 at = uv + drag * t - dir * spread * ( t - 0.5 );
      sum += texture2D( inputBuffer, clamp( at, 0.0, 1.0 ) ).rgb * w;
      weight += w;
    }
    return sum / weight;
  }

  // Multi-tap directional smear for incoming ice page
  vec3 smearIce( vec2 uv, vec2 drag, float spread, float jitter ) {
    vec2 dir = uv - 0.5;
    vec3 sum = vec3( 0.0 );
    vec3 weight = vec3( 0.0 );
    for ( int i = 0; i < TAPS; i++ ) {
      float t = ( float( i ) + jitter ) / float( TAPS );
      vec3 w = spectrum( t );
      sum += iceGround( uv + drag * t - dir * spread * ( t - 0.5 ) ) * w;
      weight += w;
    }
    return sum / weight;
  }

  void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
    float p = uCut;

    // Passthrough before transition begins
    if ( p <= 0.0 ) {
      outputColor = inputColor;
      return;
    }

    // Fully transitioned page
    if ( p >= 1.0 ) {
      outputColor = vec4( iceGround( uv ), 1.0 );
      return;
    }

    // Simple crossfade for reduced motion preference
    if ( uReduced > 0.5 ) {
      outputColor = vec4( mix( inputColor.rgb, iceGround( uv ), p ), 1.0 );
      return;
    }

    // Sample mask in aspect-corrected UV space
    vec2 uvTex = vec2( ( uv.x - 0.5 ) * uAspect + 0.5, uv.y );
    vec3 blk = texture2D( tCut, uvTex ).rgb;

    // Calculate diagonal wipe boundary
    float slope = 0.2 * uAspect;
    float x = uv.y + ( uv.x + ( blk.b * 2.0 - 1.0 ) * 0.4 ) * slope;
    float xn = ( x + 0.4 * slope ) / ( 1.0 + 1.8 * slope );

    float blurField = sweep( xn, 2.0, p );
    float shoveField = sweep( xn, 0.9, p );
    float cutField = sweep( xn, 0.2, p );

    float seam = cutField * ( 1.0 - cutField ) * 4.0;
    float wake = shoveField * ( 1.0 - shoveField ) * 4.0;

    // Procedural noise streaks and directional drag vector
    float streak = vnoise( vec2( uv.x * 2.5, uv.y * 46.0 ) + blk.b * 3.0 ) * 2.0 - 1.0;
    float fibre = vnoise( vec2( uv.x * 6.0 + 7.3, uv.y * 120.0 ) );
    vec2 drag = vec2(
      streak * STRETCH * ( 0.35 + fibre ) * ( seam + 0.5 * wake ),
      SMEAR * wake
    );

    // Multi-sample the block wipe mask along the drag direction
    float r = 0.0;
    for ( int k = 0; k < 4; k++ ) {
      vec2 o = drag * ( float( k ) / 3.0 );
      r += texture2D( tCut, uvTex + vec2( o.x * uAspect, o.y ) ).r;
    }
    r *= 0.25;

    float cut = sweep( r, 2.0, cutField );
    float shove = sweep( blk.g, 1.0, shoveField );
    float jitter = hash21( gl_FragCoord.xy );

    float edge = ( 1.0 - smoothstep( 0.7, 1.0, abs( uv.x * 2.0 - 1.0 ) ) )
               * ( 1.0 - smoothstep( 0.7, 1.0, abs( uv.y * 2.0 - 1.0 ) ) );
    float modulator = 12.0 * edge;

    vec3 world = vec3( 0.0 );
    vec3 page = vec3( 0.0 );

    if ( cut < 1.0 ) {
      vec2 at = uv - vec2( streak * STRETCH * 0.25 * seam, PARALLAX * p * p + DISPLACE * shove );
      world = smearWorld( at, drag, SPREAD * modulator * blurField, jitter );
    }

    if ( cut > 0.0 ) {
      float q = 1.0 - p;
      vec2 at = uv + vec2( streak * STRETCH * 0.12 * seam, PARALLAX * q * q + DISPLACE * ( 1.0 - shove ) );
      page = smearIce( at, drag * 0.5, SPREAD * modulator * ( 1.0 - blurField ), jitter );
    }

    vec3 color = mix( world, page, cut );

    // Frost glow on the transition seam
    color = mix( color, vec3( 1.0 ), HAZE * wake * ( 1.0 - 0.5 * cut ) );

    outputColor = vec4( clamp( color, 0.0, 1.0 ), 1.0 );
  }
`;

const rgb = (c) => new Vector3(c[0] / 255, c[1] / 255, c[2] / 255);
const rgba = (c) => new Vector4(c[0] / 255, c[1] / 255, c[2] / 255, c[3]);

class IceCutEffect extends Effect {
  constructor(texture) {
    super('IceCutEffect', FRAGMENT, {
      blendFunction: BlendFunction.NORMAL,
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

// Fullscreen post-processing transition from 3D world to 2D ice page
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

  useFrame((state) => {
    const u = effect.uniforms;
    u.get('uCut').value = cut.current;
    u.get('uAspect').value = state.size.width / Math.max(1, state.size.height);
    u.get('uViewport').value.set(state.size.width, state.size.height);
    u.get('uReduced').value = reduced ? 1 : 0;
  });

  return <primitive object={pass} dispose={null} />;
}

// Pauses R3F rendering loop once page transition is complete to save GPU resources
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

  // Request frame on canvas resize
  useEffect(() => {
    invalidate();
  }, [size, invalidate]);

  return null;
}
