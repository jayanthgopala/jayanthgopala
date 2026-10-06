// Procedural GLSL used by the arctic snow scene: one noise basis shared by the
// sky dome's cirrus, the terrain's sastrugi and the drifting mist banks, so the
// whole frame is grained by the same wind.

// Value noise + fbm. Cheap, tileless, and stable across frames.
export const NOISE_GLSL = /* glsl */ `
float snHash( vec2 p ) {
  p = fract( p * vec2( 123.34, 456.21 ) );
  p += dot( p, p + 45.32 );
  return fract( p.x * p.y );
}

float snNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = snHash( i );
  float b = snHash( i + vec2( 1.0, 0.0 ) );
  float c = snHash( i + vec2( 0.0, 1.0 ) );
  float d = snHash( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}

float snFbm( vec2 p ) {
  float sum = 0.0;
  float amp = 0.5;
  for ( int i = 0; i < 4; i ++ ) {
    sum += amp * snNoise( p );
    p *= 2.03;
    amp *= 0.5;
  }
  return sum;
}
`;

// Wind-stretched field driving both the sastrugi ridges and the cirrus: heavily
// elongated along the prevailing wind so it reads as streaks, never as blobs.
export const WIND_GLSL = /* glsl */ `
vec2 snWindWarp( vec2 p ) {
  // Rotate into wind space, then squash across it.
  vec2 w = vec2( p.x * 0.966 + p.y * 0.259, -p.x * 0.259 + p.y * 0.966 );
  return vec2( w.x * 0.12, w.y * 1.0 );
}

float snSastrugi( vec2 p ) {
  vec2 w = snWindWarp( p );
  return snFbm( w ) * 0.66 + snFbm( w * 3.17 ) * 0.26 + snFbm( w * 8.3 ) * 0.08;
}
`;

// Sky dome: a vertical wash from pale zenith blue to a near-white horizon, with
// a broad glow toward the sun and thin cirrus drawn high up. Unfogged, and it
// meets the terrain at exactly the fog colour so the seam disappears.
export const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize( position );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

export const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uSun;
uniform float uTime;
varying vec3 vDir;

${NOISE_GLSL}

void main() {
  vec3 dir = normalize( vDir );
  float h = dir.y;

  // Vertical wash. Kept soft so the horizon reads as haze, not as a line.
  float lift = smoothstep( -0.05, 0.62, h );
  vec3 col = mix( uHorizon, uZenith, lift );

  // Broad low glow around the sun's bearing, strongest near the horizon.
  float toSun = max( 0.0, dot( dir, normalize( uSun ) ) );
  col = mix( col, uGlow, pow( toSun, 3.2 ) * 0.55 * ( 1.0 - lift * 0.55 ) );

  // Overcast: a broad deck of cloud over the upper sky, soft grey undersides
  // with brighter breaks, thinning out into the horizon haze.
  vec2 deck = vec2( atan( dir.z, dir.x ) * 1.7, h * 2.4 );
  float deckA = snFbm( deck * vec2( 1.0, 2.8 ) + vec2( uTime * 0.005, 0.0 ) );
  float deckB = snFbm( deck * vec2( 2.4, 5.2 ) - vec2( uTime * 0.009, 0.0 ) + 7.0 );
  float cover = smoothstep( 0.3, 0.62, deckA * 0.72 + deckB * 0.28 );
  float deckBand = smoothstep( 0.0, 0.14, h );
  // Linear colours: they land as grey-blue undersides once encoded and exposed.
  vec3 cloud = mix( vec3( 0.26, 0.31, 0.40 ), vec3( 0.86, 0.89, 0.94 ), smoothstep( 0.4, 0.82, deckB ) );
  col = mix( col, cloud, cover * deckBand * 0.92 );

  // Cirrus: stretched fbm banded into thin streaks, faded out at the horizon
  // and thinned again at the zenith so the streaks stay in the upper third.
  vec2 sky = vec2( atan( dir.z, dir.x ) * 2.2, h * 3.1 );
  vec2 drift = vec2( uTime * 0.004, 0.0 );
  float veil = snFbm( vec2( sky.x * 1.15 + sky.y * 0.55, sky.y * 2.4 ) + drift );
  float streak = smoothstep( 0.42, 0.82, veil );
  float reach = smoothstep( 0.01, 0.22, h ) * ( 1.0 - smoothstep( 0.55, 0.95, h ) * 0.55 );
  col = mix( col, vec3( 1.0 ), streak * reach * 0.66 );

  // A second, finer pass of wisps for the torn edges the thick bands lack.
  float wisp = smoothstep( 0.60, 0.92, snFbm( vec2( sky.x * 3.4, sky.y * 5.2 ) + drift * 2.4 ) );
  col = mix( col, vec3( 1.0 ), wisp * reach * 0.32 );

  gl_FragColor = vec4( col, 1.0 );
  #include <colorspace_fragment>
}
`;
