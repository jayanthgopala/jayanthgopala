// Ice page background colour and gradient parameters.
//
// Shared by the cut shader and the water canvas's own backdrop, which is what
// keeps the two in register across the fade — change these and both move
// together.
//
// Pale blue-grey rather than white: clear water has no colour of its own, so
// everything that makes the letter legible is refraction and specular, and both
// need a ground with some tone in it to bend and reflect. A white page leaves
// the letter invisible.
export const ICE_PAGE = {
  base: [0xcb, 0xd7, 0xe4],
  dot: { color: [118, 142, 170], alpha: 0.42, radius: 1.25, spacing: 36 }, // dots on every multiple of 36px from top left
  // Icy white rather than pure white, and pulled back from 0.45, so the centre
  // stays a glow instead of a blown-out hole the letter disappears into.
  glow: { centre: [238, 245, 252, 0.34], edge: [200, 214, 230, 0.2] }, // farthest-corner radial bloom over the dots
  wash: { top: [230, 238, 246, 0.3], bottom: [195, 210, 226, 0.4], clearAt: 0.4 }, // vertical wash, clear at 40%
};
