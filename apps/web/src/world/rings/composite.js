// Final pass for the ring canvas: the same diagonal smeared cut as IceCut,
// running the other way — the ring scene rises in over the project page.
//
// The page lives in another canvas underneath, so it cannot be sampled here.
// Instead the canvas is transparent wherever the cut has not reached, and only
// the incoming scene (plus the frost haze on the seam) is drawn. Output is
// premultiplied to match the canvas.

import { CUT_PARALLAX } from '../chapters.js';

const f = (n) => n.toFixed(4);

export const COMPOSITE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4( position.xy, 0.0, 1.0 );
  }
`;

export const COMPOSITE_FRAGMENT = /* glsl */ `
  #define PARALLAX ${f(CUT_PARALLAX)}
  #define DISPLACE 0.0250
  #define STRETCH 0.0750
  #define SMEAR 0.0500
  #define SPREAD 0.0100
  #define HAZE 0.1400
  // Six taps, jittered per pixel: half the smear cost of twelve, on the one
  // fullscreen pass that runs while two canvases are both on screen.
  #define TAPS 6

  uniform sampler2D tScene;
  uniform sampler2D tCut;
  uniform float uCut;
  uniform float uAspect;
  uniform float uReduced;
  uniform float uRing;
  uniform float uTime;

  varying vec2 vUv;

  float hash21( vec2 p ) {
    vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
    p3 += dot( p3, p3.yzx + 33.33 );
    return fract( ( p3.x + p3.y ) * p3.z );
  }

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

  float sweep( float x, float margin, float progress ) {
    float front = mix( -margin, 1.0, progress );
    return clamp( ( front + margin - x ) / margin, 0.0, 1.0 );
  }

  vec3 spectrum( float t ) {
    return vec3( 1.0 - t, 1.0 - abs( t * 2.0 - 1.0 ), t ) + 0.1;
  }

  // Linear scene to display: untouched below 0.92 so the ice ground — whose
  // centre glow runs up near white — lands on exactly the project page's
  // colours, with a short shoulder above it so glows still roll off.
  vec3 grade( vec3 c ) {
    vec3 over = max( c - 0.92, 0.0 );
    c = min( c, 0.92 ) + 0.08 * ( 1.0 - exp( -over / 0.08 ) );
    return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, c ) );
  }

  // Scene sample that warps gently while a ring is passing — a slow drift like
  // the background's smear rather than concentric ripples — with the channels
  // split slightly as light through water would.
  vec3 sceneAt( vec2 uv, float jitter ) {
    if ( uRing <= 0.001 ) return texture2D( tScene, clamp( uv, 0.0, 1.0 ) ).rgb;

    vec2 d = uv - 0.5;
    d.x *= uAspect;
    float dist = length( d );
    vec2 dir = dist > 1e-4 ? d / dist : vec2( 0.0 );
    vec2 warp = vec2( vnoise( uv * 3.0 + uTime * 0.25 ), vnoise( uv * 3.4 - uTime * 0.22 ) ) - 0.5;
    vec2 off = warp * 0.03 * uRing * smoothstep( 0.05, 0.5, dist );

    return vec3(
      texture2D( tScene, clamp( uv + off * 1.15, 0.0, 1.0 ) ).r,
      texture2D( tScene, clamp( uv + off, 0.0, 1.0 ) ).g,
      texture2D( tScene, clamp( uv + off * 0.85, 0.0, 1.0 ) ).b
    );
  }

  vec3 smearScene( vec2 uv, vec2 drag, float spread, float jitter ) {
    vec2 dir = uv - 0.5;
    vec3 sum = vec3( 0.0 );
    vec3 weight = vec3( 0.0 );
    for ( int i = 0; i < TAPS; i++ ) {
      float t = ( float( i ) + jitter ) / float( TAPS );
      vec3 w = spectrum( t );
      sum += texture2D( tScene, clamp( uv + drag * t - dir * spread * ( t - 0.5 ), 0.0, 1.0 ) ).rgb * w;
      weight += w;
    }
    return sum / weight;
  }

  void main() {
    float p = uCut;
    vec2 uv = vUv;
    float jitter = hash21( gl_FragCoord.xy + fract( uTime ) * 61.0 );

    if ( p <= 0.0 ) {
      gl_FragColor = vec4( 0.0 );
      return;
    }

    if ( p >= 1.0 || uReduced > 0.5 ) {
      float a = min( p, 1.0 );
      gl_FragColor = vec4( grade( sceneAt( uv, jitter ) ) * a, a );
      return;
    }

    vec2 uvTex = vec2( ( uv.x - 0.5 ) * uAspect + 0.5, uv.y );
    vec3 blk = texture2D( tCut, uvTex ).rgb;

    float slope = 0.2 * uAspect;
    float x = uv.y + ( uv.x + ( blk.b * 2.0 - 1.0 ) * 0.4 ) * slope;
    float xn = ( x + 0.4 * slope ) / ( 1.0 + 1.8 * slope );

    float blurField = sweep( xn, 2.0, p );
    float shoveField = sweep( xn, 0.9, p );
    float cutField = sweep( xn, 0.2, p );

    float seam = cutField * ( 1.0 - cutField ) * 4.0;
    float wake = shoveField * ( 1.0 - shoveField ) * 4.0;

    float streak = vnoise( vec2( uv.x * 2.5, uv.y * 46.0 ) + blk.b * 3.0 ) * 2.0 - 1.0;
    float fibre = vnoise( vec2( uv.x * 6.0 + 7.3, uv.y * 120.0 ) );
    vec2 drag = vec2(
      streak * STRETCH * ( 0.35 + fibre ) * ( seam + 0.5 * wake ),
      SMEAR * wake
    );

    float r = 0.0;
    for ( int k = 0; k < 4; k++ ) {
      vec2 o = drag * ( float( k ) / 3.0 );
      r += texture2D( tCut, uvTex + vec2( o.x * uAspect, o.y ) ).r;
    }
    r *= 0.25;

    float cut = sweep( r, 2.0, cutField );
    float shove = sweep( blk.g, 1.0, shoveField );

    float edge = ( 1.0 - smoothstep( 0.7, 1.0, abs( uv.x * 2.0 - 1.0 ) ) )
               * ( 1.0 - smoothstep( 0.7, 1.0, abs( uv.y * 2.0 - 1.0 ) ) );
    float modulator = 12.0 * edge;

    vec3 scene = vec3( 0.0 );
    if ( cut > 0.0 ) {
      float q = 1.0 - p;
      vec2 at = uv + vec2( streak * STRETCH * 0.12 * seam, PARALLAX * q * q + DISPLACE * ( 1.0 - shove ) );
      scene = grade( smearScene( at, drag * 0.5, SPREAD * modulator * ( 1.0 - blurField ), jitter ) );
    }

    float haze = HAZE * wake * ( 1.0 - 0.5 * cut );
    vec3 color = scene * cut;
    float alpha = cut;
    color = color * ( 1.0 - haze ) + vec3( haze );
    alpha = alpha + ( 1.0 - alpha ) * haze;

    gl_FragColor = vec4( clamp( color, 0.0, 1.0 ), clamp( alpha, 0.0, 1.0 ) );
  }
`;
