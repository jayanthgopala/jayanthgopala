// The ice page's ground as numbers, because the cut has to draw the page it lands on inside the shader.
// If the DOM painted the same ground too there'd be two renderings of one surface and the handover would flicker.
// Composited in the shader in the order and space a browser uses, so this is the colour the old CSS produced.
export const ICE_PAGE = {
  base: [0xcb, 0xd7, 0xe4],
  dot: { color: [118, 142, 170], alpha: 0.42, radius: 1.25, spacing: 36 }, // dots on every multiple of 36px from top left
  glow: { centre: [255, 255, 255, 0.45], edge: [200, 214, 230, 0.2] }, // farthest-corner radial bloom over the dots
  wash: { top: [230, 238, 246, 0.3], bottom: [195, 210, 226, 0.4], clearAt: 0.4 }, // vertical wash, clear at 40%
};
