import { useLayoutEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import {
  CanvasTexture,
  SRGBColorSpace,
  LinearFilter,
  EquirectangularReflectionMapping,
} from 'three';

/**
 * The sky, drawn rather than photographed.
 *
 * This replaces the arctic backdrop plate. A photograph could never be lit by
 * our lights or take our fog, and three composites the background AFTER the
 * scene without fogging it — so wherever the terrain faded out it met the plate
 * in a band of the wrong grey, and every attempt to match the two traded one
 * seam for another. A sky authored from the same values the atmosphere uses
 * cannot have that seam by construction: the terrain fades to exactly the
 * colour that is already painted behind it.
 *
 * IT WAS A 2x256 CANVAS AND IT CANNOT BE ANY MORE. That size was justified by
 * the sky it was drawing — "a smooth vertical ramp with no clouds and no sun,
 * so there is nothing here a two-pixel-wide image cannot describe". That sky is
 * gone. This one is blue, it has a sun in it, and it has cloud, and every one of
 * those things varies horizontally.
 *
 * 1024x512 is still nothing: it is generated at startup, never downloaded, and
 * costs a couple of megabytes of transient ImageData against the twelve the old
 * photographic plate cost on the wire. No network request, no load state, and
 * every value in it is ours to art-direct.
 *
 * THE DITHER IS NOT DECORATION. A smooth gradient stretched over a 1000-pixel
 * viewport lands many screen rows on the same 8-bit value and produces visible
 * horizontal banding — the classic gradient staircase. One LSB of ordered noise
 * per row breaks the steps up below the threshold of vision. It is baked into
 * the texture rather than applied in screen space on purpose: screen-space
 * dither stays put while the image moves under it, which is its own kind of
 * crawl.
 */

/**
 * THE SKY IS BLUE, and the notes this replaces are worth keeping in mind rather
 * than deleting, because they were right about their own scene.
 *
 * Every earlier value here was chosen to sit within a few points of the fog:
 * "the terrain fades to exactly the colour that is already painted behind it",
 * and with a landscape dissolved in haze that is the only choice available —
 * any daylight in the sky would have shown up as a band along the horizon where
 * the fogged ground stopped matching it.
 *
 * There is no haze left to match. The ground now reaches the horizon at close
 * to its own albedo, so the sky is free to be a sky. What holds the join
 * together instead is the ramp: it ends at HAZE, a very pale blue-white that
 * the far snow genuinely resolves to.
 *
 * ZENITH IS THE DEEP END. It sits at the top of frame, where there is least
 * atmosphere between the eye and space, which is why real skies are darkest and
 * most saturated overhead and wash out toward the horizon. Getting that
 * direction right matters more than the exact hue — a sky that is uniformly
 * blue reads as a painted ceiling.
 */
const ZENITH = [0x3d, 0x6d, 0xac];
/** Mid-sky, so the ramp has a shoulder instead of running straight through. */
const AZURE = [0x7c, 0xa4, 0xcf];
/** At the horizon: the pale blue-white the far snowfield fades into. */
const HAZE = [0xd6, 0xe2, 0xef];

/**
 * WHERE THE SUN IS, in fractions of the frame.
 *
 * Upper right, and it has to agree with the key light in Atmosphere — that sits
 * at [210, 150, -160], which from this camera is high and to the right. A sky
 * whose bright spot is on the opposite side from the shadows is the single
 * fastest way to make a render look wrong, and it is the kind of wrong people
 * see without being able to name.
 */
/*
 * SOLVED FROM THE KEY LIGHT, NOT PICKED — AND THE OLD PAIR DISAGREED BADLY.
 *
 * This is an equirectangular map, so the two numbers are a BEARING and an
 * ELEVATION, not a position on the screen. three samples it with
 *
 *   u = atan2( dir.z, dir.x ) / 2pi + 0.5
 *   v = 0.5 + asin( dir.y ) / pi      ... and flipY puts row 0 at the zenith,
 *
 * which makes this file's own `v` run 0 at the zenith to 1 at the horizon, so
 * an elevation of e degrees is v = 1 - e/90.
 *
 * At [0.9, 0.09] that put the painted sun 82 degrees up — within eight degrees
 * of straight overhead — while the key light in Atmosphere sat at 29. The sky
 * and the shading were lit by two different suns, which is exactly the failure
 * the note below warns about, committed in the numbers rather than in the side
 * of frame.
 *
 * The key is now [101, 94, -272]; normalised that is (0.332, 0.309, -0.891),
 * so the arithmetic above gives u = 0.3068 and an elevation of 18 degrees,
 * v = 0.80. Move the light and both of these move with it.
 */
const SUN = [0.3068, 0.80];

/* ===========================================================================
   CLOUDS
   ===========================================================================

   THE FIRST TWO ATTEMPTS DID NOT LOOK LIKE CLOUDS AND THE REASON WAS THE NOISE,
   not the tuning. Both were built on VALUE noise — hash the lattice corners,
   interpolate between them — and value noise has a characteristic look that no
   amount of thresholding removes: soft round blobs sitting on a visible grid.
   Turn the threshold up and you get hard-edged bars along the cell boundaries;
   turn it down and you get a smear. Neither is a cloud, because a cloud's edge
   is not a contour of a smooth field.

   THE RECIPE HERE IS THE STANDARD ONE and it is worth naming its parts, because
   each one fixes something the previous version could not.

   GRADIENT (PERLIN) NOISE instead of value noise. It interpolates DIRECTIONS
   rather than values, so its zero crossings wander instead of following the
   lattice, and its fbm has the irregular, self-similar structure that reads as
   natural. This alone is most of the difference.

   WORLEY, INVERTED, for the billows. Cellular noise returns the distance to the
   nearest of a set of scattered points; one minus that distance is a field of
   rounded lumps with definite edges between them, which is exactly the shape of
   a cumulus's cauliflower head. Perlin fbm alone is smooth everywhere and gives
   fog, not cloud.

   COVERAGE AS A REMAP, not as a threshold. remap(shape, 1-coverage, 1, 0, 1)
   rescales the top slice of the field to the full 0..1 range instead of cutting
   it off. A cut leaves a hard silhouette at a fixed density; a remap leaves the
   density still varying inside the cloud, so it has a soft edge and a solid
   middle the way a real one does.

   DETAIL EROSION. A higher-frequency fbm is SUBTRACTED, weighted by how thin
   the cloud already is. Adding detail thickens edges into fluff; subtracting it
   eats into them, which is what wind actually does to a cloud and what gives
   the wispy, torn boundary. The (1 - d) weight is why the cores survive and only
   the margins fray.

   Adapted from the technique in CK42BB/procedural-clouds-threejs (MIT), which
   is itself the well-travelled Guerrilla/Horizon shape-then-erode approach. That
   implementation raymarches a 3D volume; this is the same density function
   evaluated in 2D and painted into a background, because nothing in this shot
   ever flies through a cloud.
   ======================================================================== */

/** A unit vector per lattice point — the gradient in "gradient noise". */
const gradient = (x, y) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  const a = (n - Math.floor(n)) * 6.2831853;
  return [Math.cos(a), Math.sin(a)];
};

/**
 * Perlin noise, with the quintic fade.
 *
 * The fade curve is 6t^5-15t^4+10t^3 rather than the cheaper 3t^2-2t^3, and it
 * matters here: the cubic has a non-zero second derivative at the cell edges, so
 * a field built from it shows faint creases along the lattice under exactly the
 * kind of hard contrast a coverage remap applies. The quintic is C2 and the
 * creases are gone.
 */
const perlin = (x, y) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);

  const dot = (cx, cy, dx, dy) => {
    const g = gradient(cx, cy);
    return g[0] * dx + g[1] * dy;
  };

  const n00 = dot(ix, iy, fx, fy);
  const n10 = dot(ix + 1, iy, fx - 1, fy);
  const n01 = dot(ix, iy + 1, fx, fy - 1);
  const n11 = dot(ix + 1, iy + 1, fx - 1, fy - 1);

  const a = n00 + (n10 - n00) * ux;
  const b = n01 + (n11 - n01) * ux;
  /* 1.4142 brings the theoretical range back to roughly -1..1. */
  return (a + (b - a) * uy) * 1.4142;
};

/** Two independent fractions per lattice point — the feature point's offset. */
const cellPoint = (x, y) => {
  const a = Math.sin(x * 269.5 + y * 183.3) * 43758.5453;
  const b = Math.sin(x * 113.5 + y * 271.9) * 43758.5453;
  return [a - Math.floor(a), b - Math.floor(b)];
};

/** Worley / cellular: distance to the nearest scattered feature point. */
const worley = (x, y) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  let best = 8;
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      const p = cellPoint(ix + ox, iy + oy);
      const dx = ox + p[0] - fx;
      const dy = oy + p[1] - fy;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
  }
  return Math.min(1, Math.sqrt(best));
};

const fbm = (x, y, octaves) => {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += perlin(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    /* Not exactly 2, so the octaves never line their lattices up. */
    freq *= 2.03;
  }
  return sum / norm;
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (e0, e1, v) => {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const remap = (v, lo, hi, nlo, nhi) =>
  nlo + ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (nhi - nlo);

/**
 * TWO LAYERS, BECAUSE THE REFERENCE HAS TWO KINDS OF CLOUD IN IT.
 *
 * High cirrus — thin, drawn out by shear into long filaments, no body at all —
 * runs across the top of frame. Below and behind it there is a band of much
 * smaller, rounder cloud catching the sun near the horizon. One layer cannot be
 * both: the property that makes cirrus read is extreme anisotropy and almost no
 * billow, and the property that makes the low band read is the opposite.
 *
 * STRETCH is how much higher the vertical sampling frequency is than the
 * horizontal — it is what makes a filament rather than a puff, and it is the
 * one number that separates the two layers most.
 *
 * COVERAGE is the fraction of the field that becomes cloud at all. Both are
 * kept low: the brief is a light sky, and the moment coverage passes about half
 * the layer stops being individual clouds and becomes an overcast.
 */
/*
 * THE BANDS LIVE IN THE TOP THIRD, AND THE FIRST SET DID NOT.
 *
 * They were authored against the sky as a whole — cirrus across the upper third
 * of the TEXTURE, a lower band beneath it — which is the right way to compose a
 * sky and the wrong way to compose this shot. The background is stretched to
 * the viewport and the terrain covers everything below about a fifth of the
 * frame, so the second layer was entirely behind mountains and the first was
 * still fading in when it reached the skyline. The visible strip had nothing in
 * it but the fade.
 *
 * So the bands are placed against what is actually on screen: everything worth
 * drawing is in v 0.0 to 0.3, and the fades are narrow enough to happen inside
 * that. The parts that run on below are occluded, which costs nothing — the
 * field is 320x160 and the whole thing is built once.
 */
const LAYERS = [
  /* Cirrus: high, long, thin, barely there. */
  {
    scale: 6.5,
    stretch: 5.2,
    coverage: 0.58,
    erosion: 0.42,
    billow: 0.12,
    opacity: 0.72,
    top: 0.0,
    fade: 0.04,
    bottom: 0.34,
  },
  /* The low band: smaller, rounder, more structure, sitting nearer the haze. */
  {
    scale: 15.0,
    stretch: 2.1,
    coverage: 0.48,
    erosion: 0.6,
    billow: 0.5,
    opacity: 0.6,
    top: 0.03,
    fade: 0.06,
    bottom: 0.44,
  },
];

/**
 * HOW FAR THE FBM IS STRETCHED BEFORE IT IS READ AS A DENSITY.
 *
 * A four-octave fbm does not use its nominal range. Each octave is signed noise
 * averaging zero, so the sum concentrates hard around the middle: measured, this
 * one sits within about +/-0.3 of zero nearly all the time, which after the
 * usual *0.5+0.5 puts the field between 0.35 and 0.65.
 *
 * That is why the first version produced an empty sky. Coverage remaps the slice
 * ABOVE 1-coverage, and at coverage 0.44 that slice starts at 0.56 — the top
 * sliver of a distribution that barely reaches it, and then erosion subtracted
 * most of what did. The numbers all looked reasonable and the field was
 * essentially always zero.
 *
 * Scaling the signal before the offset spreads it back across the full 0..1, so
 * the coverage figure means what it says: roughly the top half of the field
 * becomes cloud at 0.5. It is a normalisation, not a gain.
 */
const FBM_SPREAD = 1.9;

/**
 * The cloud field is computed at a FRACTION of the sky's resolution and
 * bilinearly upsampled, and that is a correctness decision as much as a speed
 * one.
 *
 * Speed first: the density function is a four-octave fbm, a nine-cell Worley
 * lookup and a three-octave fbm, twice over — around forty noise evaluations per
 * sample. At 1024x512 that is twenty million, which is seconds of blocked main
 * thread in JavaScript. This project already has a whole build step
 * (scripts/bake-world.mjs) that exists because seventeen seconds of exactly that
 * made the site fail to load on phones, and adding a second helping of it here
 * would be repeating a mistake that is written up at length.
 *
 * And it costs little, because cloud has no high frequencies worth resolving:
 * the erosion term's finest detail is still several grid cells across at this
 * size, so the upsample is interpolating something already smooth. If anything
 * it helps — bilinear interpolation is a mild low-pass, and cloud edges want to
 * be soft.
 */
const FIELD_W = 320;
const FIELD_H = 160;

const buildCloudField = () => {
  const field = new Float32Array(FIELD_W * FIELD_H);

  for (let y = 0; y < FIELD_H; y += 1) {
    const v = y / (FIELD_H - 1);
    for (let x = 0; x < FIELD_W; x += 1) {
      const u = x / (FIELD_W - 1);
      let total = 0;

      for (let l = 0; l < LAYERS.length; l += 1) {
        const L = LAYERS[l];

        /* The band this layer lives in, faded at both ends so no layer has an
           edge of its own. Cloud at the very top of frame has nothing above it
           and reads as a smudge on the lens; cloud at the horizon competes with
           the mountains for the same rows of pixels and muddles the skyline. */
        const band =
          smoothstep(L.top, L.top + L.fade, v) *
          (1 - smoothstep(L.bottom - 0.14, L.bottom, v));
        if (band <= 0.001) continue;

        const sx = u * L.scale + l * 31.7;
        const sy = v * L.scale * L.stretch - l * 17.3;

        /* Base shape: Perlin fbm for the mass, inverted Worley for the billow. */
        const shape = clamp01(fbm(sx, sy, 4) * FBM_SPREAD * 0.5 + 0.5);
        const billow = 1 - worley(sx * 0.85, sy * 0.85);
        const base = shape * (1 - L.billow) + billow * L.billow;

        /* Coverage, as a remap of the top slice rather than a cut. */
        let d = remap(base, 1 - L.coverage, 1, 0, 1);
        if (d <= 0) continue;

        /* Detail erosion, weighted toward the thin parts so cores survive. */
        const detail = clamp01(fbm(sx * 3.1 + 41.2, sy * 3.1 - 9.4, 3) * FBM_SPREAD * 0.5 + 0.5);
        d = Math.max(0, d - detail * L.erosion * (1 - d));

        total += d * band * L.opacity;
      }

      field[y * FIELD_W + x] = clamp01(total);
    }
  }

  return field;
};

/** Bilinear read of the low-resolution cloud field. */
const sampleField = (field, u, v) => {
  const fx = clamp01(u) * (FIELD_W - 1);
  const fy = clamp01(v) * (FIELD_H - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(FIELD_W - 1, x0 + 1);
  const y1 = Math.min(FIELD_H - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;

  const a = field[y0 * FIELD_W + x0];
  const b = field[y0 * FIELD_W + x1];
  const c = field[y1 * FIELD_W + x0];
  const d = field[y1 * FIELD_W + x1];

  const top = a + (b - a) * tx;
  const bot = c + (d - c) * tx;
  return top + (bot - top) * ty;
};

/** The vertical ramp: zenith to mid-sky to horizon, eased toward the horizon. */
const skyRamp = (t) => {
  /*
   * Eased, not linear. A linear ramp puts its midpoint halfway up the frame and
   * reads as a painted backdrop; real haze is compressed into the last stretch
   * above the horizon, so most of the sky is close to the zenith colour and the
   * change happens quickly at the bottom.
   *
   * TWO SEGMENTS, because a two-colour ramp cannot bend. Deep blue straight to
   * white passes through a slab of flat mid-blue on the way, and the sky comes
   * out looking like a gradient tool was used on it. The extra stop at AZURE is
   * what gives it a shoulder.
   */
  /*
   * EXPONENT 3.4, UP FROM 1.7, AND IT IS A FRAMING CONSTRAINT RATHER THAN A
   * TASTE ONE.
   *
   * The note above is right that haze is compressed into the last stretch
   * above the horizon. What it did not account for is how little of the sky
   * this shot actually contains: the lens is 42 degrees vertically and pitched
   * down, so the top of frame sits about 15 degrees above the horizon and
   * EVERY sky pixel in the picture comes from t > 0.83.
   *
   * At 1.7 that whole strip evaluates past the shoulder and lands in the
   * AZURE-to-HAZE half — measured, the top row of frame came out (170, 204,
   * 233), a pale blue-white. So the sky was correct as a sky and the visible
   * fifteen degrees of it were all haze, which is why the frame read as
   * overcast while the texture was demonstrably blue.
   *
   * At 3.4 the same t = 0.867 lands at k = 0.63, barely past the shoulder, so
   * the strip the camera can see holds close to AZURE and the wash is squeezed
   * into the last few degrees where the ridges are anyway. The sky above the
   * frame is unchanged in kind — it is the same three stops in the same order,
   * just reached later.
   */
  const k = Math.pow(t, 3.4);
  if (k < 0.55) {
    const u = k / 0.55;
    return ZENITH.map((z, i) => z + (AZURE[i] - z) * u);
  }
  const u = (k - 0.55) / 0.45;
  return AZURE.map((a, i) => a + (HAZE[i] - a) * u);
};

/** Cloud is lit, not emissive: its brightest is an off-white, not paper. */
const CLOUD_WHITE = [252, 253, 255];

export default function Sky() {
  const { scene } = useThree();

  const texture = useMemo(() => {
    const W = 1024;
    const H = 512;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(W, H);

    const clouds = buildCloudField();

    /*
     * THE VERTICAL IS HORIZON-RELATIVE NOW, BECAUSE THIS IS A SPHERE.
     *
     * The texture used to be a screen fill — three renders a plain-mapped
     * background as a viewport quad — so its full height was the full height of
     * the frame and the ramp could run zenith-to-haze across all of it. As an
     * equirectangular map (see the mapping below) the same image is wrapped
     * around the camera instead, and the middle row is no longer the middle of
     * the picture: it is the HORIZON. The bottom half is everything below eye
     * level, which the terrain covers.
     *
     * So the ramp, the sun and the clouds are all evaluated against vSky, which
     * runs 0 at the zenith to 1 at the horizon and then holds. Left on the raw
     * v, the pale haze stop would have landed at the nadir — under the ground,
     * where nobody can see it — and the sky would have met the ridges as flat
     * mid-blue with no haze band at all, which is the one thing this file's
     * whole opening note is about not doing.
     */
    for (let y = 0; y < H; y += 1) {
      const v = Math.min(1, y / (H - 1) / 0.5);
      const base = skyRamp(v);

      for (let x = 0; x < W; x += 1) {
        const u = x / (W - 1);
        const i = (y * W + x) * 4;

        const c = [base[0], base[1], base[2]];

        /*
         * THE SUN'S GLOW, and it is drawn as a broad bloom rather than a disc.
         * A hard disc in a background texture is a sticker: it has no scatter
         * around it, so nothing in the image agrees that there is a light
         * there. What sells it is the wash — the sky going pale over a wide
         * angle, brightest at the centre and falling off slowly.
         *
         * The distance is measured with x scaled down, so the bloom is wider
         * than it is tall. That is what atmosphere does to a low sun, and it
         * also keeps the glow from running off the top of the frame.
         */
        /*
         * WIDER AND HARDER-CENTRED, from radius 0.62 with an exponent of 2.4.
         *
         * The reference's sun is a BLOWOUT: a core that has gone completely to
         * paper, wrapped in a wash that carries most of the way down the right
         * side of the frame and washes the ridge in front of it. One curve
         * cannot be both — a single power falls off at one rate, so tuning it
         * to reach that far leaves the middle grey, and tuning the middle
         * leaves it a small bright spot with nothing around it.
         *
         * So it is two: a broad low-exponent wash that carries the reach, and a
         * tight high-exponent core on top of it that saturates. That is also
         * physically what is being drawn — forward-scattered light through a
         * lot of atmosphere, plus the disc itself.
         */
        /*
         * THE DISTANCE IS MEASURED IN DEGREES, AND UNTIL NOW IT WAS NOT.
         *
         * This was written when the sky was a SCREEN FILL — three draws a
         * plain-mapped background as a viewport quad — so u and v both ran
         * across the frame and treating them as one flat space was right. As an
         * equirectangular map they are a bearing over 360 degrees and an
         * elevation over 90, so one unit of u is four times the angle of one
         * unit of v, and a radius quoted in mixed units means nothing.
         *
         * Measured, the old radius of 0.66 in that mixed space reached 384
         * degrees horizontally — more than all the way round the sky — against
         * 119 vertically. The result was not a sun with a glow: it was a wash
         * over the whole upper hemisphere, brightest along a band rather than
         * at a point, which is exactly what the render showed. It also erased
         * the blue the ramp had just been retuned to hold.
         *
         * Converting both axes to degrees first makes the radii mean what they
         * say. The horizontal is then divided by 1.35 rather than left equal,
         * which is the ONE piece of the old anisotropy that was correct and
         * deliberate: atmosphere spreads a low sun sideways, so the glow really
         * is wider than it is tall — just by a third, not by a factor of four.
         */
        let du = u - SUN[0];
        /* Shortest way round the sphere: at a bearing near the seam the naive
           difference is nearly 1, which would put the sun 360 degrees away. */
        du -= Math.round(du);
        const dh = (du * 360) / 1.35;
        const dv = (v - SUN[1]) * 90;
        const d = Math.sqrt(dh * dh + dv * dv);

        /*
         * A BROAD WASH PLUS A TIGHT CORE, in degrees. The reference's sun is a
         * blowout: a centre gone completely to paper inside a glare that
         * carries a good forty degrees. One curve cannot be both — tuned to
         * reach that far it leaves the middle grey, tuned for the middle it is
         * a bright dot with nothing around it — so it is two, which is also
         * physically what is there: forward scatter through a lot of air, and
         * the disc.
         */
        const wash = Math.pow(Math.max(0, 1 - d / 46), 2.1) * 0.66;
        const core = Math.pow(Math.max(0, 1 - d / 13), 2.4);
        const glow = Math.min(1, wash + core);

        const cloud = sampleField(clouds, u, v);

        /*
         * CLOUD IS NOT PURE WHITE, and this is what stops it looking like paper
         * laid on the sky. Even the lit part of a cloud is scattering rather
         * than emitting, and its thin parts go toward the sky colour because
         * that is literally what is being seen through them.
         *
         * The white is reached with cloud^0.7 rather than linearly, so the
         * dense cores get most of it and the fraying margins stay translucent.
         */
        const lit = Math.pow(cloud, 0.7);
        for (let k = 0; k < 3; k += 1) {
          c[k] += (CLOUD_WHITE[k] - c[k]) * lit * 0.95;
        }

        /*
         * Glow AFTER cloud, so the streaks near the sun are washed by it rather
         * than sitting flatly on top. Real cloud close to the sun is the
         * brightest thing in the sky; cloud composited last would be the same
         * white everywhere and would read as cut-outs.
         */
        for (let k = 0; k < 3; k += 1) {
          c[k] += (255 - c[k]) * glow * 0.92;
        }

        const jitter = (((y + x) & 1) - 0.5) * 1.2;
        image.data[i] = Math.min(255, Math.max(0, c[0] + jitter));
        image.data[i + 1] = Math.min(255, Math.max(0, c[1] + jitter));
        image.data[i + 2] = Math.min(255, Math.max(0, c[2] + jitter));
        image.data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);

    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    /*
     * EQUIRECTANGULAR, WHICH IS WHAT PINS THE SKY TO THE HILLS.
     *
     * A plain-mapped background is drawn by three as a quad in screen space. It
     * is not in the world, so it does not turn when the camera does: pan the
     * lens and the ridges sweep across a sky that stays exactly where it was,
     * which reads as the mountains sliding along in front of a painted wall.
     * With the pointer now turning the camera rather than translating it (see
     * CameraRig) that is the whole of the movement, so it was the whole of the
     * problem.
     *
     * With this mapping the same image is wrapped on a sphere around the camera
     * and sampled by view DIRECTION, so the sun, the clouds and the horizon are
     * fixed to bearings the way the landscape is. Turn the lens and everything
     * in the frame moves together.
     */
    t.mapping = EquirectangularReflectionMapping;
    /* Row 0 is the zenith, and a background texture's V runs bottom-up. */
    t.flipY = true;
    t.minFilter = LinearFilter;
    t.magFilter = LinearFilter;
    t.generateMipmaps = false;
    return t;
  }, []);

  useLayoutEffect(() => {
    scene.background = texture;
    return () => {
      scene.background = null;
    };
  }, [scene, texture]);

  useLayoutEffect(() => () => texture.dispose(), [texture]);

  return null;
}

/**
 * The same sky, as an equirectangular environment map.
 *
 * THIS IS WHAT MAKES THE ICE SHINE. A roughness map only shows where there is
 * something to reflect, and until now the environment was four dim Lightformer
 * planes — so the glossy hollows in the ice had almost nothing to catch and the
 * whole roughness map was doing invisible work.
 *
 * NOT A DOWNLOADED HDRI, deliberately. The usual answer is an equirect probe
 * from a CDN: a hundred-odd megabytes of someone else's photograph, an external
 * request on every load, and a hard dependency on a third-party host staying
 * up. Generating it costs a 256x128 canvas and gives the same image-based
 * lighting, with every value ours to art-direct.
 *
 * IT HAS TO CARRY THE BLUE. This is where snow gets its colour from — a white
 * surface returns what is above it, and under a blue sky that is blue in the
 * shadows and white where the sun reaches. Leaving this grey while the
 * background went blue would give a scene whose sky and whose shading disagree,
 * which is the specific wrongness of a composite.
 *
 * NO CLOUD IN IT, deliberately. Cloud in an environment map contributes almost
 * nothing — it is convolved into a low-order irradiance before anything reads
 * it, so a few bright streaks average away to a fractionally lighter sky — and
 * the cost of generating it would be paid on every load for that. What the
 * lighting needs from the sky is its gradient and its sun, and both are here.
 *
 * THE LOWER HEMISPHERE IS BRIGHT, which is the part that is easy to get wrong.
 * Environment maps are usually authored dark below the horizon because most
 * ground is dark — but snow is the most reflective natural surface there is,
 * bouncing most of the light that lands on it straight back up. A dark lower
 * half would leave every downward-facing face of the igloo in a blackness that
 * simply does not happen in a snowfield.
 */
export function makeWinterSkyEnv() {
  const W = 256;
  const H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);

  /* Bounce off the snow: bright, faintly cool, and flat, because a field
     scatters without a direction. Raised with the snow's own albedo — this is
     the light that snow returns, so if the ground goes white this has to. */
  const GROUND = [0xd2, 0xd8, 0xe2];
  /* Where the sun sits on the sphere. */
  /*
   * SAME SUN AS THE BACKGROUND'S, IN THIS FUNCTION'S OWN PARAMETERISATION.
   *
   * Here v runs 0 at the zenith to 1 at the NADIR over the full sphere, so the
   * sky occupies 0..0.5 and an elevation of e degrees is v = ( 1 - e/90 ) / 2.
   * At 18 degrees that is 0.40. u is the same bearing the background uses.
   *
   * They were [0.17, 0.3] against the background's [0.9, 0.09] — two different
   * bearings and two different elevations, so the glint on the ice came from
   * somewhere the sky had nothing in it.
   */
  const SUN_U = 0.3068;
  const SUN_V = 0.40;

  for (let y = 0; y < H; y += 1) {
    /* v: 0 at the zenith, 1 at the nadir. */
    const v = y / (H - 1);
    for (let x = 0; x < W; x += 1) {
      const u = x / (W - 1);
      let c;

      if (v < 0.5) {
        /* Sky: the same three-stop ramp the background uses. */
        c = skyRamp(v / 0.5);

        /* The sun's broad glow, in angular distance on the sphere. */
        /* In degrees, for the reason given on the background's glow: here v
           runs over the whole 180-degree sphere, so one unit of v is 180 and
           one unit of u is 360. Same 1.35 sideways stretch. */
        let du = u - SUN_U;
        du -= Math.round(du);
        const dh = (du * 360) / 1.35;
        const dv = (v - SUN_V) * 180;
        const d = Math.sqrt(dh * dh + dv * dv);
        const glow = Math.max(0, 1 - d / 42) ** 2;
        c = c.map((n) => n + glow * 95);
      } else {
        /* Ground bounce, fading a little toward the nadir. */
        const t = (v - 0.5) / 0.5;
        c = GROUND.map((g) => g * (1 - t * 0.22));
      }

      const o = (y * W + x) * 4;
      img.data[o] = Math.min(255, c[0]);
      img.data[o + 1] = Math.min(255, c[1]);
      img.data[o + 2] = Math.min(255, c[2]);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const t = new CanvasTexture(canvas);
  t.mapping = EquirectangularReflectionMapping;
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = false;
  return t;
}
