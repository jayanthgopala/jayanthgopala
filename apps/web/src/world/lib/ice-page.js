// Ice page background color and gradient parameters used by the cut shader.
export const ICE_PAGE = {
  base: [0xcb, 0xd7, 0xe4],
  dot: { color: [118, 142, 170], alpha: 0.42, radius: 1.25, spacing: 36 }, // dots on every multiple of 36px from top left
  glow: { centre: [255, 255, 255, 0.45], edge: [200, 214, 230, 0.2] }, // farthest-corner radial bloom over the dots
  wash: { top: [230, 238, 246, 0.3], bottom: [195, 210, 226, 0.4], clearAt: 0.4 }, // vertical wash, clear at 40%
};
