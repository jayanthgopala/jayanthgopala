import { CanvasTexture, RepeatWrapping, SRGBColorSpace, LinearFilter } from 'three';
import { makeNoise2D, makeFbm } from './noise.js';

/**
 * Hard-packed snow, generated at runtime.
 *
 * NO IMAGE FILE, DELIBERATELY. A photographed snow texture would be a megabyte
 * or two, would need a licence, and would visibly tile across a wall this size.
 * Generating it means it costs nothing to ship, can be any resolution, and — the
 * part that actually matters — it is authored to be seamless, so there is no
 * repeat seam to hide.
 *
 * THREE SCALES, WEIGHTED, RATHER THAN ONE FBM. This used to be a single
 * five-octave stack, and that is why the surface read as concrete: an fbm with
 * persistence 0.55 puts a large share of its energy in the top octaves, so the
 * loudest thing on the surface was its finest detail. Packed snow is the
 * opposite — broad soft swells and shallow depressions dominate, and the fine
 * grain is barely there at normal viewing distance.
 *
 * So the layers are mixed explicitly, and the mix is the whole design:
 *
 *   MACRO   58%   large soft patches, wind-scoured hollows, uneven density
 *   MEDIUM  30%   shallow dents and packed-snow irregularity
 *   FINE    12%   just enough grain to stop it reading as plastic
 *
 * Weighting them by hand is what buys control that octave persistence cannot:
 * persistence ties every scale's amplitude to a single ratio, whereas snow
 * genuinely has a lot of macro and very little micro.
 *
 * Two maps come out of the one height field:
 *
 *   ROUGHNESS  a NARROW band near the matte end. Ice here is dry and packed,
 *              not wet — a wide range gives polished patches that read as
 *              melt-water, which is the single fastest way to make snow look
 *              like plastic.
 *
 *   NORMAL     the field's gradient, by Sobel, kept soft. This is what gives
 *              the blocks their wind-scoured surface without a single extra
 *              triangle.
 *
 * THE NORMAL MAP CARRIES NO BLOCK EDGES. Seams, block shape, arches and the
 * dome's curvature are all geometry (see shell.js) and must stay there. Baking
 * edges into the surface map is how procedural masonry starts looking like a
 * photograph of masonry glued onto a dome.
 *
 * SEAMLESS BY CONSTRUCTION, not by mirroring. The noise is sampled on a torus:
 * each pixel's (u, v) is mapped onto two circles, so the field wraps exactly in
 * both directions. Mirroring is the usual shortcut and it produces a visible
 * butterfly pattern that the eye picks out immediately on a large surface.
 */

const noise = makeNoise2D(9182736);

/** Broad forms. Low lacunarity keeps its octaves close together and soft. */
const macroFbm = makeFbm(noise, { octaves: 3, lacunarity: 1.8, persistence: 0.52 });
/** Dents and packed-snow irregularity. */
const mediumFbm = makeFbm(noise, { octaves: 3, lacunarity: 2.0, persistence: 0.48 });
/** Grain. Two octaves only — more is not perceptible and only adds shimmer. */
const fineFbm = makeFbm(noise, { octaves: 2, lacunarity: 2.2, persistence: 0.4 });

/** Wavelength ratios between the three layers. */
const MEDIUM_SCALE = 2.7;
const FINE_SCALE = 4.2;

/*
 * A FOURTH, MUCH FINER SCALE — and it goes into the NORMAL MAP ONLY.
 *
 * The macro pits are hand-chipped ice: smooth sloping depressions. On their own
 * they leave the surface between them glassy, because there is nothing at grain
 * size. Snow is coarse at every scale you can see, so a dense high-frequency
 * layer rides on top of the macro relief. It is deliberately absent from the
 * albedo, where it would read as dirt rather than as texture.
 */
const MICRO_SCALE = 15;
const MICRO_WEIGHT = 0.1;

/** Frost grain: one standard deviation, as a fraction of the 0..1 albedo. */
const GRAIN_AMP = 15 / 255;
/** Per-channel grain weighting — coldest in blue. */
const GRAIN_TINT = [0.92, 0.95, 1.0];
/** The flat frost wash and how much of it. */
const FROST_COLOR = [220 / 255, 225 / 255, 235 / 255];
const FROST_WASH = 0.04;

/** Layer weights. Macro must dominate — see the note above. */
const W_MACRO = 0.63;
const W_MEDIUM = 0.29;
const W_FINE = 0.08;

/**
 * Contrast about the midpoint.
 *
 * Summing three layers averages toward 0.5 and flattens the result, so the
 * combined field is stretched back out. Applied once at the end rather than per
 * layer, so the ratio between the scales is preserved.
 */
const CONTRAST = 1.3;

/**
 * Map a tile coordinate onto a torus so the field wraps.
 *
 * Two circles in four dimensions. `frequency` is in tile-repeats: 2.2 means
 * 2.2 cycles of that layer across the tile. Any frequency wraps exactly,
 * because the mapping is periodic in u and v by construction.
 */
function torusCoordinates(u, v, frequency) {
  const a = u * Math.PI * 2;
  const b = v * Math.PI * 2;
  const r = frequency / (Math.PI * 2);

  return {
    x: Math.cos(a) * r,
    y: Math.sin(a) * r,
    z: Math.cos(b) * r,
    w: Math.sin(b) * r,
  };
}

/**
 * One noise layer, tiled by cross-fade.
 *
 * THIS REPLACES A FAKE TORUS, AND IT IS THE FIX FOR THE DIAGONAL STREAKS.
 *
 * The old version mapped (u, v) onto two circles and then flattened the four
 * resulting coordinates into two noise arguments as `fbm(x + z*3.1, y + w*3.1)`.
 * That wraps, which is what it was for — but summing a u-derived term with a
 * v-derived term COUPLES the two axes, so the field has a built-in preference
 * along the diagonal where those terms move together. Everything sampled
 * through it inherited a diagonal lay: smooth fbm, turbulence, craters and
 * warped rock all came out streaked the same way, which is exactly why chasing
 * it through the texture content never worked. Filtering was ruled out by
 * disabling mipmaps and seeing no change at all.
 *
 * The standard alternative is to sample the noise on a plain grid and make it
 * tile by blending the four copies offset by one period, weighted by position.
 * The seam cancels because opposite edges end up as the same weighted sum. It
 * costs four lookups instead of one and flattens contrast slightly toward the
 * tile centre, which is a far better trade than a directional artefact in every
 * map the generator produces.
 */
function layerAt(fbm, u, v, frequency, offset) {
  const s = frequency;
  const x = u * s + offset;
  const y = v * s + offset;

  const n00 = fbm(x, y);
  const n10 = fbm(x - s, y);
  const n01 = fbm(x, y - s);
  const n11 = fbm(x - s, y - s);

  const blended =
    n00 * (1 - u) * (1 - v) +
    n10 * u * (1 - v) +
    n01 * (1 - u) * v +
    n11 * u * v;

  return (blended + 1) * 0.5;
}


const clamp01 = (x) => Math.min(1, Math.max(0, x));
const sstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Cheap deterministic hash of a grid cell, for stone placement. */
function hash21(x, y) {
  let px = (x * 127.1 + y * 311.7) % 1;
  let py = (x * 269.5 + y * 183.3) % 1;
  if (px < 0) px += 1;
  if (py < 0) py += 1;
  const d = px * px + py * py + 74.7;
  const r = (px + d) * (py + d) * 43758.5453;
  return r - Math.floor(r);
}

/**
 * Rocky ground: domain-warped fbm at three scales, plus shallow crevices.
 *
 * The warp is what breaks the grid's directional lay, but it is kept LIGHT.
 * Displacing sample coordinates by a slowly varying field stretches the
 * pattern wherever the warp gradient is steep, and a surface full of stretched
 * noise is marbled — long swirled smears that read as filtering error.
 */
function marsHeightAt(u, v, frequency) {
  const wx = layerAt(macroFbm, u, v, frequency * 0.85, 3.1) - 0.5;
  const wy = layerAt(macroFbm, u, v, frequency * 0.85, 61.7) - 0.5;
  const uu = u + wx * 0.02;
  const vv = v + wy * 0.02;

  const large = layerAt(macroFbm, uu, vv, frequency, 0);
  const medium = layerAt(mediumFbm, uu, vv, frequency * 3.4, 17.3);
  const fine = layerAt(fineFbm, uu, vv, frequency * 16, 41.7);

  let value = large * 0.5 + medium * 0.35 + fine * 0.15;

  /* Shallow crevices. Subtle on purpose — deep ones read as cracks in glaze
     rather than as weathered rock. */
  const crev = layerAt(mediumFbm, uu, vv, frequency * 4.2, 91.3);
  value -= sstep(0.58, 0.68, crev) * 0.075;

  return clamp01(sstep(0.1, 0.9, value));
}

/**
 * Sparse stones on a wrapping grid.
 *
 * GRID CELLS, NOT RANDOM POSITIONS. Uniformly random placement clumps by
 * chance, and the eye finds regularity in the clumps — which is what kept
 * reading as pimples. At most one stone per cell, accepted only when the
 * cell's hash clears a threshold, guarantees minimum spacing while still
 * looking unplanned. Cell counts must be whole numbers or the lattice will not
 * meet itself at the tile edge.
 */
function stonesAt(u, v, cells, salt, threshold, radius) {
  const gx = u * cells;
  const gy = v * cells;
  const cx = Math.floor(gx);
  const cy = Math.floor(gy);

  let best = 0;
  /* Neighbouring cells too, so a stone near a cell edge is not clipped. */
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      const ix = (((cx + ox) % cells) + cells) % cells;
      const iy = (((cy + oy) % cells) + cells) % cells;

      if (hash21(ix + salt, iy + salt * 2) < threshold) continue;

      const jx = hash21(ix + salt + 3.1, iy + salt + 8.7);
      const jy = hash21(ix + salt + 17.3, iy + salt + 5.9);
      const px = cx + ox + 0.5 + (jx - 0.5) * 0.6;
      const py = cy + oy + 0.5 + (jy - 0.5) * 0.6;

      const dx = gx - px;
      const dy = gy - py;
      const r = radius * (0.55 + hash21(ix + salt + 41, iy + salt + 23) * 0.75);
      const d = Math.sqrt(dx * dx + dy * dy) / r;
      if (d >= 1) continue;

      const h = Math.pow(1 - d * d, 0.6);
      if (h > best) best = h;
    }
  }
  return best;
}

function heightAt(u, v, frequency) {
  const fold = (fbm, f, offset) => Math.abs(layerAt(fbm, u, v, f, offset) * 2 - 1);

  const a = fold(macroFbm, frequency, 0);
  const b = fold(mediumFbm, frequency * 2.1, 17.3);
  const c = fold(fineFbm, frequency * 4.4, 41.7);

  /* Inverted so the veins read as the light frost and the bodies as denser
     ice, which is the way round the reference has it. */
  const turb = 1 - (a * 0.44 + b * 0.34 + c * 0.22);
  return Math.min(1, Math.max(0, 0.5 + (turb - 0.5) * 1.45));
}

function unusedSmoothHeightAt(u, v, frequency) {
  const macro = layerAt(macroFbm, u, v, frequency, 0);
  const medium = layerAt(mediumFbm, u, v, frequency * MEDIUM_SCALE, 17.3);
  const fine = layerAt(fineFbm, u, v, frequency * FINE_SCALE, 41.7);

  const mixed = macro * W_MACRO + medium * W_MEDIUM + fine * W_FINE;
  const stretched = 0.5 + (mixed - 0.5) * CONTRAST;

  return Math.min(1, Math.max(0, stretched));
}

/*
 * STONES IN FINE MUD, and the scatter is a separate layer for a reason.
 *
 * An fbm — any fbm, at any weighting — is continuous: it produces swells and
 * hollows that flow into one another, never discrete objects sitting on a
 * surface. Chunks of ice pressed into packed snow are discrete, so no amount of
 * octave tuning was ever going to get there. They have to be placed.
 *
 * So the field is two things added together: a quiet fbm matrix (the fine mud)
 * and a scatter of individually stamped rounded lumps (the stones).
 *
 * STAMPED, NOT SAMPLED. Testing every pixel against every stone would be
 * size^2 * count — 65 million distance checks at 512 with 250 stones. Splatting
 * instead walks only the pixels inside each stone's own radius, which is a few
 * hundred per stone and runs in a blink.
 *
 * COMBINED WITH MAX, NOT SUM. Overlapping stones that add together build into
 * tall welded ridges; taking the greater leaves them reading as separate lumps
 * that happen to touch, which is what a bed of pebbles actually looks like.
 */

/** How many stones per tile. */
const PIT_COUNT = 32;
/** Stone radius as a fraction of the tile. Large — these are slabs of ice
    pressed into the surface, not gravel. */
const PIT_MIN = 0.045;
const PIT_MAX = 0.125;
/** Fraction of the radius given over to the soft flank; the rest is crown. */
const PIT_EDGE = 0.62;
/** How far a stone stands proud of the matrix. Low — flat, not knobbly. */
const PIT_DEPTH = 0.2;
/** How much of the cloudy fbm leaks into the RELIEF. Tiny, or waves return. */
const MATRIX_WEIGHT = 0.08;

/** Deterministic PRNG, so the texture is identical on every load. */
function mulberry32(a) {
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The rock field.
 *
 * ROCK IS THE OPPOSITE RULE TO SNOW, which is why it cannot just be the ice
 * field turned up. Everything above exists to remove edges: smoothstepped
 * layers, macro dominance, a whisper of fine detail. Stone does the reverse —
 * it fractures, so it holds sharp crests and V-shaped clefts, and its detail
 * carries most of the way down the scales instead of dying out.
 *
 * So the layers are folded about zero with 1-|n| — the ridged trick that was
 * wrong for snow dunes and is exactly right here — and the fine band gets three
 * times the weight it has in the ice.
 */
function rockHeightAt(u, v, frequency) {
  const ridged = (fbm, f, offset) => {
    const n = layerAt(fbm, u, v, f, offset) * 2 - 1;
    return 1 - Math.abs(n);
  };

  const macro = ridged(macroFbm, frequency, 0);
  const medium = ridged(mediumFbm, frequency * MEDIUM_SCALE, 17.3);
  const fine = ridged(fineFbm, frequency * FINE_SCALE, 41.7);

  const mixed = macro * 0.44 + medium * 0.33 + fine * 0.23;
  return Math.min(1, Math.max(0, 0.5 + (mixed - 0.5) * 1.55));
}

/**
 * Rock relief: irregular rises and clefts, no round objects anywhere.
 *
 * WHY NOT SPLATS. Every scattered-object version of this — pebbles, stones,
 * craters, grid cells — came back as pimples, and the reason is structural. A
 * splat has an outline. Stamp any closed shape onto a surface and the eye finds
 * its edge, so a field of them reads as things sitting ON the surface rather
 * than as the surface having shape. Changing count, size, height spread,
 * clustering and profile all left that outline intact.
 *
 * Rock has no outlines. It is one connected mass with crests and clefts in it,
 * and that is what ridged noise produces: folding each octave at zero with
 * 1-|n| turns smooth humps into sharp crests separated by V-shaped valleys.
 * Weighted toward the finer octaves it gives crags rather than hills.
 *
 * This was unusable earlier because the noise sampler coupled u and v and gave
 * everything a diagonal lay; with that fixed, ridged noise is isotropic and
 * this is the right tool.
 */
function rockReliefAt(u, v, frequency) {
  const fold = (fbm, f, offset) => 1 - Math.abs(layerAt(fbm, u, v, f, offset) * 2 - 1);

  const a = fold(macroFbm, frequency, 0);
  const b = fold(mediumFbm, frequency * 2.6, 17.3);
  const c = fold(fineFbm, frequency * 6.1, 41.7);

  /*
   * WEIGHTED TOWARD THE COARSE END, so the surface has rises rather than rash.
   *
   * At 0.40/0.34/0.26 the three scales were near enough equal, and equal
   * weighting across octaves is what produces uniform grain — every part of the
   * surface equally busy, which looks like coarse sandpaper rather than rock.
   * Rock is dominated by its largest forms: a few big irregular swells with
   * finer breakup riding on them.
   */
  const mixed = a * 0.58 + b * 0.28 + c * 0.14;

  /* Sharpened, so crests stay crisp instead of rounding into humps. */
  return clamp01(sstep(0.2, 0.86, mixed));
}

/**
 * The crack network.
 *
 * A FROZEN CRUST FRACTURES, AND THE PATTERN IT MAKES IS NOT NOISE. Cracks meet
 * at junctions, enclose whole plates of unbroken surface between them, and run
 * for a long way in one direction before turning. No amount of fbm produces
 * that, because fbm has no notion of a boundary — it makes smooth fields, and a
 * crack is a discontinuity with plates either side of it.
 *
 * A cellular partition does have boundaries, and they are exactly the right
 * ones. Scatter feature points, give every pixel to its nearest, and the set of
 * pixels equidistant from two of them is a network of lines dividing the plane
 * into plates — which is structurally what a fractured crust IS. The difference
 * between the nearest and second-nearest distance is near zero on those lines
 * and grows away from them, so thresholding it draws the network directly, with
 * the line width in the threshold.
 *
 * WARPED BEFORE PARTITIONING, not after. Straight cell walls read as a
 * honeycomb — the tell that gives cellular noise away instantly. Displacing the
 * sample point by a smooth field first makes every wall wander, so the plates
 * come out as irregular slabs rather than as tiles, and the junctions stop
 * being uniformly three-way.
 *
 * WRAPPING, like everything else here: cell indices are taken modulo the grid,
 * so the network meets itself at the tile edge and there is no seam to hide.
 */
function crackAt(u, v, cells) {
  /* The warp. Low amplitude — a fifth of a cell is enough to lose the lattice,
     and past about half the walls start folding back through each other. */
  const wx = layerAt(macroFbm, u, v, 2.4, 311.7) - 0.5;
  const wy = layerAt(macroFbm, u, v, 2.4, 907.1) - 0.5;
  const gx = (u + wx * 0.18) * cells;
  const gy = (v + wy * 0.18) * cells;

  const cx = Math.floor(gx);
  const cy = Math.floor(gy);

  let f1 = 1e9;
  let f2 = 1e9;

  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      const ix = (((cx + ox) % cells) + cells) % cells;
      const iy = (((cy + oy) % cells) + cells) % cells;

      /* Jitter kept below 0.5 so a point never leaves its own cell, which is
         what makes the 3x3 neighbourhood sufficient. */
      const jx = cx + ox + 0.5 + (hash21(ix + 0.3, iy + 7.1) - 0.5) * 0.86;
      const jy = cy + oy + 0.5 + (hash21(ix + 5.7, iy + 2.9) - 0.5) * 0.86;

      const dx = gx - jx;
      const dy = gy - jy;
      const d = Math.sqrt(dx * dx + dy * dy);

      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }

  /*
   * NOT EVERY WALL IS A CRACK. A complete partition is a net, and a net over
   * the whole ground looks like crazy paving. Real fracture is patchy: some
   * plates have parted, most have not. A slow field gates which stretches of
   * the network survive, so cracks run, stop, and pick up again elsewhere.
   */
  const present = sstep(0.44, 0.72, layerAt(mediumFbm, u, v, 3.1, 55.3));

  /*
   * WIDTH IN CELL UNITS, AND IT HAS TO BE SET AGAINST BOTH ENDS.
   *
   * Too wide and it is not a crack. At 0.055 of a cell, with cells 17 world
   * units across, the line came out well over a metre wide — a trench, and at
   * a distance it read as a tyre track smeared across the snow.
   *
   * Too narrow and it cannot be drawn: the tile is rasterised at 512, so one
   * texel is the tile size over 512, and a line thinner than about two of those
   * falls between samples and breaks into dashes that crawl when the camera
   * moves. 0.016 of a cell is roughly 28cm here — a real crack, and still two
   * texels wide, which is the floor.
   */
  return (1 - sstep(0.0, 0.016, f2 - f1)) * present;
}

function buildFields(size, frequency, rock, pebbles) {
  /*
   * THE CLOUD FIELD. Smooth, continuous fbm — and it drives the ROUGHNESS MAP
   * ONLY. This is the broad mottling: patches where the ice is denser or has
   * been scoured harder, which shows as a change in sheen rather than in shape.
   */
  const cloud = new Float32Array(size * size);
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const u = i / size;
      const v = j / size;
      cloud[j * size + i] = rock ? rockHeightAt(u, v, frequency) : marsHeightAt(u, v, frequency);
    }
  }

  /* The micro grain. Sampled on the same torus so it wraps with everything
     else, then folded into the relief only. */
  const micro = new Float32Array(size * size);
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const g = layerAt(fineFbm, i / size, j / size, frequency * MICRO_SCALE, 77.1);
      micro[j * size + i] = (g - 0.5) * MICRO_WEIGHT;
    }
  }

  /*
   * NO SPLATTED SCATTER ANY MORE.
   *
   * The stamped circles were an answer to "stones in fine mud", and against
   * this reference they are wrong: individually placed round lumps read as
   * pimples on the surface however wide or flat they are made, because the eye
   * finds their outlines. Cloudy ice has no discrete objects in it at all — its
   * structure is continuous and tangled, which is exactly what turbulence
   * gives, so the relief now comes from the same field as everything else.
   */

  /*
   * SCREE PEBBLES, and they are a scatter on purpose this time.
   *
   * Stamped circles were wrong on the igloo — individually placed lumps read as
   * pimples, because at that size the eye resolves each outline. On the ground
   * the same construction is right for the same reason it was wrong there: a
   * scree slope IS discrete objects, and here they are small enough relative to
   * the surface that they read collectively as a gravelled texture rather than
   * as a field of circles.
   *
   * Combined with max rather than sum, so overlapping stones stay separate
   * lumps instead of welding into ridges.
   */
  /*
   * THE SPLAT PASS IS GONE. See rockReliefAt for why scattered objects can
   * never read as rock, whatever their shape or distribution.
   */

  /*
   * FROST GRAIN, for the ALBEDO — and its octave mix is deliberately the
   * inverse of the relief's.
   *
   * Everything else in this file is macro-dominant, because large soft forms
   * are what give a surface its shape. Frost is the opposite: it is a fine
   * crystalline scatter, so the finest octave carries half the weight and the
   * coarsest barely a sixth. Mixing it the usual way round produces cloudy
   * blotches rather than sparkle.
   *
   * STANDARDISED to zero mean and unit variance before use. The octave sum has
   * no predictable range — it depends on the weights and on how the noise
   * happens to land — so scaling it directly makes the grain's strength drift
   * whenever any of those change. Normalising means the amplitude below is in
   * real units: a standard deviation of GRAIN_AMP, whatever the octaves do.
   */
  const frost = new Float32Array(size * size);
  {
    let sum = 0;
    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        const u = i / size;
        const v = j / size;
        const f =
          layerAt(fineFbm, u, v, frequency * 17, 5.7) * 0.5 +
          layerAt(mediumFbm, u, v, frequency * 6.2, 29.1) * 0.32 +
          layerAt(macroFbm, u, v, frequency * 2.3, 53.9) * 0.18;
        frost[j * size + i] = f;
        sum += f;
      }
    }
    const mean = sum / frost.length;
    let varSum = 0;
    for (let n = 0; n < frost.length; n += 1) {
      const d = frost[n] - mean;
      varSum += d * d;
    }
    const sd = Math.sqrt(varSum / frost.length) || 1e-6;
    for (let n = 0; n < frost.length; n += 1) frost[n] = (frost[n] - mean) / sd;
  }

  /* The rock field, sampled once and shared by relief, roughness and AO. */
  const rockField = new Float32Array(size * size);
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      rockField[j * size + i] = rockReliefAt(i / size, j / size, frequency);
    }
  }

  const relief = new Float32Array(size * size);
  for (let n = 0; n < relief.length; n += 1) {
    if (rock) {
      /* The fracture pattern IS the relief here — there is no smooth matrix to
         protect, so the cloud field drives the normal directly. */
      relief[n] = clamp01(rockField[n] * 1.0 + micro[n] * 0.3);
    } else {
      relief[n] = clamp01(rockField[n] * 1.0 + micro[n] * 0.3);
    }
  }

  /*
   * THE PATCH FIELD — smooth, broad, and deliberately NOT the relief.
   *
   * It exists because the relief is the wrong thing to threshold. Anything
   * downstream asking "is this bare stone or filled ice" is asking about
   * PATCHES metres across, and the relief carries most of its energy in octaves
   * a hand's width across: cutting it at any level gives a fine speckle, which
   * on the ground read as a dalmatian rather than as mottling. The two are
   * different questions at different scales and they need different fields.
   *
   * So this is macro-dominant on purpose — 62/38 across two scales, no fine
   * octave at all — and it is the field the bands are cut from. The relief goes
   * on carrying the surface's shape within whichever band it lands in.
   */
  const patch = new Float32Array(size * size);
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const u = i / size;
      const v = j / size;
      patch[j * size + i] = clamp01(
        layerAt(macroFbm, u, v, frequency * 1.5, 131.7) * 0.6 +
          layerAt(mediumFbm, u, v, frequency * 3.4, 57.3) * 0.4
      );
    }
  }

  /*
   * Cell count is per TILE, and it is low on purpose. Fracture plates on a
   * snowfield are metres across, the tile is tens of metres, so a handful of
   * cells across it is the right density — and a sparse network is also what
   * keeps its repeat from being readable when the tile is laid many times.
   */
  const cracks = new Float32Array(size * size);
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      cracks[j * size + i] = crackAt(i / size, j / size, 4);
    }
  }

  return { cloud, relief, frost, patch, cracks };
}

/** Wrapping fetch, so the Sobel kernel is seamless at the edges too. */
const sample = (field, size, i, j) =>
  field[((j + size) % size) * size + ((i + size) % size)];

/**
 * @param frequency cycles of the MACRO layer across one tile. Low, because the
 *   macro forms are meant to be larger than a single block face.
 * @param repeat texture repeats across the UV span. Kept at 1: making the
 *   pattern denser by repeating it is exactly what makes tiling visible.
 * @param bump normal-map strength.
 * @param variant 'ice' is dry packed snow — matte throughout, soft rounded
 *   relief. 'rock' is fractured stone — wide roughness range, sharp ridged
 *   relief. Both come out of the same torus sampling and the same Sobel, so a
 *   surface can be switched between them with nothing else in the scene
 *   changing.
 */
/**
 * THE PURE HALF: every pixel of all four maps, and nothing that touches the DOM
 * or three.
 *
 * SPLIT OUT SO IT CAN BE RUN AT BUILD TIME. This is by far the most expensive
 * thing the site does — measured, four calls at 512 cost 15.2 of the 16.9
 * seconds the world took to start, all of it synchronous on the main thread,
 * which is why a low-end phone never got to the end of it. None of it is
 * variable: there is no Math.random in this file and the fields are functions
 * of position alone, so every visitor was paying fifteen seconds to compute a
 * byte-identical answer.
 *
 * scripts/bake-world.mjs calls THIS in Node and writes the buffers out as PNGs.
 * The browser fetches those instead and decodes them off-thread in native code.
 * Keeping the split at exactly this line is what makes that possible: below
 * here is canvas and CanvasTexture, which Node does not have, and above here is
 * arithmetic, which runs anywhere.
 *
 * makeIceMaps() is unchanged in behaviour and still available — it is what the
 * bake script is a cache OF, and what the runtime falls back to if the baked
 * assets are missing.
 */
export function makeIceMapData({
  size = 512,
  frequency = 1.4,
  repeat = 1,
  bump = 2.6,
  variant = 'ice',
  /**
   * Density of scattered scree pebbles in the relief, 0 to about 1.5. Zero on
   * anything seen close up — at that size discrete lumps read as pimples.
   */
  pebbles = 0,
} = {}) {
  const rock = variant === 'rock';
  const { cloud, relief, frost, patch, cracks } = buildFields(size, frequency, rock, pebbles);

  /* --- Roughness ---------------------------------------------------------
     A narrow band near the matte end, 0.84 to about 0.97. Dry packed snow is
     diffuse almost everywhere; the small variation that is here reads as
     differences in how hard the surface has been wind-packed, not as wetness.
     The |h-0.5| term gives a touch back at both extremes, so the mid-height
     patches are not the only matte ones. */
  const rimg = { data: new Uint8ClampedArray(size * size * 4) };

  for (let n = 0; n < cloud.length; n += 1) {
    /*
     * HIGH CONTRAST, and driven by the RELIEF rather than the cloud.
     *
     * This was a 0.84-0.97 band, which is correct for uniformly dry snow and
     * wrong for a real block: it made every part of the surface scatter
     * identically, so the only thing separating a powdery face from a scoured
     * one was its shape. Roughness is what actually tells them apart.
     *
     * Raised powder goes to nearly pure white — maximum scatter, no specular
     * at all. The carved indentations drop to mid-grey, where the exposed ice
     * is dense enough to catch a soft glossy highlight. That specular in the
     * hollows is most of what makes chipped ice look like ice.
     */
    const h = relief[n];
    const rough = rock ? 0.4 + h * 0.55 : 0.46 + h * 0.52;
    const v = Math.round(Math.min(1, rough) * 255);
    /*
     * THE PATCH FIELD RIDES IN RED, and this is a free channel rather than a
     * fourth texture.
     *
     * A roughness map is greyscale — three reads it from a single channel and
     * the other two are duplicates carried along for nothing. Putting a second
     * field in one of them costs no memory, no bandwidth and no extra sampler,
     * and the field arrives mipmapped and anisotropically filtered exactly like
     * everything else. Generating world-space noise in the shader instead would
     * have none of that, which at this frequency means it would alias — the one
     * failure this whole file is organised around avoiding.
     *
     * RED SPECIFICALLY, AND NOT GREEN. three reads a roughness map from its
     * GREEN channel and a metalness map from BLUE — so green is the one channel
     * here that is load-bearing, and writing the patch into it silently
     * replaced the roughness of every surface using these maps: the ground, the
     * scree and the igloo at once. Red is read only by an AO map, and the AO
     * here is a separate canvas.
     */
    rimg.data[n * 4] = Math.round(patch[n] * 255);
    rimg.data[n * 4 + 1] = v;
    /*
     * AND THE CRACK NETWORK RIDES IN BLUE.
     *
     * Blue is a metalness map's channel, and nothing here is ever bound as one
     * — so between red and blue this texture carries two extra full-resolution
     * fields at no cost in memory, bandwidth or samplers, both of them
     * mipmapped and anisotropically filtered like the roughness they travel
     * with. That filtering is not a nicety for a crack: a one-texel-wide line
     * generated in the shader instead would alias into a dashed shimmer the
     * moment the camera moved.
     *
     * Green remains roughness — see the note above for why that one is not
     * available.
     */
    rimg.data[n * 4 + 2] = Math.round((1 - cracks[n]) * 255);
    rimg.data[n * 4 + 3] = 255;
  }


  /* --- Colour ------------------------------------------------------------
     THE MAP THE MATERIAL NEVER HAD, and the reason the blocks read as one flat
     tone however much relief was on them. A single `color` gives every pixel
     the same albedo, so all variation had to come from shading — and shading
     alone cannot show the difference between deep ice and the frost sitting on
     it, because that is a difference in the material, not in the light.

     Three terms, straight out of how frosted ice actually works:

       STRUCTURE  the same field the relief uses, ramping between shadowed ice
                  and bright surface snow. Hollows read as denser, bluer ice;
                  crests read as the powder that settles on them.
       GRAIN      a fine per-texel hash, tiny in amplitude. This is the powdery
                  scatter that makes frost sparkle rather than look wet.
       GLOW       an additive lift on the very highest parts only, faking the
                  subsurface scattering that makes thick ice glow slightly from
                  within instead of ending at its surface.

     Sampled from the SAME toroidal field as the other two maps, so it wraps —
     a colour map built on a plain hash would seam at the tile edge, and on a
     surface this size the seam is the first thing you would see. */
  const cimg = { data: new Uint8ClampedArray(size * size * 4) };

  /* Deep material and surface material. Rock swings between two stones; ice
     between shadowed blue-grey and crisp white. */
  /*
   * LOW CONTRAST, AND ONLY JUST BLUE.
   *
   * These two were [0.55,0.65,0.75] and [0.92,0.95,0.98] — a 0.20 blue-minus-red
   * spread at the dark end, which is a saturated ice blue, not the pale
   * desaturated slate that packed snow actually is. The spread is now 0.05, so
   * the hue survives as a cast rather than announcing itself, and the two ends
   * sit closer together because albedo variation in snow is genuinely subtle:
   * almost everything you read on a snow surface is shading, not pigment.
   */
  /*
   * REGOLITH GREY. Almost no saturation at all — lunar soil is famously
   * neutral, a touch warm rather than blue, and its albedo range is narrow
   * because it is one pulverised material rather than several.
   */
  /* Dry rocky ground: warm mid-grey with a faint ochre lean, and a wide
     albedo range because rock, dust and stone are genuinely different tones —
     unlike snow, where almost all variation is shading. */
  /*
   * Sampled off the reference, not chosen. igloo.inc's world is a cool
   * blue-grey with the blue sitting mostly in the shadows: its dark end runs
   * bluer than its light end, which is what atmospheric scattering does to a
   * snow field. So the deep colour carries more blue-minus-red than the bright
   * one rather than the two being tints of a single hue.
   */
  /*
   * A NARROW RAMP, and this is the fix for the surface looking like marble.
   *
   * These ran 0.29 to 0.64 — the light end more than twice the dark end. That
   * much pigment variation means the pattern is drawn ON the surface in colour,
   * and a colour pattern that does not move with the light is exactly what
   * veined stone looks like. It read as marble pasted onto the blocks because
   * that is structurally what it was.
   *
   * Real ice and rock are close to uniform in albedo. Almost everything you see
   * on them is SHADING — light meeting relief — which changes as the light and
   * the viewer move, and that is what makes a surface read as physical rather
   * than printed. So the ramp is narrowed to a fifth of its old range and the
   * normal map is given the work instead.
   */
  const deep = rock ? [0.42, 0.41, 0.39] : [0.47, 0.5, 0.57];
  const bright = rock ? [0.6, 0.59, 0.56] : [0.6, 0.63, 0.7];

  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const n = j * size + i;
      const h = cloud[n];

      /*
       * The old per-texel hash grain that used to sit here is gone. It was
       * built from sin(i*12.9898 + j*78.233), which is indexed by TEXEL rather
       * than by position, so it neither wrapped at the tile edge nor held still
       * if the resolution changed. The frost field below replaces it and is
       * both seamless and standardised.
       */
      const t = Math.min(1, Math.max(0, h));
      /*
       * NO GLOW TERM. An albedo map is raw pigment: what the surface would
       * look like under perfectly flat light. There used to be an additive
       * lift on the crests here to fake subsurface scattering, and baking that
       * in is a mistake — it is a highlight, so it stays put when the light
       * moves, and it fights the real shading rather than adding to it. The
       * ice reads as translucent through roughness and the material's own
       * emissive instead.
       */
      /*
       * Grain weighted per channel, and the weighting is the point: it is
       * strongest in blue and weakest in red, so the speckle itself carries a
       * cold cast. Uniform grain would only add and remove brightness, which
       * reads as film noise rather than as frost catching the light.
       */
      const grain = frost[n] * GRAIN_AMP;

      const o = n * 4;
      for (let c = 0; c < 3; c += 1) {
        let v = deep[c] + (bright[c] - deep[c]) * t + grain * GRAIN_TINT[c];
        /* A few percent of flat blue-white over everything. Frost sits ON a
           surface, so it lifts the whole thing slightly toward its own colour
           rather than modulating what is underneath. */
        v = v * (1 - FROST_WASH) + FROST_COLOR[c] * FROST_WASH;
        cimg.data[o + c] = Math.round(Math.min(1, Math.max(0, v)) * 255);
      }
      cimg.data[o + 3] = 255;
    }
  }

  /* --- Normal ------------------------------------------------------------
     Sobel gradient of the same field, packed into RGB the usual way: X and Y
     in red and green about a mid-grey zero, Z left at full blue. */
  const nimg = { data: new Uint8ClampedArray(size * size * 4) };

  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const tl = sample(relief, size, i - 1, j - 1);
      const t = sample(relief, size, i, j - 1);
      const tr = sample(relief, size, i + 1, j - 1);
      const l = sample(relief, size, i - 1, j);
      const r = sample(relief, size, i + 1, j);
      const bl = sample(relief, size, i - 1, j + 1);
      const b = sample(relief, size, i, j + 1);
      const br = sample(relief, size, i + 1, j + 1);

      const dx = tl + 2 * l + bl - (tr + 2 * r + br);
      const dy = tl + 2 * t + tr - (bl + 2 * b + br);

      const nx = dx * bump;
      const ny = dy * bump;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);

      const o = (j * size + i) * 4;
      nimg.data[o] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      nimg.data[o + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      nimg.data[o + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255);
      nimg.data[o + 3] = 255;
    }
  }

  /*
   * THE FIELD'S QUANTILES, SORTED ONCE AND USED TWICE — by the AO ramp
   * immediately below and by the stops this function returns. They were
   * computed at the end of the function until the AO ramp needed them; the sort
   * is the expensive part and there is no reason to do it twice.
   */
  const sorted = Float32Array.from(relief).sort();
  const at = (q) => sorted[Math.floor((sorted.length - 1) * q)];

  /* --- Ambient occlusion --------------------------------------------------
     The same relief field read as depth: the hollows the light cannot reach.

     THE WINDOW IS TAKEN FROM THE FIELD, NOT WRITTEN DOWN — and the version that
     wrote it down had been producing a blank texture for as long as it existed.

     It ramped across a fixed 0.04 to 0.46. Measured, this field's MINIMUM is
     0.27 and its median is 0.99: the entire distribution sits above the top of
     that ramp, so every texel evaluated to full brightness. 99.9% of the map
     was pure white. Not subtly wrong — the map was uniform, which is the same
     as having no AO map at all, and three duly multiplied every surface by one.

     It is the identical failure the ground fog's bank threshold had, and the
     note there states the rule this now follows: a window has to be set against
     the distribution rather than by eye, because the distribution moves
     whenever anything upstream is retuned and a hardcoded pair of numbers does
     not move with it. The relief is clamped at 1.0 and piles up hard against
     it — 40% of the ice variant sits at 0.999 or above — so any window chosen
     for a field that "runs 0 to 1" is going to miss.

     Reading it from the quantiles means the ramp lands in the right place by
     construction, for both variants, and keeps landing there if the octave
     weights or the micro amplitude are ever changed again.

     p01 to p40, and the asymmetry is the point: occlusion is a property of the
     bottom of a pit and of almost nothing else. The deepest hundredth is fully
     occluded, the next two fifths ramp out of it, and the top three fifths —
     the flats and crests that the eye reads as the surface — are untouched.

     The floor of 0.55 is as it was authored, so the deepest hollows still take
     more than half their light. Occlusion this map cannot see the top of should
     not be able to black anything out.

     The block SEAMS are left to geometry. Every joint here is a real gap
     between two shell segments, so the lighting already darkens them; painting
     seams into this map would put a second set of them wherever the texture
     happened to land. */
  const aoDark = at(0.01);
  const aoOpen = at(0.4);
  /* Degenerate only if the field is constant, which would make the map uniform
     whatever we did — guarded so it cannot divide by zero on the way there. */
  const aoSpan = aoOpen - aoDark || 1;

  const aimg = { data: new Uint8ClampedArray(size * size * 4) };

  for (let n = 0; n < relief.length; n += 1) {
    const t = Math.min(1, Math.max(0, (relief[n] - aoDark) / aoSpan));
    const soft = t * t * (3 - 2 * t);
    const v = Math.round((0.55 + 0.45 * soft) * 255);
    aimg.data[n * 4] = v;
    aimg.data[n * 4 + 1] = v;
    aimg.data[n * 4 + 2] = v;
    aimg.data[n * 4 + 3] = 255;
  }

  /*
   * THE PURE HALF ENDS HERE. Four RGBA buffers and the two quantile sets, and
   * every one of them is a plain array — nothing above this line has touched a
   * canvas, a texture or the DOM, which is the whole reason it can be run in
   * Node at build time.
   *
   * The channel packing travels with the buffers and is NOT incidental: the
   * roughness buffer carries three separate fields (patch in red, roughness in
   * green, cracks in blue) and the normal buffer carries a vector. Both must be
   * stored losslessly by anything that bakes them — a lossy codec's chroma
   * subsampling would quietly destroy two of the roughness map's three fields
   * and bend every normal. See scripts/bake-world.mjs, which uses PNG for
   * exactly this reason.
   */
  /*
   * THE FIELD'S OWN QUARTILES, REPORTED BACK.
   *
   * Anything downstream that wants to threshold this relief — "stone here, snow
   * there" — needs to know where its values actually lie, and that is not
   * knowable from outside: it depends on the octave weights, on the sharpening
   * smoothstep, on the variant, and it moves whenever any of those are tuned.
   *
   * Guessing it cost a full pass. A threshold picked by eye at 0.26-0.68 sat
   * almost entirely below a field whose quartiles turned out to be higher than
   * that, so it evaluated to nearly 1 everywhere: the rock mixed in at a
   * constant strength across the whole surface, which darkened the ground
   * uniformly and produced no grain at all. The pattern was there in the map
   * and the threshold was flattening it.
   *
   * Reporting the quartiles means a caller can ask for "the top quarter is bare
   * stone, the bottom quarter is filled with snow" and get exactly that,
   * whatever the generator is retuned to do later.
   */
  const sortedPatch = Float32Array.from(patch).sort();
  const patchAt = (q) => sortedPatch[Math.floor((sortedPatch.length - 1) * q)];

  return {
    size,
    rough: rimg.data,
    color: cimg.data,
    normal: nimg.data,
    ao: aimg.data,
    reliefStops: {
      p10: at(0.1),
      p25: at(0.25),
      p35: at(0.35),
      p50: at(0.5),
      p75: at(0.75),
      p90: at(0.9),
    },
    /* Quantiles of the patch field in the roughness map's green channel, so a
       caller can ask for "the top fifth" and get exactly a fifth. */
    patchStops: {
      p05: patchAt(0.05),
      p20: patchAt(0.2),
      p35: patchAt(0.35),
      p50: patchAt(0.5),
      p70: patchAt(0.7),
      p88: patchAt(0.88),
    },
  };
}

/**
 * THE DOM HALF: RGBA buffers in, three textures out.
 *
 * Shared by both paths on purpose. Whether the pixels were computed here and
 * now (makeIceMaps, below) or decoded from a baked PNG (lib/baked.js), they end
 * up in exactly the same texture objects with exactly the same wrapping,
 * filtering, anisotropy and colour space — so a baked world and a generated one
 * are not two code paths that have to be kept in agreement, they are one.
 */
/**
 * THE SETTINGS, IN ONE PLACE AND APPLIED TO BOTH PATHS.
 *
 * A texture's wrapping, tiling, filtering and colour space are as much a part
 * of how this material looks as any pixel in it — anisotropy 16 below is not a
 * refinement, it is the whole fix for the streaking on the ground plane. So
 * they cannot live only in the generate path: a baked texture that arrives
 * without them is not the same material, and the failure would show up as the
 * exact artefact the note below describes, months after anyone remembered why
 * the number was 16.
 *
 * Generated or decoded from disk, every map in this scene goes through here.
 */
export function applyIceSettings(tex, repeat = 1) {
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeat, repeat);
    /*
     * ANISOTROPY 16, NOT 4, and on the ground plane this is the whole fix for
     * the streaking.
     *
     * A surface seen at a grazing angle is compressed far more along the view
     * direction than across it, so one screen pixel covers a long thin footprint
     * in texture space. Isotropic mip selection has to pick a single level for
     * that footprint: it takes the one that suits the LONG axis, which blurs the
     * short axis into smears that run along the surface. Those smears follow the
     * topography rather than the UV grid, which is exactly why this looked like
     * contour lines and not like a tiling seam — and why chasing it as tiling,
     * and then as a slope blend, both missed.
     *
     * Anisotropic filtering takes multiple samples along the long axis instead,
     * so the short axis keeps its detail. 16 is the usual hardware maximum; the
     * driver silently clamps to whatever it supports.
     */
  tex.anisotropy = 16;
  return tex;
}

/** The sRGB/AO tagging that distinguishes the four maps from one another. */
export function tagIceMaps({ roughnessMap, normalMap, colorMap, aoMap, reliefStops, patchStops }) {
  /* The only one of the three that carries colour rather than data, so it is
     the only one that must be tagged sRGB. Leaving it linear washes every
     value toward white and the ramp between deep and bright disappears. */
  colorMap.colorSpace = SRGBColorSpace;

  /*
   * AO READS UV CHANNEL 1 BY DEFAULT in modern three, and none of these
   * geometries have a second UV set — so without this the map is sampled
   * against a missing attribute and simply does nothing. Pointing it at
   * channel 0 reuses the UVs everything else already has.
   */
  aoMap.channel = 0;

  return { roughnessMap, normalMap, colorMap, aoMap, reliefStops, patchStops };
}

/**
 * Buffers in, textures out — the path taken when the maps are generated in the
 * browser rather than loaded from the bake.
 */
export function iceMapsFromData(data, repeat = 1) {
  const { size } = data;

  const toTexture = (buffer) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    img.data.set(buffer);
    ctx.putImageData(img, 0, 0);
    return applyIceSettings(new CanvasTexture(canvas), repeat);
  };

  return tagIceMaps({
    roughnessMap: toTexture(data.rough),
    normalMap: toTexture(data.normal),
    colorMap: toTexture(data.color),
    aoMap: toTexture(data.ao),
    reliefStops: data.reliefStops,
    patchStops: data.patchStops,
  });
}

/**
 * Generate and wrap in one call — the original entry point, unchanged in what
 * it returns.
 *
 * This is now the FALLBACK rather than the normal path: lib/baked.js serves the
 * same thing from disk when the baked assets are present. It stays because the
 * bake has to be a cache of something, and because art-directing these maps
 * means changing the code above and seeing it immediately.
 */
export function makeIceMaps(options = {}) {
  return iceMapsFromData(makeIceMapData(options), options.repeat ?? 1);
}
