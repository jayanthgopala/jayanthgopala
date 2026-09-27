import { CatmullRomCurve3, TubeGeometry, Vector3 } from 'three';
import { withReveal } from '../lib/reveal.js';

// Helpers shared by the props on the shore (Shore.jsx) and the runabout
// (Runabout.jsx).

/** A small seeded generator, so props are laid out the same on every load. */
export function createRng(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/**
 * Snow settles on whatever faces up. Patched into each material along with
 * the reveal, so the props sit under the same dusting as the ground.
 */
export function snowDusted(material, uReveal, amount = 1) {
  material.onBeforeCompile = (shader) => {
    withReveal(shader, uReveal);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
       {
         vec3 up = inverseTransformDirection( normal, viewMatrix );
         float settled = smoothstep( 0.55, 0.85, up.y ) * ${amount.toFixed(2)};
         diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.92, 0.95, 0.99 ), settled );
         roughnessFactor = mix( roughnessFactor, 0.92, settled );
       }`
    );
  };
  // Distinct cache key per dusting amount, since the amount is baked in.
  material.customProgramCacheKey = () => `snow-${amount}`;
  return material;
}

/** A rope hung between two points, sagging under its own weight. */
export function ropeGeometry(a, b, sag) {
  const points = [];
  for (let i = 0; i <= 12; i += 1) {
    const t = i / 12;
    const p = new Vector3().lerpVectors(a, b, t);
    p.y -= Math.sin(Math.PI * t) * sag;
    points.push(p);
  }
  return new TubeGeometry(new CatmullRomCurve3(points), 24, 0.3, 6, false);
}

/**
 * One step of a damped spring toward zero, pushed by a force: state[key] is
 * the displacement and state[`${key}V`] its velocity.
 */
export function spring(state, key, rate, damping, force, dt) {
  const v = `${key}V`;
  state[v] += (-rate * rate * state[key] - damping * state[v] + force) * dt;
  state[key] += state[v] * dt;
}

/** Where a world point falls across the screen, -1 (left) to 1 (right). */
const projected = new Vector3();
export function screenX(point, camera) {
  projected.copy(point).project(camera);
  return Math.max(-1, Math.min(1, projected.x));
}
