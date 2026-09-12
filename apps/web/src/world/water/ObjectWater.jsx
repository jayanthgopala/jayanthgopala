// A project, as an object made of water.
//
// Real geometry rather than an extruded outline, so light goes through a volume
// and out the far side — which is the whole reason to render water at all. The
// surface is pushed along its own normal by the ripple field, so touching it
// deforms the silhouette itself rather than only shading it.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, DoubleSide, MeshPhysicalMaterial } from 'three';
import { shapeGeometry } from './shapes.js';

/** Radians per second an object turns on its own. */
const IDLE_SPIN = 0.16;

/** How quickly a flick bleeds off after release, per second. */
const SPIN_DECAY = 0.055;

const FIELD = /* glsl */ `
attribute vec3 aSmooth;

uniform sampler2D uRipple;
uniform float uFocus;
uniform float uTime;
uniform float uRippleAmp;
uniform float uIdleAmp;
uniform float uImpactAmp;

// Where a point on the object reads the shared ripple field. Derived from the
// position rather than the geometry's own UVs: a torus knot and an icosahedron
// unwrap very differently, and the field should behave the same on both.
vec2 fieldUv(vec3 p) {
  vec3 n = normalize(p);
  return vec2(atan(n.z, n.x) * 0.1591549 + 0.5, n.y * 0.5 + 0.5);
}

float surfaceAt(vec3 p) {
  vec2 uv = fieldUv(p);
  vec2 sim = texture2D(uRipple, uv).rg;
  float ripple = sim.r;
  float impact = sim.r - sim.g;

  // Long, slow swell. Detail belongs to the refraction, not the geometry.
  float idle =
      sin(p.y * 2.6 + uTime * 0.42 + p.x * 1.4) * 0.55
    + sin(p.x * 3.1 - uTime * 0.31 + p.z * 2.0) * 0.30
    + sin(p.z * 1.9 + uTime * 0.23 - p.y * 1.1) * 0.15;

  return idle * 0.35 * uIdleAmp
    + (ripple * 0.75 * uRippleAmp + impact * 0.40 * uImpactAmp) * uFocus;
}
`;

function makeMaterial(uniforms) {
  const material = new MeshPhysicalMaterial({
    color: new Color('#ffffff'),
    roughness: 0.04,
    metalness: 0,
    transmission: 1,
    thickness: 0.95,
    ior: 1.33,
    // Colourless: the object is separated from the page by refraction and
    // specular, which is why the page has tone in it.
    attenuationColor: new Color('#f4fafd'),
    attenuationDistance: 12,
    iridescence: 0.05,
    iridescenceIOR: 1.25,
    specularIntensity: 1,
    clearcoat: 0.45,
    clearcoatRoughness: 0.06,
    envMapIntensity: 2.4,
    transparent: true,
    side: DoubleSide,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${FIELD}`)
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `
        float height = surfaceAt(position);

        // Two tangents spanning the surface, so the displaced normal can be
        // rebuilt by finite difference the same way it was on the flat field.
        vec3 axis = abs(aSmooth.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
        vec3 t1 = normalize(cross(aSmooth, axis));
        vec3 t2 = cross(aSmooth, t1);

        const float STEP = 0.035;
        float h1 = surfaceAt(position + t1 * STEP);
        float h2 = surfaceAt(position + t2 * STEP);

        vec3 objectNormal = normalize(
          aSmooth - (t1 * (h1 - height) + t2 * (h2 - height)) / STEP
        );
        `
      )
      // Displaced along the welded normal, never the face normal, so coincident
      // vertices of a faceted shape move together and no cracks open up.
      .replace('#include <begin_vertex>', 'vec3 transformed = position + aSmooth * height;');
  };

  return material;
}

export default function ObjectWater({ sim, shape, focus, spin, calm = false }) {
  const mesh = useRef(null);

  // Its own orientation, kept here rather than on the stage so turning one
  // object leaves every other one exactly where it was. Started at a random
  // angle so two of the same shape never sit in lockstep.
  const turn = useRef({ x: 0, y: Math.random() * Math.PI * 2, vx: 0, vy: 0 });

  const uniforms = useRef({
    uRipple: { value: sim?.texture ?? null },
    uFocus: { value: 1 },
    uTime: { value: 0 },
    uRippleAmp: { value: 0.12 },
    uIdleAmp: { value: 0.06 },
    uImpactAmp: { value: 0.18 },
  });

  const geometry = useMemo(() => shapeGeometry(shape), [shape]);
  const material = useMemo(() => makeMaterial(uniforms.current), []);

  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    uniforms.current.uIdleAmp.value = calm ? 0.02 : 0.06;
    uniforms.current.uRippleAmp.value = calm ? 0.05 : 0.12;
    uniforms.current.uImpactAmp.value = calm ? 0 : 0.18;
  }, [calm]);

  useFrame((_, dt) => {
    const step = Math.min(dt, 0.05);
    const u = uniforms.current;
    u.uTime.value += step;
    u.uFocus.value = focus?.current ?? 1;
    if (sim) u.uRipple.value = sim.texture;

    const own = turn.current;

    // Only whatever is at the centre answers the pointer, and it takes the drag
    // rather than reading it: leaving the value in place would let the object
    // behind claim the same movement on the following frame.
    const pending = spin?.current;
    if (pending && (focus?.current ?? 1) > 0.5) {
      own.y += pending.y;
      own.x += pending.x;
      own.vy = pending.vy;
      own.vx = pending.vx;
      pending.x = 0;
      pending.y = 0;
      pending.vx = 0;
      pending.vy = 0;
    }

    // Idle turn, then the coast left over from a flick. Decayed by dt so the
    // glide is the same length at any refresh rate.
    if (!calm) own.y += IDLE_SPIN * step;
    own.y += own.vy * step;
    own.x += own.vx * step;
    const bleed = SPIN_DECAY ** step;
    own.vx *= bleed;
    own.vy *= bleed;
    // Kept off the poles: past this it reads as upside down rather than turned.
    own.x = Math.max(-1.2, Math.min(1.2, own.x));

    if (mesh.current) {
      mesh.current.rotation.x = own.x;
      mesh.current.rotation.y = own.y;
    }
  });

  return <mesh ref={mesh} geometry={geometry} material={material} />;
}
