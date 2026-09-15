// What this machine can afford.
//
// Every quality decision on this page reads from here rather than testing a
// width of its own, so "small" means one thing and changing it changes all of
// them together.
//
// Resolved once. A phone does not become a desktop mid-session, and re-deciding
// on resize would mean rebuilding geometry and shaders while the reader is
// looking at them.

const width = typeof window === 'undefined' ? 1440 : window.innerWidth;
const cores = typeof navigator === 'undefined' ? 8 : navigator.hardwareConcurrency || 4;

/** Phones and small tablets, where fill rate is the thing in short supply. */
export const SMALL = width < 820;

/** Also thin on cores, so geometry has to be cheaper to build as well. */
export const MODEST = SMALL || cores <= 4;

/**
 * Ceiling on device pixel ratio.
 *
 * The single biggest cost here is fill rate: the backdrop is a fullscreen
 * shader and the objects are transmissive, so both are paid for per pixel. A
 * phone's 3x display would triple that for detail nobody can see at arm's
 * length.
 */
export const MAX_DPR = MODEST ? 1.25 : 1.75;

/**
 * Where a canvas starts, before it has measured its own frame rate: never above
 * the display's real density, since rendering past it buys nothing.
 */
export const START_DPR = Math.min(
  typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
  MAX_DPR
);

/** Floor the adaptive resolution may drop to when frames run long. */
export const MIN_DPR = MODEST ? 0.6 : 0.8;

/**
 * Resolution of the pass transmissive materials refract. The refraction is
 * soft anyway, and this pass is re-rendered every frame for the water.
 */
export const TRANSMISSION_SCALE = MODEST ? 0.5 : 0.75;

/** Side of the ripple simulation. */
export const SIM_SIZE = MODEST ? 128 : 256;

/** Cubemap side for the lighting rig. Built once, but memory is memory. */
export const ENV_SIZE = MODEST ? 128 : 256;

/** Ambient bubbles drifting past. Each one is transmissive. */
export const BUBBLES = MODEST ? 14 : 64;

/** Patches of frost allowed to be forming at once. */
export const GLAZE_ACTIVE = SMALL ? 2 : 4;

/**
 * Longest triangle edge a shape may have.
 *
 * Coarser on modest hardware: fewer vertices to displace every frame, and far
 * less time spent subdividing before the first object can be shown.
 */
export const MAX_EDGE = MODEST ? 0.2 : 0.12;
