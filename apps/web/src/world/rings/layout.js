// Where everything in the ring descent sits, in world units.
//
// The rings are stacked down the Y axis and the camera falls through their
// centres, so every piece shares the axis x = z = 0.

/** How many rings the camera falls through, and how far apart they sit. */
export const RING_COUNT = 5;
export const RING_GAP = 1.5;

/** Heights of the rings, top to bottom, close enough to read as one stack. */
export const RING_Y = Array.from({ length: RING_COUNT }, (_, i) => -1.65 - i * RING_GAP);

/** Bottom of the shaft the haze and drifting specks fill, just past the last ring. */
export const SHAFT_BOTTOM = RING_Y[RING_COUNT - 1] - 1.85;

/**
 * How far the whole room is moved from where it is modelled, so it always sits
 * the same short drop below the last ring. The model was placed for three
 * rings, which is where the lift is 3; every extra ring lowers it one gap.
 */
// Three further down again than that, so there is height enough above the
// pedestal to look straight down on the whole room before levelling off.
export const ROOM_LIFT = 3 - (RING_COUNT - 3) * RING_GAP - 3;

/**
 * The camera's dive down the shaft: the height it starts from, the height it
 * ends at just above the room, and the window of fall progress it happens in.
 * Shared with the scroll, which needs to know where the camera clears the last
 * ring in order to carry it on into the room.
 */
export const FALL_TOP = 1.0;
/** Fall progress at which the descent along the curve begins. */
export const DIVE_START = 0.2;
/**
 * Where the descent ends: low over the frozen lake, a little back from the
 * mark and looking very slightly up at it, so the horizon sits below centre
 * and the mountains rise either side.
 */
export const ROOM_VIEW = { y: -9.62 + ROOM_LIFT, z: 6.0 };

/** The room's outer floor and the pedestal, in the room's own (unlifted) frame. */
export const FLOOR_Y = -10.45;
export const PEDESTAL_TOP = -10.29;

/**
 * The glass chamber, seated on a machined plinth with a collar over its mouth.
 *
 * Proportion is the whole look: the tube is close to twice as tall as it is
 * wide, which is what makes it read as a specimen chamber rather than a jar.
 * Measured at the room view on a short window, the frame runs from about 0.6
 * below the pedestal to 2.55 above it, and this fills it with the plinth clear
 * at the bottom and the collar just grazing the top.
 */
export const CASE_RADIUS = 0.72;
export const CASE_HEIGHT = 2.0;

/** Centre of the particle mark, in the room's own (unlifted) frame. */
const LOGO_BASE = PEDESTAL_TOP + 1.02;

/** Centre of the particle mark, in world space: a little above the tube's middle. */
export const LOGO_Y = LOGO_BASE + ROOM_LIFT;

/**
 * The tube's ends in the mark's own frame — the frame the particles, the glass
 * and the rig are all built in, centred on the mark rather than on the room.
 */
export const TUBE_BOTTOM = PEDESTAL_TOP - LOGO_BASE;
export const TUBE_TOP = TUBE_BOTTOM + CASE_HEIGHT;

/**
 * The base the chamber stands on: a shallow dark plate, and how far the lit
 * rings around it reach. The chamber is seated almost on the floor — what
 * raises it off the ground visually is the light spilling out from under it,
 * not any height in the base itself.
 */
export const PLINTH_HEIGHT = 0.07;
export const PLINTH_RADIUS = CASE_RADIUS * 1.78;

/** The floor, in world space: the plinth's full height below the tube's foot. */
export const LAKE_Y = PEDESTAL_TOP + ROOM_LIFT - PLINTH_HEIGHT;

/** The glowing halo that hangs over the room, in the room's own frame. */
export const HALO_Y = -8.3;

/** Fog and backdrop colour: the ice page's own base, so the cut lands in register. */
export const FOG = '#cbd7e4';
