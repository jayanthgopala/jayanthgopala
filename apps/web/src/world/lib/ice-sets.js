// The four surfaces declared once, because the bake script and the runtime both read them.
// Two copies of "frequency 2.4, bump 2.4, ice" can disagree, and the failure is silent, the ground just quietly stops looking right.
// repeat isn't here, it's a UV transform on the finished texture and the ground's is derived from world size at runtime.
export const ICE_SETS = {
  snow: { size: 512, frequency: 2.4, bump: 1.5, variant: 'ice', pebbles: 0 }, // Terrain.jsx, clean snow
  crag: { size: 512, frequency: 3.4, bump: 3.0, variant: 'rock' }, // Terrain.jsx, stone breaking through
  scree: { size: 512, frequency: 5.6, bump: 3.6, variant: 'rock' }, // Scree.jsx, the apron against the dome
  igloo: { size: 512, frequency: 3.4, bump: 2.2, variant: 'ice', pebbles: 0 }, // Igloo.jsx, the blocks
};

// The four maps every set produces, and how each has to be stored
export const ICE_MAPS = [
  // Three fields in one texture so this stays lossless, patch in red, roughness in green, cracks in blue.
  // A lossy codec subsamples the chroma planes and takes two of the three with it.
  { key: 'rough', channels: 3 },
  { key: 'color', channels: 3 },
  { key: 'normal', channels: 3 }, // a vector not a colour, lossy compression bends normals visibly
  { key: 'ao', channels: 1 }, // greyscale, the other two channels were duplicates
];
