/**
 * THE FOUR SURFACES, DECLARED ONCE.
 *
 * These parameters used to live inline at their four call sites — the ground
 * and the crag in Terrain, the apron in Scree, the dome in Igloo. That was fine
 * while the maps were generated on the spot, because the call site WAS the
 * definition and there was nothing to keep in step with it.
 *
 * Baking breaks that. A build script has to generate exactly what the runtime
 * asks for, and the moment the two hold their own copies of "frequency 2.4,
 * bump 2.4, ice, pebbles 0.2" they can disagree — and the failure is silent and
 * awful, because the site loads a texture that is valid, plausible, and not the
 * one the code was tuned against. Nothing throws; the ground just quietly stops
 * looking right and there is no clue where to start.
 *
 * So the parameters move here and both sides import them. The bake iterates
 * this object; the runtime looks up by the same key. Neither can drift, because
 * there is only the one copy.
 *
 * `repeat` IS DELIBERATELY NOT HERE. It sets three's UV transform on the
 * finished texture and has no effect on a single generated pixel, so it is not
 * a property of the bake — and it cannot be, because the ground's is derived
 * from the terrain's world size at runtime. It stays an argument at the call
 * site.
 *
 * The rationale for each individual number stays at its call site, where it was
 * argued and where it belongs.
 */
export const ICE_SETS = {
  /* Terrain.jsx — the snowfield. Clean, smooth snow without pebbles or rock dots. */
  snow: { size: 512, frequency: 2.4, bump: 1.5, variant: 'ice', pebbles: 0 },
  /* Terrain.jsx — the stone breaking through it. */
  crag: { size: 512, frequency: 3.4, bump: 3.0, variant: 'rock' },
  /* Scree.jsx — the loose apron banked against the dome. */
  scree: { size: 512, frequency: 5.6, bump: 3.6, variant: 'rock' },
  /* Igloo.jsx — the blocks themselves. */
  igloo: { size: 512, frequency: 3.4, bump: 2.2, variant: 'ice', pebbles: 0 },
};

/** The four maps every set produces, and how each must be stored. */
export const ICE_MAPS = [
  /*
   * THREE FIELDS IN ONE TEXTURE, so this is RGB and must stay lossless: patch
   * rides in red, roughness in green, the crack network in blue. A lossy codec
   * would subsample the chroma planes and take two of the three with it.
   */
  { key: 'rough', channels: 3 },
  { key: 'color', channels: 3 },
  /* A vector, not a colour. Lossy compression bends normals visibly. */
  { key: 'normal', channels: 3 },
  /* Greyscale — the other two channels were duplicates of the first. */
  { key: 'ao', channels: 1 },
];
