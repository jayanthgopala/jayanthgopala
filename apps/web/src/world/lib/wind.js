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
export const WIND_SPEED = 24.0;       // World units per second base speed
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
    /* Base wind is barely visible when still; normal move is clearly visible (~0.4-0.6); capped at 1.2 so never a storm */
    const targetForce = Math.min(speed * 0.016, 1.2);
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
  #define SHARED_WIND_SPEED 24.0
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

    /* 3. Interactive cursor disturbance */
    vec2 relCursor = p.xz - cursorPos;
    float distCursor = length(relCursor);
    float cursorRadius = 85.0;
    float cursorInf = exp(-distCursor / cursorRadius) * cursorForce;
    /* Tangential vortex swirl + forward momentum kick */
    warp += vec2(-relCursor.y, relCursor.x) / max(distCursor, 1.0) * (cursorInf * 28.0);
    warp += SHARED_WIND_DIR * (cursorInf * 18.0);

    return warp;
  }
`;

/**
 * =========================================================================
 * AUDIO SYNTHESIS ENGINE (Synthesized Arctic Wind Audio)
 * =========================================================================
 */

/** Where the gusting bandpass sits, and how far it wanders. */
const BAND_HZ = 380;
const BAND_SWING = 300;
const BAND_Q = 0.55;

/** Everything above this is hiss rather than wind. */
const ROLLOFF_HZ = 1100;

/** Loudness when on. Deliberately low: this is a room tone, not an effect. */
const LEVEL = 0.055;

/** Seconds to fade in or out. Long enough that toggling never clicks. */
const FADE = 1.4;

/** Seconds of noise in the loop buffer. Long, so its own period is inaudible
 *  underneath the filter movement that is doing the real work. */
const BUFFER_SECONDS = 8;

/**
 * Pink noise via the Voss-McCartney style filter bank.
 */
function fillPink(data) {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;

  for (let i = 0; i < data.length; i += 1) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }

  const blend = Math.min(2000, Math.floor(data.length / 8));
  for (let i = 0; i < blend; i += 1) {
    const k = i / blend;
    const tail = data[data.length - blend + i];
    data[i] = data[i] * k + tail * (1 - k);
  }
}

/**
 * A wind that can be switched on and off.
 *
 * @returns {{ start: () => Promise<void>, stop: () => void, dispose: () => void }}
 */
export function createWind() {
  let ctx = null;
  let gain = null;
  let stopped = true;

  function build() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;

    ctx = new Ctx();

    const buffer = ctx.createBuffer(1, ctx.sampleRate * BUFFER_SECONDS, ctx.sampleRate);
    fillPink(buffer.getChannelData(0));

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = BAND_HZ;
    band.Q.value = BAND_Q;

    const rolloff = ctx.createBiquadFilter();
    rolloff.type = 'lowpass';
    rolloff.frequency.value = ROLLOFF_HZ;

    gain = ctx.createGain();
    gain.gain.value = 0;

    const gustA = ctx.createOscillator();
    gustA.frequency.value = 0.037;
    const gustAAmount = ctx.createGain();
    gustAAmount.gain.value = BAND_SWING;

    const gustB = ctx.createOscillator();
    gustB.frequency.value = 0.011;
    const gustBAmount = ctx.createGain();
    gustBAmount.gain.value = BAND_SWING * 0.55;

    gustA.connect(gustAAmount).connect(band.frequency);
    gustB.connect(gustBAmount).connect(band.frequency);

    source.connect(band).connect(rolloff).connect(gain).connect(ctx.destination);

    source.start();
    gustA.start();
    gustB.start();
    return true;
  }

  return {
    async start() {
      if (!ctx && !build()) return;
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch {
          return;
        }
      }
      stopped = false;
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(LEVEL, now + FADE);
    },

    stop() {
      if (!ctx || stopped) return;
      stopped = true;
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + FADE);
    },

    dispose() {
      if (!ctx) return;
      ctx.close().catch(() => {});
      ctx = null;
      gain = null;
    },
  };
}

