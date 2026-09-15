import { Vector3, CatmullRomCurve3 } from 'three';
import { DIVE_START, FALL_TOP, RING_Y, ROOM_VIEW } from './rings/layout.js';

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
export const SEGMENTS = { world: 0.25, cut: 1.2 };

// Cut transition milestones
export const JOURNEY = { atCut: 0.17, end: 0.4 };

// Vertical parallax factor across the cut
export const CUT_PARALLAX = 0.4;

// Ring descent after the last project, in screen heights: a short lead past the
// last project, the cut into the shaft, the fall, and the room it lands in.
export const RINGS = { lead: 0.6, cut: 1.2, fall: 4.8, room: 1.15 };

/**
 * The camera's whole descent, as one curve: straight in at the top of the
 * shaft and through the first ring, then easing off the axis through the
 * middle and last rings (always inside their openings), and sweeping out and
 * down into the room view. One smooth path rather than a straight drop with a
 * hook at the bottom. Points are (y, z); x stays on the axis.
 */
const DESCENT_POINTS = [
  [FALL_TOP, 0],
  [RING_Y[0], 0],
  [RING_Y[Math.floor(RING_Y.length / 2)], 0.12],
  [RING_Y[RING_Y.length - 1], 0.45],
  [ROOM_VIEW.y + 0.5, 2.0],
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

/** Where along the descent the camera passes the middle ring and the last. */
export const DESCENT_U_MID = descentAt(RING_Y[Math.floor(RING_Y.length / 2)]);
export const DESCENT_U_LAST = descentAt(RING_Y[RING_Y.length - 1]);

/** Descent position from fall progress: eased in and out across the dive. */
export function descentU(fall) {
  const t = Math.min(1, Math.max(0, (fall - DIVE_START) / (1 - DIVE_START)));
  return t * t * (3 - 2 * t);
}

/**
 * Fall progress at which the camera clears the last ring. Past it, the scroll
 * carries on into the room by itself.
 */
export const FALL_PAST_LAST = (() => {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 32; i += 1) {
    const mid = (lo + hi) / 2;
    if (mid * mid * (3 - 2 * mid) < DESCENT_U_LAST) lo = mid;
    else hi = mid;
  }
  return DIVE_START + (1 - DIVE_START) * ((lo + hi) / 2);
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
const CAMERA_POINTS = [
  [7.9, 57.8, 399.5],
  [12.2, 77.5, 453],
  [18, 112, 524],
  [22, 155, 588],
  [27, 210, 660],
];

// Camera look-at target waypoints across scroll progress
const TARGET_POINTS = [
  [-24.4, 42.8, 250],
  [-25, 43.5, 250.5],
  [-26, 45, 251],
  [-27, 47, 251.5],
  [-28, 50, 252],
];

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
