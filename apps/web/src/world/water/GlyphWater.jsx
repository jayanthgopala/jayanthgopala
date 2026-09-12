// The liquid letterform.
//
// A plane whose vertices are pushed out of the page by the glyph's signed
// distance field, so the letter gains a rounded body that thins to nothing at
// its outline. Fragments outside the glyph are discarded, which is what makes
// the shape read as a free-standing blob of water rather than a decal.
//
// Two copies are drawn, one pushed toward the camera and one away, closing the
// volume so it refracts like something with a front and a back.
//
// One instance carries one letter. Moving between projects slides whole letters
// past the camera rather than melting one shape into another, so a letter is
// only ever itself.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, FrontSide, BackSide, MeshPhysicalMaterial } from 'three';
import { SDF_SPREAD } from './glyph.js';

/** Side of the square the glyph is drawn into, in world units. */
export const PLANE = 3.5;

const SEGMENTS = 176;

const FIELD = /* glsl */ `
uniform sampler2D uGlyph;
uniform sampler2D uRipple;
uniform float uFocus;
uniform float uTime;
uniform float uDepth;
uniform float uEdge;
uniform float uSpread;
uniform float uSign;
uniform float uRippleAmp;
uniform float uIdleAmp;
uniform float uImpactAmp;
uniform float uEdgeIdle;
uniform float uEdgePush;
uniform float uPlane;

varying float vInside;

// Signed distance to the typed letterform: positive inside, negative outside.
float glyphAt(vec2 uv) {
  return (texture2D(uGlyph, uv).r - 0.5) * 2.0 * uSpread;
}

// How far the outline is pushed out, or pulled in, at this point.
//
// Displacing only the surface left the silhouette pinned to the type, which is
// what made the letter read as a decal: the inside moved and the edge did not.
// Offsetting the distance field instead moves the boundary itself, so the shape
// breathes on its own and swells outward wherever it is touched.
float edgeAt(vec2 uv) {
  vec2 sim = texture2D(uRipple, uv).rg;
  float ripple = sim.r;
  float impact = sim.r - sim.g;

  float a = uv.x * 6.2831853;
  float breathe =
      sin(uv.y * 2.7 + uTime * 0.33 + a * 1.5) * 0.60
    + sin(uv.y * 4.1 - uTime * 0.21 - a * 2.5) * 0.40;

  return breathe * uEdgeIdle + (ripple * 0.8 + impact * 0.6) * uEdgePush * uFocus;
}

// The outline as it currently stands, type plus whatever the water is doing.
float shapeAt(vec2 uv) {
  return glyphAt(uv) + edgeAt(uv);
}

// Surface height above the page, before the sign is applied.
float surfaceAt(vec2 uv) {
  float signedDistance = shapeAt(uv);

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
      + ripple   * 0.75 * uRippleAmp * uFocus
      + impact   * 0.40 * uImpactAmp * uFocus
    );
}
`;

function makeMaterial(uniforms, sign) {
  const material = new MeshPhysicalMaterial({
    color: new Color('#ffffff'),
    // Not a mirror finish: a hair of roughness spreads the highlights into
    // streaks you can actually see rather than pinpoints you cannot.
    roughness: 0.04,
    metalness: 0,
    transmission: 1,
    // Thick enough to bend the dot grid visibly behind it. This is the single
    // number that decides whether the letter is legible.
    thickness: 0.95,
    ior: 1.33,
    // Colourless. Absorption is pushed far enough out that the body adds no
    // tint of its own — the letter is separated from the page by refraction and
    // specular alone, which is the whole reason the page has tone in it.
    attenuationColor: new Color('#f4fafd'),
    attenuationDistance: 12,
    // A trace of dispersion at the rim, where the surface turns away hardest.
    iridescence: 0.05,
    iridescenceIOR: 1.25,
    specularIntensity: 1,
    // A thin hard surface over the water, for the crisp glassy edge.
    clearcoat: 0.45,
    clearcoatRoughness: 0.06,
    envMapIntensity: 2.4,
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
        // Discard follows the displaced boundary, not the typed one, or the
        // bulge would be clipped back to the letter's original outline.
        vInside = shapeAt(uv);

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

export default function GlyphWater({ sim, glyph, focus, calm = false }) {
  const uniforms = useRef({
    uGlyph: { value: glyph },
    uRipple: { value: sim?.texture ?? null },
    uFocus: { value: 1 },
    uTime: { value: 0 },
    // Half-thickness of the letter at its fattest.
    uDepth: { value: 0.52 },
    // How far in from the outline the body reaches full thickness. Wider means
    // the rim rolls over across more of the face, so the edge highlight is a
    // band rather than a hairline.
    uEdge: { value: 0.072 },
    uSpread: { value: SDF_SPREAD },
    uRippleAmp: { value: 0.1 },
    uIdleAmp: { value: 0.05 },
    uImpactAmp: { value: 0.16 },
    // Constant drift of the outline, so it is never quite still.
    uEdgeIdle: { value: 0.008 },
    // How far a touch throws the boundary out from that point.
    uEdgePush: { value: 0.05 },
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
    uniforms.current.uGlyph.value = glyph;
  }, [glyph]);

  useEffect(() => {
    uniforms.current.uIdleAmp.value = calm ? 0.05 * 0.35 : 0.05;
    uniforms.current.uRippleAmp.value = calm ? 0.1 * 0.45 : 0.1;
    uniforms.current.uImpactAmp.value = calm ? 0 : 0.16;
    uniforms.current.uEdgeIdle.value = calm ? 0.003 : 0.008;
    uniforms.current.uEdgePush.value = calm ? 0.018 : 0.05;
  }, [calm]);

  useFrame((_, dt) => {
    const u = uniforms.current;
    u.uTime.value += Math.min(dt, 0.05);
    u.uFocus.value = focus?.current ?? 1;
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
