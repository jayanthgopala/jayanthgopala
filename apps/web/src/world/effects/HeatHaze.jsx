import { forwardRef, useMemo } from 'react';
import { Effect } from 'postprocessing';
import { Uniform } from 'three';

// Rising air, as refraction rather than a particle effect. Nothing is drawn, something already drawn is displaced.
// Every particle attempt ends up drawing visible puffs, which is smoke, a different phenomenon in the same place.
// postprocessing's mainUv hook runs before the frame is sampled and lets the shader choose where each pixel reads from.
//
// Three things make it read as rising air. It scrolls upward always, noise animated in place reads as a bad codec.
// It's stretched vertically, isotropic noise gives round blobs which is boiling water seen from above.
// It strengthens as it rises then fades before the top, or the displacement drags in what's outside the frame.
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
    // one unit across is four up, so the cells come out as columns
    vec2 q = vec2( uv.x * uScale, uv.y * uScale * 0.25 );

    float a = hazeNoise( q + vec2( 0.0, -uTime * uRise ) );
    float b = hazeNoise( q * 2.07 + vec2( 3.7, -uTime * uRise * 1.55 ) );

    // The two octaves drive the two axes separately rather than being summed. Summing gives one displacement
    // direction per pixel and the frame appears to slide, independent fields give a real shear.
    vec2 d = vec2( a - 0.5, ( b - 0.5 ) * 0.6 );

    // zero at the bottom, full through the middle, back to zero before the top so nothing is dragged in from outside
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

  // postprocessing drives this every frame, deltaTime is seconds
  update(renderer, inputBuffer, deltaTime) {
    this.uniforms.get('uTime').value += deltaTime;
  }
}

// No wrapEffect, the effect takes an options object and the wrapper spreads props positionally.
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
