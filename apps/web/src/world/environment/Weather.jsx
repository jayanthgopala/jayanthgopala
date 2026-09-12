import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  ClampToEdgeWrapping,
  DataTexture,
  DoubleSide,
  LinearFilter,
  NormalBlending,
  PlaneGeometry,
  RGFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
} from 'three';
import { MOUND_AT, TERRAIN_SIZE, TERRAIN_CENTER_Z, heightAt } from '../lib/terrain.js';
import { LOOK } from '../lib/lighting.js';
import { SHARED_WIND_GLSL, updateWindState } from '../lib/wind.js';

// Height texture parameters: R = ground height, G = regional blurred height
const HEIGHT_TEX = 256;
const HEIGHT_MAX = 720;
const TEXEL_WORLD = TERRAIN_SIZE / (HEIGHT_TEX - 1);
const BLUR_RADIUS = 16;

function buildHeightTexture() {
  const n = HEIGHT_TEX;
  const raw = new Float32Array(n * n);
  const x0 = -TERRAIN_SIZE / 2;
  const z0 = TERRAIN_CENTER_Z - TERRAIN_SIZE / 2;
  const step = TERRAIN_SIZE / (n - 1);

  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      raw[j * n + i] = heightAt(x0 + i * step, z0 + j * step);
    }
  }

  // Separable box blur for regional reference height
  const tmp = new Float32Array(n * n);
  const blur = new Float32Array(n * n);
  const span = BLUR_RADIUS * 2 + 1;

  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      let sum = 0;
      for (let k = -BLUR_RADIUS; k <= BLUR_RADIUS; k += 1) {
        const s = Math.max(0, Math.min(n - 1, i + k));
        sum += raw[j * n + s];
      }
      tmp[j * n + i] = sum / span;
    }
  }
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      let sum = 0;
      for (let k = -BLUR_RADIUS; k <= BLUR_RADIUS; k += 1) {
        const s = Math.max(0, Math.min(n - 1, j + k));
        sum += tmp[s * n + i];
      }
      blur[j * n + i] = sum / span;
    }
  }

  const data = new Uint8Array(n * n * 2);
  for (let i = 0; i < n * n; i += 1) {
    data[i * 2 + 0] = Math.max(0, Math.min(255, Math.round((raw[i] / HEIGHT_MAX) * 255)));
    data[i * 2 + 1] = Math.max(0, Math.min(255, Math.round((blur[i] / HEIGHT_MAX) * 255)));
  }

  const tex = new DataTexture(data, n, n, RGFormat, UnsignedByteType);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

const SUN_DIR = new Vector3(...LOOK.key.position).normalize();

// Mist vertex shader
const MIST_VERT = /* glsl */ `
  uniform sampler2D uHeight;
  uniform vec2 uTerrainOrigin;
  uniform vec2 uTerrainSize;
  uniform vec3 uSunDir;
  uniform float uTime;
  uniform float uLayerHeight;
  uniform float uLayerSpeed;
  uniform float uSeed;

  varying vec3 vWorldPos;
  varying vec2 vUv;
  varying float vDepression;
  varying float vSunFacing;
  varying float vRelH;

  void main() {
    vUv = uv;
    vec4 worldP = modelMatrix * vec4( position, 1.0 );

    vec2 huv = ( worldP.xz - uTerrainOrigin ) / uTerrainSize;
    vec2 hs = texture2D( uHeight, huv ).rg * ${HEIGHT_MAX.toFixed(1)};
    float ground = hs.r;
    float regional = hs.g;

    // Positive in depressions and valley hollows, negative on crests
    vDepression = regional - ground;

    // Surface normal estimation for sunlight shading
    float texel = 1.0 / ${HEIGHT_TEX.toFixed(1)};
    float hR = texture2D( uHeight, huv + vec2( texel, 0.0 ) ).r * ${HEIGHT_MAX.toFixed(1)};
    float hL = texture2D( uHeight, huv - vec2( texel, 0.0 ) ).r * ${HEIGHT_MAX.toFixed(1)};
    float hU = texture2D( uHeight, huv + vec2( 0.0, texel ) ).r * ${HEIGHT_MAX.toFixed(1)};
    float hD = texture2D( uHeight, huv - vec2( 0.0, texel ) ).r * ${HEIGHT_MAX.toFixed(1)};
    vec3 nrm = normalize( vec3( -( hR - hL ) * 0.5, ${TEXEL_WORLD.toFixed(3)}, -( hU - hD ) * 0.5 ) );
    vSunFacing = dot( nrm, uSunDir );

    // Vertical drift oscillation
    float s = uSeed;
    float t = uTime * uLayerSpeed;
    float rise = sin( worldP.x * 0.0068 + worldP.z * 0.0049 + t * 0.40 + s ) * 1.5
               + sin( worldP.z * 0.0104 - worldP.x * 0.0035 - t * 0.26 + s * 1.618 ) * 1.0
               + sin( worldP.x * 0.0151 + worldP.z * 0.0082 + t * 0.17 + s * 2.718 ) * 0.6;

    float finalH = ground + uLayerHeight + rise;
    vRelH = finalH - ground;

    worldP.y = finalH;
    vWorldPos = worldP.xyz;

    gl_Position = projectionMatrix * viewMatrix * worldP;
  }
`;

// Mist fragment shader
const MIST_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uLayerSpeed;
  uniform float uLayerOpacity;
  uniform float uNoiseScale;
  uniform float uCoverage;
  uniform vec4 uDepthBand;   // near-in, near-full, far-full, far-out
  uniform float uSeed;

  varying vec3 vWorldPos;
  varying vec2 vUv;
  varying float vDepression;
  varying float vSunFacing;
  varying float vRelH;

  ${SHARED_WIND_GLSL}

  float mHash( vec2 p ) {
    return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
  }

  float mNoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix(
      mix( mHash( i ), mHash( i + vec2( 1.0, 0.0 ) ), u.x ),
      mix( mHash( i + vec2( 0.0, 1.0 ) ), mHash( i + vec2( 1.0, 1.0 ) ), u.x ),
      u.y
    );
  }

  // 5-octave rotated FBM
  float mFbm( vec2 p ) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2( 0.80, 0.60, -0.60, 0.80 );
    for ( int i = 0; i < 5; i++ ) {
      v += a * mNoise( p );
      p = rot * p * 2.04;
      a *= 0.47;
    }
    return v / 0.935;
  }

  void main() {
    vec3 p = vWorldPos;
    float distCam = length( p - cameraPosition );

    vec2 windDir = normalize( SHARED_WIND_DIR );
    vec2 windPerp = vec2( -windDir.y, windDir.x );
    float t = uTime * SHARED_WIND_SPEED * uLayerSpeed;

    // 1. Distance depth band window
    float depth = smoothstep( uDepthBand.x, uDepthBand.y, distCam )
                * ( 1.0 - smoothstep( uDepthBand.z, uDepthBand.w, distCam ) );
    if ( depth <= 0.002 ) discard;

    // 2. Valley depression masking
    float valley = smoothstep( -2.0, 26.0, vDepression );
    valley *= mix( 0.45, 1.0, smoothstep( 26.0, 4.0, vRelH ) );
    if ( valley <= 0.004 ) discard;

    // 3. Multi-scale wind flow domain warp
    vec2 flow = evaluateWindWarp( p, uTime, uLayerSpeed, vec2( 0.0 ), 0.0 );
    vec2 pw = p.xz + flow;

    vec2 pA = vec2( dot( pw, windDir ) * 0.30 + t * 0.42, dot( pw, windPerp ) * 1.05 )
            * uNoiseScale * 0.55 + uSeed;
    float fA = mFbm( pA );

    vec2 warp = ( vec2( fA, mFbm( pA + vec2( 5.2, 1.7 ) ) ) - 0.5 ) * 48.0;
    vec2 pB = vec2( dot( pw + warp, windDir ) * 0.34, dot( pw + warp, windPerp ) * 1.55 )
            * uNoiseScale + vec2( t * 0.030, 0.0 );
    float fB = mFbm( pB );

    vec2 pC = pB * 2.6 + vec2( t * 0.022, t * 0.006 ) + uSeed * 0.8;
    float fC = mFbm( pC );

    float field = fB * 0.62 + fC * 0.26 + fA * 0.12;

    // 4. Mist shape and coverage threshold
    float shape = smoothstep( uCoverage, uCoverage + 0.13, field );
    if ( shape <= 0.004 ) discard;

    float variation = mFbm( pB * 0.42 + vec2( 11.3, 4.1 ) );
    shape *= mix( 0.30, 1.15, smoothstep( 0.32, 0.74, variation ) );
    shape = clamp( shape, 0.0, 1.0 );

    float grad = mFbm( pB + vec2( 0.03, 0.0 ) ) - mFbm( pB - vec2( 0.03, 0.0 ) );
    shape *= mix( 0.55, 1.0, smoothstep( -0.06, 0.08, grad * sign( windDir.x ) ) );

    // 5. Regional weather distribution
    vec2 pR = vec2( dot( pw, windDir ) * 0.22 + t * 0.20, dot( pw, windPerp ) * 0.70 )
            * 0.0021 + uSeed * 0.35;
    float region = smoothstep( 0.44, 0.66, mFbm( pR ) );
    if ( region <= 0.004 ) discard;

    float alpha = shape * valley * region * depth * uLayerOpacity;

    // 6. Clearance around igloo dome and entrance
    float dDome = length( p.xz - vec2( ${MOUND_AT[0].toFixed(1)}, ${MOUND_AT[1].toFixed(1)} ) ) - 24.0;
    vec2 pPorch = abs( p.xz - vec2( ${MOUND_AT[0].toFixed(1)}, ${(MOUND_AT[1] + 15).toFixed(1)} ) ) - vec2( 7.0, 8.0 );
    float dPorch = length( max( pPorch, 0.0 ) ) + min( max( pPorch.x, pPorch.y ), 0.0 );
    alpha *= mix( 0.10, 1.0, smoothstep( 3.5, 30.0, min( dDome, dPorch ) ) );

    // Boundary edge fade
    vec2 cuv = abs( vUv - 0.5 );
    alpha *= ( 1.0 - smoothstep( 0.40, 0.50, cuv.x ) ) * ( 1.0 - smoothstep( 0.40, 0.50, cuv.y ) );

    if ( alpha <= 0.0015 ) discard;

    // 7. Shading and aerial perspective
    vec3 colBase = vec3( 0.82, 0.88, 0.94 );
    vec3 colShadow = vec3( 0.66, 0.73, 0.84 );
    vec3 colLit = vec3( 0.99, 0.99, 1.00 );

    float lit = smoothstep( -0.05, 0.55, vSunFacing );
    float thin = 1.0 - smoothstep( 0.25, 0.95, shape );

    vec3 col = mix( colShadow, colBase, smoothstep( 0.0, 0.45, lit ) );
    col = mix( col, colLit, lit * mix( 0.25, 0.85, thin ) );
    col = mix( col, vec3( 0.80, 0.85, 0.92 ), smoothstep( 260.0, 900.0, distCam ) * 0.45 );

    gl_FragColor = vec4( col, alpha );
  }
`;

// Single depth stratum for valley mist
function MistLayer({
  heightTexture,
  size,
  centerZ,
  segments,
  layerHeight,
  layerSpeed,
  opacity,
  noiseScale,
  coverage,
  depthBand,
  seed,
}) {
  const geometry = useMemo(() => {
    const geo = new PlaneGeometry(size[0], size[1], segments[0], segments[1]);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [size, segments]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: MIST_VERT,
        fragmentShader: MIST_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: DoubleSide,
        blending: NormalBlending,
        uniforms: {
          uHeight: { value: heightTexture },
          uTerrainOrigin: {
            value: [-TERRAIN_SIZE / 2, TERRAIN_CENTER_Z - TERRAIN_SIZE / 2],
          },
          uTerrainSize: { value: [TERRAIN_SIZE, TERRAIN_SIZE] },
          uSunDir: { value: SUN_DIR },
          uTime: { value: 0 },
          uLayerHeight: { value: layerHeight },
          uLayerSpeed: { value: layerSpeed },
          uLayerOpacity: { value: opacity },
          uNoiseScale: { value: noiseScale },
          uCoverage: { value: coverage },
          uDepthBand: { value: depthBand },
          uSeed: { value: seed },
        },
      }),
    [heightTexture, layerHeight, layerSpeed, opacity, noiseScale, coverage, depthBand, seed],
  );

  useFrame((state, delta) => {
    material.uniforms.uTime.value = updateWindState(state, delta).time;
  });

  return (
    <mesh
      geometry={geometry}
      material={material}
      position={[-20, 0, centerZ]}
      renderOrder={1}
      frustumCulled={false}
    />
  );
}

export default function Weather() {
  const heightTexture = useMemo(() => buildHeightTexture(), []);

  return (
    <group name="arctic-valley-mist">
      {/* Distant mountain-pass drift */}
      <MistLayer
        heightTexture={heightTexture}
        size={[2600, 2200]}
        segments={[120, 100]}
        centerZ={-500}
        layerHeight={22.0}
        layerSpeed={0.16}
        opacity={0.09}
        noiseScale={0.0019}
        coverage={0.5}
        depthBand={[420, 720, 1200, 1650]}
        seed={12.4}
      />

      {/* Midground valley mist layer */}
      <MistLayer
        heightTexture={heightTexture}
        size={[1500, 1300]}
        segments={[150, 130]}
        centerZ={-40}
        layerHeight={9.0}
        layerSpeed={0.55}
        opacity={0.2}
        noiseScale={0.0046}
        coverage={0.47}
        depthBand={[110, 250, 620, 950]}
        seed={5.8}
      />

      {/* Near-ground fast wisps */}
      <MistLayer
        heightTexture={heightTexture}
        size={[800, 800]}
        segments={[130, 130]}
        centerZ={180}
        layerHeight={2.2}
        layerSpeed={1.05}
        opacity={0.13}
        noiseScale={0.0115}
        coverage={0.56}
        depthBand={[45, 130, 260, 430]}
        seed={1.2}
      />
    </group>
  );
}
