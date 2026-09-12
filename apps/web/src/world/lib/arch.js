// Entrance doorway and arch geometry calculations

// Half-width of opening at given height
export function openingHalfWidth(y, { springY, extrados }) {
  if (y <= springY) return extrados;
  const rise = y - springY;
  if (rise >= extrados) return 0;
  return Math.sqrt(extrados * extrados - rise * rise);
}

// Opening half-angle along dome ring
export function openingHalfAngle(y, ringRadius, arch) {
  const w = openingHalfWidth(y, arch);
  if (w <= 0 || ringRadius <= 0) return 0;
  return Math.asin(Math.min(1, w / ringRadius));
}

// Subdivide or clip a block span intersecting the doorway opening
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
