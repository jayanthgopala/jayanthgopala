/**
 * THE ICE PAGE'S GROUND, AS NUMBERS.
 *
 * The dotted pale-ice field the projects page stands on — the same #cbd7e4
 * ground, 36px dot grid, centre bloom and cool wash that world.css used to carry
 * as `.w-retreat-dots`, and the loader curtain still paints.
 *
 * WHY IT IS NOT CSS ANY MORE. The cut draws the page it lands on inside the
 * shader, because a wipe can only reveal something it can sample. If the DOM
 * painted the same ground as well, there would be two renderings of one surface
 * with different anti-aliasing, and the handover from one to the other would
 * show as a flicker. So there is exactly one: IceCut paints it, and the DOM page
 * above is text on a transparent layer.
 *
 * The values are composited in the shader in the SAME ORDER and the SAME SPACE a
 * browser uses — sRGB, premultiplied gradient stops, background layers listed
 * top-first — so this is the colour the CSS rule produced, not an approximation
 * of it.
 */
export const ICE_PAGE = {
  base: [0xcb, 0xd7, 0xe4],

  /*
   * 1.25px dots with a centre on every multiple of 36px from the top-left.
   * (The CSS offset the tile by 18px and centred the dot inside it, which lands
   * on exactly this grid.) Bottom layer, under the bloom.
   */
  dot: { color: [118, 142, 170], alpha: 0.42, radius: 1.25, spacing: 36 },

  /* Farthest-corner radial bloom, painted over the dots. */
  glow: { centre: [255, 255, 255, 0.45], edge: [200, 214, 230, 0.2] },

  /* A vertical wash over everything: tinted at both ends, clear at 40%. */
  wash: { top: [230, 238, 246, 0.3], bottom: [195, 210, 226, 0.4], clearAt: 0.4 },
};
