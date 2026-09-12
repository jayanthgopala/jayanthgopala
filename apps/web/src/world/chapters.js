import { Vector3, CatmullRomCurve3 } from 'three';

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

// Intro descent timing in seconds
export const INTRO = { seconds: 3.6, tail: 4.2, rush: 6 };

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Maps raw scroll offset to world progress, cut factor, and page offset
export function scrollState(scroll, vh, out = {}) {
  const worldPx = SEGMENTS.world * vh;
  const cutPx = SEGMENTS.cut * vh;
  const cut = clamp01((scroll - worldPx) / cutPx);

  out.journey =
    scroll < worldPx
      ? JOURNEY.atCut * clamp01(scroll / worldPx)
      : JOURNEY.atCut + (JOURNEY.end - JOURNEY.atCut) * cut;
  out.cut = cut;
  out.page = Math.max(0, scroll - worldPx - cutPx);
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
