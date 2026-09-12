// The liquid letterform.
//
// A plane whose vertices are pushed out of the page by the glyph's signed
// distance field, so the letter gains a rounded body that thins to nothing at
// its outline. Fragments outside the glyph are discarded, which is what makes
// the shape read as a free-standing blob of water rather than a decal.
//
// Two copies are drawn, one pushed toward the camera and one away, closing the
// volume so it refracts like something with a front and a back.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, FrontSide, BackSide, MeshPhysicalMaterial } from 'three';
import { SDF_SPREAD } from './glyph.js';

/** Side of the square the glyph is drawn into, in world units. */
export const PLANE = 3.5;

const SEGMENTS = 176;

const FIELD = /* glsl */ `
uniform sampler2D uGlyphA;
uniform sampler2D uGlyphB;
uniform sampler2D uRipple;
uniform float uMorph;
uniform float uTime;
uniform float uDepth;
uniform float uEdge;
uniform float uSpread;
uniform float uSign;
uniform float uRippleAmp;
uniform float uIdleAmp;
uniform float uImpactAmp;
uniform float uPlane;

varying float vInside;

// Signed distance in UV units: positive inside the letter, negative outside.
float glyphAt(vec2 uv) {
  float a = texture2D(uGlyphA, uv).r;
  float b = texture2D(uGlyphB, uv).r;
  return (mix(a, b, uMorph) - 0.5) * 2.0 * uSpread;
}

// Surface height above the page, before the sign is applied.
float surfaceAt(vec2 uv) {
  float signedDistance = glyphAt(uv);

  // Circular falloff rather than a linear ramp: the rim rolls over the way a
  // meniscus does instead of meeting the page at a hard bevel.
  float t = clamp(signedDistance / uEdge, 0.0, 1.0);
  float dome = sqrt(max(0.0, 1.0 - (1.0 - t) * (1.0 - t)));

  vec2 sim = texture2D(uRipple, uv).rg;
  float ripple = sim.r;
  float impact = sim.r - sim.g;

  // Long, slow waves. Detail belongs to the refraction, not the geometry.
  float a = uv.x * 6.2831853;
  float idleWave =
      sin(uv.y * 3.1 - uTime * 0.42 + a) * 0.55
    + sin(uv.y * 5.3 + uTime * 0.31 - a * 2.0) * 0.30
    + sin(uv.y * 1.7 + uTime * 0.23 + a * 0.5) * 0.15;

  float slowCurl =
      sin(uv.y * 2.3 + uTime * 0.17 + sin(a + uTime * 0.11) * 1.6) * 0.60
    + sin(uv.y * 1.1 - uTime * 0.13 + cos(a * 2.0 - uTime * 0.09) * 1.2) * 0.40;

  // Waves ride on the body, so they fade out with it at the outline.
  float body = smoothstep(0.0, uEdge * 0.9, signedDistance);

  return uDepth * dome
    + body * (
        idleWave * 0.35 * uIdleAmp
      + slowCurl * 0.20 * uIdleAmp
      + ripple   * 0.75 * uRippleAmp
      + impact   * 0.40 * uImpactAmp
    );
}
`;

function makeMaterial(uniforms, sign) {
  const material = new MeshPhysicalMaterial({
    color: new Color('#ffffff'),
    roughness: 0.015,
    metalness: 0,
    transmission: 1,
    // Thin, and with absorption pushed far out, so the background reads
    // straight through the letter instead of being tinted by it.
    thickness: 0.32,
    ior: 1.33,
    attenuationColor: new Color('#dcecf6'),
    attenuationDistance: 7.5,
    // A little dispersion at the rim, where the surface turns away hardest.
    iridescence: 0.06,
    iridescenceIOR: 1.2,
    specularIntensity: 1,
    envMapIntensity: 1.8,
    transparent: true,
    side: sign > 0 ? FrontSide : BackSide,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { uSign: { value: sign } });

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${FIELD}`)
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `
        float height = surfaceAt(uv);
        vInside = glyphAt(uv);

        // Gradient in world units, so the normal does not change with how many
        // segments the plane happens to have.
        const float STEP = 1.0 / 256.0;
        float hx = surfaceAt(uv + vec2(STEP, 0.0));
        float hy = surfaceAt(uv + vec2(0.0, STEP));
        float dx = (hx - height) / (STEP * uPlane);
        float dy = (hy - height) / (STEP * uPlane);

        // The back copy is the mirror of the front, so the whole normal flips.
        vec3 objectNormal = normalize(vec3(-dx, -dy, 1.0) * uSign);
        `
      )
      .replace(
        '#include <begin_vertex>',
        'vec3 transformed = vec3(position.xy, position.z + uSign * height);'
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vInside;'
      )
      .replace(
        '#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\nif (vInside <= 0.0) discard;'
      );
  };

  return material;
}

export default function GlyphWater({ sim, glyphA, glyphB, morph, calm = false }) {
  const uniforms = useRef({
    uGlyphA: { value: glyphA },
    uGlyphB: { value: glyphB },
    uRipple: { value: sim?.texture ?? null },
    uMorph: { value: 0 },
    uTime: { value: 0 },
    // Half-thickness of the letter at its fattest.
    uDepth: { value: 0.34 },
    // How far in from the outline the body reaches full thickness.
    uEdge: { value: 0.055 },
    uSpread: { value: SDF_SPREAD },
    uRippleAmp: { value: 0.1 },
    uIdleAmp: { value: 0.05 },
    uImpactAmp: { value: 0.16 },
    uPlane: { value: PLANE },
  });

  const front = useMemo(() => makeMaterial(uniforms.current, 1), []);
  const back = useMemo(() => makeMaterial(uniforms.current, -1), []);

  useEffect(
    () => () => {
      front.dispose();
      back.dispose();
    },
    [front, back]
  );

  useEffect(() => {
    uniforms.current.uGlyphA.value = glyphA;
  }, [glyphA]);

  useEffect(() => {
    uniforms.current.uGlyphB.value = glyphB;
  }, [glyphB]);

  useEffect(() => {
    uniforms.current.uIdleAmp.value = calm ? 0.05 * 0.35 : 0.05;
    uniforms.current.uRippleAmp.value = calm ? 0.1 * 0.45 : 0.1;
    uniforms.current.uImpactAmp.value = calm ? 0 : 0.16;
  }, [calm]);

  useFrame((_, dt) => {
    const u = uniforms.current;
    u.uTime.value += Math.min(dt, 0.05);
    u.uMorph.value = morph?.current ?? 0;
    if (sim) u.uRipple.value = sim.texture;
  });

  return (
    <group>
      <mesh material={front}>
        <planeGeometry args={[PLANE, PLANE, SEGMENTS, SEGMENTS]} />
      </mesh>
      <mesh material={back}>
        <planeGeometry args={[PLANE, PLANE, SEGMENTS, SEGMENTS]} />
      </mesh>
    </group>
  );
}
