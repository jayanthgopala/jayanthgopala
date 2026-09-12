/**
 * UNIFIED SHARED WIND FIELD
 *
 * Single source of truth for all atmospheric movement in the Arctic scene.
 * Mist layers, surface snow drift, loose snow particles, and igloo deflection
 * all evaluate from this shared mathematical model.
 */

import { Vector2, Vector3, Plane, Raycaster } from 'three';
import { MOUND_AT } from './terrain.js';

export const WIND_DIR = [-0.96, -0.28]; // Normalized horizontal direction crossing right-to-left with slight camera lean
export const WIND_SPEED = 16.0;       // Slow, graceful atmospheric drift speed
export const IGLOO_EDDY_AT = [MOUND_AT[0], MOUND_AT[1]]; // [-30, 252]
export const IGLOO_EDDY_RADIUS = 110.0;
export const IGLOO_EDDY_STRENGTH = 28.0;

const groundPlane = new Plane(new Vector3(0, 1, 0), -16);
const hitPoint = new Vector3();
const raycaster = new Raycaster();
const prevCursor = new Vector2(-30, 252);
let lastUpdateTime = -1;

export const windState = {
  time: 0,
  cursorPos: new Vector2(-30, 252),
  cursorForce: 0,
};

/**
 * Updates the shared wind interaction state once per frame.
 * Measures cursor speed across the snow plane to produce smooth impulse and decay.
 */
export function updateWindState(state, delta) {
  if (state.clock.elapsedTime === lastUpdateTime) return windState;
  lastUpdateTime = state.clock.elapsedTime;

  const dt = Math.max(0.001, Math.min(delta, 1 / 20));
  windState.time = state.clock.elapsedTime;

  raycaster.setFromCamera(state.pointer, state.camera);
  const hit = raycaster.ray.intersectPlane(groundPlane, hitPoint);
  if (hit) {
    const distMoved = prevCursor.distanceTo(hitPoint);
    const speed = distMoved / dt;
    /* Responsive wind reaction: active movement bends and curls nearby mist and snow */
    const targetForce = Math.min(speed * 0.022, 1.4);
    windState.cursorForce += (targetForce - windState.cursorForce) * (1 - Math.exp(-4.2 * dt));
    windState.cursorPos.set(hitPoint.x, hitPoint.z);
    prevCursor.set(hitPoint.x, hitPoint.z);
  } else {
    windState.cursorForce += (0 - windState.cursorForce) * (1 - Math.exp(-4.2 * dt));
  }

  return windState;
}

/**
 * Shared GLSL definitions and evaluation function for wind flow.
 * Injected into Terrain.jsx (mist + surface drift) and Weather.jsx (particles).
 */
export const SHARED_WIND_GLSL = /* glsl */ `
  #define SHARED_WIND_DIR vec2(-0.96, -0.28)
  #define SHARED_WIND_SPEED 16.0
  #define SHARED_EDDY_AT vec2(${IGLOO_EDDY_AT[0].toFixed(1)}, ${IGLOO_EDDY_AT[1].toFixed(1)})
  #define SHARED_EDDY_RADIUS ${IGLOO_EDDY_RADIUS.toFixed(1)}
  #define SHARED_EDDY_STRENGTH ${IGLOO_EDDY_STRENGTH.toFixed(1)}

  /*
   * Evaluates the shared wind displacement warp at world position p.
   * Returns coordinate displacement including:
   * 1. Multi-harmonic crosswind turbulence & height shear
   * 2. Obstacle deflection around the igloo mound
   * 3. Interactive cursor disturbance (swirl vortex + acceleration kick)
   */
  vec2 evaluateWindWarp(vec3 p, float t, float speedFactor, vec2 cursorPos, float cursorForce) {
    vec2 warp = vec2(0.0);

    /* 1. Multi-harmonic crosswind turbulence (moving opposite way) */
    float longWave = sin(p.z * 0.007 - t * 0.42 * speedFactor) * 16.0;
    float shortWave = sin(p.z * 0.022 + t * 0.85 * speedFactor + 2.1) * 7.5;
    float heightShear = sin(p.y * 0.035 - t * 0.55 * speedFactor) * 5.5;
    float crossWaver = sin(p.x * 0.011 - t * 0.48 * speedFactor) * 5.0;

    warp.x += (longWave + shortWave + heightShear);
    warp.y += crossWaver;

    /* 2. Obstacle deflection around the igloo mound (slipstream mirrored for reversed wind) */
    vec2 relIgloo = p.xz - SHARED_EDDY_AT;
    float distIgloo = length(relIgloo);
    float iglooCurl = exp(-distIgloo / SHARED_EDDY_RADIUS) * SHARED_EDDY_STRENGTH
      * (0.70 + 0.30 * sin(t * 0.35 - distIgloo * 0.025));
    warp += vec2(relIgloo.y, -relIgloo.x) / max(distIgloo, 1.0) * iglooCurl;

    /* 3. Interactive cursor disturbance: widened radius & stronger deflection */
    vec2 relCursor = p.xz - cursorPos;
    float distCursor = length(relCursor);
    float cursorRadius = 115.0;
    float cursorInf = exp(-distCursor / cursorRadius) * cursorForce;
    /* Tangential vortex swirl + forward momentum kick */
    warp += vec2(-relCursor.y, relCursor.x) / max(distCursor, 1.0) * (cursorInf * 36.0);
    warp += SHARED_WIND_DIR * (cursorInf * 24.0);

    return warp;
  }
`;
