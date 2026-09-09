import { MOUND_AT } from './terrain.js';

/**
 * THE WIND. ONE FIELD, READ BY EVERYTHING.
 *
 * WHY THIS EXISTS, AND IT IS AN ARCHITECTURAL ARGUMENT RATHER THAN A FEATURE.
 *
 * Before this, every moving thing in the scene had its own private idea of the
 * air. Weather.jsx held a WIND vector and a WIND_SPEED; Terrain.jsx held
 * FOG_DRIFT and FOG_WISP_DRIFT with a comment warning that the two must be kept
 * in agreement by hand; AirFilaments scrolled at its own rate; Clouds.jsx has
 * three more speeds of its own. Five systems, five constants, one physical
 * quantity — and the only thing keeping them consistent was a note asking the
 * next person to remember.
 *
 * That is a correctness problem before it is a design one. Grains crossing the
 * frame at a visibly different rate from the air they are suspended in is the
 * single mistake that gives an atmospheric scene away, and with the speeds held
 * in five files it is not a question of whether they drift apart but when.
 *
 * IT IS ALSO THE ONLY WAY THE INTERACTION CAN BE COHERENT. The brief asks for
 * one cause with many effects: the cursor disturbs the air, and the snow, the
 * frost, the mist and the sound all answer. That is impossible to build as
 * per-system mouse handlers — it would be five effects that happen to fire at
 * once, which reads as five gimmicks. It is trivial once there is a single field
 * that one thing writes and everything else reads.
 *
 * SHAPE OF IT. A plain mutable singleton, advanced once per frame by WindField
 * and sampled by anyone. Not React state and not context: it changes every frame
 * and nothing renders off it, so state would mean sixty re-renders a second to
 * deliver a number that only useFrame callbacks ever look at.
 */

/** Prevailing direction in the XZ plane, normalised. Matches Weather's WIND. */
const PREVAILING = [0.958, 0.287];

/**
 * Base speed in world units per second.
 *
 * THE ONE PLACE THIS NUMBER LIVES NOW. Weather.jsx's WIND_SPEED was 34 and
 * Terrain.jsx's FOG_WISP_DRIFT was 34 on X with a note tying them together by
 * hand; both are expressed as multiples of this instead.
 */
export const WIND_BASE = 34;

/**
 * The live field. Read it, do not replace it — consumers hold the reference.
 */
export const wind = {
  /** Seconds since start, advanced by WindField. */
  time: 0,
  /** Prevailing direction, XZ, normalised. */
  dirX: PREVAILING[0],
  dirZ: PREVAILING[1],
  /**
   * GUST MULTIPLIER, and it is the value most consumers actually want.
   *
   * Hovers around 1 and wanders between roughly 0.55 and 1.5 on a slow cycle.
   * Everything that moves scales its own rate by this, so the whole scene surges
   * and eases together — which is what makes it read as weather rather than as
   * several independent animations that happen to share a screen.
   */
  gust: 1,
  /**
   * Cursor disturbance, in world XZ, with a strength that decays.
   *
   * The pointer does not blow the snow directly. It writes here, and the
   * consumers decide what a local disturbance means for them — see sampleAt.
   */
  cursorX: MOUND_AT[0],
  cursorZ: MOUND_AT[1],
  cursorStrength: 0,
};

/* Smooth 1-D value noise, for the gust envelope. Cheap; called once a frame. */
const hash1 = (n) => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};

const noise1 = (x) => {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash1(i) + (hash1(i + 1) - hash1(i)) * u;
};

/**
 * Advance the field. Called once per frame by WindField and nowhere else.
 */
export function updateWind(dt, elapsed) {
  wind.time = elapsed;

  /*
   * TWO OCTAVES AT NON-DIVIDING RATES. One gives a regular pulse, which reads
   * as a loop the moment anyone watches for ten seconds. Two that do not divide
   * each other never repeat, so the air surges irregularly the way it does
   * outdoors.
   */
  const g = noise1(elapsed * 0.055) * 0.65 + noise1(elapsed * 0.131 + 17) * 0.35;
  wind.gust = 0.55 + g * 0.95;

  /*
   * The direction swings slightly with the gust. Real wind veers as it
   * strengthens; holding a fixed bearing while the speed changes is the tell
   * that a single scalar is being animated.
   */
  const veer = (noise1(elapsed * 0.043 + 7) - 0.5) * 0.35;
  const c = Math.cos(veer);
  const s = Math.sin(veer);
  wind.dirX = PREVAILING[0] * c - PREVAILING[1] * s;
  wind.dirZ = PREVAILING[0] * s + PREVAILING[1] * c;

  /*
   * THE CURSOR'S INFLUENCE DECAYS RATHER THAN SWITCHING OFF.
   *
   * A disturbance that vanishes the instant the pointer stops is a hover state.
   * Air keeps moving after whatever pushed it has gone, so the strength eases
   * away over about a second and a half — long enough that the environment is
   * still settling when attention has moved on, which is most of what separates
   * "the world reacted to me" from "that element has a hover effect".
   */
  wind.cursorStrength *= Math.exp(-dt * 0.7);
}

/**
 * Tell the field where the pointer is, in world XZ.
 *
 * `push` is how hard — it should scale with how fast the pointer is moving, so
 * a still cursor disturbs nothing and a flick disturbs a lot.
 */
export function setCursor(x, z, push) {
  wind.cursorX = x;
  wind.cursorZ = z;
  wind.cursorStrength = Math.min(1, wind.cursorStrength + push);
}

const _out = { x: 0, z: 0, speed: 0 };

/**
 * The wind at a world position: direction, and speed in units per second.
 *
 * THE CURSOR TERM IS RADIAL AND FALLS OFF, which is what makes it read as a
 * disturbance in the air rather than as a second wind. Near the pointer the
 * flow is pushed outward from it; a hundred units away there is nothing but the
 * prevailing drift. Consumers that only want a scalar can read `.speed`.
 */
export function sampleAt(x, z) {
  let dx = wind.dirX;
  let dz = wind.dirZ;
  let mag = WIND_BASE * wind.gust;

  if (wind.cursorStrength > 0.001) {
    const px = x - wind.cursorX;
    const pz = z - wind.cursorZ;
    const d2 = px * px + pz * pz;
    /* 90-unit radius, squared falloff — local, and gone well before the frame
       edge, so the effect is a place rather than a global multiplier. */
    const fall = Math.exp(-d2 / (90 * 90));
    const k = wind.cursorStrength * fall;
    const inv = 1 / Math.sqrt(d2 + 1e-3);
    dx += px * inv * k * 1.6;
    dz += pz * inv * k * 1.6;
    mag *= 1 + k * 0.9;
  }

  const len = Math.hypot(dx, dz) || 1;
  _out.x = dx / len;
  _out.z = dz / len;
  _out.speed = mag;
  return _out;
}

/**
 * A 0..1 scalar for "how disturbed is the air here" — the cheap read for
 * consumers that only need an amount, such as the igloo's frost or the audio
 * bed. Combines the gust with the local cursor disturbance.
 */
export function agitationAt(x, z) {
  const px = x - wind.cursorX;
  const pz = z - wind.cursorZ;
  const fall = Math.exp(-(px * px + pz * pz) / (90 * 90));
  return Math.min(1, (wind.gust - 0.55) / 0.95 * 0.7 + wind.cursorStrength * fall * 0.8);
}
