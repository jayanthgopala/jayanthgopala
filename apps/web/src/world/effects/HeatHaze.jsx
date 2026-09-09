import { forwardRef, useMemo } from 'react';
import { Effect } from 'postprocessing';
import { Uniform } from 'three';

/**
 * Rising air.
 *
 * THE THING ABOVE A HOT DRINK, AND IT IS NOT A PARTICLE EFFECT.
 *
 * The shimmer over a coffee is not smoke and it is not steam you can see — most
 * of the time there is nothing there to see at all. What the eye picks up is
 * REFRACTION: rising air is warmer and therefore less dense than the air around
 * it, so light bends as it crosses the boundary, and what is BEHIND the column
 * appears to wobble. Nothing is drawn; something already drawn is displaced.
 *
 * That is why this is a post-processing effect and not geometry. Every attempt
 * to do it with particles fails in the same way — you end up drawing visible
 * puffs, which is smoke, a completely different phenomenon that happens to
 * occupy the same place. The give-away in a render is always that you can see
 * the thing itself rather than seeing through it.
 *
 * postprocessing's `mainUv` hook is exactly the right entry point: it runs
 * before the frame is sampled and lets the shader decide WHERE each output pixel
 * reads from. Displacing that read is refraction, in one function, with no extra
 * draw calls and no sorting.
 */

/*
 * THE THREE PROPERTIES THAT MAKE IT READ AS RISING AIR RATHER THAN AS A WOBBLE.
 *
 *   1. IT SCROLLS UPWARD, ALWAYS. The noise is sampled at a v that decreases
 *      with time, so features travel up the frame. This is the single strongest
 *      cue and it is the one a generic distortion shader gets wrong by animating
 *      the noise in place — turbulence that boils without moving reads as a bad
 *      video codec, not as convection.
 *   2. IT IS STRETCHED VERTICALLY. Rising air organises into columns, so the
 *      field is sampled with its vertical axis compressed: features come out
 *      several times taller than they are wide. Isotropic noise gives round
 *      blobs, which is what boiling water looks like from above, not what a
 *      thermal looks like from the side.
 *   3. IT GETS STRONGER AS IT RISES, THEN STOPS. A thermal starts as a tight
 *      ordered column and breaks up as it entrains the air around it, so the
 *      distortion grows with height — and then has to be faded out before the
 *      top of frame, because a displacement that runs off the edge of the screen
 *      drags in whatever is outside it and shows a smeared border.
 *
 * TWO OCTAVES AT DIFFERENT RATES, for the same reason Clouds.jsx uses three
 * layers: one field moving at one speed is a texture being slid, and it is the
 * shear between fields that turns motion into behaviour.
 */
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
    /* Vertical squash: one unit across is four units up, so the cells come out
       as columns. See note 2 above. */
    vec2 q = vec2( uv.x * uScale, uv.y * uScale * 0.25 );

    float a = hazeNoise( q + vec2( 0.0, -uTime * uRise ) );
    float b = hazeNoise( q * 2.07 + vec2( 3.7, -uTime * uRise * 1.55 ) );

    /*
     * The two octaves drive the two axes separately rather than being summed.
     * Summing gives a single displacement direction per pixel and the frame
     * appears to slide; independent fields give a genuine shear, which is what
     * makes the edge of a distant ridge ripple rather than translate.
     */
    vec2 d = vec2( a - 0.5, ( b - 0.5 ) * 0.6 );

    /*
     * THE ENVELOPE. Zero at the bottom of frame, full through the middle, back
     * to zero before the top — see note 3. uv.y is 0 at the bottom in this
     * space, so the column builds as it rises and is gone before it can drag
     * anything in from outside the frame.
     */
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

  /* postprocessing drives this every frame; `deltaTime` is seconds. */
  update(renderer, inputBuffer, deltaTime) {
    this.uniforms.get('uTime').value += deltaTime;
  }
}

/**
 * `wrapEffect` is not used here because the effect takes an options object
 * rather than positional arguments, and the wrapper spreads props positionally.
 * A five-line forwardRef is clearer than fighting that.
 */
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
