// A project, as an object made of water.
//
// Real geometry rather than an extruded outline, so light goes through a volume
// and out the far side — which is the whole reason to render water at all. The
// surface is pushed along its own normal by the ripple field, so touching it
// deforms the silhouette itself rather than only shading it.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, DoubleSide, FrontSide, MeshPhysicalMaterial } from 'three';
import { isOpenShape, shapeGeometry } from './shapes.js';
import { sound } from '../lib/sound.js';

/** Radians per second an object turns on its own. */
const IDLE_SPIN = 0.16;

/** How quickly a flick bleeds off after release, per second. */
const SPIN_DECAY = 0.055;

/**
 * Frames an object is drawn even while out of view.
 *
 * During the About section the objects sit below the frame, so frustum culling
 * skipped them and their buffers, shader and transmission pass were only set up
 * on the frame the first project slid in — which is where it stalled. Drawing
 * them for a moment first gets all of that done while the reader is on About.
 */
const WARM_FRAMES = 40;

const FIELD = /* glsl */ `
attribute vec3 aSmooth;

uniform sampler2D uRipple;
uniform float uFocus;
uniform float uTime;
uniform float uRippleAmp;
uniform float uIdleAmp;
uniform float uImpactAmp;

#ifdef PLANAR_FIELD
uniform float uFieldScale;
#endif

#ifdef MORPH_BLOB
// 0 the object's own shape, 1 melted into a single rounded drop.
uniform float uMelt;
#endif

// Where a point on the object reads the shared ripple field. Derived from the
// position rather than the geometry's own UVs: a torus knot and an icosahedron
// unwrap very differently, and the field should behave the same on both.
// Flat objects (the contact marks) read it straight across their face instead,
// so a touch ripples out from exactly where it landed.
vec2 fieldUv(vec3 p) {
#ifdef PLANAR_FIELD
  return p.xy * uFieldScale + 0.5;
#else
  vec3 n = normalize(p);
  return vec2(atan(n.z, n.x) * 0.1591549 + 0.5, n.y * 0.5 + 0.5);
#endif
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

/**
 * The project objects' water. Shared with the contact marks, which pass
 * `planar` to read the ripple field flat across their face.
 */
export function makeWaterMaterial(uniforms, { planar = false, edge = null, morph = false } = {}) {
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
    // No iridescence: at 0.05 it was invisible, but it still costs a thin-film
    // evaluation on every pixel of the object.
    specularIntensity: 1,
    clearcoat: 0.45,
    clearcoatRoughness: 0.06,
    envMapIntensity: 2.4,
    transparent: true,
    side: DoubleSide,
  });

  // Added to the material's own defines, never in place of them: replacing
  // them drops PHYSICAL, and without it the transmission shader cannot compile.
  if (planar) material.defines = { ...material.defines, PLANAR_FIELD: '' };
  // `morph`: the body can melt into one rounded drop (uMelt), so two shapes
  // can be swapped while both are the same drop and the water re-forms.
  if (morph) material.defines = { ...material.defines, MORPH_BLOB: '' };

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

    if (morph) {
      shader.vertexShader = shader.vertexShader
        // Blend the lighting normal toward the drop's as it melts.
        .replace(
          '#include <defaultnormal_vertex>',
          /* glsl */ `
          float meltK = uMelt * uMelt * (3.0 - 2.0 * uMelt);
          vec3 dropDir = normalize(position * vec3(1.0, 1.0, 2.4) + vec3(0.0, 0.0, 1e-4));
          objectNormal = normalize(mix(objectNormal, normalize(dropDir * vec3(1.0, 1.0, 2.3)), meltK));
          #include <defaultnormal_vertex>
          `
        )
        // Every point of the surface drawn onto a wobbling pebble of water.
        .replace(
          'vec3 transformed = position + aSmooth * height;',
          /* glsl */ `
          vec3 transformed = position + aSmooth * height;
          float dropWobble = 1.0
            + 0.09 * sin(dropDir.x * 5.0 + uTime * 3.1) * sin(dropDir.y * 4.0 - uTime * 2.6)
            + 0.05 * sin(dropDir.z * 6.0 + uTime * 2.2);
          vec3 drop = dropDir * vec3(0.46, 0.46, 0.2) * dropWobble;
          transformed = mix(transformed, drop, meltK);
          `
        );
    }

    // On a near-white ground clear water has nothing to show and disappears.
    // `edge` darkens it toward its silhouette, the way a body of water in a
    // bright studio reads by its dark rim.
    if (edge) {
      shader.uniforms.uEdgeColor = { value: new Color(edge.color) };
      shader.uniforms.uEdgeAmount = { value: edge.amount };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uEdgeColor;\nuniform float uEdgeAmount;')
        .replace(
          '#include <opaque_fragment>',
          /* glsl */ `
          {
            float edgeFres = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.5);
            outgoingLight = mix(outgoingLight, uEdgeColor, edgeFres * uEdgeAmount);
          }
          #include <opaque_fragment>
          `
        );
    }
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

  // Warm again whenever the shape changes, so the next object's buffers are on
  // the GPU before it scrolls into view.
  const warm = useRef(0);
  useEffect(() => {
    warm.current = 0;
  }, [geometry]);
  const material = useMemo(() => makeWaterMaterial(uniforms.current), []);

  // Double-sided transmission renders the object twice; only open surfaces
  // need it. Closed shapes draw their front faces and let thickness stand in
  // for the far side.
  useEffect(() => {
    const side = isOpenShape(shape) ? DoubleSide : FrontSide;
    if (material.side !== side) {
      material.side = side;
      material.needsUpdate = true;
    }
  }, [material, shape]);

  useEffect(() => {
    return () => {
      material.dispose();
      sound.waterPhysics({ focus: 0 });
    };
  }, [material]);

  useEffect(() => {
    uniforms.current.uIdleAmp.value = calm ? 0.02 : 0.06;
    uniforms.current.uRippleAmp.value = calm ? 0.05 : 0.12;
    uniforms.current.uImpactAmp.value = calm ? 0 : 0.18;
  }, [calm]);

  useFrame((_, dt) => {
    if (mesh.current && warm.current < WARM_FRAMES) {
      warm.current += 1;
      mesh.current.frustumCulled = warm.current >= WARM_FRAMES;
    }

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

    const foc = focus?.current ?? 1;
    if (foc > 0.4) {
      const angSpeed = Math.hypot(own.vx, own.vy);
      sound.waterPhysics({
        angSpeed,
        rotX: own.x,
        rotY: own.y,
        focus: foc,
      });
    }
  });

  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} />;
}
