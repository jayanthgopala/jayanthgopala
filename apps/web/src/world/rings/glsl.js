// Shared shader noise for the ring descent. Hash-based, so nothing is loaded.

export const NOISE = /* glsl */ `
  float rHash( vec2 p ) {
    vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
    p3 += dot( p3, p3.yzx + 33.33 );
    return fract( ( p3.x + p3.y ) * p3.z );
  }

  float rNoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    f = f * f * ( 3.0 - 2.0 * f );
    return mix(
      mix( rHash( i ), rHash( i + vec2( 1.0, 0.0 ) ), f.x ),
      mix( rHash( i + vec2( 0.0, 1.0 ) ), rHash( i + vec2( 1.0, 1.0 ) ), f.x ),
      f.y
    );
  }
`;

export const VUV = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;
