// Texture map configurations for procedural ice and rock surfaces
export const ICE_SETS = {
  snow: { size: 512, frequency: 2.4, bump: 1.5, variant: 'ice', pebbles: 0 }, // Clean snow
  crag: { size: 512, frequency: 3.4, bump: 3.0, variant: 'rock' }, // Exposed rock
  scree: { size: 512, frequency: 5.6, bump: 3.6, variant: 'rock' }, // Scree apron
  igloo: { size: 512, frequency: 3.4, bump: 2.2, variant: 'ice', pebbles: 0 }, // Igloo blocks
};

// Texture channels and storage configurations
export const ICE_MAPS = [
  { key: 'rough', channels: 3 }, // R: patch, G: roughness, B: cracks
  { key: 'color', channels: 3 },
  { key: 'normal', channels: 3 },
  { key: 'ao', channels: 1 },
];
