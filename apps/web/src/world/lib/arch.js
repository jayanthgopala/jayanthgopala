// The doorway as geometry rather than a hole punched through a wall.
// Removing whole blocks leaves a staircase notch, so blocks straddling the opening get their own trimmed geometry.
// The arch is a semicircle, so the intrados radius is half the clear span and the rise equals the half-span.
// Each of n voussoirs spans PI/n, and its outer face is always the longer chord, which is why an arch stands up.
// The hole cut in the dome follows the extrados, so the ring drops exactly into the space left for it.

// Half-width of the opening at a given height. Below the springing line the jambs are vertical, above it it's the arch.
// Returns 0 once clear of the crown, which tells a course it's above the doorway entirely.
export function openingHalfWidth(y, { springY, extrados }) {
  if (y <= springY) return extrados;
  const rise = y - springY;
  if (rise >= extrados) return 0;
  return Math.sqrt(extrados * extrados - rise * rise);
}

// The same thing as an angle on the dome, which is what the block layout needs.
// Clamped because near the crown the arch can be wider than the circle it's cut into.
export function openingHalfAngle(y, ringRadius, arch) {
  const w = openingHalfWidth(y, arch);
  if (w <= 0 || ringRadius <= 0) return 0;
  return Math.asin(Math.min(1, w / ringRadius));
}

// What's left of a block's span once the opening is removed from it.
// None if it's swallowed, one piece if clipped on a side, two if it was wide enough to bridge the whole doorway.
export function clipSpan(t0, t1, centre, halfAngle) {
  if (halfAngle <= 0) return [[t0, t1]];

  const o0 = centre - halfAngle;
  const o1 = centre + halfAngle;

  if (t1 <= o0 || t0 >= o1) return [[t0, t1]];
  if (t0 >= o0 && t1 <= o1) return [];

  const pieces = [];
  if (t0 < o0) pieces.push([t0, o0]);
  if (t1 > o1) pieces.push([o1, t1]);
  return pieces;
}
