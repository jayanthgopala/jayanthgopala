import { Vector3, CatmullRomCurve3 } from 'three';
import { FALL_TOP, RING_Y, ROOM_VIEW } from './rings/layout.js';

// Camera waypoints, trajectory curves, and scroll act definitions.

export const ACTS = [
  { id: 'horizon', index: 1, start: 0.0, end: 0.17, label: 'Horizon' },
  { id: 'work', index: 2, start: 0.17, end: 1.0, label: 'Selected Work' },
];

export function actAt(progress) {
  return ACTS.find((a) => progress >= a.start && progress < a.end) || ACTS[ACTS.length - 1];
}

// 0..1 progress within the given act
export function actProgress(progress, act) {
  const span = act.end - act.start;
  return span <= 0 ? 0 : Math.min(1, Math.max(0, (progress - act.start) / span));
}

// Scroll segments measured in screen heights
// The world stretch carries the boat's run and the camera flying ahead of it
// before the cut (one scroll glides through it: see ScrollProvider).
export const SEGMENTS = { world: 1.0, cut: 1.2 };

// Cut transition milestones
export const JOURNEY = { atCut: 0.17, end: 0.4 };

// Vertical parallax factor across the cut
export const CUT_PARALLAX = 0.4;

// Ring descent after the last project, in screen heights: a short lead past the
// last project, the cut into the shaft, the fall, and the room it lands in.
// Short, as igloo.inc's is: a brisk scroll carries from the last project down
// the shaft into the room, and it all follows the scroll, both ways.
export const RINGS = { lead: 0.3, cut: 0.8, fall: 2.4, room: 1.15 };

/**
 * The camera's whole descent, as one curve: straight in at the top of the
 * shaft and through the first ring, then easing off the axis through the
 * middle and last rings (always inside their openings), and sweeping out and
 * down into the room view. One smooth path rather than a straight drop with a
 * hook at the bottom. Points are (y, z); x stays on the axis.
 */
const DESCENT_POINTS = [
  // In from high above the first ring, curving down onto the axis: the ring
  // seen from above as a circle the whole way, the path dropping into its
  // centre (the opening, played across the ring cut).
  [FALL_TOP + 4.6, 0.9],
  [FALL_TOP + 2.2, 0.2],
  [FALL_TOP, 0],
  [RING_Y[0], 0],
  [RING_Y[Math.floor(RING_Y.length / 2)], 0.08],
  [RING_Y[RING_Y.length - 1], 0.3],
  // Out of the shaft in one even arc, bending from falling to gliding, until
  // level over the lake: no drop-then-hook.
  [ROOM_VIEW.y + 3.3, 1.0],
  [ROOM_VIEW.y + 2.0, 2.1],
  [ROOM_VIEW.y + 1.0, 3.4],
  [ROOM_VIEW.y + 0.35, 4.8],
  [ROOM_VIEW.y, ROOM_VIEW.z],
];

export const DESCENT_CURVE = new CatmullRomCurve3(
  DESCENT_POINTS.map(([y, z]) => new Vector3(0, y, z)),
  false,
  'centripetal'
);

/** Arc-length position along the descent where the camera first reaches a height. */
function descentAt(y) {
  const p = new Vector3();
  for (let i = 0; i <= 600; i += 1) {
    const u = i / 600;
    DESCENT_CURVE.getPointAt(u, p);
    if (p.y <= y) return u;
  }
  return 1;
}

/** Where along the descent the camera passes the last ring. */
export const DESCENT_U_LAST = descentAt(RING_Y[RING_Y.length - 1]);
/** Just clear of the last ring: the gaze stays down the shaft until here. */
export const DESCENT_U_TURN = descentAt(RING_Y[RING_Y.length - 1] - 0.8);

// The share of the descent played across the ring cut, in proportion to the
// scroll each takes, so the pace carries straight on from one to the other.
const CUT_SHARE = RINGS.cut / (RINGS.cut + RINGS.fall);

/**
 * Descent position from the ring cut and the fall: one path at one pace,
 * eased in under the cut and out into the room, never stopping in between.
 */
export function descentU(fall, cut = 1) {
  const c = Math.min(1, Math.max(0, cut));
  const f = Math.min(1, Math.max(0, fall));
  const q = CUT_SHARE * c + (1 - CUT_SHARE) * f;
  return 0.5 - 0.5 * Math.cos(Math.PI * q);
}

/** Fall progress at which the camera clears the last ring. */
export const FALL_PAST_LAST = (() => {
  const q = Math.acos(1 - 2 * DESCENT_U_LAST) / Math.PI;
  return Math.min(1, Math.max(0, (q - CUT_SHARE) / (1 - CUT_SHARE)));
})();

// Offset into the page scroll where the ring cut begins — just past the point
// WorkPage parks on its last project.
export function ringsStart(pageHeight, vh) {
  return Math.max(pageHeight, vh) - vh + RINGS.lead * vh;
}

// Intro descent timing in seconds
export const INTRO = { seconds: 3.6, tail: 4.2, rush: 6 };

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Maps raw scroll offset to world progress, cut factor, and page offset
export function scrollState(scroll, vh, out = {}, pageHeight = 0) {
  const worldPx = SEGMENTS.world * vh;
  const cutPx = SEGMENTS.cut * vh;
  const cut = clamp01((scroll - worldPx) / cutPx);

  out.journey =
    scroll < worldPx
      ? JOURNEY.atCut * clamp01(scroll / worldPx)
      : JOURNEY.atCut + (JOURNEY.end - JOURNEY.atCut) * cut;
  out.cut = cut;
  out.page = Math.max(0, scroll - worldPx - cutPx);

  const ringPx = out.page - ringsStart(pageHeight, vh);
  // Only once the page has a height: before WorkPage reports one, the start
  // would sit at the top of the page and mount the rings on load.
  // Mounted four screens early, so the scene is built and compiled while the
  // reader is still on the projects, not as they reach the last one.
  out.ringNear = pageHeight > 0 && out.page > 0 && ringPx > -4 * vh;
  out.ringCut = pageHeight > 0 ? clamp01(ringPx / (RINGS.cut * vh)) : 0;
  out.ringFall = pageHeight > 0 ? clamp01((ringPx - RINGS.cut * vh) / (RINGS.fall * vh)) : 0;
  return out;
}

// Camera position waypoints across scroll progress
// The opening hero frame places the igloo centered in the landscape with a slightly
// elevated camera looking down at the frosted dome and front-right warm entrance.
const CAMERA_POINTS = [
  // Opening frame: well back from the igloo, so it sits small in a wide
  // snowfield as in the reference.
  [-34, 21, 382],
  [-28, 48, 400],
  [-27, 85, 465],
  [-25, 122, 535],
  [-24, 168, 610],
  [-22, 215, 680],
];

// Camera look-at target waypoints across scroll progress
const TARGET_POINTS = [
  // Aimed a little left of the igloo, which then sits just right of centre.
  [-40, 15, 252],
  [-28, 16, 252],
  [-28, 26, 252],
  [-28, 36, 252],
  [-28, 45, 252],
  [-28, 52, 252],
];

// The opening frame, which the sky backplate was cut from (see SnowSky).
export const OPENING_FRAME = { eye: CAMERA_POINTS[0], aim: TARGET_POINTS[0], fov: 38 };

const toVec = (p) => new Vector3(p[0], p[1], p[2]);

export const CAMERA_CURVE = new CatmullRomCurve3(CAMERA_POINTS.map(toVec), false, 'centripetal');
export const TARGET_CURVE = new CatmullRomCurve3(TARGET_POINTS.map(toVec), false, 'centripetal');

// Subject position derived from camera look-at target
export function characterPosition(progress, out = new Vector3()) {
  TARGET_CURVE.getPointAt(Math.min(1, Math.max(0, progress)), out);
  out.z -= 16;
  out.x *= 0.35;
  return out;
}
