import { Vector3, CatmullRomCurve3 } from 'three';

// Where the camera goes, where it looks, and which act it's in.
// Position and aim are separate splines sampled at the same progress, so the camera can look sideways at something while moving past it.

export const ACTS = [
  { id: 'horizon', index: 1, start: 0.0, end: 0.17, label: 'Horizon' },
  { id: 'work', index: 2, start: 0.17, end: 1.0, label: 'Selected Work' },
];

export function actAt(progress) {
  return ACTS.find((a) => progress >= a.start && progress < a.end) || ACTS[ACTS.length - 1];
}

// 0..1 within the given act
export function actProgress(progress, act) {
  const span = act.end - act.start;
  return span <= 0 ? 0 : Math.min(1, Math.max(0, (progress - act.start) / span));
}

// The scroll in three stretches, measured in screens.
// world: a quarter screen, so the cut starts while the camera is still pulling back rather than after dead travel.
// cut: the wipe, never faster than ScrollProvider's CUT_MIN_SECONDS so the blur is always seen. Let go early and it eases back.
// page: whatever the work page measures, ScrollProvider adds it.
export const SEGMENTS = { world: 0.25, cut: 1.2 };

// The cut begins half way through the pull-back and the lens carries on to 0.4 underneath it, so the rest plays inside the blur.
export const JOURNEY = { atCut: 0.17, end: 0.4 };

// How far each picture travels vertically across the cut, as a share of frame
export const CUT_PARALLAX = 0.4;

// The opening descent's clock. tail runs longer than seconds so the last of the land arrives just after the shot settles.
// rush is how much faster it all runs once the visitor scrolls, a camera that keeps falling anyway reads as ignoring them.
export const INTRO = { seconds: 3.6, tail: 4.2, rush: 6 };

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Scroll pixels to the three things the world reads. Writes into out because it runs every frame.
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

// Y is authored as a floor, CameraRig lifts the camera wherever the terrain would come through the lens.
// The opening frame was solved off igloo.inc: dome centred, lens level with its shoulder. A raised vantage makes it a model on a table.
// Every later point is further and higher with the aim held, so the move is one retreat with the subject shrinking in the middle.
// It climbs rather than dollying flat because the ground behind the camera rises hard, a level reverse hits a hillside in seconds.
// The dome was asked to read bigger and the lens moved in along the sight line. The model is never scaled.
const CAMERA_POINTS = [
  [7.9, 57.8, 399.5], // the held opening frame
  [12.2, 77.5, 453], // starting back and up, dome still the subject
  [18, 112, 524], // the near hills come into view around it
  [22, 155, 588], // one object in a landscape now
  [27, 210, 660], // a mark on an empty white plain
];

// One subject the whole way. The aim only creeps, which is what keeps the igloo centred as the perspective changes.
// It's deliberately not on the dome, pitch and subject height are two constraints and one point can't satisfy both.
// No two points are identical, centripetal Catmull-Rom divides by the distance between them and a repeat comes out NaN.
const TARGET_POINTS = [
  [-24.4, 42.8, 250], // the hero framing
  [-25, 43.5, 250.5],
  [-26, 45, 251],
  [-27, 47, 251.5],
  [-28, 50, 252],
];

const toVec = (p) => new Vector3(p[0], p[1], p[2]);

// Centripetal matters, uniform parameterisation makes unevenly spaced waypoints loop and overshoot between them.
export const CAMERA_CURVE = new CatmullRomCurve3(CAMERA_POINTS.map(toVec), false, 'centripetal');
export const TARGET_CURVE = new CatmullRomCurve3(TARGET_POINTS.map(toVec), false, 'centripetal');

// Derived from the camera's target rather than authored separately, so he can't drift out of frame.
export function characterPosition(progress, out = new Vector3()) {
  TARGET_CURVE.getPointAt(Math.min(1, Math.max(0, progress)), out);
  out.z -= 16;
  out.x *= 0.35;
  return out;
}
