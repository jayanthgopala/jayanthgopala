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
export const ROOM_LIFT = 3 - (RING_COUNT - 3) * RING_GAP;

/**
 * The camera's dive down the shaft: the height it starts from, the height it
 * ends at just above the room, and the window of fall progress it happens in.
 * Shared with the scroll, which needs to know where the camera clears the last
 * ring in order to carry it on into the room.
 */
export const FALL_TOP = 1.0;
/** Fall progress at which the descent along the curve begins. */
export const DIVE_START = 0.2;
/** Where the descent ends: the room view the contact marks are seen from. */
export const ROOM_VIEW = { y: -9.2 + ROOM_LIFT, z: 3.8 };

/** The room's outer floor and the pedestal, in the room's own (unlifted) frame. */
export const FLOOR_Y = -10.45;
export const PEDESTAL_TOP = -10.29;

/** Centre of the particle mark, in world space. Its lower edge just clears the pedestal. */
export const LOGO_Y = -9.42 + ROOM_LIFT;

/** The glowing halo that hangs over the room, in the room's own frame. */
export const HALO_Y = -8.3;

/** Fog and backdrop colour: the ice page's own base, so the cut lands in register. */
export const FOG = '#cbd7e4';
