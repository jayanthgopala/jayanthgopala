// The ten objects a project can appear as.
//
// Ids are stored in the database, so they are the stable part: renaming a label
// is cosmetic, but changing an id repoints every project that used it. Add to
// the end rather than reordering.
//
// Geometry lives in the web app, since only it needs three.js. Everything here
// is deliberately dependency-free so the admin can import it too.

export const SHAPES = [
  { id: 'flower', label: 'Water Flower' },
  { id: 'ring', label: 'Ring' },
  { id: 'icosahedron', label: 'Icosahedron' },
  { id: 'cube', label: 'Cube' },
  { id: 'knot', label: 'Knot' },
  { id: 'crescent', label: 'Crescent' },
  { id: 'peak', label: 'Peak' },
  { id: 'dome', label: 'Dome' },
  { id: 'shard', label: 'Shard' },
  { id: 'dna', label: 'Liquid DNA' },
];

export const SHAPE_IDS = SHAPES.map((shape) => shape.id);

export const labelOf = (id) =>
  SHAPES.find((shape) => shape.id === id)?.label || '';

/** How many projects currently use each shape. */
export function shapeUsage(projects = [], exclude = null) {
  const counts = new Map(SHAPE_IDS.map((id) => [id, 0]));

  for (const project of projects) {
    if (exclude != null && project?.id === exclude) continue;
    const id = project?.shape;
    if (counts.has(id)) counts.set(id, counts.get(id) + 1);
  }

  return counts;
}

/**
 * The shapes a project may take: those used least often so far.
 *
 * This is what gives "no repeats until all ten are spoken for" without storing
 * a cycle anywhere. Counting what is actually in use means a deleted project
 * frees its shape immediately, reordering changes nothing, and an eleventh
 * project simply starts the next round — none of which a counter would survive.
 */
export function availableShapes(projects = [], exclude = null) {
  const counts = shapeUsage(projects, exclude);
  const fewest = Math.min(...counts.values());
  return SHAPE_IDS.filter((id) => counts.get(id) === fewest);
}

/** Least-used shape, for assigning one without asking. */
export function nextShape(projects = [], exclude = null) {
  return availableShapes(projects, exclude)[0] ?? SHAPE_IDS[0];
}

/** How far through the current round of ten the list is. */
export function roundProgress(projects = []) {
  const counts = shapeUsage(projects);
  const fewest = Math.min(...counts.values());
  return {
    used: SHAPE_IDS.filter((id) => counts.get(id) > fewest).length,
    total: SHAPE_IDS.length,
    round: fewest + 1,
  };
}

/** Falls back by position, so a project with no shape set still renders. */
export function shapeFor(project, index = 0) {
  const id = project?.shape;
  return SHAPE_IDS.includes(id) ? id : SHAPE_IDS[index % SHAPE_IDS.length];
}
