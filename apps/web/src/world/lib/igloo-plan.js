/*
 * TRACED OFF igloo.inc, BY SCANNING ITS SILHOUETTE ROW BY ROW.
 */
export const PROFILE = [
  [1.0, 0.0], //  ground
  [1.0, 0.1], //  the wall is vertical
  [1.0, 0.2], //
  [1.0, 0.3], //
  [1.0, 0.4], //
  [1.0, 0.5], //
  [1.0, 0.6], //  and stays vertical to about 0.65
  [0.966, 0.7], //  the cap begins
  [0.849, 0.8], //
  [0.66, 0.9], //
  [0.0, 1.0], //  pole
];

export const COURSE_BLOCKS = [13, 13, 13, 13, 13, 12];
export const CROWN_BLOCKS = 8;

export function makeProfile(radius, height, points = PROFILE) {
  const n = points.length;

  const at = (i) => points[Math.max(0, Math.min(n - 1, i))];

  const spline = (a, b, c, d, t) => {
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      0.5 *
      (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
    );
  };

  return (u) => {
    const uu = u < 0 ? 0 : u > 1 ? 1 : u;
    const f = uu * (n - 1);
    const i = Math.min(n - 2, Math.floor(f));
    const t = f - i;

    const rr = spline(at(i - 1)[0], at(i)[0], at(i + 1)[0], at(i + 2)[0], t);
    const yy = spline(at(i - 1)[1], at(i)[1], at(i + 1)[1], at(i + 2)[1], t);

    return { r: Math.max(0, rr) * radius, y: yy * height };
  };
}

/**
 * The entrance archway, dimensioned to match the reference image proportions.
 */
export function entrancePlan(radius) {
  const clearSpan = radius * 0.44;
  const intrados = clearSpan / 2;
  const archThickness = radius * 0.14;
  const extrados = intrados + archThickness;

  const jambBlocks = 2;
  const jambHeight = radius * 0.32;

  const depth = radius * 0.60;
  const z = radius * 0.94;

  return {
    clearSpan,
    intrados,
    extrados,
    archThickness,
    jambBlocks,
    jambHeight,
    depth,
    z,
    voussoirs: 7,
    arch: { springY: jambHeight, extrados },
  };
}