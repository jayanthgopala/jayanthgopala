/**
 * The shot list, following the eight-scene storyboard.
 *
 *   1  The beginning       a lone walk through an enormous empty space
 *   2  The world appears   the first slabs resolve out of the dark
 *   3  Projects orbit      a larger space, exhibits either side of the path
 *   4  Projects become     the walk STOPS at each one in turn
 *      stories
 *   5  The world gets      the hall opens out
 *      bigger
 *   6  The structure       something enormous in the distance
 *   7  About               the camera goes inside; a calmer room
 *   8  Contact             the edge of the world, and a horizon
 *
 * THE FIGURE WALKS AND THE CAMERA FOLLOWS. Nothing here is an absolute world
 * position: every keyframe is an OFFSET from wherever the figure currently is,
 * so the subject is in frame by construction rather than by luck, and the whole
 * thing reads as one continuous travelling shot. The alternative — a static
 * subject with the camera orbiting it — always reads as a turntable, because
 * the world never goes anywhere.
 *
 * Scenes 3 and 4 share one act element, because the per-project beats are
 * sub-scenes inside it. The engine subdivides that act by project count, which
 * is what lets the walk pause at each slab without anything in this table
 * needing to know how many projects exist.
 *
 * Axes: the figure walks toward -Z. Y is metres off the floor. Offsets are in
 * the figure's own frame, so +Z is behind it and -Z is ahead.
 */

export const INK = 'ink';
export const PAPER = 'paper';

/**
 * Duotone endpoints as 0..1 RGB triples.
 *
 * THE FIGURE IS BLACK INK IN EVERY SCENE, and the cut between tones is a change
 * of paper rather than a photographic negative.
 *
 * That is not where this started. The first version flipped luminance on the
 * dark scenes, on the theory that a negative makes the most dramatic possible
 * cut. It does, and it also flips the subject: the figure went luminous white,
 * and because distance fog pulls far geometry toward the fog colour, inverting
 * it turned the background bright as well — so the "dark" scenes came out as a
 * white figure on a pale field, which is the one thing this composition cannot
 * survive.
 *
 * Holding the ink point constant and moving only the paper point keeps the
 * subject reading as ink on paper from the first frame to the last, and still
 * lands a real cut: a close grey world opening out into a bright one.
 * Separation comes from albedo — the figure reflects about four percent, the
 * set about thirty-seven — so it holds under any lighting the scenes ask for.
 */
export const PALETTE = {
  // Both tones share the same ink point and the same red. Only the paper point
  // moves, so the figure stays black from the first frame to the last and the
  // cut reads as a change of stock rather than as a different world.
  ink: {
    dark: [0.055, 0.055, 0.058],
    light: [0.70, 0.695, 0.685],
    signal: 0x2f7dff,
  },
  paper: {
    dark: [0.067, 0.067, 0.067],
    light: [0.945, 0.941, 0.933],
    signal: 0x2f7dff,
  },
};

/**
 * `halftone` is OFF everywhere. It ran at 0.9 on the paper scenes,
 * on the theory that heavy screening would read as engraving. It did not — at
 * that strength a regular dot grid reads as a dirty screen, because the
 * reference's texture is hand-drawn hatching that follows form, and a uniform
 * mechanical dot has none of that. Dropped to the level where it only adds
 * tooth to flat areas.
 *
 * `veil` is a scrim over the canvas, and it is deliberately almost nothing.
 *
 * The first cut ran it at 0.6–0.78 so body copy stayed readable, which worked
 * and buried the figure behind a sheet of flat colour for most of the sequence.
 * The fix was not a lighter veil but to stop asking it to do typography's job:
 * text sits on opaque plaques that carry their own contrast, so the world stays
 * visible underneath at full strength.
 */
export const ACTS = [
  {
    // 1 — THE BEGINNING. Far enough back that the light at the end of the hall
    // reads BEHIND the figure rather than being eclipsed by it. That
    // relationship is the shot, and it has a narrow working range: closer than
    // about six metres and the figure covers the light, further than ten and it
    // stops being a portrait.
    id: 'cx-title',
    copyKey: 'cine.actTitle',
    copyFallback: 'The beginning',
    tone: INK,
    from: { offset: [0, 1.55, 8.2], aim: [0, 1.5, -6], fov: 38 },
    to: { offset: [0, 1.5, 6.4], aim: [0, 1.5, -9], fov: 35 },
    veil: 0,
    halftone: 0,
    // Thin air, so what they are walking toward is legible.
    fog: 0.013,
  },
  {
    // 2 — THE WORLD APPEARS. Three-quarter, as the first slabs resolve.
    id: 'cx-dossier',
    copyKey: 'cine.actDossier',
    copyFallback: 'The world appears',
    tone: INK,
    from: { offset: [2.8, 1.7, 6.4], aim: [0, 1.45, -7], fov: 42 },
    to: { offset: [4.2, 2.1, 5.6], aim: [0, 1.5, -10], fov: 46 },
    veil: 0.12,
    halftone: 0,
    fog: 0.018,
  },
  {
    // 3 & 4 — PROJECTS ORBIT, THEN BECOME STORIES. The cut to paper. The engine
    // subdivides this act by project count and holds the walk at each slab.
    id: 'projects',
    copyKey: 'cine.actWork',
    copyFallback: 'The work',
    tone: PAPER,
    focus: true,
    from: { offset: [-4.2, 2.3, 6.2], aim: [0, 1.5, -8], fov: 47 },
    to: { offset: [-3.2, 2.0, 5.4], aim: [0, 1.5, -9], fov: 44 },
    veil: 0.16,
    halftone: 0,
    fog: 0.018,
  },
  {
    // 5 — THE WORLD GETS BIGGER. High and wide, down the length of the hall.
    id: 'stack',
    copyKey: 'cine.actSystem',
    copyFallback: 'The tools',
    tone: PAPER,
    from: { offset: [0, 2.6, 7.0], aim: [0, 1.6, -15], fov: 52 },
    to: { offset: [0, 2.2, 5.8], aim: [0, 1.6, -20], fov: 55 },
    veil: 0.2,
    halftone: 0,
    fog: 0.02,
  },
  {
    // 6 & 7 — THE STRUCTURE, THEN INSIDE IT. Back to ink; the camera swings
    // around them as the monolith fills the far end, then settles.
    id: 'experience',
    copyKey: 'cine.actRecord',
    copyFallback: 'The structure',
    tone: INK,
    from: { offset: [7.0, 1.8, 2.4], aim: [0, 1.5, -6], fov: 45 },
    to: { offset: [1.6, 1.7, 5.6], aim: [0, 1.6, -14], fov: 42 },
    veil: 0.18,
    halftone: 0,
    fog: 0.02,
  },
  {
    // 8 — THE EDGE. The camera stops following; the figure walks on into the
    // light. The offset grows on purpose — this is the one scene where the
    // follow deliberately fails, and that is the shot.
    id: 'contact',
    copyKey: 'cine.actSignal',
    copyFallback: 'The edge',
    tone: INK,
    from: { offset: [0, 1.7, 8], aim: [0, 1.5, -10], fov: 44 },
    to: { offset: [0, 2.0, 19], aim: [0, 1.5, -16], fov: 50 },
    veil: 0.1,
    halftone: 0,
    fog: 0.03,
  },
];

/** Stable, module-level, and never rebuilt — see useActTracker on why. */
export const ACT_IDS = ACTS.map((act) => act.id);

/** The act the project slabs belong to. The engine subdivides it. */
export const FOCUS_ACT = ACTS.findIndex((act) => act.focus);

/** Metres walked before the projects act, and after it. */
export const LEAD_IN = 17;
export const RUN_OUT = 40;
