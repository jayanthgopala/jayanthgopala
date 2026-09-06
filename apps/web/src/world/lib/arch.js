/**
 * The doorway, as geometry rather than as a hole punched through a wall.
 *
 * THE PROBLEM THIS SOLVES. Removing whole blocks to make an opening leaves a
 * staircase-shaped notch: the doorway's edge can only ever follow block
 * boundaries, so a semicircular arch comes out as a rectangular bite with the
 * arch ring floating loose inside it. What is needed is for the blocks bordering
 * the opening to be CUT along the arch itself, which means the ones that
 * straddle the boundary need their own trimmed geometry rather than the shared
 * one their course uses.
 *
 * THE ARCH IS A SEMICIRCLE, and everything else follows from that by
 * construction:
 *
 *   clear span  S   the width you can actually crawl through
 *   intrados    Ri = S / 2          inner radius; for a semicircle the rise
 *                                   equals the half-span, so the arch is exactly
 *                                   as tall as it is half-wide
 *   extrados    Ro = Ri + d         outer radius, d being the voussoir depth
 *   voussoir    dA = PI / n         each of n wedges spans this angle
 *   inner face  2 * Ri * sin(dA/2)  chord at the intrados
 *   outer face  2 * Ro * sin(dA/2)  chord at the extrados — always the longer,
 *                                   which is what makes a voussoir a wedge and
 *                                   is why an arch stands up at all
 *
 * The hole cut in the dome follows the EXTRADOS, so the arch ring drops exactly
 * into the space left for it.
 */

/**
 * Half-width of the opening at a given height, measured across the wall.
 *
 * Below the springing line the jambs are vertical, so the opening is at its full
 * width; above it the profile is the arch itself. Returns 0 once clear of the
 * crown, which is what tells a course it is above the doorway entirely.
 */
export function openingHalfWidth(y, { springY, extrados }) {
  if (y <= springY) return extrados;
  const rise = y - springY;
  if (rise >= extrados) return 0;
  return Math.sqrt(extrados * extrados - rise * rise);
}

/**
 * The same thing expressed as an angle on the dome, which is the form the block
 * layout actually needs.
 *
 * A course at latitude phi lies on a horizontal circle of radius
 * `radius * cos(phi)`, so a half-width of w subtends `asin(w / that)`. Clamped,
 * because near the crown the arch can be wider than the circle it is cut into —
 * in which case the whole course is inside the opening.
 */
export function openingHalfAngle(y, ringRadius, arch) {
  const w = openingHalfWidth(y, arch);
  if (w <= 0 || ringRadius <= 0) return 0;
  return Math.asin(Math.min(1, w / ringRadius));
}

/**
 * How a block's angular span survives the opening.
 *
 * Returns the pieces of [t0, t1] left once the opening's span is removed from
 * it — none if the block is swallowed whole, one if it is clipped on a side,
 * and two in the case where a single block is wide enough to bridge the entire
 * doorway and is left with a piece standing either side of it.
 */
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
