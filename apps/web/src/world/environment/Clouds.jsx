import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BackSide, Color, ShaderMaterial, SphereGeometry } from 'three';
import { LOOK } from '../lib/lighting.js';

/**
 * Cloud that actually moves.
 *
 * WHY THIS IS NOT IN Sky.jsx, WHICH ALREADY DRAWS CLOUD. That file paints a
 * 1024x512 canvas once, on the CPU, and uploads it as an equirectangular
 * background. For a gradient that is exactly right — it is evaluated a
 * half-million times at startup and never again. For WEATHER it is exactly
 * wrong: moving the field by a few pixels would mean re-running the whole noise
 * stack and re-uploading the texture every frame, on the main thread, which is
 * several milliseconds of blocking work per frame to animate something the eye
 * can barely see move.
 *
 * The same field evaluated per-fragment on the GPU costs nothing measurable and
 * can be moved by adding a clock to its input. So the painted field is switched
 * off (LOOK.paintedCloud.enabled) and this draws over the gradient instead.
 *
 * IT IS STILL IN THE ENVIRONMENT MAP AS A STATIC APPROXIMATION, and that is
 * deliberate rather than an inconsistency. The IBL is a very broad irradiance —
 * it is the average of a whole hemisphere of sky per lookup — and no amount of
 * cloud movement changes that average in a way any surface could show. Baking
 * the cover into the map once and animating only what the camera sees directly
 * is the right split.
 */

/*
 * THE SKY-PLANE PROJECTION, AND IT IS THE ONE THING THAT MAKES THIS READ AS
 * CLOUD RATHER THAN AS A TEXTURED BALL.
 *
 * The obvious mapping for a dome is spherical: turn the view direction into a
 * latitude and longitude and sample the noise there. It looks wrong immediately
 * and the reason is worth stating, because it is the same mistake as sampling
 * terrain fbm on the plain world axes. Real cloud is a LAYER — a roughly flat
 * sheet at a fixed altitude — so its features get smaller and closer together
 * toward the horizon, converging on the skyline in a way that is pure
 * perspective. A spherical mapping gives features of constant angular size all
 * the way down, which reads as a painted dome because that is what it is.
 *
 * Dividing the horizontal direction by the vertical one intersects the view ray
 * with a flat plane overhead, so the noise is sampled where the ray actually
 * crosses the cloud deck. Everything else follows from that for free: the
 * convergence at the horizon, the way movement slows as features recede, and
 * the fact that a scroll in the plane looks like wind rather than like a
 * texture being dragged.
 */
const CLOUD_SHADER = /* glsl */ `
  varying vec3 vDir;
  uniform float uTime;
  uniform vec3 uLit;
  uniform vec3 uShade;
  uniform vec3 uScale;
  uniform vec3 uSpeed;
  uniform float uCoverage;
  uniform float uSoftness;
  uniform float uOpacity;
  uniform float uHorizonFade;

  float hash( vec2 p ) {
    return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
  }

  float vnoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix(
      mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), u.x ),
      mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), u.x ),
      u.y
    );
  }

  /* Four octaves, normalised so the result genuinely spans 0..1 — without the
     divide the field sits around 0.47 and every coverage threshold written for
     a 0..1 signal lands in the wrong place. Same correction, and the same
     reason, as the ground fog's fbm in Terrain.jsx. */
  float fbm( vec2 p ) {
    float v = 0.0;
    float a = 0.5;
    for ( int i = 0; i < 4; i ++ ) {
      v += a * vnoise( p );
      /* Not exactly 2, so the octaves never line their grids up and the lattice
         the value noise is built on stays invisible. */
      p *= 2.03;
      a *= 0.5;
    }
    return v / 0.9375;
  }

  void main() {
    vec3 d = normalize( vDir );

    /*
     * Everything below the horizon is discarded rather than faded. The dome is a
     * full sphere because that is the cheapest geometry to be inside of, but
     * there is no cloud under the ground and drawing any would put a band of it
     * behind the terrain, where the fog would then have to remove it again.
     */
    if ( d.y <= 0.0 ) discard;

    /* The clamp is what stops the projection going to infinity at the skyline.
       It also fixes the finest feature size the field can reach, which is what
       keeps the horizon from aliasing into noise. */
    vec2 p = d.xz / max( d.y, 0.06 );

    /*
     * THREE LAYERS AT THREE SPEEDS, WHICH IS THE WHOLE TRICK.
     *
     * One scrolling field reads as a texture being dragged across the sky: every
     * feature moves the same way at the same rate, which nothing in the
     * atmosphere does. Three fields at different scales moving at different
     * speeds shear against each other continuously, so the SHAPES change as well
     * as their positions — and shapes changing is the difference between weather
     * and moving wallpaper.
     *
     * The directions differ as well as the rates. A common prevailing drift with
     * a cross-component per layer is what real decks do, and it means the
     * interference pattern never repeats.
     */
    float f = 0.0;
    f += 0.50 * fbm( p * uScale.x + uTime * uSpeed.x * vec2( 1.00,  0.22 ) );
    f += 0.32 * fbm( p * uScale.y + uTime * uSpeed.y * vec2( 0.88, -0.30 ) );
    f += 0.18 * fbm( p * uScale.z + uTime * uSpeed.z * vec2( 0.60,  0.50 ) );

    /*
     * COVERAGE AND SOFTNESS. The threshold decides how much sky is cloud; the
     * width of the ramp around it decides what KIND of cloud. A narrow ramp
     * gives hard-edged cumulus in clear air; a wide one gives an overcast deck
     * with no edges anywhere, which is the weather this look is after.
     */
    float a = smoothstep( uCoverage - uSoftness * 0.5, uCoverage + uSoftness * 0.5, f );

    /* Denser is brighter: the thick parts of a deck are what the light is
       reaching first. Using the raw field rather than the alpha keeps some
       shading inside a cloud instead of a flat fill at full opacity. */
    vec3 col = mix( uShade, uLit, smoothstep( uCoverage, 1.0, f ) );

    /*
     * FADED OUT ALONG THE SKYLINE. Not because there is no cloud there — there
     * is more of it than anywhere — but because the terrain's own aerial haze
     * already owns that band of the frame, and two systems drawing the same
     * white in the same place is how a seam appears. This hands the horizon to
     * the fog and keeps the dome above it.
     */
    a *= smoothstep( 0.0, uHorizonFade, d.y );

    gl_FragColor = vec4( col, a * uOpacity );
  }
`;

const CLOUD_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    /*
     * The direction is taken in LOCAL space, and that is what lets the dome be
     * parented to the camera below without the sky spinning with it. position on
     * a unit-ish sphere is already the outward direction; running it through the
     * model matrix would fold the dome's own translation into it.
     */
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

export default function Clouds() {
  const { camera } = useThree();
  const ref = useRef();
  const C = LOOK.clouds;

  const material = useMemo(() => {
    const lit = new Color(`rgb(${C.lit.join(',')})`);
    const shade = new Color(`rgb(${C.shade.join(',')})`);
    return new ShaderMaterial({
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_SHADER,
      uniforms: {
        uTime: { value: 0 },
        uLit: { value: lit },
        uShade: { value: shade },
        uScale: { value: { x: C.scale[0], y: C.scale[1], z: C.scale[2] } },
        uSpeed: { value: { x: C.speed[0], y: C.speed[1], z: C.speed[2] } },
        uCoverage: { value: C.coverage },
        uSoftness: { value: C.softness },
        uOpacity: { value: C.opacity },
        uHorizonFade: { value: C.horizonFade },
      },
      /* Seen from the inside. */
      side: BackSide,
      transparent: true,
      /*
       * NO DEPTH WRITE, AND FOG EXPLICITLY OFF.
       *
       * The fog is the one that would have been a long debugging session. The
       * scene runs fogExp2 at 0.00115, and this dome sits 2400 units out — which
       * evaluates to about five ten-thousandths of a per cent transmission. Left
       * on, the clouds would have been rendered perfectly and then replaced,
       * pixel for pixel, with the fog colour. A ShaderMaterial does not take the
       * fog chunks unless asked, but the flag is set explicitly because the
       * failure is silent and looks exactly like the shader not working.
       */
      depthWrite: false,
      fog: false,
    });
  }, [C]);

  const geometry = useMemo(() => new SphereGeometry(2400, 32, 24), []);

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
    /*
     * PARENTED TO THE LENS, so the dome is a sky rather than an object in the
     * world. The camera travels a few hundred units over the scroll; a fixed
     * dome would show that as parallax against the cloud, which is wrong by
     * three orders of magnitude — real cloud is kilometres up and does not shift
     * because you walked backwards. Copying the position each frame is the
     * cheapest way to say "infinitely far away".
     */
    if (ref.current) ref.current.position.copy(camera.position);
  });

  return (
    <mesh
      ref={ref}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      /* Drawn before the terrain, which then depth-tests over it normally. */
      renderOrder={-1}
    />
  );
}
