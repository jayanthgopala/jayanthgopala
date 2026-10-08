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
uniform sampler2D uPlate;
uniform float uPlateOn;
uniform vec3 uRefF;
uniform vec3 uRefR;
uniform vec3 uRefU;
uniform vec2 uRefTan;
uniform float uPlateRows;
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

  // Overcast cumulus, as in the reference: lumpy banks with grey-blue
  // undersides at their thick cores and bright white rims, and a break of
  // brighter sky high in the middle of the view where the sun sits behind.
  vec2 deck = vec2( atan( dir.z, dir.x ) * 2.4, h * 5.0 );
  // Domain warp: bends the field into rounded, heaped billows.
  deck += vec2( snFbm( deck * 1.7 + 3.1 ), snFbm( deck * 1.7 - 5.3 ) ) * 0.28 - 0.14;
  vec2 deckDrift = vec2( uTime * 0.004, 0.0 );
  float deckA = snFbm( deck * vec2( 0.9, 1.4 ) + deckDrift );
  float deckB = snFbm( deck * vec2( 2.2, 3.0 ) - deckDrift * 1.6 + 7.0 );
  float deckC = snFbm( deck * vec2( 6.5, 8.0 ) + deckDrift * 2.2 - 3.0 );
  float dens = deckA * 0.56 + deckB * 0.3 + deckC * 0.14;
  // The same field a little higher up: where it thins upward, a billow's top
  // catches the light, which is what gives each cumulus its shape.
  vec2 deckUp = deck + vec2( 0.0, 0.16 );
  float densUp = snFbm( deckUp * vec2( 0.9, 1.4 ) + deckDrift ) * 0.56 + snFbm( deckUp * vec2( 2.2, 3.0 ) - deckDrift * 1.6 + 7.0 ) * 0.3 + deckC * 0.14;
  float billowLit = clamp( ( dens - densUp ) * 7.0, 0.0, 1.0 );
  float brk = pow( max( 0.0, dot( dir, normalize( vec3( 0.42, 0.52, -1.0 ) ) ) ), 22.0 );
  float edgeDetail = snFbm( deck * vec2( 9.0, 12.0 ) - deckDrift * 3.0 ) - 0.47;
  float cover = smoothstep( 0.05, 0.25, dens + edgeDetail * 0.12 - brk * 0.5 );
  // The deck hangs higher: just above the peaks the sky stays bright.
  float deckBand = smoothstep( 0.05, 0.15, h );
  // Linear colours: they land as grey-blue undersides once encoded and exposed.
  vec3 cloud = mix( vec3( 0.55, 0.60, 0.70 ), vec3( 0.12, 0.15, 0.23 ), smoothstep( 0.2, 0.52, dens ) );
  col = mix( col, cloud, cover * deckBand * 0.95 );
  col = mix( col, vec3( 0.88, 0.91, 0.95 ), billowLit * cover * deckBand * 0.5 );
  // Bright, crisp rims where each billow thins against the sky.
  float rimC = smoothstep( 0.16, 0.3, dens ) * ( 1.0 - smoothstep( 0.3, 0.46, dens ) );
  col = mix( col, vec3( 0.92, 0.94, 0.97 ), rimC * deckBand * 0.35 );
  // Heavier overhead, as the reference's deck darkens toward the top of frame.
  col *= mix( 1.0, 0.68, smoothstep( 0.06, 0.24, h ) * cover );
  col = mix( col, vec3( 0.97, 0.97, 0.97 ), brk * 0.35 * deckBand );

  // Cirrus: stretched fbm banded into thin streaks, faded out at the horizon
  // and thinned again at the zenith so the streaks stay in the upper third.
  vec2 sky = vec2( atan( dir.z, dir.x ) * 2.2, h * 3.1 );
  vec2 drift = vec2( uTime * 0.004, 0.0 );
  float veil = snFbm( vec2( sky.x * 1.15 + sky.y * 0.55, sky.y * 2.4 ) + drift );
  float streak = smoothstep( 0.42, 0.82, veil );
  float reach = smoothstep( 0.01, 0.22, h ) * ( 1.0 - smoothstep( 0.55, 0.95, h ) * 0.55 );
  col = mix( col, vec3( 1.0 ), streak * reach * 0.18 );

  // A second, finer pass of wisps for the torn edges the thick bands lack.
  float wisp = smoothstep( 0.60, 0.92, snFbm( vec2( sky.x * 3.4, sky.y * 5.2 ) + drift * 2.4 ) );
  col = mix( col, vec3( 1.0 ), wisp * reach * 0.1 );

  // The reference's own clouds, where this direction falls inside its frame
  // and above its peaks; faded at every edge into the procedural sky.
  float refZ = dot( dir, uRefF );
  if ( uPlateOn > 0.5 && refZ > 0.0 ) {
    vec2 ndc = vec2( dot( dir, uRefR ), dot( dir, uRefU ) ) / ( refZ * uRefTan );
    vec2 frame = vec2( ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5 );
    float plateY = frame.y / uPlateRows;
    // Faded at the frame's sides, above its top edge, and well before the
    // reference's peaks so none of its mountains ghost behind ours.
    // Fades only OUTSIDE the frame (a wider screen, or the camera's sway),
    // holding the edge column there; inside it the photo is whole.
    float side = smoothstep( -0.12, 0.0, frame.x ) * ( 1.0 - smoothstep( 1.0, 1.12, frame.x ) );
    float plateX = clamp( frame.x, 0.001, 0.999 );
    float keep = side * ( 1.0 - smoothstep( 0.0, 0.12, -frame.y ) );
    vec3 plate = texture2D( uPlate, vec2( plateX, 1.0 - clamp( plateY, 0.002, 0.998 ) ) ).rgb;
    // Below the clouds the photo turns to the bright haze over its peaks;
    // hold that haze (its row just above the summits) on down to our range,
    // so the reference's own mountains never ghost behind ours.
    vec3 haze = vec3( 0.0 );
    for ( int i = -4; i <= 4; i ++ ) {
      float hx = clamp( plateX + float( i ) * 0.016, 0.001, 0.999 );
      haze += texture2D( uPlate, vec2( hx, 1.0 - 0.52 ) ).rgb + texture2D( uPlate, vec2( hx, 1.0 - 0.58 ) ).rgb;
    }
    haze = mix( haze / 18.0, col, 0.4 );
    plate = mix( plate, haze, smoothstep( 0.5, 0.58, plateY ) );
    // The photo is already graded; offset the scene's tone map and grade.
    float plateL = dot( plate, vec3( 0.2126, 0.7152, 0.0722 ) );
    plate = mix( vec3( plateL ), plate, 0.82 ) * 0.9;
    col = mix( col, plate, keep );
  }

  gl_FragColor = vec4( col, 1.0 );
  #include <colorspace_fragment>
}
`;
