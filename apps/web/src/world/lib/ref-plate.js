import { Vector2, Vector3 } from 'three';
import { OPENING_FRAME } from '../chapters.js';

// The reference render the opening frame was matched to, HUD painted out,
// projected back onto the scene from the opening camera (camera-projection
// mapping, as a matte painter does). From that frame, every surface shows the
// reference's own pixels: its clouds, rock, mist, shadows and igloo. As the
// lens moves off on scroll, the near surfaces hand back to the 3D scene.

export const PLATE = { width: 1871, height: 841, url: '/environments/ref-plate.jpg' };

/** The opening camera's basis and lens, as uniforms. */
export function plateUniforms() {
  const eye = new Vector3(...OPENING_FRAME.eye);
  const f = new Vector3(...OPENING_FRAME.aim).sub(eye).normalize();
  const r = new Vector3().crossVectors(f, new Vector3(0, 1, 0)).normalize();
  const u = new Vector3().crossVectors(r, f);
  const th = Math.tan((OPENING_FRAME.fov * Math.PI) / 360);
  return {
    uRefEye: { value: eye },
    uRefF: { value: f },
    uRefR: { value: r },
    uRefU: { value: u },
    uRefTan: { value: new Vector2(th * (PLATE.width / PLATE.height), th) },
  };
}

// One shared set, so the texture loads once and every material that projects
// it flips on together when it arrives.
let shared = null;
export function refPlateUniforms() {
  if (!shared) {
    shared = {
      ...plateUniforms(),
      uRange: { value: null },
      uRangeOn: { value: 0 },
      // How much of the picture is showing: see setPlateFade.
      uPlateFade: { value: 1 },
    };
    // No cover image: the texture is never loaded, so uRangeOn stays 0 and every
    // shader that projects it falls back to the 3D scene's own surfaces.
  }
  return shared;
}

/**
 * How far the lens has left the opening frame, as a 0..1 the shaders read.
 *
 * Written from the camera's SETTLED position (CameraRig), not its live one:
 * the pointer parallax moves the camera several units while the scene is at
 * rest, and the picture would breathe in and out with the cursor.
 */
// The projected picture is switched off for good: the world is drawn by the 3D
// scene alone. The fade is kept at 0 so the shaders take their own path.
export function setPlateFade() {
  refPlateUniforms().uPlateFade.value = 0;
}

export const REF_PLATE_GLSL = /* glsl */ `
uniform float uPlateFade;
uniform sampler2D uRange;
uniform float uRangeOn;
uniform vec3 uRefEye;
uniform vec3 uRefF;
uniform vec3 uRefR;
uniform vec3 uRefU;
uniform vec2 uRefTan;

// Where the opening camera saw this world point in the reference, and the
// reference's colour there (offset for the scene's own tone map and grade,
// which it is about to pass through again). 0 outside the picture.
float refPlateAt( vec3 wp, out vec3 ph, out vec2 fr ) {
  ph = vec3( 0.0 );
  fr = vec2( -1.0 );
  vec3 d = wp - uRefEye;
  float z = dot( d, uRefF );
  if ( uRangeOn < 0.5 || z <= 0.0 ) return 0.0;
  vec2 ndc = vec2( dot( d, uRefR ), dot( d, uRefU ) ) / ( z * uRefTan );
  fr = vec2( ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5 );
  // Past the picture's sides (a screen wider than it), mirror it, so the
  // snow and mountains run on instead of stopping at an edge.
  vec2 uv = vec2( 1.0 - abs( 1.0 - abs( fr.x ) ), fr.y );
  uv = clamp( uv, 0.001, 0.999 );
  ph = texture2D( uRange, vec2( uv.x, 1.0 - uv.y ) ).rgb;
  ph = pow( mix( vec3( dot( ph, vec3( 0.2126, 0.7152, 0.0722 ) ) ), ph, 0.94 ), vec3( 1.12 ) ) * 0.75;
  return smoothstep( -0.3, -0.18, fr.x ) * ( 1.0 - smoothstep( 1.18, 1.3, fr.x ) )
    * smoothstep( -0.02, 0.0, fr.y ) * ( 1.0 - smoothstep( 1.0, 1.02, fr.y ) );
}

// 1 while the lens is at the opening frame, falling to 0 as it moves off.
float refPlateHome() {
  return uPlateFade;
}
`;
