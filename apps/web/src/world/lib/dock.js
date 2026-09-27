import { CatmullRomCurve3, Vector3 } from 'three';

// Where the dock stands and the runabout lies, and the course it runs when
// the reader scrolls. Shared by the props built there (structures/Shore.jsx,
// structures/Runabout.jsx), the ice that has to stay open around them
// (environment/Water.jsx), the floes kept clear of it (Floes.jsx), the camera
// that watches it (CameraRig.jsx) and the scroll that waits for it
// (ScrollProvider.jsx).

// Dock posts, from the shore by the igloo's door out along the water: [x, z].
export const DOCK = [
  [14, 284],
  [25, 287],
  [36, 289],
  [47, 290],
];

// The runabout, moored off the dock's outer side with its bow along +x.
export const BOAT_AT = [30, 301];
export const BOAT_YAW = 0.02;

// The boat is modelled at BOAT_BASE (length, beam) and shown BOAT_SCALE
// times larger; BOAT_LENGTH and BOAT_BEAM are its size as it stands in the
// world (length along the boat's x, beam across its z).
export const BOAT_BASE = [26, 7.4];
export const BOAT_SCALE = 1.35;
export const BOAT_LENGTH = BOAT_BASE[0] * BOAT_SCALE;
export const BOAT_BEAM = BOAT_BASE[1] * BOAT_SCALE;

/**
 * Half the beam at the sheer, at u along the hull from the transom (-1) to
 * the bow (+1): full and nearly straight aft, a fine entry forward.
 */
export function hullHalfWidth(u) {
  const half = BOAT_BEAM / 2;
  if (u <= -0.2) {
    const k = (-0.2 - u) / 0.8;
    return half * (1 - 0.14 * k * k);
  }
  const k = (u + 0.2) / 1.2;
  return half * Math.sqrt(Math.max(0, 1 - k * k));
}

// Where the boat is this frame. Runabout.jsx writes it; the water reads it for
// the wake, the camera to hold it in frame, and the sound for panning (`pan`,
// -1..1 across the screen). `speed` is 0 at rest to 1 flat out.
export const boatPose = {
  x: BOAT_AT[0],
  z: BOAT_AT[1],
  yaw: BOAT_YAW,
  speed: 0,
  pan: 0,
};

// Open water the boat floats in, each a line of [x, z, half-width]: the lead
// along the dock. In front of the island the fjord is open all the way to the
// camera (frontEdgeZ), with the ice sheet beyond it.
export const LEAD = [
  [4, 292, 3],
  [16, 298, 9],
  [30, 304, 14],
  [45, 303, 12],
  [58, 297.5, 6.5],
  [74, 293, 3],
];

/**
 * Where the sheet ice ends and the open water in front begins, along x: a
 * ragged edge a little in front of the island. Mirrored in the water shader.
 */
export function frontEdgeZ(x) {
  return 296 + 8 * Math.sin(x * 0.045) + 5 * Math.sin(x * 0.11 + 1.3);
}

/** Distance from a point to the edge of the open water (negative inside). */
export function openWaterDistance(x, z) {
  let d = frontEdgeZ(x) - z;
  for (const line of [LEAD]) {
    for (let i = 0; i < line.length - 1; i += 1) {
      const [ax, az, ar] = line[i];
      const [bx, bz, br] = line[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const h = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      d = Math.min(d, Math.hypot(x - ax - dx * h, z - az - dz * h) - (ar + (br - ar) * h));
    }
  }
  return d;
}

/**
 * The course: off the dock, round to face the camera's opening view, and on
 * across the open water in front, with the camera travelling ahead of it. Points on the
 * water (x, 0, z); the heading comes from the curve.
 */
export const RUN_CURVE = new CatmullRomCurve3(
  [
    [BOAT_AT[0], BOAT_AT[1]],
    [42, 307],
    [44, 320],
    [36, 338],
    [27, 358],
    [20, 378],
    [13, 402],
    [6, 428],
    [0, 456],
  ].map(([x, z]) => new Vector3(x, 0, z)),
  false,
  'centripetal'
);
export const RUN_LENGTH = RUN_CURVE.getLength();

// Where in the opening scroll (in the camera's journey: 0 at the top,
// JOURNEY.atCut = 0.17 where the cut begins, 0.4 once the page has arrived)
// the boat runs its course: it casts off with the first scroll, has nearly
// finished by the time that scroll's glide rests, and eases the last of the
// way as the next scroll brings the cut across.
export const RUN_SPAN = [0.004, 0.21];
