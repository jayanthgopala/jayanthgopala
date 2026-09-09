import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  ClampToEdgeWrapping,
  DataTexture,
  DoubleSide,
  LinearFilter,
  NormalBlending,
  PlaneGeometry,
  RedFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
} from 'three';
import { MOUND_AT, TERRAIN_SIZE, TERRAIN_CENTER_Z, heightAt } from '../lib/terrain.js';
import { SHARED_WIND_GLSL, updateWindState } from '../lib/wind.js';

/**
 * SURFING COFFEE MIST & CLOUD LAYERS
 *
 * Simulates soft curling mist that surfs across the snow surface like steam wafting
 * off hot coffee, or large undulating cloud banks where parts are visible and the
 * rest is completely transparent.
 *
 * NO PARTICLES: This is a fluid, continuous 3D transparent volume surface that hugs
 * the terrain contours, deflects around the igloo, and swirls with cursor interaction.
 */

const HEIGHT_TEX = 256;
const HEIGHT_MAX = 720;

function buildHeightTexture() {
  const n = HEIGHT_TEX;
  const data = new Uint8Array(n * n);
  const x0 = -TERRAIN_SIZE / 2;
  const z0 = TERRAIN_CENTER_Z - TERRAIN_SIZE / 2;
  const step = TERRAIN_SIZE / (n - 1);

  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const h = heightAt(x0 + i * step, z0 + j * step);
      data[j * n + i] = Math.max(0, Math.min(255, Math.round((h / HEIGHT_MAX) * 255)));
    }
  }

  const tex = new DataTexture(data, n, n, RedFormat, UnsignedByteType);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

const MIST_SURF_VERT = /* glsl */ `
  uniform sampler2D uHeight;
  uniform vec2 uTerrainOrigin;
  uniform vec2 uTerrainSize;
  uniform float uTime;
  uniform float uLayerHeight;

  varying vec3 vWorldPos;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    // Position in world space:
    vec4 worldP = modelMatrix * vec4( position, 1.0 );

    // Look up local terrain elevation
    vec2 huv = ( worldP.xz - uTerrainOrigin ) / uTerrainSize;
    float ground = texture2D( uHeight, huv ).r * ${HEIGHT_MAX.toFixed(1)};

    // Undulating breathing wave like steam wafting over air currents (reversed direction)
    float wave = sin( -worldP.x * 0.016 - worldP.z * 0.012 + uTime * 0.75 ) * 1.2
               + cos( -worldP.z * 0.020 + worldP.x * 0.009 - uTime * 0.55 ) * 0.8;

    worldP.y = ground + uLayerHeight + wave;
    vWorldPos = worldP.xyz;

    gl_Position = projectionMatrix * viewMatrix * worldP;
  }
`;

const MIST_SURF_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec2 uCursorPos;
  uniform float uCursorForce;
  uniform float uLayerSpeed;
  uniform float uLayerOpacity;
  uniform float uCloudCutoff;
  uniform float uNoiseScale;

  varying vec3 vWorldPos;
  varying vec2 vUv;

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

  float mFbm( vec2 p ) {
    float v = 0.0;
    float a = 0.5;
    for ( int i = 0; i < 4; i ++ ) {
      v += a * mNoise( p );
      p *= 2.03;
      a *= 0.5;
    }
    return v / 0.9375;
  }

  void main() {
    vec3 p = vWorldPos;

    // 1. Shared wind warp: crosswind harmonics + igloo deflection + cursor vortex
    vec2 warp = evaluateWindWarp( p, uTime, uLayerSpeed, uCursorPos, uCursorForce );

    // 2. Wind drift translation along dominant wind vector
    float t = uTime * SHARED_WIND_SPEED * uLayerSpeed;

    // Macro cloud bank shape
    vec2 q1 = ( p.xz + warp + SHARED_WIND_DIR * t ) * ( uNoiseScale * 0.45 );
    float f1 = mFbm( q1 );

    // Domain warping: curls the noise into flowing wisps like steam wafting off hot coffee
    vec2 curl = vec2( sin( f1 * 6.28 + uTime * 0.45 ), cos( f1 * 6.28 + uTime * 0.38 ) ) * 24.0;
    vec2 q2 = ( p.xz + warp * 1.35 + curl + SHARED_WIND_DIR * ( t * 1.22 ) ) * uNoiseScale;
    float f2 = mFbm( q2 );

    // Combined cloud/steam density field
    float steam = f1 * 0.52 + f2 * 0.48;

    // Soft blowing snow mist density
    float alpha = smoothstep( uCloudCutoff, uCloudCutoff + 0.20, steam );
    if ( alpha <= 0.001 ) discard;

    // Smooth natural falloff
    alpha = pow( alpha, 1.4 ) * uLayerOpacity;

    // Accurate distance from igloo exterior shell (dome + porch)
    float dDome = length( p.xz - vec2( -30.0, 252.0 ) ) - 23.0;
    vec2 pPorch = abs( p.xz - vec2( -30.0, 267.0 ) ) - vec2( 6.5, 7.5 );
    float dPorch = length( max( pPorch, 0.0 ) ) + min( max( pPorch.x, pPorch.y ), 0.0 );
    float dIgloo = min( dDome, dPorch );

    // Clear of igloo walls (zero inside and on walls, softly flows across surrounding dunes 2 to 14 units out)
    float iglooClearance = smoothstep( 2.0, 14.0, dIgloo );
    if ( iglooClearance <= 0.001 ) discard;
    alpha *= iglooClearance;

    // Distance fades: smoothly fade before reaching the camera lens
    float distCam = length( p - cameraPosition );
    float nearFade = smoothstep( 16.0, 48.0, distCam );
    float farFade = 1.0 - smoothstep( 650.0, 950.0, distCam );
    alpha *= nearFade * farFade;

    // Feather outer edges of the mesh bounds so borders are invisible
    vec2 cuv = vUv - 0.5;
    float edge = 1.0 - smoothstep( 0.38, 0.495, length( cuv ) );
    alpha *= edge;

    if ( alpha <= 0.001 ) discard;

    // Soft luminous white mist
    vec3 col = vec3( 1.0, 1.0, 1.0 );
    gl_FragColor = vec4( col, alpha );
  }
`;

function MistSurfSheet({
  heightTexture,
  layerHeight,
  layerSpeed,
  layerOpacity,
  cloudCutoff,
  noiseScale,
}) {
  const meshRef = useRef();

  const geometry = useMemo(() => {
    // Plane covering the valley floor, igloo mound, and midground passes
    const geo = new PlaneGeometry(950, 850, 110, 95);
    // Rotate to lie horizontally in XZ
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, []);

  const material = useMemo(() => {
    return new ShaderMaterial({
      vertexShader: MIST_SURF_VERT,
      fragmentShader: MIST_SURF_FRAG,
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
        uTime: { value: 0 },
        uCursorPos: { value: new Vector2(-30, 252) },
        uCursorForce: { value: 0 },
        uLayerHeight: { value: layerHeight },
        uLayerSpeed: { value: layerSpeed },
        uLayerOpacity: { value: layerOpacity },
        uCloudCutoff: { value: cloudCutoff },
        uNoiseScale: { value: noiseScale },
      },
    });
  }, [
    heightTexture,
    layerHeight,
    layerSpeed,
    layerOpacity,
    cloudCutoff,
    noiseScale,
  ]);

  useFrame((state, delta) => {
    const ws = updateWindState(state, delta);
    material.uniforms.uTime.value = ws.time;
    material.uniforms.uCursorPos.value.copy(ws.cursorPos);
    material.uniforms.uCursorForce.value = ws.cursorForce;
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      position={[-20, 0, 270]}
      renderOrder={1}
      frustumCulled={false}
    />
  );
}

export default function Weather() {
  const heightTexture = useMemo(() => buildHeightTexture(), []);

  return (
    <group name="surfing-mist-weather">
      {/*
        Layer 1: Low surface skim - windblown snow mist skimming the dunes
      */}
      <MistSurfSheet
        heightTexture={heightTexture}
        layerHeight={1.8}
        layerSpeed={1.35}
        layerOpacity={0.14}
        cloudCutoff={0.52}
        noiseScale={0.0070}
      />

      {/*
        Layer 2: Valley cloud waft - soft drifting mist across the ridges
      */}
      <MistSurfSheet
        heightTexture={heightTexture}
        layerHeight={5.4}
        layerSpeed={0.85}
        layerOpacity={0.10}
        cloudCutoff={0.58}
        noiseScale={0.0036}
      />
    </group>
  );
}
