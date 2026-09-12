import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Uniform } from 'three';
import { BlendFunction, Effect, EffectAttribute, EffectPass } from 'postprocessing';
import { useWorldScroll } from '../scroll/ScrollProvider.jsx';
import { ACTS } from '../chapters.js';

// Act transition boundaries derived from chapter data
const BOUNDARIES = ACTS.slice(1).map((a) => a.start);
const BURST_HALF_WIDTH = 0.038;
const MOTION_GAIN = 1.6;

const TEAR_MAX = 0.035;
const SPLIT_MAX = 0.0072;
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

    // Early out when effect amount is negligible
    if ( a < 0.002 ) {
      outputColor = inputColor;
      return;
    }

    // Quantize time steps to simulate digital scanline jitter
    float step1 = floor( uTime * 18.0 );

    vec2 c = uv - 0.5;
    float r = length( c * vec2( uAspect, 1.0 ) );
    vec2 dir = r > 0.001 ? ( c / r ) : vec2( 0.0 );

    // Mask center to keep igloo sharp while distorting flanks
    float flareMask = smoothstep( 0.18, 0.65, r );

    // Wave ripples across horizontal bands
    float wave = sin( uv.y * 24.0 + step1 * 2.1 ) * cos( uv.x * 12.0 - step1 * 1.5 );
    float waveFine = sin( uv.y * 62.0 - step1 * 4.2 );
    float shear = ( wave * 0.014 + waveFine * 0.005 ) * a * flareMask;

    // Chromatic dispersion offsets
    vec2 chromOffset = ( dir * 0.038 + vec2( shear, 0.0 ) ) * a * flareMask;

    // Multi-tap spectral sampling for chromatic fringe
    vec4 sRed   = texture2D( inputBuffer, clamp( uv - chromOffset * 1.35, 0.0, 1.0 ) );
    vec4 sAmber = texture2D( inputBuffer, clamp( uv - chromOffset * 0.70, 0.0, 1.0 ) );
    vec4 sGreen = texture2D( inputBuffer, clamp( uv, 0.0, 1.0 ) );
    vec4 sCyan  = texture2D( inputBuffer, clamp( uv + chromOffset * 0.70, 0.0, 1.0 ) );
    vec4 sBlue  = texture2D( inputBuffer, clamp( uv + chromOffset * 1.35, 0.0, 1.0 ) );

    vec3 col = vec3(
      sRed.r * 0.70 + sAmber.r * 0.30,
      sAmber.g * 0.25 + sGreen.g * 0.50 + sCyan.g * 0.25,
      sCyan.b * 0.30 + sBlue.b * 0.70
    );

    // Subtle edge flare and grain
    float rainbowGlow = a * flareMask * ( 0.6 + 0.4 * sin( r * 14.0 - step1 * 2.0 ) );
    vec3 rainbowTint = 0.5 + 0.5 * cos( vec3( 0.0, 2.0, 4.0 ) + r * 10.0 + uv.x * 4.0 );
    col += rainbowTint * 0.14 * rainbowGlow;

    float st = h21( uv * vec2( 530.0, 910.0 ) + step1 * 1.7 );
    col += ( st - 0.5 ) * 0.035 * a * flareMask;

    outputColor = vec4( col, inputColor.a );
  }
`;

class TravelGlitchEffect extends Effect {
  constructor() {
    super('TravelGlitchEffect', FRAGMENT, {
      blendFunction: BlendFunction.NORMAL,
      // Marked as CONVOLUTION because it samples inputBuffer with spatial offsets
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([
        ['uAmount', new Uniform(0)],
        ['uTime', new Uniform(0)],
        ['uAspect', new Uniform(1.777)],
      ]),
    });
  }
}

// Post-processing pass that adds chromatic aberration at act boundaries during motion
export default function TravelGlitch() {
  const { flight, progress } = useWorldScroll();
  const camera = useThree((s) => s.camera);
  const effect = useMemo(() => new TravelGlitchEffect(), []);
  const uniforms = useRef(effect.uniforms);

  // Wrap in explicit EffectPass to prevent incompatible pass merging
  const pass = useMemo(() => new EffectPass(camera, effect), [camera, effect]);
  useEffect(() => () => pass.dispose(), [pass]);

  useFrame((state) => {
    const u = uniforms.current;
    const t = flight.current;
    const p = progress.current;
    let nearest = Infinity;
    for (let i = 0; i < BOUNDARIES.length; i += 1) {
      const d = Math.abs(p - BOUNDARIES[i]);
      if (d < nearest) nearest = d;
    }

    // Triangular falloff centered at nearest act boundary
    const linear = Math.max(0, 1 - nearest / BURST_HALF_WIDTH);
    const bump = linear * linear * (3 - 2 * linear);

    // Gate effect by travel speed so stationary scenes stay clean
    const motion = Math.min(1, t * MOTION_GAIN);

    u.get('uAmount').value = bump * motion;
    u.get('uTime').value = state.clock.elapsedTime;
    u.get('uAspect').value = state.size.width / Math.max(1, state.size.height);
  });

  return <primitive object={pass} dispose={null} />;
}
