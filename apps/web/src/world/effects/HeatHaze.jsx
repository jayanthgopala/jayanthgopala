import { forwardRef, useMemo } from 'react';
import { Effect } from 'postprocessing';
import { Uniform } from 'three';

// Postprocessing refraction shader simulating upward rising heat haze
const HAZE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uStrength;
  uniform float uScale;
  uniform float uRise;
  uniform float uFloor;
  uniform float uCeil;

  float hazeHash( vec2 p ) {
    return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
  }

  float hazeNoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix(
      mix( hazeHash( i ), hazeHash( i + vec2( 1.0, 0.0 ) ), u.x ),
      mix( hazeHash( i + vec2( 0.0, 1.0 ) ), hazeHash( i + vec2( 1.0, 1.0 ) ), u.x ),
      u.y
    );
  }

  void mainUv( inout vec2 uv ) {
    vec2 q = vec2( uv.x * uScale, uv.y * uScale * 0.25 );

    float a = hazeNoise( q + vec2( 0.0, -uTime * uRise ) );
    float b = hazeNoise( q * 2.07 + vec2( 3.7, -uTime * uRise * 1.55 ) );

    // Independent displacement axes
    vec2 d = vec2( a - 0.5, ( b - 0.5 ) * 0.6 );

    // Vertical bounds smoothstep mask
    float rise = smoothstep( uFloor, uFloor + 0.22, uv.y );
    float fade = 1.0 - smoothstep( uCeil - 0.18, uCeil, uv.y );

    uv += d * uStrength * rise * fade;
  }
`;

class HeatHazeEffect extends Effect {
  constructor({ strength = 0.0032, scale = 9.0, rise = 0.05, floor = 0.02, ceil = 0.72 } = {}) {
    super('HeatHaze', HAZE_FRAG, {
      uniforms: new Map([
        ['uTime', new Uniform(0)],
        ['uStrength', new Uniform(strength)],
        ['uScale', new Uniform(scale)],
        ['uRise', new Uniform(rise)],
        ['uFloor', new Uniform(floor)],
        ['uCeil', new Uniform(ceil)],
      ]),
    });
  }

  update(renderer, inputBuffer, deltaTime) {
    this.uniforms.get('uTime').value += deltaTime;
  }
}

const HeatHaze = forwardRef(function HeatHaze(props, ref) {
  const effect = useMemo(() => new HeatHazeEffect(props), [
    props.strength,
    props.scale,
    props.rise,
    props.floor,
    props.ceil,
  ]);
  return <primitive ref={ref} object={effect} dispose={null} />;
});

export default HeatHaze;
