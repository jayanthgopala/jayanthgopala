import { CanvasTexture, LinearFilter, RepeatWrapping } from 'three';

/**
 * A tiling noise texture, generated once.
 *
 * WHY A TEXTURE AND NOT A GLSL NOISE FUNCTION. This is the one point the smoke
 * lesson makes most insistently and it is a performance argument rather than an
 * aesthetic one: a perlin function evaluated per fragment is a pile of
 * arithmetic run at every pixel of every frame, and the smoke shader below
 * samples it FIVE times per vertex or fragment — twice for the twist and wind,
 * once for the body. A texture fetch is one of the cheapest things a GPU does
 * and the sampler gives bilinear interpolation for free. It is what games do.
 *
 * The rest of this scene already agrees. Sky.jsx, ice-texture.js and the baked
 * map set are all the same trade taken at startup: compute the expensive thing
 * once into a buffer, then look it up.
 *
 * WHY IT IS GENERATED RATHER THAN DOWNLOADED. The lesson fetches a perlin PNG.
 * This project has a standing rule against that — see the note at the top of
 * Atmosphere.jsx about the environment map, which makes the same choice for the
 * same three reasons: no asset to ship, no request on load, no dependency on a
 * third-party host. 128x128 of value noise is a few milliseconds of work.
 *
 * SEAMLESS IS NOT OPTIONAL HERE, AND IT IS WHY THIS ISN'T THE USUAL HASH NOISE.
 * The smoke shader wraps this texture in both axes and scrolls it continuously —
 * `smokeUv.y -= uTime * 0.05` runs forever, so the sample point crosses the tile
 * boundary every few seconds. A texture with a discontinuity at its edge would
 * show a hard line sweeping up through the plume on a fixed cycle, which is
 * exactly the artefact that makes a scrolling effect look like a scrolling
 * texture.
 *
 * The fix is to make the noise PERIODIC by construction rather than to tile a
 * non-periodic field and blend the seam. Each octave's integer lattice is taken
 * modulo its own period, so the cell at the right edge is literally the same
 * cell as the one at the left edge. Every period divides the image width, so all
 * four octaves wrap together and the result is exactly seamless — not nearly.
 */

/** Octave periods, in lattice cells across the tile. All powers of two so they
    divide the image size and therefore wrap together. */
const PERIODS = [4, 8, 16, 32];
/** Summing to exactly 1, so the field genuinely spans 0..1 and the smoke
    shader's smoothstep( 0.4, 1.0, … ) means what it says. An unnormalised fbm
    sits around 0.44 and puts that whole ramp in the top fifth of the range —
    the same correction the ground fog's fbm in Terrain.jsx documents. */
const WEIGHTS = [0.5, 0.25, 0.15, 0.1];

export function makePerlinTexture(size = 128, seed = 1337) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);

  /* Lattice hash, wrapped to the octave's period — this is the whole of the
     seamlessness. */
  const hash = (xi, yi, period) => {
    const x = ((xi % period) + period) % period;
    const y = ((yi % period) + period) % period;
    const n = Math.sin((x + 1) * 127.1 + (y + 1) * 311.7 + seed) * 43758.5453;
    return n - Math.floor(n);
  };

  const noise = (u, v, period) => {
    const x = u * period;
    const y = v * period;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    /* Smoothstep the interpolant, so the lattice does not show as diamonds. */
    const sx = xf * xf * (3 - 2 * xf);
    const sy = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, period);
    const b = hash(xi + 1, yi, period);
    const c = hash(xi, yi + 1, period);
    const d = hash(xi + 1, yi + 1, period);
    const top = a + (b - a) * sx;
    const bot = c + (d - c) * sx;
    return top + (bot - top) * sy;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      /* Divided by `size`, NOT by `size - 1`. The last column has to be the
         cell BEFORE the wrap, not the wrap itself, or the tile repeats one
         column of pixels and the seam is back. */
      const u = x / size;
      const v = y / size;
      let n = 0;
      for (let i = 0; i < PERIODS.length; i += 1) n += WEIGHTS[i] * noise(u, v, PERIODS[i]);
      const c = Math.round(Math.max(0, Math.min(1, n)) * 255);
      const o = (y * size + x) * 4;
      img.data[o] = c;
      img.data[o + 1] = c;
      img.data[o + 2] = c;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const texture = new CanvasTexture(canvas);
  /* Both axes: the shader wraps in x for the twist lookups and in y for the
     endless upward scroll. */
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  /*
   * NO MIPMAPS, AND NO COLOUR SPACE CONVERSION.
   *
   * Mipmaps would average the field down at distance, and this texture is read
   * as DATA — a displacement and a density — not drawn as an image. An averaged
   * noise field tends to its mean, so the smoke would quietly lose all its
   * structure as the plume got smaller in frame.
   *
   * Colour space is left at the three default for a data texture. Running a
   * noise field through an sRGB decode would bend its distribution and move
   * every threshold written against it.
   */
  texture.generateMipmaps = false;
  return texture;
}
