import { PlaneGeometry } from 'three';
import { makeNoise2D, makeFbm } from './noise.js';
import { createRng, erodeStep } from './erosion.js';

/**
 * The shape of the world — AND THE BACKGROUND, WHICH IS NOW THE SAME THING.
 *
 * This used to be a flat snow field standing in front of a photographic plate.
 * The plate is gone: a photograph can never be lit by our lights, never takes
 * the fog, and its horizon meets our ground in a seam that no amount of colour
 * matching fully hides. The reference image is one continuous piece of terrain
 * running from the drift under the igloo all the way to the peaks, graded only
 * by distance. So that is what this builds.
 *
 * THREE TERMS, EACH WITH A JOB.
 *
 *   drifts   Low, smooth, everywhere. The rolling snow of the near field.
 *   mound    A single broad swell centred under the igloo, so the hero object
 *            stands on a rise instead of on a table. In the reference this is
 *            the strongest read in the foreground.
 *   ridges   Ridged noise, amplitude ramping up with distance down -Z. These
 *            are the mountains, and they only exist far enough away that the
 *            fog has already turned them into flat silhouettes.
 *
 * NOTHING HIGH-FREQUENCY. The old surface carried a fine grain term, and fine
 * grain a few hundred units out is smaller than a pixel — which does not read
 * as detail, it reads as shimmer, because sub-pixel relief cannot be resolved
 * and simply aliases differently every frame. Every term here has a wavelength
 * of tens of units or more.
 */

const SEED = 20260824;

const noise = makeNoise2D(SEED);

/** Broad landform noise for the near-field drifts. */
const drift = makeFbm(noise, { octaves: 3, lacunarity: 2.0, persistence: 0.45 });
/** Separate octave stack for the mountains, so the two never correlate. */
const mountain = makeFbm(noise, { octaves: 3, lacunarity: 1.95, persistence: 0.42 });

/** The extent of the ground plane, in world units. */
export const TERRAIN_SIZE = 2600;

/** Where the hero object stands. The mound is built around it. */
/**
 * Where the hero object stands. The pad, the bank and the bowl are all built
 * around it, and Stage passes the same pair to <Igloo at=...> — they must match
 * or the structure seats itself on ground that was levelled somewhere else.
 */
export const MOUND_AT = [-30, 252];

/**
 * Where the mountains start and where they reach full height.
 *
 * Authored in world Z rather than as a distance from the camera, because the
 * camera is a fixed shot: the peaks need to sit behind the igloo in frame, and
 * "behind the igloo" is a place, not a radius.
 */
/*
 * TWO RANGES AT TWO DISTANCES, WHICH IS THE WHOLE POINT.
 *
 * One range, however tall, reads as a crust along the horizon — there is
 * nothing for it to be in front of. The reference gets its depth from planes:
 * a nearer range with visible shading and ridge detail, and a paler one behind
 * it that the haze has already flattened into a silhouette. Fog does the
 * grading for free, but only if there is genuinely something at two different
 * distances for it to grade.
 *
 * Authored in world Z rather than as a distance from the camera, because this
 * is a fixed shot: the peaks need to sit behind the igloo IN FRAME, and that is
 * a place, not a radius.
 */
/*
 * PUSHED WELL BEHIND THE PLACED HILLS, from -60/-760 and -420/-1450.
 *
 * The old MID band began at z = -60, which is in among the placed hills
 * themselves (they sit between -210 and -430), so switching it on would have
 * raised the middle ground rather than put anything behind it. These ranges
 * only do their job if there is a clear run of LOWER ground between them and
 * the hills in front — that gap is what the haze fills, and the filled gap is
 * what makes them read as distance rather than as more hill.
 *
 * Heights are solved from the frame rather than picked. The lens now sits at
 * y 60 with the top of frame 15.5 degrees above the horizon, so a summit 900
 * units out wanting to reach 10 degrees needs 159 units of height, and one at
 * 1500 wanting 13 needs 346. crest() peaks around 0.8 in practice, hence 210
 * and 430.
 */
const MID_NEAR = -500;
const MID_FAR = -1100;
const MID_HEIGHT = 210;

const FAR_NEAR = -900;
const FAR_FAR = -1550;
const FAR_HEIGHT = 430;

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Sample an fbm in a ROTATED, STRETCHED frame.
 *
 * THE ONE THING THE WHOLE LANDSCAPE WAS MISSING, and it is a property of the
 * sampling rather than of the noise.
 *
 * fbm is ISOTROPIC: its features have no preferred direction, so they come out
 * round. Every hill in this scene was built by sampling it on the plain world
 * axes, which is why the middle distance read as a field of similar circular
 * bumps — knobbly rather than drifted. No amount of amplitude, warping or
 * octave tuning fixes that, because roundness is not an artefact of the noise,
 * it is what the noise IS when you sample it evenly.
 *
 * Wind-formed snow is the opposite. It is the most directional landform there
 * is: the wind runs one way and everything it builds lies ACROSS that way, in
 * long parallel ridges with a shallow windward flank and a defined crest. The
 * reference is full of them — the whole foreground and middle distance is
 * transverse dunes receding in rows, and that directionality is most of why it
 * reads as an Arctic snowfield rather than as generic terrain.
 *
 * Dividing one axis of the sample position by `stretch` lowers the frequency
 * along it, so features come out that many times longer in that direction than
 * across it. The rotation is what keeps the ridges off the world axes — aligned
 * exactly with X they would read as a manufactured corduroy.
 *
 * Everything else about the terms that call this is unchanged; they simply see
 * a differently-shaped field.
 */
const anisotropic = (fbm, f, ox, oz, rot, stretch, px, pz) => {
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const ax = (px * cr + pz * sr) / stretch;
  const az = -px * sr + pz * cr;
  return fbm(ax * f + ox, az * f + oz);
};

/**
 * Ground height at a world position.
 *
 * Cheap enough to call per frame from the camera rig and per block from the
 * igloo, which is why it stays a function rather than a lookup into the mesh.
 */
function rawHeight(x, z) {
  /* Rolling snow. Long wavelength, modest amplitude — drifts, not hills. */
  /*
   * ONE TERM, NOT TWO — and dropping the second is what removes the waves.
   *
   * There used to be a `drift(x * 0.014, ...) * 1.6` ripple on top of the broad
   * dunes, added to give the near field some relief. Its wavelength is about 71
   * units, and under a key light that rakes in barely above the horizon every
   * one of those gentle undulations turns into a light band and a dark band.
   * Across the foreground that reads as corduroy running along the contours.
   *
   * It survived three wrong diagnoses — a UV tiling repeat, a slope blend, and
   * anisotropic filtering — because it looks like a texture artefact. The thing
   * that ruled the texture out is scale: the ground tile is 19 units across and
   * these bands are tens of units, and a pattern cannot be larger than its own
   * repeat. That left geometry, and this was the only geometry at that scale.
   */
  /*
   * AND NOW IT IS A DUNE FIELD RATHER THAN A LUMP FIELD — same fbm, same
   * frequency, sampled in a frame stretched 3.2 to 1.
   *
   * This is the term that carries the near ground, inside the radius where the
   * hummocks are ramped off, so it is the whole of what the foreground is made
   * of. Round it read as soft blisters; stretched it reads as the long shallow
   * snow ridges the reference has running across its lower half.
   *
   * The amplitude goes up a little with it. A ridge four times longer than it
   * is wide needs more height than a dome to show the same crest, because the
   * eye reads a dune by the shadow along its lee side and a shallower one has
   * a shorter shadow.
   *
   * FREQUENCY DOWN AS WELL, 0.0055 -> 0.0042, on a second look at the frame.
   * The first stretched pass gave the foreground direction and left it busy:
   * lots of short ridges rather than a few long ones. The reference's near
   * ground has perhaps three or four crests across the whole width of the
   * picture, each running most of it. Lengthening the wavelength to about 240
   * units is what gets that count down to something that reads as calm.
   */
  const drifts = anisotropic(drift, 0.0042, 0, 0, 0.28, 4.2, x, z) * 19;

  /*
   * SCULPTED DRIFTS — and yes, this is the term the note above deleted.
   *
   * Reinstating something a previous pass removed needs a reason, and there are
   * two. First, the measurement: the reference's foreground carries a p10-to-p90
   * luminance spread of 95 and ours, on ground this smooth, carries 23. Nearly
   * all of that difference is SHADING — its snow has faces turned toward the
   * low sun and faces turned away, ours is a single plane at a single angle, and
   * no amount of pigment or texture supplies the difference because the shape
   * is not there to be lit.
   *
   * Second, the diagnosis in that note is precise and it is not a diagnosis of
   * drifts. What was removed was `drift(x * 0.014, z * 0.014) * 1.6` — an
   * unwarped ripple with a 71-unit wavelength — and the failure was that under
   * a raking key every one of its regular undulations became a light band and a
   * dark band, reading as corduroy running along the contours. The problem was
   * the PERIODICITY, not the relief.
   *
   * So this one is domain-warped before it is sampled. The warp is nearly as
   * long as the drift wavelength itself, which stretches the field hard in some
   * places and compresses it in others, so no two swells are the same size and
   * there is no repeating interval for the eye to lock onto. It is the same
   * argument the mountains already make for their own warp, one scale down.
   */
  const dwx = drift(x * 0.0042 + 51.3, z * 0.0042 - 12.7) * 46;
  const dwz = drift(x * 0.0042 - 87.1, z * 0.0042 + 33.9) * 46;
  /*
   * CALMED, 0.019 / 3.6 -> 0.0125 / 2.2.
   *
   * At 0.019 its wavelength is about 53 units, which is the crinkle scale — big
   * enough to catch the raking key and throw a shadow, small enough that a
   * dozen of them cross a single dune flank. Against the long smooth ridges the
   * foreground is now built from, that read as wrinkling on an otherwise clean
   * surface. Lengthened and quietened it goes back to being what its own note
   * describes: a slow irregularity in the drifts rather than a texture on them.
   */
  const sculpt = drift((x + dwx) * 0.0125, (z + dwz) * 0.0125) * 2.2;

  /*
   * The swell under the igloo. A gaussian rather than more noise, because its
   * job is specific: put the hero object on the crest of something, with the
   * ground falling away on every side so the silhouette has air under it.
   */
  const dx = x - MOUND_AT[0];
  const dz = z - MOUND_AT[1];
  /*
   * 2.0 WAS NOT A SWELL, IT WAS A ROUNDING ERROR.
   *
   * The comment above says the ground should fall away on every side so the
   * silhouette has air under it, and at two units against a structure
   * twenty-eight units tall it simply did not — the igloo stood on flat ground
   * that happened to be two units proud of the flat ground beside it. The
   * reference puts it on a distinct knoll, high enough that the ground drops
   * out of frame in front of it and the dome breaks the skyline on its own.
   *
   * Sized against the object rather than picked: a shade over half the dome's
   * height, so the rise reads as a landform the igloo was placed ON rather than
   * a bump it happens to sit near. Sigma is unchanged — widening it as well
   * would turn the knoll into a hill and swallow the object.
   */
  /*
   * RAISED AGAIN, from 9.0. The note above is right about what the knoll is for
   * and still undersized it: against the reference the igloo sits on a rise
   * that drops away hard enough on both sides that you see sky under the
   * shoulders of the dome, and the ground in front of it falls out of frame.
   * At 9 units under a 29-unit structure the rise was still reading as a
   * gentle swell in a plain.
   */
  const mound = 16.0 * Math.exp(-(dx * dx + dz * dz) / (2 * 58 * 58));

  /* The sculpting is held off the pad so the igloo still stands on level
     ground — the drift banked against its wall is authored separately. */
  const sculpted = sculpt * smoothstep(20, 90, Math.hypot(dx, dz));

  /*
   * The mountains.
   *
   * RIDGED noise, not plain fbm: folding the signal about zero with 1-|n| turns
   * smooth blobs into sharp crests with V-shaped valleys, which is the entire
   * difference between hills and a mountain range. Squaring it afterwards keeps
   * the valleys wide and the peaks narrow, the way real ranges read in profile.
   */
  /*
   * RIDGED noise, not plain fbm: folding the signal about zero with 1-|n|
   * turns smooth blobs into sharp crests with V-shaped valleys, which is the
   * entire difference between hills and a mountain range. Squaring afterwards
   * keeps the valleys wide and the peaks narrow, the way real ranges read in
   * profile.
   */
  /*
   * SMOOTH DOMES, NOT RIDGES.
   *
   * This used to fold the noise about zero with 1-|n|, which is the standard
   * way to get mountains: it turns smooth blobs into sharp crests with V-shaped
   * valleys. It works, and it was wrong here — the reference is a SNOW
   * landscape, and deep snow does not hold a sharp edge. Every crest came out
   * as a knife edge and the range read as crumpled foil.
   *
   * Passing the noise through a smoothstep instead keeps the same large-scale
   * shapes and rounds every one of them, which is what wind-packed snow over
   * rock actually looks like. The octave counts came down at the same time:
   * each extra octave adds detail at half the wavelength, and it was those top
   * octaves that were putting the crinkle on the slopes.
   */
  /*
   * A DUNE BAND — dome() sampled anisotropically.
   *
   * Identical in every other respect: same shaping curve, same envelope that
   * stops every crest reaching the same height. The only difference is the
   * frame it reads the noise in, and that difference is the whole look.
   */
  const dune = (f, ox, oz, rot, stretch, px = x, pz = z) => {
    const n = anisotropic(mountain, f, ox, oz, rot, stretch, px, pz);
    const t = Math.min(1, Math.max(0, n * 0.5 + 0.5));
    const s2 = t * t * (3 - 2 * t);
    const env =
      0.45 + 0.55 * Math.abs(anisotropic(drift, f * 0.32, ox, -oz, rot, stretch, px, pz));
    return s2 * env;
  };

  const dome = (f, ox, oz, px = x, pz = z) => {
    const n = mountain(px * f + ox, pz * f + oz);
    const t = Math.min(1, Math.max(0, n * 0.5 + 0.5));
    const s2 = t * t * (3 - 2 * t);
    /* Amplitude-modulated so neighbouring summits differ; without this every
       peak reaches the same height and the skyline reads as a plateau. */
    const env = 0.45 + 0.55 * Math.abs(drift(px * f * 0.32 + ox, pz * f * 0.32 - oz));
    return s2 * env;
  };

  /*
   * DOMAIN WARPING, and it is the difference between noise and landscape.
   *
   * Everything above sums noise at several scales, which is the standard
   * recipe and has a standard tell: the shapes it makes are isotropic. Summits
   * are round, valleys are round, and nothing has a DIRECTION — no flank runs
   * one way for a while, no hollow reaches around behind a ridge. The eye
   * reads that as a generated field however many octaves are stacked on it.
   *
   * Warping displaces the coordinates the noise is READ AT by another noise
   * field, so the same sum gets stretched one way here and folded back there.
   * The forms stop being blobs and start having grain — the flowing,
   * asymmetric shapes the reference has everywhere in it.
   *
   * TWO SEPARATE OFFSETS. Driving x and z from one field displaces every point
   * along the same diagonal and the whole landscape shears rather than warps.
   * Independent fields let it genuinely swirl.
   *
   * The amplitude is a fraction of the dominant 625-unit wavelength. Push it
   * past about a third and the warp starts folding forms back through each
   * other, which reads as noise again — just messier noise.
   */
  /*
   * DOWN FROM 78. Less distortion.
   *
   * The note above is right that warping is what stops noise reading as noise,
   * and it is also possible to have too much of it: at 78 against a 625-unit
   * dominant wavelength the field was being pushed an eighth of a form sideways,
   * which smears the big masses into each other and costs them their outline.
   * The swirl was doing the work the ramp below now does better.
   *
   * At 44 the forms keep a direction without losing their edges.
   */
  const WARP = 44;
  const wx = x + drift(x * 0.0019 + 19.3, z * 0.0019 - 7.1) * WARP;
  const wz = z + drift(x * 0.0019 - 41.7, z * 0.0019 + 63.9) * WARP;

  /*
   * HUMMOCKS: the missing middle of the landscape.
   *
   * The terrain went straight from flat drifts to distant ranges with nothing
   * between them, so the near and middle ground read as an empty plain with
   * mountains pasted along the back. The reference has rounded hills at EVERY
   * distance — that is what builds the sense of depth, because overlapping
   * near forms against far ones is what the eye reads as space.
   *
   * Same smoothed-dome construction as the ranges, at a wavelength of about 90
   * units so each swell is a few times the igloo's width: whalebacks you could
   * walk over, not peaks.
   *
   * RAMPED AWAY FROM THE IGLOO. Inside 40 units the ground has to stay legible
   * for the structure to sit on — the pad blend handles the last 46 — so the
   * hummocks fade in beyond that and reach full height by 170.
   */
  /*
   * PUSHED OUT, from smoothstep(55, 250).
   *
   * Starting to lift at 55 units meant the hills began almost at the igloo's
   * doorstep and grew continuously outward, so there was no line anywhere
   * between the ground the structure stands on and the landform behind it —
   * the two were one surface at different heights, and the frame read as a
   * single slope with an igloo somewhere on it.
   *
   * Holding flat to 150 and reaching full height by 320 puts an unbroken run of
   * level snow in front, and the hills start beyond it. That gap is what makes
   * them read as separate things at separate distances rather than as more of
   * the same ground.
   */
  const hummockRamp = smoothstep(150, 320, Math.sqrt(dx * dx + dz * dz));

  /*
   * THREE SCALES, NOT ONE — because one wavelength can only make one size.
   *
   * This was a single dome() at 0.011, and the result was a field of identical
   * evenly spaced mounds: bubble wrap, not landscape. It is the same mistake as
   * the scattered pebbles, one scale up. A single frequency has a single
   * characteristic size and spacing, so everything it produces is a copy of
   * everything else.
   *
   * Real hills run from long ridges hundreds of units across down to swells you
   * could stand on, and the big ones swallow the small ones — a small hill on
   * the flank of a large one reads as a shoulder, not as another hill. Summing
   * scales an octave apart with the weight on the LOW end is what produces
   * that: 285-unit forms carrying 110-unit forms carrying 45-unit ones.
   *
   * The envelope is the other half. Without it hills cover the map uniformly,
   * which is its own kind of repetition — real ground has groups of hills and
   * open ground between them. A very slow noise gates whole regions in and out.
   */
  const hillEnv = 0.25 + 0.75 * smoothstep(0.3, 0.75, drift(x * 0.0016 + 55, z * 0.0016 - 31) * 0.5 + 0.5);

  /*
   * BIG AND SIMPLE, the way a child draws hills: one dominant hump sloping into
   * a hollow with another rising behind it.
   *
   * The previous mix topped out at a 285-unit wavelength, which at this camera
   * distance is a mound you look across rather than a hill you look AT. The
   * dominant form is now 625 units — wide enough that a single flank fills a
   * good part of the frame and the eye reads it as one landform instead of as
   * terrain detail.
   *
   * The smaller octaves are cut right back for the same reason. Their job is
   * only to stop the big humps being geometrically smooth; carry too much and
   * they break the silhouette that makes the shape legible.
   */
  /*
   * THE DOMINANT OCTAVE COMES DOWN, from 190, AND IT IS THE SKY THAT WANTS IT.
   *
   * This is the term that sets how high the background stands, and at 190 it
   * stood higher than the frame: the horizon ran from edge to edge somewhere in
   * the top eighth of the picture and what was left for sky was a strip. That
   * was survivable while the sky was a flat grey ramp with nothing in it. It is
   * not survivable now that the sky is the source of the light, carries the sun
   * and has cirrus in it — none of which can be seen through solid ground.
   *
   * AND IT IS WHAT WAS FLATTENING THE PEAK. A landform only reads as tall
   * against something lower; with the general ground at 190 and the placed
   * summit at 132 the mountain was BELOW its own surroundings, so no amount of
   * shaping it was ever going to make it read as a summit. At 118 the peak
   * stands clear of the field it sits in, which is the whole difference.
   *
   * The second octave comes down with it in proportion, so the relationship
   * between the two — big forms carrying smaller ones — is unchanged. The third
   * does NOT: it is the one that makes face angle rather than height (see its
   * own note), and the ground still needs its slopes.
   */
  /*
   * THE MIDDLE GROUND COMES DOWN, 118 / 34 / 20 -> 88 / 15 / 5.
   *
   * THIS IS THE CHANGE THAT MAKES THE MOUNTAINS BIG, and it is not a change to
   * the mountains. Measured off the frame, the background summits were already
   * reaching thirteen and a half degrees above the horizon — as high as they
   * have ever been — and the picture still read as rolling hills with a ridge
   * behind them. The reason is that the middle ground was rising to within a
   * hundred pixels of those summits, so the RELIEF between them was almost
   * nothing, and relief is what the eye measures a mountain by. Absolute height
   * in frame does not signify; the drop from the summit to the valley floor is
   * the whole of it.
   *
   * The brief asks for a scale hierarchy — rolling foreground, igloo and ridge,
   * then a huge range — and that hierarchy needs a FLOOR under the range for
   * the range to stand out of. So the two small octaves come down hard: they
   * were putting mound-sized lumps across the whole middle distance, which both
   * filled the valley and gave the eye a repeating unit to read the scale by.
   *
   * The large octave keeps most of its amplitude, because that is the broad
   * swell the igloo's own ridge belongs to and it should stay.
   */
  const hummocks =
    /*
     * TWO CROSSING DUNE BANDS, replacing two isotropic dome octaves.
     *
     * They are at different rotations on purpose — 0.24 and -0.38 radians, so
     * roughly 35 degrees apart. A single band, however well stretched, is a
     * corduroy: parallel ridges of one size marching across the frame. Two at
     * an angle interfere, and the interference is what produces the real thing
     * — ridges that run for a while, merge, fork, and die out into a flat, with
     * hollows of different sizes between them.
     *
     * The second band is also nearly twice the amplitude the isotropic octave
     * it replaces had. That octave was cut to 15 because at 220 units across it
     * was putting mound-sized lumps everywhere; stretched, the same energy goes
     * into the LENGTH of a ridge instead of into its diameter, so it builds
     * form rather than clutter and can carry more.
     */
    (dune(0.0016, 7.3, -21.5, 0.24, 4.4, wx, wz) * 88 +
      dune(0.0052, 61.7, 13.1, -0.38, 3.2, wx, wz) * 20 +
      /*
       * THE OCTAVE THAT ACTUALLY MAKES ANGLE, up from 8.
       *
       * Slope is amplitude over wavelength, so the two big octaves cannot
       * supply it however tall they get — raising a 625-unit form from 132 to
       * 200 units makes a bigger hill at the same grade. At 83 units across,
       * this one converts amplitude into face angle roughly eight times as
       * efficiently.
       *
       * The note above warns that the small octaves break the silhouette if
       * they carry too much, and that is still true — this is why it stops at
       * 24 rather than going further. Measured, it moves the median normal
       * from 0.90 to the mid 0.8s and roughly doubles the share of ground
       * inside the rock window, which is what was wanted, without the big
       * forms losing their outline.
       */
      /*
       * UP FROM 24, NOW THAT THE BIG OCTAVE HAS COME DOWN.
       *
       * The note above stopped at 24 because more of it broke the silhouette of
       * the 625-unit forms it was sitting on. Those forms are 38% shorter now,
       * so the ratio this has to respect has changed and there is room.
       *
       * IT IS ALSO WHAT MAKES ROCK POSSIBLE. The exposed-stone term in the
       * shader is gated on slope, and the landscape simply did not have any:
       * measured, the mid-ground hills sat at fifteen to twenty degrees, and
       * this is the only octave that converts amplitude into angle efficiently
       * enough to change that. Asking for visible rock on a rounded snow dome is
       * asking for rock where there is no face to hold it.
       */
      /*
       * DOWN TO 20, from 42.
       *
       * Its note is right that this is the octave that converts amplitude into
       * face angle rather than into skyline, and that is why it was raised. The
       * cost, which that note did not have to pay when the terracing was also
       * carrying edges, is that at 83 units across it puts a lump roughly the
       * size of the igloo's mound on every part of every hill — and a hillside
       * covered in mound-sized lumps is the "dumped" reading. The reference has
       * nothing at this scale in its mid ground at all: it goes straight from
       * the big dune forms to the fine wind texture on them.
       *
       * The angle it was supplying is now supplied by the placed peak's steeper
       * profile and its stronger spurs, which make it where a mountain actually
       * has it instead of everywhere.
       */
      /* The one term left isotropic, and deliberately: it is surface grain
         rather than landform, and grain has no direction. */
      dome(0.012, 5.2, 44.8) * 4) *
    hillEnv *
    hummockRamp;

  /*
   * PLACED HILLS, not noise.
   *
   * The noise hills land wherever the seed puts them, which is fine for filler
   * and useless when a specific shape is wanted in a specific part of frame.
   * These two are positioned by hand: a large one on the LEFT whose flank runs
   * down to the right into a hollow, and a second rising behind it on the
   * right — the composition in the sketch.
   *
   * POSITIONS ARE SET BY FRAME ANGLE, not by eye. A hill close to the camera
   * needs only a small lateral offset to leave the frame: the first attempt sat
   * at x=-235, z=150, which is 51 degrees off centre against a horizontal
   * half-angle of 43 — completely out of shot. Both are now placed further down
   * -Z so the same lateral spread lands nearer the middle of the picture.
   *
   * cos^2 falloff rather than a gaussian: it reaches exactly zero at the radius
   * with zero slope, so the hill meets the surrounding ground without a seam
   * and without the long faint skirt a gaussian leaves behind.
   */
  const placedHill = (cx, cz, radius, height) => {
    const px = x - cx;
    const pz = z - cz;
    const d = Math.sqrt(px * px + pz * pz) / radius;
    if (d >= 1) return 0;
    const c = Math.cos((Math.PI / 2) * d);
    return height * c * c;
  };

  /*
   * placedPeak USED TO LIVE HERE, AND massif() BELOW IS WHAT REPLACED IT.
   *
   * It was a cos-to-a-power profile modulated by polar harmonics about its own
   * centre — the idea being that what makes a mountain legible at a distance is
   * its SPURS, the ridges running down from the summit and the gullies between
   * them, and that noise cannot produce them because noise has no idea where
   * the summit is. That reasoning is correct and it is carried forward intact:
   * massif() computes exactly the same angular term.
   *
   * What it could not do was be anything other than sharp. Its exponent and
   * spur amplitude were fixed at values chosen to make one dramatic peak, so
   * every caller got that peak, and a landscape built from one shape is the
   * sawtooth problem no matter how the shapes are arranged. massif() takes the
   * same construction and puts a roundness on it, which is what lets a range be
   * mostly broad masses with a few sharp ones in it.
   */

  /*
   * A MASSIF — placedPeak's structure at RANGE scale, plus the three things
   * that separate a mountain from a big cone.
   *
   * WHY NOT JUST TURN UP THE RIDGED NOISE. That is what the background used to
   * be (see the crest() note below, which is kept because it was right about
   * the version it describes) and it produced the one failure the brief names
   * explicitly: repeated cones. Ridged fbm has no idea where a summit is, so
   * every local maximum of the field becomes an identical spike and the skyline
   * comes out as a row of them. Large forms have to be AUTHORED; noise is only
   * good for the irregularity laid on top of them.
   *
   * So the order here is the one the brief asks for: build the mass, then break
   * it up.
   *
   *   1. MASS      an elliptical, rotated footprint with a broad foot. Rotation
   *                and aspect are what stop nine of these reading as nine of
   *                the same object seen from different distances.
   *   2. LEAN      the summit is displaced off the centre of the footprint, so
   *                one flank is long and shallow and the other is short and
   *                steep. Real peaks are never in the middle of their own base,
   *                and a symmetric one announces itself instantly.
   *   3. SPURS     the same polar harmonics placedPeak uses, for the ridges
   *                that converge on the summit. This is the term that makes a
   *                distant silhouette readable as a mountain.
   *   4. CREST     a raised line along the massif's long axis, so the top is an
   *                ARETE rather than a point — the difference between an alpine
   *                ridge and a volcano.
   *   5. CARVE     ridged noise evaluated in the massif's OWN frame, at a
   *                wavelength derived from its radius. Because the frequency
   *                scales with the object, a 900-unit massif gets nine-hundred-
   *                unit valleys rather than the same grain as a 400-unit one,
   *                which is most of what sells the size difference between the
   *                layers.
   *
   * Terms 3 to 5 are all multiplied by flank(), which is zero at the summit and
   * zero at the foot. At the summit because spurs that still have amplitude at
   * r=0 tear the peak into separate points; at the foot because a ridge that
   * reaches the base leaves a scalloped outline where the mountain meets the
   * ground instead of a clean skirt.
   */
  const massif = (cx, cz, radius, height, seed, opts) => {
    const aspect = (opts && opts.aspect) || 1.0;
    const rot = (opts && opts.rot) || 0;
    const lean = (opts && opts.lean) || 0;
    const carveAmt = opts && opts.carve !== undefined ? opts.carve : 0.34;
    const spurAmt = opts && opts.spur !== undefined ? opts.spur : 0.30;
    /*
     * ROUNDNESS: 0 is a sharp alpine peak, 1 is a broad snow dome.
     *
     * THE ONE CONTROL THE FIRST VERSION OF THIS FILE WAS MISSING, and its
     * absence is what produced the skyline the brief rejects. Every massif was
     * built from one recipe — the same profile exponent, the same spur
     * amplitude, the same carving — so eleven of them in a row came out as
     * eleven versions of the same sharp object, and a row of sharp objects at
     * similar heights is a sawtooth however carefully each one is placed.
     *
     * Realistic ranges are not made of one landform. They are mostly enormous
     * rounded masses, with a minority of ridged ones and only the occasional
     * genuine spire, and the brief puts numbers on that: roughly 70 / 20 / 10.
     * That mix is impossible to express as placement alone; it has to be a
     * property of the generator, which is what this is.
     *
     * It drives four things at once, because "rounded" is not one parameter:
     *
     *   profile   a LOWER exponent. cos^p reaches the foot with zero gradient
     *             at any p, so the exponent is not about the seam — it is about
     *             where the mass sits. A high p pulls mass under the summit and
     *             straightens the flank into a cone; a low one spreads it out
     *             into a shoulder, which is what makes a mountain read as
     *             enormous rather than as tall.
     *   spurs     damped, so the radial ridges become broad buttresses rather
     *             than fins.
     *   crest     damped hardest. An arete is the one feature that is purely
     *             sharp; a rounded summit should barely have one.
     *   carve     damped, so the ridged noise scallops the flank instead of
     *             cutting notches through the outline.
     */
    const round = opts && opts.round !== undefined ? opts.round : 0.0;

    const gx = x - cx;
    const gz = z - cz;

    /* Into the massif's own frame. */
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    const lx = (gx * cr + gz * sr) - lean * radius;
    const lz = (-gx * sr + gz * cr) * aspect;

    const r = Math.sqrt(lx * lx + lz * lz);
    if (r >= radius) return 0;

    const u = r / radius;
    const theta = Math.atan2(lz, lx);

    /*
     * Broad-based, cos-to-a-power like placedPeak — but a LOWER power than its
     * 2.7. That value concentrates mass under the summit to make a sharp peak,
     * and a range does not want that: what reads as a big mountain is a wide
     * shoulder carrying a long flank, not a spike. It still lands at the foot
     * with zero gradient, so there is no ring seam.
     */
    const c = Math.cos((Math.PI / 2) * u);
    const profile = Math.pow(c, 2.4 - 1.25 * round);

    const flank = Math.sin(Math.PI * u);

    /*
     * THE CROWN GUARD, AND IT IS WHAT ACTUALLY ROUNDS A SUMMIT.
     *
     * flank() is zero at the summit, which sounds as though it already protects
     * the crown — but it is a sine, so it is up to 0.45 by a seventh of the way
     * down, and at that radius on a 900-unit massif that is still a hundred and
     * thirty units of summit region getting the full spur and carve treatment.
     * That is exactly where the serration in the old skyline was coming from:
     * not the flanks, which looked fine, but the top of every mountain being
     * chewed into three or four competing points.
     *
     * This holds every modulator off the top of the form entirely and fades
     * them in below the shoulder. The result is a summit that is pure profile —
     * a smooth dome or a clean point depending on the exponent — with the
     * structure appearing where a real mountain has it, on the flanks.
     */
    const crown = smoothstep(0.09, 0.40 + 0.18 * round, u);
    const mod = flank * crown;

    /* Incommensurate harmonics, so the sum never repeats around the circle. */
    const spur =
      Math.cos(theta * 4 + seed) +
      0.58 * Math.cos(theta * 7 - seed * 1.7) +
      0.31 * Math.cos(theta * 11 + seed * 0.6);

    /* The arete: highest along the long axis, falling away to either side. */
    const crestLine = Math.pow(Math.abs(Math.cos(theta)), 2.2);

    /*
     * Ridged fbm in local coordinates. Frequency is 2.4 wavelengths across the
     * radius at the coarse octave, so the biggest carved valley is about a
     * third of the mountain — the scale a real cirque sits at.
     */
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = 2.4 / radius;
    for (let i = 0; i < 3; i += 1) {
      const n = 1 - Math.abs(mountain(lx * f + seed * 17.3 * (i + 1), lz * f - seed * 9.1 * (i + 1)));
      sum += n * n * amp;
      norm += amp;
      amp *= 0.44;
      f *= 2.19;
    }
    /* Centred on zero so it both raises ridges and CUTS valleys. A carve that
       only adds turns the massif into a lumpier massif; one that subtracts is
       what puts cols and hanging valleys into the silhouette. */
    const carve = (sum / norm - 0.52) * 1.9;

    const shape =
      profile *
      (1 +
        spur * spurAmt * (1 - 0.62 * round) * mod +
        crestLine * 0.20 * (1 - 0.78 * round) * mod +
        carve * carveAmt * (1 - 0.55 * round) * mod);

    return shape > 0 ? height * shape : 0;
  };

  /*
   * THE BOWL, AND IT IS DELIBERATELY NOT A COMPLETE ONE.
   *
   * A full ring around the igloo would wall it in — from a fixed camera the
   * near arc of that ring sits directly between lens and subject and hides the
   * base. The reference has the structure sitting in a hollow whose rim rises
   * behind and to the sides and falls away at the front, so you look over the
   * open lip into it.
   *
   * So the rim's height is modulated by ANGLE about the igloo: full strength
   * away from the camera, tapering to nothing across the ~130 degrees facing
   * it. cos of the half-angle to the camera direction, clamped and raised to a
   * power to keep the opening wide and the back solid.
   */
  const bowlRim = (() => {
    const bx = x - MOUND_AT[0];
    const bz = z - MOUND_AT[1];
    const d = Math.sqrt(bx * bx + bz * bz);
    if (d < 34 || d > 130) return 0;

    /* Radial profile: rises from the inner edge, crests, falls away. */
    const t2 = (d - 34) / (130 - 34);
    const radial = Math.sin(Math.PI * t2);

    /* Angular gate. +Z is toward the camera, so face away from it. */
    const facing = bz / (d || 1);
    const open = Math.max(0, facing * 0.5 + 0.5);
    const gate = Math.pow(1 - open, 1.6);

    return radial * gate * 21;
  })();

  const hills =
    /*
     * THE DOMINANT HILL, sized off the drawn line rather than by eye.
     *
     * The annotation puts its summit about a fifth of the way across frame and
     * runs its right flank down to roughly three fifths. Converted to camera
     * angles that is a peak at -26 degrees and a foot at +9.5, and at this
     * depth (562 units out) that solves to a centre at x=-256 with a radius of
     * 366. The left flank then lands at -49 degrees, past the -43 frame edge,
     * which is what makes the hill run off the side of the picture instead of
     * sitting inside it as a lump.
     */
    /*
     * THE ONE BEHIND THE IGLOO IS A PEAK NOW, not a hill — see placedPeak.
     * Same centre and same radius, so the composition the note above solved for
     * is untouched: the summit still sits a fifth of the way across frame and
     * the left flank still runs off the edge of the picture.
     *
     * Height up from 112. A dome and a peak of the same height do not read as
     * the same size — the dome's mass is spread over its whole footprint while
     * the peak concentrates it toward the summit, so converting one to the
     * other loses apparent scale unless the height goes up to compensate.
     */
    /*
     * THE PRIMARY MOUNTAIN, AND IT IS A BROAD MASS NOW RATHER THAN A PEAK.
     *
     * This slot has always been the dominant form in the frame — the note above
     * records its centre and radius being solved off the composition, and both
     * are kept within a few units. What changed is its CHARACTER. It was a
     * placedPeak: profile exponent 2.7, spurs at 0.34, mass concentrated under
     * the summit. That is the recipe for a spire, and at this size it read as a
     * dramatic fantasy peak rather than as an Arctic mountain.
     *
     * The reference's dominant mass is the opposite kind of object: a huge
     * rounded snow-covered dome with one long shallow flank and one short steep
     * one, larger than everything around it and conspicuously SOFTER. That is
     * what makes it read as a landform of enormous size — a sharp summit gives
     * the eye a scale reference and a rounded one does not, so the rounded one
     * always reads bigger at the same height.
     *
     * So: massif at round 0.92, which is nearly the top of the range, with the
     * spurs and carving pulled right down under it. Radius up from 366 to 430
     * and height from 132 to 168, because a broad form needs both to keep the
     * presence the sharp one had.
     *
     * THE RADIUS IS BOUNDED BY THE IGLOO, not by taste. The structure stands at
     * (-30, 252), which is 541 units from this centre; anything past that and
     * the mountain starts lifting the ground the igloo is seated on.
     */
    /*
     * PUSHED BACK AND WIDENED rather than made taller: z -235 -> -320, radius
     * 430 -> 470, height 168 -> 134.
     *
     * At its first placement this filled the top of the frame on its own and
     * left the authored ranges with nowhere to be seen, so the picture had one
     * mountain in it and no distance. A near object subtends a large angle for
     * very little height, and that is the wrong way to buy scale — it makes the
     * mountain big IN FRAME while making the world look small, because there is
     * nothing behind it to be far away.
     *
     * Moving it back eighty-five units and spreading it wider keeps the same
     * mass and the same broad rounded read, drops the angle it subtends, and
     * opens the sky it was covering for layers B and C. Still bounded by the
     * igloo at (-30, 252): the centre is now 619 units away against a radius of
     * 470.
     */
    /*
     * DEMOTED TO A SHOULDER, and the primary mountain moves back to layer A.
     *
     * This slot is 740 units from the lens, which is near enough that whatever
     * stands in it fills the middle of the frame regardless of its height — and
     * with the mid-ground floor lowered it did exactly that: one white dome
     * across the centre of the picture, with the actual ranges pushed out to
     * the two edges and a valley that went nowhere.
     *
     * A dominant mountain has to be far enough away to have things in front of
     * it and beside it. This one cannot be, so it stops trying: 104 units and
     * pushed left, where it reads as the near shoulder the eye crosses on the
     * way back to the range. The primary mass is now A1, at twice the distance.
     */
    massif(-380, -300, 430, 104, 1.7, {
      aspect: 1.14,
      rot: 0.42,
      lean: 0.20,
      round: 0.92,
      spur: 0.26,
      carve: 0.2,
    }) +
    /*
     * RIGHT, further back — rises behind the valley and overlaps it.
     *
     * LOWERED FROM 126, TO GIVE THE SKY BACK. The background was a continuous
     * wall of hill from edge to edge with about eight per cent of the frame
     * left over for sky, and a landscape with no sky in it has no scale: there
     * is nothing above the horizon for the horizon to be measured against, and
     * the clouds and the sun the sky now carries had nowhere to be seen.
     *
     * It also costs the peak its dominance. A mountain reads as a mountain
     * because it is taller than what is beside it, so a neighbour at nearly the
     * same height turns both into ridges. Dropping this by a quarter is what
     * makes the one behind the igloo read as THE summit.
     */
    /*
     * A MASSIF NOW, NOT A DOME — and the composition it was solved for is kept.
     *
     * The note above is the record of this being lowered to give the sky back,
     * and that is still what its height is doing. What changed is that it is
     * the whole right-hand third of the frame, and a cos-squared dome at that
     * size is a single unbroken white surface with one outline: it read as a
     * drift the size of a mountain, and it blocked every plane of the new
     * background behind it with nothing of its own to look at.
     *
     * Run through massif() it gets spurs, a lean and carved valleys, so it has
     * slopes steep enough for the alpine rule in the shader to break rock out
     * of — which is what the reference has on that side of frame. Same centre
     * within a few units, same order of height, so the skyline it sets across
     * the right of the picture is where it was.
     */
    massif(400, -172, 336, 108, 3.3, { aspect: 1.22, rot: -0.55, lean: 0.24, round: 0.86, spur: 0.2, carve: 0.16 }) +

    /*
     * HALF-SIZE HILLS FILLING THE MIDDLE.
     *
     * The two big hills left a bare gap straight down the centre of frame, and
     * a gap with nothing in it reads as a hole rather than as distance. These
     * are roughly half their radius and half their height, set further back so
     * they show THROUGH the gap — a third plane between the big pair and the
     * horizon.
     */
    /*
     * LOWERED WITH THE BIG PAIR, from 56 / 62 / 48. Same reason: these sit
     * between the two large forms and along the skyline, so their height is
     * what the horizon line actually is across the middle of frame. They keep
     * their job — filling the gap so it does not read as a hole — at three
     * quarters of the height.
     */
    placedHill(30, -330, 150, 24) +
    placedHill(-105, -430, 165, 27) +
    placedHill(175, -390, 140, 20) +

    /*
     * THE RIGHT-HAND BAND, WHICH WAS THE LAST BARE PIECE OF THE PICTURE.
     *
     * Between the igloo's rise and the foot of the right massif there was a
     * run of ground sitting at about fifteen units and nothing on it — the
     * drifts alone, which at that distance grade into a single smooth sheet.
     * It read as a gap in the middle distance on that side, the same failure
     * the three fillers above were added to fix in the centre of frame.
     *
     * SOLVED FROM THE FRAME, like the rest. The lens is at (12.8, 60, 422)
     * aimed at (-24.4, 42.8, 250), which puts its axis 12.2 degrees left of
     * -Z; the middle of the bare band is 22.8 degrees right of that axis, and
     * at a depth of z = -90 that lands the centre at x = 109. Its summit comes
     * out 42% down the frame — BELOW the skyline the three fillers set at 36%,
     * which is the point: it has to read as a nearer plane crossing in front
     * of them, not as another candidate for the horizon.
     *
     * Sized to the fillers it stands among rather than to make a statement:
     * 150 and 26 against their 150/24, 165/27 and 140/20. It overlaps the foot
     * of the massif at (400, -172) and of the near hill at (288, 35), so it
     * arrives behind something and in front of something else instead of
     * showing its whole outline against flat snow.
     *
     * IT DOES NOT REACH THE IGLOO. The structure stands at (-30, 252), which
     * is 369 units from this centre against a radius of 150 — measured, not
     * assumed, because anything that lifts the pad moves the hero object.
     */
    placedHill(109, -90, 150, 26) +

    /*
     * AND SMALLER ONES IN FRONT OF THE BIG PAIR, so each large hill has
     * something overlapping its foot. A hill meeting flat ground shows its
     * whole outline at once and flattens; one whose base is crossed by a
     * nearer form reads as standing behind it, which is what builds depth.
     */
    placedHill(-215, 20, 115, 38) +
    placedHill(288, 35, 105, 34) +

    /*
     * FOREGROUND MOUNDS. Small, low, and kept off the camera's own track —
     * anything rising under the lens gets pushed away by the rig's ground
     * clearance and shoves the whole shot upward. Set to either side instead,
     * where they sit along the bottom of the frame and give the near ground
     * something to overlap the middle distance with.
     */
    placedHill(-145, 300, 80, 17) +
    placedHill(155, 308, 68, 14) +
    placedHill(-60, 288, 52, 10);

  /*
   * A SHARP RANGE, NOT A DOME — and this is the one place in the landscape
   * where this file's own argument for rounding does not apply.
   *
   * dome() puts every form through a smoothstep, and the note above it is
   * right about why: deep snow does not hold an edge, and folding the noise
   * the usual way made the near hills read as crumpled foil. That is an
   * argument about SNOW. These ranges are not snowfields — they are the rock
   * spine along the back of the reference, grey aretes with white only in the
   * gullies, and rock holds an edge because stone does. Drawn as domes they
   * came out as more white humps behind the white humps, which is why the
   * layer was switched off rather than fixed.
   *
   * So this is the ridged construction the near hills gave up: 1-|n| folds
   * each octave at zero, turning a smooth swell into a crest with a V-shaped
   * valley beside it, and squaring keeps the valleys wide and the crests
   * narrow — the profile a real range reads in. Three octaves weighted hard to
   * the low end, because at fifteen hundred units the fine ones cannot resolve
   * anyway.
   *
   * THE CONTRAST RAMP IS WHAT MAKES THEM SEPARATE PEAKS. Raw ridged noise is a
   * continuous gradient — every value between valley and crest is present — so
   * the range comes out as one corrugated mass with a level top. Pulling the
   * black and white points together pushes the middle of that range out to the
   * ends: broad low ground, a defined break, and narrow summits standing out
   * of it, which is what gives the sky something to show BETWEEN them.
   *
   * It reads the warped coordinates, like everything else at this scale, so
   * the range has a direction instead of being isotropic noise.
   */
  const crest = (f, ox, oz) => {
    let sum = 0;
    let amp = 1;
    let freq = f;
    let norm = 0;
    for (let i = 0; i < 3; i += 1) {
      const n = 1 - Math.abs(mountain(wx * freq + ox * (i + 1), wz * freq + oz * (i + 1)));
      sum += n * n * amp;
      norm += amp;
      amp *= 0.42;
      /* Not exactly 2, so the octaves never line their lattices up. */
      freq *= 2.11;
    }
    const v = sum / norm;

    /*
     * THE RAMP IS CLAMPED AT THE BOTTOM ONLY, AND CLAMPING THE TOP GAVE MESAS.
     *
     * A plain smoothstep saturates: every value above the upper stop returns
     * exactly 1. Ridged-squared noise spends a real fraction of its time up
     * there, so the whole of that fraction came back at the same height — and a
     * broad area at one height with a steep edge round it is a butte. The first
     * render of this range was a row of flat-topped columns, which is the one
     * landform a snow-and-rock skyline must not have.
     *
     * So the low end keeps its cut, because that is what makes the valleys
     * broad and the crests narrow, and the high end is allowed to keep
     * climbing — at a reduced rate, so the contrast the ramp bought is not
     * simply given back. Summits then differ from one another, which is what
     * makes a skyline read as a range rather than as a wall.
     */
    const t = Math.max(0, (v - 0.28) / 0.46);
    const shaped = t < 1 ? t * t * (3 - 2 * t) : 1 + (t - 1) * 0.55;

    /*
     * AND AN AMPLITUDE ENVELOPE, the same device dome() uses one scale down.
     * Without it every summit that clears the ramp reaches a similar height and
     * the skyline is level however sharp the individual peaks are. A very slow
     * second field gates whole stretches of the range up and down, so one
     * section stands and the next is a saddle.
     */
    const env = 0.42 + 0.58 * Math.abs(drift(wx * f * 0.4 + ox, wz * f * 0.4 - oz));
    return shaped * env;
  };

  const mid = smoothstep(MID_NEAR, MID_FAR, z);
  const far = smoothstep(FAR_NEAR, FAR_FAR, z);

  /*
   * MAX, NOT SUM, and it is the difference between two ranges and one very
   * tall one. Where the bands overlap — z between -900 and -1100 — adding them
   * would stack a mid summit on a far one and raise a wall six hundred units
   * high that neither layer asked for. Taking the greater lets the far range
   * simply stand THROUGH the near one wherever it is higher, which is what
   * being behind something looks like.
   */
  /*
   * THREE AUTHORED RANGES, AND THE NOISE IS DEMOTED TO A COAT ON THEM.
   *
   * What used to be here was two bands of crest() — pure ridged fbm ramped up
   * with distance — and it produced exactly the failure mode the brief names:
   * a row of thin, repeated cones with no mass behind them. The reason is
   * structural rather than a matter of tuning. Ridged noise has no notion of
   * where a summit is, so every local maximum of the field is the same event
   * at the same scale, and a skyline made of them reads as a comb however the
   * amplitude and the contrast ramp are set.
   *
   * Large forms are AUTHORED. Each entry below is a massif() — a placed mass
   * with its own footprint, orientation, lean, spurs and carving — and the
   * noise now only rides on top of them (see `weathering`), which is the order
   * the brief asks for: build the big shapes first, then add the irregularity.
   *
   * THE LAYERS, AND WHY THEIR HEIGHTS GO UP WITH DISTANCE.
   *
   * Apparent height is height over distance, so a range twice as far away needs
   * to be twice as tall to subtend the same angle. Making each layer a little
   * MORE than that keeps the far one standing clear above the near one instead
   * of being hidden by it — which is the only way four planes of mountain are
   * legible as four planes rather than as one crust along the horizon.
   *
   *   A   z -430..-570    h 205..255    the range the valley runs into
   *   B   z -880..-1030   h 300..360    the main wall behind it
   *   C   z -1290..-1470  h 430..510    the far summits, above everything
   *
   * The camera sits at z 422 with a 42-degree vertical lens pitched 5.6 degrees
   * down, so the top of frame is 15.4 degrees above the horizon. C3 at h 500
   * and 1850 units out subtends 13.4 degrees — the tallest thing in the picture
   * and still inside the frame with sky over it.
   *
   * X SPREAD IS SOLVED FROM THE LENS, not chosen. The horizontal half-angle is
   * 42.7 degrees, so the visible half-width at distance D is 0.92 D: about 800
   * units at layer A, 1200 at B and 1600 at C. Each layer's outermost massifs
   * sit AT or slightly beyond that, so the ranges run off both sides of the
   * frame rather than ending inside it — a mountain whose whole footprint is
   * visible is a mountain you have measured, and one that leaves the picture is
   * one that could be any size.
   *
   * Every massif carries a different rotation, aspect and lean. Nine copies of
   * one shape at nine sizes is the other half of the repeated-cone problem, and
   * it is the asymmetry rather than the height that stops it.
   */
  let peaks = 0;
  const range = (h) => {
    if (h > peaks) peaks = h;
  };

  /*
   * THE COL IS AUTHORED AS A GAP IN THE LIST, not carved out afterwards.
   *
   * The reference's depth comes from one thing more than any other: a V-shaped
   * opening right of centre where the skyline drops most of the way to the
   * valley floor and you see three ranges receding through it. A skyline that
   * is uniformly high across the frame has no such window, and without it the
   * mountains are a wall — which is what the first pass of this list produced.
   *
   * So layers A and B are deliberately SHORT of a massif around world x 0..250,
   * which is the +3 to +11 degree slice of the lens, about two thirds of the
   * way across frame. The nearest massifs either side reach that slice near
   * their feet, so the ground there is a saddle rather than a hole, and layer
   * C's tallest summit stands square in the window behind it.
   */

  /*
   * EVERY HEIGHT BELOW COMES DOWN BY ROUGHLY AN EIGHTH, AND THE SKY IS WHY.
   *
   * Sampled in an eight-by-six grid, the reference's top row runs 118 to 214 —
   * it is mostly SKY, with the mountains occupying the second and third bands
   * of the frame. Ours ran 78 to 167: mountain edge to edge, with a strip of
   * blue above it. The brief asks for substantial sky and for the environment
   * to feel enormous, and those are not in tension — a range reads as huge
   * because of what is beside and behind it, not because it reaches the top of
   * the picture. A skyline pressed against the frame edge actually reads
   * SMALLER, because there is nothing left for it to be measured against.
   *
   * The ratios between the three layers are untouched, so the receding planes
   * the list was built for are exactly as they were. This is a scale, not a
   * redesign.
   */

  /* ---- LAYER A: the near range the valley runs into -------------------- */
  /*
   * ROUNDNESS IS ASSIGNED HERE, NOT LEFT TO THE DEFAULT, and the split across
   * the eleven entries below is the brief's 70 / 20 / 10.
   *
   *   round >= 0.75   seven of them   broad rounded snow masses
   *   round ~ 0.4     three           medium, visibly ridged
   *   round <= 0.2    one             a genuinely sharp peak, and only one
   *
   * THE HEIGHTS ARE ALSO DELIBERATELY UNEVEN NOW. Layer B used to run
   * 252 / 205 / 258 / 212 — four masses within a quarter of each other, which
   * is a row rather than a range whatever their shapes are. Real skylines have
   * large-scale rhythm: a dominant mass, a long low saddle, a secondary summit,
   * a valley. Spreading each layer's heights over better than a two-to-one
   * ratio is what puts that rhythm in.
   *
   * AND THEY ALL WENT UP AGAIN AFTER THE FIRST ROUNDED PASS, by about a third.
   * Roundness costs apparent height and it is worth being explicit about why:
   * the profile exponent drops from 2.4 to about 1.3, which spreads the same
   * summit height over a much wider shoulder, and the crown guard removes the
   * spur and carve contributions that used to pile up just below the top. The
   * number in this call is still the height of the summit — what changed is
   * that far less of the massif now approaches it, so a range set to the old
   * figures reads as a line of low domes. Rounder mountains have to be taller
   * to be the same mountain.
   */

  /* ---- LAYER A: the near range the valley runs into -------------------- */
  /*
   * THE PRIMARY MOUNTAIN. Bigger than anything else in the frame by a clear
   * margin, broad, rounded, left of centre — which is where the reference puts
   * its dominant mass, and it is not an arbitrary choice: the igloo sits just
   * right of centre, so putting the mountain on the same side would stack the
   * two strongest things in the picture on one axis.
   *
   * 1157 units out and 286 tall, which subtends eleven degrees against a frame
   * top of fifteen. That leaves sky above it — a summit pressed into the top
   * edge reads as a wall rather than as a mountain — and it stands a clear four
   * degrees over the layer-B masses behind it.
   *
   * THE X AND THE RADIUS ARE SET BY WHAT MUST BE SEEN PAST IT. At (-600, r 620)
   * its right flank reached world x +20, which at this depth is 12.6 degrees
   * right of the lens axis — better than half way across the frame — so the
   * dominant mountain was also the thing hiding every range behind it, and the
   * picture had two masses in it and no distance at all. Moved to -780 with the
   * radius pulled in to 560 it stops at the frame's centre line, and the col to
   * its right opens onto B2, C2 and C3 stacked one behind another.
   */
  /*
   * SPURS BACK UP TO 0.30 ON THE BROAD MASSES, AND THE CROWN GUARD IS WHY THIS
   * IS SAFE NOW.
   *
   * They were cut to 0.17 in the same pass that added roundness, because spurs
   * were what had been serrating the skyline. That was over-correction: with
   * the guard in place the angular term cannot reach the top of the form at
   * all, so what it produces is ridges running down the FLANKS — which is
   * exactly the "large form + medium ridges + subtle surface detail" the brief
   * asks for, and without them the mountains came back as smooth featureless
   * domes with nothing to read their size by.
   *
   * The two things the old skyline got wrong were sharp summits and uniform
   * shapes. Neither is a property of flank ridges.
   */
  range(massif(-780, -560, 560, 286, 1.7, { aspect: 1.26, rot: 0.38, lean: 0.22, round: 0.9, spur: 0.30, carve: 0.22 }));
  range(massif(-170, -600, 400, 106, 4.1, { aspect: 1.12, rot: -0.52, lean: -0.22, round: 0.82, spur: 0.28, carve: 0.22 }));
  /*
   * SHIFTED RIGHT AND LOWERED, from (640, h 222), to give the sun its corner.
   *
   * The key sits 33 degrees right of the lens axis and above the top of frame,
   * so what the picture gets of it is the glow spilling down into the upper
   * right. This mass and B3 behind it were standing in front of that: measured
   * in an eight-by-six grid the reference's top-right two cells read 214 and
   * 108 where ours read 108 and 79 — its brightest corner against our darkest.
   *
   * The reference does have a large dark mountain on that side and it is kept;
   * it simply starts about four fifths of the way across rather than two
   * thirds. This is the 20 per cent medium-ridged entry in the mix, so it holds
   * its round 0.5 — the sun corner is bought with placement, not with shape.
   */
  range(massif(880, -520, 470, 196, 2.9, { aspect: 1.24, rot: 0.86, lean: 0.14, round: 0.5, spur: 0.26, carve: 0.24 }));

  /* ---- LAYER B: the main wall ----------------------------------------- */
  range(massif(-1010, -905, 660, 330, 5.3, { aspect: 1.18, rot: -0.24, lean: 0.26, round: 0.88, spur: 0.29, carve: 0.22 }));
  range(massif(-400, -1010, 570, 288, 0.9, { aspect: 1.34, rot: 0.62, lean: -0.16, round: 0.44, spur: 0.21, carve: 0.30 }));
  range(massif(800, -950, 650, 372, 3.6, { aspect: 1.08, rot: -0.78, lean: 0.21, round: 0.42, spur: 0.27, carve: 0.26 }));
  /*
   * PUSHED OUT TO THE EDGE, from x 1160 and 1520.
   *
   * THE SUN IS BEHIND THIS PAIR AND THAT IS WHERE THE MEASUREMENT SENT THEM.
   * The key sits 33 degrees right of the lens axis and 18 above the horizon,
   * which is above the top of frame — so what the picture gets of it is the
   * glow spilling down into the upper right corner. These two were standing in
   * front of it: sampled in an eight-by-six grid the reference reads 186 and
   * 214 across the top right where ours read 129 and 83, and the whole of that
   * difference is a dark mountain where the reference has lit sky.
   *
   * The reference does have a big dark massif on that side — it is the closest
   * thing in its frame — but it starts about 83 per cent of the way across and
   * ours started at 64. Moving them right keeps the mass and gives the sun its
   * corner back.
   */
  range(massif(1420, -985, 630, 282, 6.2, { aspect: 1.26, rot: 0.41, lean: -0.24, round: 0.84, spur: 0.29, carve: 0.22 }));

  /* ---- LAYER C: the far summits, seen through the col ------------------ */
  range(massif(-1340, -1360, 860, 470, 2.2, { aspect: 1.15, rot: 0.29, lean: -0.20, round: 0.8, spur: 0.28, carve: 0.22 }));
  /* THE ONE SHARP PEAK. Every range has one, and one is the whole point — it
     is what the rounded masses are read against. Set at the back and off to the
     left, where it is a note in the skyline rather than the subject. */
  range(massif(-520, -1465, 780, 336, 5.9, { aspect: 1.28, rot: -0.66, lean: 0.24, round: 0.12, spur: 0.3, carve: 0.3 }));
  /*
   * SHIFTED LEFT INTO THE COL, from x 690, as well as lowered.
   *
   * This is the summit the window in the skyline was cut for, and it was
   * sitting to the RIGHT of that window — so instead of being framed by the col
   * it joined the mass filling the right of the picture, and the col looked
   * through at nothing. At x 330 it stands square in the gap, which is what
   * makes the opening read as depth rather than as a notch.
   */
  range(massif(330, -1390, 900, 440, 1.1, { aspect: 1.10, rot: 0.71, lean: -0.15, round: 0.78, spur: 0.28, carve: 0.22 }));
  range(massif(1900, -1430, 880, 452, 4.7, { aspect: 1.22, rot: -0.35, lean: 0.18, round: 0.46, spur: 0.24, carve: 0.22 }));

  /*
   * WEATHERING — the old crest() field, kept but reduced to what it is good at.
   *
   * It is a poor generator of mountains and a good generator of the small,
   * self-similar broken-ness that sits ON one: cols, gendarmes, the ragged
   * quarter-scale detail along a ridge that stops an authored silhouette
   * looking drawn. So it is now MULTIPLICATIVE on the massifs rather than a
   * peak in its own right, which means it can only ever modulate a shape that
   * already exists — it can no longer invent a spike in an empty valley, which
   * is precisely what it was doing before.
   *
   * Gated on `mid` so it stays off the near field entirely, and kept modest:
   * at 0.16 it moves a 300-unit summit by up to fifty units, which is a
   * visible break in a ridge and nowhere near a second mountain.
   */
  if (peaks > 0 && mid > 0) {
    /*
       HALVED AND COARSENED, from 0.0026 / 0.11.
       This is ridged fbm applied on top of the authored masses, and ridged fbm
       is by nature a field of points — every local maximum is a little spike.
       At 11 per cent on a 300-unit summit it was moving the outline by thirty
       units at a wavelength of a couple of hundred, which is precisely the
       scale that shows up as serration on a skyline. Dropping the frequency
       makes what is left a broad undulation of the ridge rather than a set of
       teeth on it, and halving the amplitude keeps it under the silhouette.
    */
    const weathering = crest(0.0014, 17, -44) - 0.5;
    peaks *= 1 + weathering * 0.055 * mid;
  }

  /*
   * A FLOOR UNDER THE RANGES, so they stand on ground rather than on the plain.
   *
   * Without it the last of layer A meets the near field at zero and the join
   * reads as a moat. This raises the whole back half of the plate by a modest
   * amount with the same smoothstep the ranges use, which puts a valley FLOOR
   * between the igloo's hills and the mountains — the thing the brief calls the
   * midground, and the surface the aerial perspective is measured across.
   */
  if (mid > 0) peaks = Math.max(peaks, (26 + 44 * far) * mid);

  /*
   * THE DISTANT RANGES ARE BACK, and the note that removed them is kept
   * because it was right about the version it removed.
   *
   * It read: they "were fogged almost to the sky colour, so they read as a
   * flat white band rather than as landscape". True, and both halves of that
   * have since changed. They were domes, so there was no shape in them for the
   * haze to leave behind; and the standing haze was at 0.0042, which at a
   * kilometre is total erasure. They are crests now, and the fog is at 0.0009
   * — 48 per cent at nine hundred units and 84 at fifteen hundred, which is
   * aerial perspective rather than a curtain.
   *
   * That is the reference's back third exactly: pale grey-blue silhouettes
   * with their ridge lines still legible, each plane lighter than the one in
   * front of it, and white haze lying in the valleys between them.
   */
  /*
   * SHARP CUTS: terracing the hill mass.
   *
   * Smooth noise gives smooth hills, and smooth hills have no edges anywhere —
   * every slope eases into the next, which is why they read as soft mounds
   * however large they get. Real high ground is broken by benches and
   * escarpments where harder rock has resisted: a flat shelf, then an abrupt
   * step down, then another shelf.
   *
   * Quantising the height to a step gives exactly that, and the sharpness
   * factor controls how much of each step is spent rising. At 3.2 the climb
   * happens in the first third and the rest is flat, so the result is a bench
   * with a steep riser rather than a staircase of even ramps.
   *
   * Blended at 45% rather than applied outright. Full terracing looks
   * machined; mixing it back with the smooth original keeps the overall
   * landform and cuts edges into it.
   */
  const terraced = (h) => {
    /*
     * SHORTER STEPS, STEEPER RISERS, from 15 / 3.2.
     *
     * The terracing is the one term that makes ANGLE rather than height — it
     * converts a smooth gradient into shelf-riser-shelf without changing the
     * landform's overall shape. That is exactly what bare rock needs somewhere
     * to sit: a hillside at a uniform gentle grade has no face steep enough to
     * shed snow, however tall you make it.
     *
     * Raising the amplitudes instead would have made the hills bigger and no
     * steeper, since slope is amplitude over wavelength and both scale
     * together.
     */
    const STEP = 11;
    const SHARP = 4.6;
    const f = h / STEP;
    const i = Math.floor(f);
    const rise = Math.min(1, (f - i) * SHARP);
    return (i + rise) * STEP;
  };

  /*
   * THE PLACED HILLS ARE LEFT OUT OF THE TERRACING.
   *
   * They were being cut along with everything else, which broke exactly the
   * thing they exist for: a clean rounded hump with one continuous outline, the
   * way a hill is drawn. Benches chopped that silhouette into steps and it
   * stopped reading as a single landform.
   *
   * So the escarpments are applied to the noise mass only, and the big hills
   * keep their cos-squared profile intact. They sit as clean shapes with broken
   * ground around and in front of them, which is the contrast that makes both
   * read.
   */
  /*
   * BLENDED HARDER, from 0.45. Full terracing looks machined and none of it
   * looks like rock country; two thirds keeps the landform reading as
   * weathered while giving the escarpments enough definition to strip.
   */
  /*
   * THE TERRACING DROPS TO 0.18, from 0.68, AND IT IS THE SINGLE BIGGEST CAUSE
   * OF THE HEAPED LOOK.
   *
   * Its own note argues for escarpments — shelf, riser, shelf — as the thing
   * that gives a rounded hill an edge, and that is a real landform where hard
   * rock has resisted. At two thirds strength applied to every noise hill in
   * the frame it stops being an escarpment and becomes a texture: a field of
   * short benches at one spacing, all over the middle distance, which is
   * exactly what a tipped pile of material looks like and is nothing like the
   * reference. Its mid ground is SMOOTH — long wind-packed snow dunes with an
   * unbroken silhouette — and its hard edges are all in the rock at the back.
   *
   * At 0.18 the benches survive as a faint break in the slope where the
   * landform already wanted one, and the dunes read as dunes.
   */
  /*
   * TERRACING DOWN TO 0.07, from 0.18.
   *
   * It quantises height to eleven-unit steps with a sharp riser, which reads as
   * bedding on a rock face and as a stair on a snow field. The mid-ground is
   * meant to be snow, and the brief asks for soft accumulated forms there; a
   * riser is the sharpest edge in the whole terrain function. What is left is
   * enough to keep the hills from being pure smooth blobs.
   */
  const cut = hummocks + (terraced(hummocks) - hummocks) * 0.07;

  /*
   * CRAG: the rock, and it is deliberately the one term that is NOT rounded.
   *
   * dome() puts every form through a smoothstep, for a good reason recorded
   * above it: deep snow does not hold a sharp edge, and folding the noise the
   * usual way made the whole range read as crumpled foil. That argument is
   * exactly right for snow and exactly wrong for the mass behind it, which in
   * the reference is not a snowdrift at all — it is rock with snow lying in its
   * hollows, and it holds edges because stone does.
   *
   * So this is the ridged construction the ranges gave up: 1-|n| folds each
   * octave at zero, turning smooth swells into crests with V-shaped valleys
   * between them. Three octaves, weighted to the low end so the big shapes
   * dominate and the small ones only break up the faces.
   *
   * RAMPED BY DISTANCE, and the window matters. It starts at 90 — clear of the
   * pad, so nothing rocky intrudes on the snow the igloo stands in — and is at
   * full strength by 280, which is roughly where the mid-ground hills sit. Past
   * that the fog takes over: FOG_COLOR now sits within a few points of the sky,
   * so anything far enough to be fully fogged dissolves whatever shape it has.
   * There is no point carving rock into ground that resolves to nothing, and
   * the depth in the reference comes precisely from near rock read against far
   * haze.
   *
   * hillEnv rides along so the rock appears in the same regions the hills do,
   * rather than as a separate field laid across everything.
   */
  const cragDist = Math.sqrt(dx * dx + dz * dz);
  const cragRamp = smoothstep(150, 340, cragDist);
  const ridged = (f, ox, oz) => 1 - Math.abs(mountain(wx * f + ox, wz * f + oz));

  /*
   * THE CONTRAST RAMP, and it is what makes the masses big.
   *
   * Ridged noise comes out as a continuous gradient — every value between
   * valley and crest is represented, so the rock is all transition and no
   * mass. Pulling the black and white points in toward each other pushes the
   * middle of that range out to the ends: what was a slow ramp from hollow to
   * peak becomes a broad high face, a defined break, and a broad low one.
   *
   * Same operation as narrowing a colour ramp, and the same result — fewer,
   * larger, more legible forms out of exactly the same noise. It costs nothing
   * and it is a better way to get size than either more amplitude (which just
   * makes the same shapes taller) or more warp (which smears them).
   */
  const ramp = (v) => {
    const t = Math.min(1, Math.max(0, (v - 0.28) / 0.44));
    return t * t * (3 - 2 * t);
  };

  /*
   * AMPLITUDES DOWN, from 30/13/5.5.
   *
   * The ramp above makes the forms read bigger without them being taller, so
   * the height that was standing in for size is no longer needed — and at 30
   * the crag was starting to fight the hills it is supposed to be sitting on.
   *
   * THE FINE OCTAVE IS DELIBERATELY NOT RAMPED. Its job is surface roughness,
   * not shape: putting it through the same contrast curve would turn the grain
   * into another set of small masses and the faces would go lumpy instead of
   * rough. It stays a raw gradient, and it keeps most of its amplitude for the
   * same reason — it is the only term supplying texture on a rock face.
   */
  /*
   * AMPLITUDES LEFT ALONE, AND ONE PASS PROVED WHY.
   *
   * The obvious way to make the hill behind the igloo read as a mountain was to
   * turn this up — it is the ridged term, ridges are what mountains have, so
   * more of it should give more mountain. Tried at 34 / 17 / 5.2 with a tighter
   * contrast ramp, and the result was worse in a specific and instructive way:
   * the whole middle distance rose into a continuous lumpy mass that filled the
   * top of the frame, took the sky out of the shot, and still did not read as a
   * peak.
   *
   * The reason is that this term is UNPLACED. It is noise over the whole
   * hill-bearing region, so turning it up raises every part of that region
   * equally — the background got taller everywhere rather than at one summit,
   * and a landscape with no low ground in it has nothing for a mountain to
   * stand above. Structure had to come from a placed form that knows where its
   * own summit is, which is what placedPeak does.
   *
   * So this stays what it always was: surface break-up on ground that is shaped
   * by something else.
   */
  /*
   * THE TWO COARSE OCTAVES COME DOWN, from 22 and 16.
   *
   * Everything in this file that makes a rounded form at a few hundred units —
   * the hummocks, the placed hills, the terracing and this — was tuned
   * separately and against a frame where the mid ground was much smaller. Added
   * together they produce several overlapping masses per hillside at similar
   * sizes, and overlapping masses at ONE size is what the eye reads as spoil
   * rather than as landform. Thinning the ones that are not placed is the way
   * to fix that, because the placed forms are the ones that know where their
   * summit is.
   *
   * THE FINE OCTAVE IS UNTOUCHED at 4.5. It is surface roughness on a rock
   * face, it is the only thing supplying that, and it is far too small to make
   * a mass.
   */
  const crag =
    (ramp(ridged(0.0034, 91.3, -17.7)) * 8 +
      /*
       * UP FROM 9, FOR FACE ANGLE RATHER THAN FOR HEIGHT.
       *
       * The pass that raised all three of these at once is written up above and
       * it failed because the COARSE octave went up with them and lifted the
       * whole background. This one is 120-unit forms — small enough that
       * amplitude turns into slope instead of into skyline, which is the same
       * argument the hummocks' fine octave makes.
       */
      /*
       * AND BACK DOWN: 13 / 11 / 4.5 -> 8 / 5.5 / 1.8.
       *
       * The note above is the argument for the middle octave, and it is right
       * that amplitude at 120-unit wavelength becomes face angle rather than
       * skyline. What it does not account for is that face angle is exactly
       * what the shader's alpine rule reads: every extra degree of slope here
       * turns into another patch of exposed rock, so this term was writing the
       * mid-ground's rock coverage as much as its shape — and the result was a
       * middle distance that looked crushed and stony rather than snow-covered.
       *
       * The FINE octave comes down hardest, 4.5 to 1.8. At 50-unit wavelength
       * it is below the scale anything in this shot is read at; all it
       * contributed was the high-frequency chop the brief asks to be taken out,
       * plus a normal that flickers when the camera moves.
       */
      ramp(ridged(0.0082, 13.9, 44.1)) * 5.5 +
      ridged(0.0195, -63.1, 8.5) * 1.8) *
    cragRamp *
    hillEnv;

  /*
   * peaks JOINS BY MAX RATHER THAN BY SUM, for the same reason the two bands
   * do between themselves: everything before it is near and middle ground, and
   * a range standing behind that ground should stand THROUGH it where it is
   * higher rather than be stacked on top of it. Summing would ride the far
   * summits up on whatever the hummocks happen to be doing underneath and lift
   * the whole back of the frame with them.
   */
  const front = drifts + sculpted + mound + cut + hills + bowlRim + crag;
  return Math.max(front, peaks);
}

/**
 * A LEVEL PAD UNDER THE IGLOO, and it is what stops it floating.
 *
 * The structure's ground course is a flat ring, but the drifts under it are
 * not: sampling the terrain at the centre and seating the whole igloo there
 * leaves one side buried and the opposite side standing on air, which is the
 * daylight visible under its left edge. Flattening the ground to a single
 * height beneath it and easing that back into the drifts over the next dozen
 * units gives it something level to stand on while still reading as a swell in
 * the snow rather than as a plinth.
 *
 * THESE SCALE WITH THE IGLOO'S RADIUS. It is 22 now, so the flat pad runs to
 * 25 and the drift banks against the wall at 26. Leave them at the old
 * radius-18 figures and the blend starts inside the footprint, which puts the
 * outermost blocks of the ground course on sloping ground.
 *
 * PAD_RADIUS has to exceed the igloo's own radius or the blend starts inside
 * the footprint and the far blocks lift off again.
 */
/*
 * WIDENED, from 25/52, so the level part covers the whole structure.
 *
 * The porch reaches 28.5 units out while the dome wall stops at 22, so a pad
 * that is only fully flat to 25 has the entrance standing on ground that has
 * already started to blend back toward the natural field.
 */
const PAD_RADIUS = 32;
const PAD_FALLOFF = 60;

/*
 * THE DRIFT BANKED AGAINST THE WALL, and it is what stops the igloo reading as
 * an object placed on the snow rather than one built in it.
 *
 * A level pad alone gives a clean line all the way round where the bottom
 * course meets the ground, and a clean line is exactly what a real structure in
 * deep snow never has: wind piles snow against anything that obstructs it, so
 * the base is always half buried and you cannot see where the wall starts.
 *
 * A ring crest just outside the wall radius, gated to zero inside the footprint
 * so it never pushes up through the floor. It buries roughly the lower half of
 * the ground course, which is the whole read.
 */
/*
 * MOVED OUT, from 26. The crest now sits clear of the porch rather than on it.
 */
const BANK_PEAK = 38;
const BANK_WIDTH = 10;
/*
 * RAISED, from 2.1. The reference buries roughly the bottom 29% of its igloo in
 * drifted snow — its wall disappears into the bank well before it reaches the
 * ground, which is both what wind does around an obstruction and what stops the
 * structure reading as an object set down on a surface. At 2.1 on a 31-unit
 * dome ours was barely a skirting board.
 */
const BANK_HEIGHT = 4.5;
/*
 * Inside this radius the ground stays flat — the whole structure sits on it.
 *
 * OUT FROM 15, AND THAT NUMBER WAS THE BUG. The gate opened at 15 while the
 * dome's own wall radius is 22, so the drift started climbing seven units
 * INSIDE the footprint: the ground under the igloo was not level at all, it
 * was the inner flank of the bank. That is what put the dome on a mound, and
 * it is also why seating it needed the maximum height over its footprint
 * rather than simply the pad — the footprint had a slope across it.
 *
 * At 31 the flat covers the dome and the porch's 28.5-unit reach with a little
 * to spare, and the drift begins beyond the building instead of under it.
 */
const BANK_INNER = 31;
/** How far past BANK_INNER the drift takes to come up to full strength. */
const BANK_RAMP = 8;

/* The pad's height, resolved once from the unpadded field. Computing it inside
   heightAt would recurse. */
let padY = null;

/* --- THE ERODED FIELD ----------------------------------------------------
 *
 * WHY THIS IS A GRID AND EVERYTHING ELSE IS A FUNCTION.
 *
 * rawHeight is analytic: give it a point and it answers without knowing what
 * is around that point. That is what makes it cheap to call per frame, and it
 * is also the reason the landscape can only ever look like summed noise.
 * Erosion is the opposite kind of process — where material ends up depends on
 * where it came from — so it cannot be expressed as a function of position at
 * all. It has to be simulated over a field, once.
 *
 * So rawHeight stops being the terrain and becomes the INPUT to it. The field
 * is baked at first call, water is run over it, and every later query is a
 * bilinear read of the result. Queries actually get cheaper: a lookup replaces
 * a dozen fbm evaluations.
 *
 * The cost is paid once, at load, behind the loader that already says
 * "BUILDING THE WORLD" — which is now literally what it is doing.
 */

/** Grid resolution. Matches the mesh's own segment count so the simulation
    resolves nothing the geometry cannot show, and nothing less. */
export const ERODE_SEGMENTS = 512;

/**
 * The centre of the baked field. MUST match the centreZ the mesh is built
 * with, or the terrain the camera walks on is offset from the one it sees.
 */
export const TERRAIN_CENTER_Z = -300;

/**
 * Vertical scale for the simulation: ONE CELL WIDTH.
 *
 * This started as a flat 240 — "map the tallest hill to about 1" — and that is
 * the mistake that produced a field of spikes. The simulation measures slope as
 * height difference PER CELL, and a cell here spans five world units. Dividing
 * height by 240 while leaving the horizontal spacing at 1 handed it a landscape
 * squashed almost flat: gradients came out around 0.009, far too weak to steer
 * anything.
 *
 * A droplet always advances a full cell, so on ground that flat the direction
 * it picks is essentially noise. It wanders, and every step that happens to
 * land uphill triggers the deposit branch — which raises that cell, which makes
 * the next arrival more likely to deposit there too. That is the same runaway
 * their maxChangePerStep note describes, on the deposition side, and it grows
 * spikes rather than pits.
 *
 * Normalising by the cell width instead makes the vertical and horizontal units
 * the same, so the number the simulation reads as slope IS the slope. Hillsides
 * present gradients around 0.4 and the water goes downhill because downhill is
 * now unambiguous.
 */
const ERODE_NORM = TERRAIN_SIZE / ERODE_SEGMENTS;

/**
 * How many droplets. About 0.7 per cell.
 *
 * Erosion is not a filter with a strength dial — it is a count. Too few and
 * the channels never connect into anything; far too many and every slope
 * flattens toward its own angle of repose and the landform dissolves.
 */
/*
 * CUT FROM 130,000, AND THE REFERENCE IS WHY.
 *
 * The note above is right that erosion is a count rather than a strength, and
 * it was counted for a landscape meant to look carved. igloo.inc's is not
 * carved at all: it is deep wind-packed snow over rounded ground, with no
 * channels, no gullies and no terraces anywhere in frame. What 130,000
 * droplets were adding here was exactly the thing it does not have — stepped
 * benches across the mid-ground and hard facets in the near field, both of
 * which the eye reads instantly as eroded rock rather than as snow.
 *
 * Enough are left to break the noise's symmetry and give the slopes somewhere
 * to drain, which is worth keeping. The landform is the composition's job.
 */
const ERODE_DROPLETS = 24000;

const ERODE_PARAMS = {
  /*
   * GENTLER THAN THE DEFAULTS ACROSS THE BOARD.
   *
   * Theirs are set for a demo whose whole point is watching terrain be carved,
   * so they cut hard and fast. This landscape has already been composed — the
   * placed hills, the bowl, the drifts are all deliberate — and erosion is here
   * to add the one thing composition cannot, not to redesign it. Roughly a
   * quarter of the default bite, over a longer droplet life so the channels
   * still run somewhere.
   */
  erodeSpeed: 0.15,
  depositSpeed: 0.15,
  /* In cell-widths now, not in fractions of the whole relief: 0.03 of a cell
     is about 15cm of world. Small enough that carving takes many droplets,
     large enough that it is not lost in floating-point noise. */
  maxChangePerStep: 0.03,
  minSedimentCapacity: 0.002,
  maxLifetime: 46,
  inertia: 0.06,
};

let field = null;

/**
 * EXPORTED FOR THE BAKE. scripts/bake-world.mjs calls this directly, quantises
 * the result and writes it to public/baked/heightfield.bin — 1.5 seconds of
 * erosion that every visitor was otherwise re-running to get the same landscape
 * the seed already determines.
 *
 * It stays the fallback: if the baked file is missing or fails to load, nothing
 * here changes and the field is simply built the way it always was.
 */
export function buildField() {
  const n = ERODE_SEGMENTS + 1;
  const cell = TERRAIN_SIZE / ERODE_SEGMENTS;
  const x0 = -TERRAIN_SIZE / 2;
  const z0 = TERRAIN_CENTER_Z - TERRAIN_SIZE / 2;
  const data = new Float32Array(n * n);

  for (let iy = 0; iy < n; iy += 1) {
    for (let ix = 0; ix < n; ix += 1) {
      data[iy * n + ix] = rawHeight(x0 + ix * cell, z0 + iy * cell) / ERODE_NORM;
    }
  }

  /* Seeded, so the landscape is the same on every load. An unseeded run would
     give a different world each refresh, and the camera moves are authored
     against this one. */
  const rng = createRng(0x5eed1);
  for (let i = 0; i < ERODE_DROPLETS; i += 1) erodeStep(data, n, rng, ERODE_PARAMS);

  /*
   * A LIGHT SMOOTH AFTERWARDS, and it is not cosmetic tidying.
   *
   * Correcting the vertical scale removed the spike forest, but it cannot
   * remove the mechanism entirely: the drifts near the camera are genuinely
   * almost level, and on ground that flat a droplet's chosen direction is still
   * close to arbitrary. A few cells always end up a little proud, and a cell
   * that is proud reads as a hard crystalline facet once normals are computed
   * from it — the jagged shards left in the foreground.
   *
   * Single-cell deviation is exactly what a small kernel removes and exactly
   * what a channel is not: a carved channel is coherent across many cells, so
   * it survives this almost untouched while the isolated spikes do not. Two
   * passes with the weight kept on the centre — enough to kill the facets, not
   * enough to soften the erosion back out again.
   */
  /*
   * A MEDIAN FILTER, NOT A BLUR — and the distinction is the whole point.
   *
   * This began as two passes of a 3x3 mean, which did remove the spikes and
   * also removed the slope: a mean is a low-pass filter, and the shortest
   * wavelengths in the field are exactly where face angle lives. Measured, the
   * blur was costing about eight points of the ground that falls inside the
   * rock window, and dropping it to one gentle pass brought the spikes
   * straight back as hard crystalline facets across the foreground.
   *
   * The two goals only look opposed because a mean is the wrong instrument. A
   * spike is a single cell far from its neighbours; a steep face is many cells
   * agreeing on a gradient. A median discards the outlier and leaves the
   * agreement untouched — it cannot invent a value that was not already there,
   * so an edge survives it intact while a lone proud cell is simply replaced
   * by whatever its neighbourhood actually is.
   *
   * One pass is enough because a median is idempotent on anything that is not
   * an outlier.
   */
  /*
   * A GENTLE MEAN, AFTER the median and because of what changed downstream.
   *
   * The note below rules a mean out, and the reasoning was sound at the time:
   * a mean is a low-pass filter, the shortest wavelengths are where face angle
   * lives, and the ground's rock was selected by a SLOPE window — so blurring
   * the slope was measured to cost about eight points of the surface that
   * qualified as rock. Softening the terrain and losing the rock were the same
   * action.
   *
   * They are not any more. The rock is now chosen by a world-space patch field
   * and a texture (see Terrain.jsx), and neither reads the terrain's gradient
   * at all — so face angle no longer has a second job and can be softened on
   * its own merits. Which the reference says it should be: deep snow rounds
   * everything it lies on.
   *
   * Weighted hard toward the centre, once. This is a rounding, not a blur.
   */
  {
    const pre = new Float32Array(data);
    for (let iy = 1; iy < n - 1; iy += 1) {
      for (let ix = 1; ix < n - 1; ix += 1) {
        const i = iy * n + ix;
        const ring =
          pre[i - n - 1] + pre[i - n] + pre[i - n + 1] +
          pre[i - 1] + pre[i + 1] +
          pre[i + n - 1] + pre[i + n] + pre[i + n + 1];
        data[i] = pre[i] * 0.44 + (ring / 8) * 0.56;
      }
    }
  }

  const src = new Float32Array(data);
  const win = new Float64Array(9);
  for (let iy = 1; iy < n - 1; iy += 1) {
    for (let ix = 1; ix < n - 1; ix += 1) {
      const i = iy * n + ix;
      win[0] = src[i - n - 1]; win[1] = src[i - n]; win[2] = src[i - n + 1];
      win[3] = src[i - 1];     win[4] = src[i];     win[5] = src[i + 1];
      win[6] = src[i + n - 1]; win[7] = src[i + n]; win[8] = src[i + n + 1];
      /* Insertion sort: nine elements, so this beats anything cleverer. */
      for (let a = 1; a < 9; a += 1) {
        const v = win[a];
        let b = a - 1;
        while (b >= 0 && win[b] > v) { win[b + 1] = win[b]; b -= 1; }
        win[b + 1] = v;
      }
      data[i] = win[4];
    }
  }

  return { data, n, cell, x0, z0 };
}

/**
 * Hand the pre-computed field in, in place of running the erosion.
 *
 * WHY THIS IS A SETTER AND NOT AN ASYNC LOAD INSIDE erodedHeight. heightAt is
 * called synchronously from everywhere — the terrain mesh's vertex loop, the
 * scree scatter, the igloo's footing, the camera rig's ground clearance every
 * frame — and there is no version of "await" that fits inside a function shaped
 * like that. Making it async would mean making all of those async, which means
 * the whole scene graph.
 *
 * So the fetch happens once, before any of it exists: lib/baked.js loads the
 * file while the loading screen is up and calls this, and the Stage does not
 * mount until it has. By the time anything asks for a height, the field is
 * already here and every existing synchronous caller is untouched.
 *
 * Not called, or called with nothing, and the lazy build below still runs.
 */
export function setBakedField(data) {
  if (!data) return;
  const n = ERODE_SEGMENTS + 1;
  if (data.length !== n * n) {
    throw new Error(`baked heightfield is ${data.length} samples, expected ${n * n}`);
  }
  field = {
    data,
    n,
    cell: TERRAIN_SIZE / ERODE_SEGMENTS,
    x0: -TERRAIN_SIZE / 2,
    z0: TERRAIN_CENTER_Z - TERRAIN_SIZE / 2,
  };
}

function erodedHeight(x, z) {
  if (field === null) field = buildField();
  const { data, n, cell, x0, z0 } = field;

  const gx = (x - x0) / cell;
  const gy = (z - z0) / cell;

  /* Outside the baked extent — the mesh's own skirt, and anything the camera
     rig probes beyond it — fall back to the analytic field. It is never in
     frame, and a clamp would smear the edge row across the whole margin. */
  if (gx < 0 || gy < 0 || gx >= n - 1 || gy >= n - 1) return rawHeight(x, z);

  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = gx - ix;
  const fy = gy - iy;

  const h00 = data[iy * n + ix];
  const h10 = data[iy * n + ix + 1];
  const h01 = data[(iy + 1) * n + ix];
  const h11 = data[(iy + 1) * n + ix + 1];

  return (
    (h00 * (1 - fx) * (1 - fy) +
      h10 * fx * (1 - fy) +
      h01 * (1 - fx) * fy +
      h11 * fx * fy) *
    ERODE_NORM
  );
}

export function heightAt(x, z) {
  const dx = x - MOUND_AT[0];
  const dz = z - MOUND_AT[1];
  const d = Math.hypot(dx, dz);
  if (d >= PAD_FALLOFF) return erodedHeight(x, z);

  if (padY === null) padY = erodedHeight(MOUND_AT[0], MOUND_AT[1]);

  const k = 1 - smoothstep(PAD_RADIUS, PAD_FALLOFF, d);
  const h = erodedHeight(x, z);
  const levelled = h + (padY - h) * k;

  const t = (d - BANK_PEAK) / BANK_WIDTH;
  /*
   * The gate's upper bound was a hardcoded 22, which only worked while
   * BANK_INNER happened to be below it — smoothstep(31, 22, d) would be
   * inverted and the drift would appear inside the footprint instead of
   * outside it. Tied to BANK_INNER now so the two cannot disagree.
   */
  const bank =
    BANK_HEIGHT *
    Math.exp(-0.5 * t * t) *
    smoothstep(BANK_INNER, BANK_INNER + BANK_RAMP, d);

  return levelled + bank;
}

/**
 * The ground mesh geometry, displaced once at build time.
 *
 * Segment count is the quality/cost dial, and it is set by the far end rather
 * than the near: the peaks are the thing that must not be faceted, and they sit
 * hundreds of units out. Normals are recomputed after displacement — skipping
 * that leaves every normal pointing straight up and the terrain lights as a
 * flat sheet no matter how much relief it has, which is the single most common
 * way procedural ground looks wrong.
 */
export function buildTerrainGeometry(segments = 512, centerZ = TERRAIN_CENTER_Z) {
  const geometry = new PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, segments, segments);
  // PlaneGeometry is built in the XY plane; lay it down so Y is up.
  geometry.rotateX(-Math.PI / 2);
  /* Centred on the shot rather than on the world origin, so the mesh's own
     edges stay outside the frustum and behind the fog. */
  geometry.translate(0, 0, centerZ);

  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
  }

  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
