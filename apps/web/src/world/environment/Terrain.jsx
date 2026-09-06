import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { buildTerrainGeometry, MOUND_AT, TERRAIN_SIZE } from '../lib/terrain.js';
import { iceMapsFor } from '../lib/baked.js';

/**
 * The ground.
 *
 * Geometry is built once, in a memo, and never rebuilt. It is roughly a hundred
 * thousand vertices of displacement work — trivial as a one-off at startup, and
 * ruinous if it were to run on a re-render, which is exactly what would happen
 * if this were computed inline in the component body.
 *
 * MATERIAL, NOT TEXTURE. There is no image map on this. A tiling photograph of
 * rock at this scale either visibly repeats or turns to mush at distance, and
 * authoring a non-repeating one for a 900-unit plane is a texture-painting job.
 * Instead the surface is a plain physical material with high roughness, and all
 * of its apparent detail comes from two places: the vertex normals recomputed
 * after displacement, and the image-based lighting in Atmosphere. That is enough
 * because the shot is always at distance and in fog — nothing here is ever seen
 * close enough for a surface map to be the thing that sells it.
 *
 * flatShading is off: the terrain reads as weathered ground rather than as
 * faceted crystal, and faceting at this polygon count would produce a very
 * distinctive low-poly look that is not what we are after.
 */
/*
 * THE GROUND DOES NOT CAST, ONLY RECEIVES.
 *
 * Self-shadowing drifts are the correct look and they were measurably worth it
 * — long raking shadows are what pushed the dark end of the histogram toward
 * the reference. They are also 262k triangles re-rendered into the shadow map
 * on every single frame, which took the renderer from 30fps to unresponsive.
 * The raking key already models the drifts through N.L alone; the cast shadows
 * were buying the last few percent of contrast at the cost of the frame.
 */

/**
 * Snow tile size in world units.
 *
 * A BALANCE BETWEEN TWO FAILURES, and both were visible on screen.
 *
 * Too large (26) and the generator's bumps came out over three units across,
 * reading as craters scattered over the field — shapes right for a block face
 * a couple of metres wide and absurd at landscape scale.
 *
 * Too small (8.5) and the tile repeats over three hundred times across the
 * plane. That was invisible while the surface was soft snow and became obvious
 * the moment the rock variant went on, because strong directional detail makes
 * the eye find the period: the near field filled with repeating diagonal
 * streaks. Tiling only shows when the pattern is loud enough to recognise.
 */
const SNOW_TILE = 62;
const SNOW_REPEAT = Math.round(TERRAIN_SIZE / SNOW_TILE);

/**
 * The rock tile, and it is a QUARTER of the snow's.
 *
 * MEASURED OFF THE REFERENCE, not chosen. Sampled in bands, igloo.inc's
 * foreground has a p10-to-p90 luminance spread of 95 and ours had 18 — the
 * single largest miss anywhere in the frame, larger than any error in overall
 * brightness. Its near ground is not a smooth white sheet at all: it is dark
 * stone grain with bright ice crust between, and that salt-and-pepper is where
 * almost all of its local contrast lives.
 *
 * Grain is the operative word. At a 30-unit tile the fracture pattern came out
 * as swells a person could stand on, which read as more landform rather than as
 * surface. At 17 it lands at roughly the size of the chips and gravel the
 * reference actually shows.
 *
 * Tiling this hard is safe for the reason the snow's note gives in reverse: a
 * repeat shows when the pattern is loud AND uniform. This one is loud and
 * spatially gated — see the outcrop term — so there is never a large enough
 * uninterrupted run of it for the eye to find the period.
 */
const ROCK_TILE = 20;
const ROCK_REPEAT = Math.round(TERRAIN_SIZE / ROCK_TILE);

/**
 * The crack tile, and it is an order of magnitude larger than the rock's.
 *
 * The two fields share one texture but not one scale, because they are not one
 * scale of thing. Fracture plates on a frozen crust are the size of a room, and
 * the network dividing them has to run across the ground for tens of metres
 * before it turns — sampled at the rock's 20-unit tile the whole network would
 * fit inside a stride, which reads as crackle glaze on a pot rather than as
 * broken ice.
 *
 * Tiling this large is normally where a repeat becomes visible, and it does not
 * here for a specific reason: the generator only keeps a fraction of the
 * network (see present in crackAt), so what lands on any one tile is a few
 * disconnected runs rather than a complete signature. There is not enough of it
 * in one place to recognise a second time.
 */
const CRACK_TILE = 70;
const CRACK_REPEAT = Math.round(TERRAIN_SIZE / CRACK_TILE);

/**
 * Scree on the slopes, wind-packed snow on the crests — plus a distance fade.
 *
 * THE MATERIAL IS NOT UNIFORM, AND THAT IS THE POINT. A single texture applied
 * evenly gives a field that reads as one substance shrink-wrapped over the
 * landform. Real high ground does the opposite: loose stone collects on the
 * steep faces where nothing else can sit, and wind-packed snow lies on the
 * flats and crests. So the same maps are read two ways and blended by how
 * upward-facing the ground is — coarse, darker and glossier down the slope,
 * smooth, brighter and matte toward the top.
 *
 * Slope is taken from the GEOMETRIC normal deliberately; see the note in the
 * shader for why the mapped one is the wrong input.
 *
 * ---
 *
 * It also fades the surface normals out with distance.
 *
 * A TILING NORMAL MAP ON A 2600-UNIT PLANE IS THE OLD FLICKER BUG WAITING TO
 * HAPPEN, and this is what makes it safe. Near the camera one tile covers 26
 * units and its detail is many pixels across, which is exactly what the ground
 * needs. Four hundred units out that same tile is a handful of pixels wide, so
 * the surface detail lands below the sampling rate: it cannot be resolved, it
 * simply aliases, and the smallest camera movement makes it crawl. That is the
 * shimmer that cost this scene the entire photographic-backdrop detour.
 *
 * Mipmaps alone do not save it, because the normal map's problem is not colour
 * averaging — averaging a field of opposing normals gives a flat normal with a
 * roughness that no longer matches, so the surface goes subtly wrong rather
 * than smooth. Blending the perturbed normal back toward the geometric one
 * fades the detail out honestly: the far field becomes plain shaded terrain,
 * which is all it ever reads as anyway at that distance.
 */
/**
 * GROUND FOG — as fog, not as geometry.
 *
 * Weather.jsx carries the post-mortem on the alternative: drifting cloud cards
 * were tried twice there, as flat sheets (which draw hard lines when seen
 * edge-on, because a plane edge-on IS a line) and as upright billboards (which
 * read as translucent cards standing in front of the landscape rather than as
 * air inside it). The note left behind says the thing that actually works is
 * modulating the existing fog rather than adding more surfaces, and that is
 * what this is.
 *
 * Three terms multiplied together:
 *
 * LOWNESS — an exponential falloff in world height, so the fog fills hollows
 * and thins out over the rises. This is the whole reason it reads as lying ON
 * the terrain: it is denser in the dips because the dips are lower, which is
 * what actual cold air does. It also puts the igloo's knoll above the layer,
 * so the structure stands clear of the mist that pools around it.
 *
 * BANKS — scrolling fbm across world XZ, so the layer is not a uniform slab.
 * Real ground fog is patchy, and the patches move.
 *
 * DISTANCE — it takes depth through the volume before it can accumulate.
 * Without this the fragment at the camera's feet is as foggy as the one two
 * hundred units away, which reads as a dirty lens.
 *
 * Added to three's own fog factor rather than replacing it: the exponential
 * distance fog is still doing the aerial perspective, and this is a layer
 * within it, not a substitute for it.
 */
const GROUND_FOG_GLSL = `
  float fogHash( vec2 p ) {
    return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
  }

  float fogNoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix(
      mix( fogHash( i ), fogHash( i + vec2( 1.0, 0.0 ) ), u.x ),
      mix( fogHash( i + vec2( 0.0, 1.0 ) ), fogHash( i + vec2( 1.0, 1.0 ) ), u.x ),
      u.y
    );
  }

  float fogFbm( vec2 p ) {
    float v = 0.0;
    float a = 0.5;
    for ( int i = 0; i < 3; i ++ ) {
      v += a * fogNoise( p );
      /* Not exactly 2, so the octaves never line their grids up and the
         lattice the value noise is built on stays invisible. */
      p *= 2.03;
      a *= 0.5;
    }
    /*
     * NORMALISED, and leaving this out is why the first attempt was invisible.
     *
     * Three octaves at halving amplitude sum to at most 0.5 + 0.25 + 0.125 =
     * 0.875, and since each octave averages 0.5 the typical value is about
     * 0.44. Feeding that into smoothstep(0.30, 0.82) put nearly the whole field
     * in the bottom fifth of the ramp, so the banks never formed however hard
     * the strength was pushed. Dividing by the maximum puts the signal back
     * across the full 0..1 the threshold was written for.
     */
    return v / 0.875;
  }
`;

/** Where the layer sits and how fast it thins going up, in world units. */
/*
 * RETUNED TO BE VISIBLE AT ALL.
 *
 * The first pass was measurably animating and practically invisible, which is
 * the worst of both — it cost the frames and showed nothing. Three things were
 * throttling it at once: the layer only reached 19 units up so it sat below
 * almost everything in shot, the depth ramp did not start accumulating until
 * 18 units and was still climbing at 260, and the drift worked out at about
 * 0.8 world units per second, which over a ten-second look is eight units on a
 * 2600-unit landscape.
 *
 * All three widened. The layer now fills the hollows properly, builds up over
 * the distances this shot actually spans, and moves at a speed you can see
 * without it looking like weather on fast-forward.
 */
/*
 * RAISED TO THE GROUND IT IS SUPPOSED TO LIE ON, from 2.0.
 *
 * This is an ABSOLUTE world height, and the ground is not at zero: the pad the
 * igloo stands on is at 15.78, and the flats around it are near that. So a
 * layer based at 2.0 and nine units thick sat entirely UNDERGROUND in the
 * foreground — at the pad the height term evaluated to exp(-13.78/9) = 0.22,
 * throwing away more than three quarters of it before anything else was
 * applied. The drift was being computed and then buried.
 *
 * 14 is just under the pad, so the mist pools on the flats at close to full
 * strength and still thins away up the hills exactly as intended: at y=60 the
 * near term is 0.006, which is gone.
 *
 * Tied to the terrain, so if the pad height moves this has to move with it.
 */
const FOG_BASE = 14.0;
/**
 * HOW FAST THE AIR THINS WITH ALTITUDE, in world units.
 *
 * The scale height of the medium: density falls by 1/e every this many units
 * above FOG_BASE. It is the number deciding which parts of the landscape are IN
 * the fog and which stand out of it, so it is set against the terrain's own
 * vertical range rather than picked. The igloo sits between 16 and 47 and the
 * ranges climb past 200.
 *
 * RAISED FROM 70. At that height the layer was physically correct and sat too
 * low for this landscape: the far peaks climbed clear of it and came back
 * sharp, which is exactly what real fog does and is not what the reference
 * looks like — igloo.inc's furthest ranges are nearly dissolved. Its fog is
 * simply deep enough that nothing in shot gets above it.
 *
 * RAISED AGAIN, 70 -> 120 -> 175, each time for the same reason and each time
 * measured against the reference rather than guessed. igloo.inc's furthest
 * ranges are so nearly dissolved that you read them as a change in the sky
 * rather than as mountains, and ours kept coming back as distinct grey
 * silhouettes — which is what a peak does when it climbs out of the fog layer.
 * Its air is simply deep enough that nothing in shot gets above it.
 *
 * 175 keeps the whole model — hollows still fill, crests still emerge, lifting
 * the camera on the retreat still thins everything — while putting even the
 * high ranges inside the medium instead of above it.
 *
 * Replaces FOG_THICKNESS, FOG_NEAR_THICKNESS and FOG_STRENGTH, which described
 * a layer painted onto the terrain and have no meaning for a medium.
 */
const FOG_SCALE_HEIGHT = 175.0;

/**
 * Trim on the scene's fog density for the height integral.
 *
 * three's FOG_EXP2 goes as the SQUARE of distance; a homogeneous medium goes
 * linearly, and this integral is the honest version — so the same density
 * constant lands somewhere different. Without a correction the far field came
 * out thinner than the exp2 version it replaces, and that version is what the
 * whole grade was measured against. 1.6 restored the mid-distance exactly.
 *
 * 2.6 goes past that deliberately. Held beside igloo.inc, matching the old exp2
 * fog was matching the wrong thing: our air was always thinner than the
 * reference's, so faithfully reproducing our own previous mid-distance kept a
 * gap we had stopped noticing. The reference's near hills are already
 * half-dissolved where ours were still legible.
 */
/*
 * DOWN FROM 2.6, WITH THE SCENE DENSITY IT MULTIPLIES.
 *
 * The two numbers are one setting — this is a trim on fogDensity, so cutting
 * the density in Atmosphere and leaving this alone would only soften the cut.
 * Both come down together: 0.0042 * 2.6 = 0.0109 becomes 0.0009 * 0.55 =
 * 0.0005, which is a twentieth of the air the scene used to be graded through.
 *
 * WHAT IS LEFT IS NOT A LOOK, IT IS A JOIN. At this density nothing in the
 * middle distance is meaningfully hazed; the only thing the term still does is
 * put about half a stop of grey on the far edge of the ground plane, 1900 units
 * out, so that the boundary of the terrain arrives as a fade rather than as a
 * horizon-wide straight line. Take it to zero and that edge is visible.
 *
 * Depth is carried by the moving air now — see Atmosphere's note. The wisps
 * deliberately do NOT scale off this any more: they have their own density in
 * FOG_WISP_DENSITY, because clearing the haze was taking the wind with it.
 */
const FOG_GAIN = 0.55;

/**
 * Samples along each view ray.
 *
 * The integral's accuracy and the pass's cost, in one number. Six is where the
 * dither stops having to hide anything: below it the error per ray is large
 * enough that even scattered it shows as a faint grain, and above it nothing
 * visibly improves because the density field is smooth and slow. Every extra
 * step is a noise lookup on every terrain fragment on screen.
 */
const FOG_STEPS = 6;

/**
 * HOW MUCH THE SAMPLING DOMAIN IS COMPRESSED ALONG THE WIND, and this one
 * number is the difference between weather and wind.
 *
 * The noise this reads is isotropic — its features come out round, and round
 * features drifting past read as clouds passing overhead however fast they are
 * pushed. Wind-driven snow does not look like that. It looks like long thin
 * filaments lying ALONG the flow, because the air is being sheared: a parcel
 * that starts as a blob is stretched out by the velocity gradient faster than
 * it can diffuse back.
 *
 * Simulating that shear is one way to get it. Compressing the sample domain on
 * the wind axis is the other, and it costs nothing: at 0.26 a step of one world
 * unit along X moves a quarter as far through noise space as a step along Z, so
 * every feature comes out roughly four times longer than it is wide, aligned
 * with the wind by construction.
 *
 * THE WIND IS +X, which is left-to-right in frame: the camera sits at z 370 and
 * looks at z 250, so its right hand points down +X. FOG_DRIFT and the spindrift
 * in Weather.jsx both have to agree with this — air blowing one way and snow
 * blowing the other is the single most obvious way to break the illusion.
 */
const FOG_WIND_STRETCH = 0.26;

/**
 * Size of one weather bank, as an inverse world scale.
 *
 * 1/300 units. Banks have to be big enough to read as masses of air and small
 * enough that more than one is in shot — a field whose features are wider than
 * the frame cannot be seen to move, it just changes the whole picture's level
 * together, which reads as the exposure drifting rather than as weather.
 *
 * COARSER THAN THE 1/230 IT REPLACES, because this layer is no longer the only
 * one. It has become the SLOW half of a two-speed atmosphere: the deep banks
 * that reach all the way to the far ranges and have to stay calm back there.
 * The fast, filamented half is FOG_WISP_* below, and it is deliberately kept
 * out of the distance.
 */
const FOG_WEATHER_SCALE = 1 / 300;

/**
 * How thin and how thick a bank makes the air, as multiples of the base
 * density.
 *
 * Kept deliberately modest. This is a MEDIUM being modulated, not a cloud
 * layer: at a wide spread the visible result is the whole distance pumping
 * between clear and white, which looks like a fault.
 *
 * NARROWED FROM 0.55..1.5, and the far mountains are the reason. This term is
 * the only one that reaches them — the wisp layer stops well short — so
 * whatever spread is set here is exactly how much the back of the frame
 * breathes. A range dissolving and re-forming behind the igloo pulls the eye
 * off the moving air in the middle ground, which is where the wind is supposed
 * to be read. The midpoint is unchanged at 1.0, so FOG_GAIN still means what it
 * was calibrated to mean.
 */
const FOG_WEATHER_MIN = 0.72;
const FOG_WEATHER_MAX = 1.32;

/**
 * How fast the weather drifts, in world units per second, on each axis.
 *
 * Different rates on the two axes on purpose: equal speeds translate the field
 * rigidly along one diagonal, and a pattern sliding as a whole reads as the
 * texture moving rather than as air. Unequal rates shear it, so banks appear to
 * grow and dissolve as they pass.
 *
 * SLOWED FROM [7.5, 3.2]. These are the heavy banks, and mass is read from
 * speed: a large body of air that moves as quickly as the streamers in front of
 * it has no weight to it. The separation between this and FOG_WISP_DRIFT is the
 * effect — one parallax between two layers of the same medium does more for the
 * sense of depth in the air than either layer does alone.
 */
const FOG_DRIFT = [5.5, 1.4];

/* -------------------------------------------------------------------------
   THE WISP LAYER — the fast, low, filamented air.
   ----------------------------------------------------------------------

   A SECOND MEDIUM RATHER THAN MORE MODULATION OF THE FIRST, and the reason is
   that the two want opposite things. The bank layer has to reach 1500 units to
   do aerial perspective, which forces long steps, which forces low frequencies
   — anything finer than a step is undersampled and comes back as scintillation
   rather than as detail. Wisps are exactly the fine, near thing that constraint
   forbids.

   So they get their own march, over a much shorter reach, at a step size small
   enough to resolve them. It is more samples in total and they are spent where
   they are visible.

   ADDED TO THE HAZE, NOT MULTIPLIED INTO IT. A multiplier can only reveal what
   the base density already had — where the air is thin the streak is thin too,
   so wisps would disappear over exactly the clear middle ground where they are
   supposed to show. As an additive medium they carry their own extinction and
   read against the dark ranges, which is where the reference puts them. */

/**
 * Size of one wisp, as an inverse world scale — before FOG_WIND_STRETCH, which
 * stretches it about four times longer along the wind.
 *
 * 1/165 crosswind, so roughly 165 units thick and 630 long. That is a streamer
 * the width of the igloo's mound and long enough to run most of the way across
 * frame, which is the shape blowing snow actually makes.
 *
 * IT IS ALSO THE SAMPLING FLOOR. At FOG_WISP_STEPS over FOG_WISP_REACH the
 * steps are 74 units, so this puts a bit over two samples across a wisp. Finer
 * wisps than this would alias no matter how good they looked in a still — the
 * fine airborne detail is carried by the spindrift points in Weather.jsx, which
 * are geometry and cannot alias.
 */
const FOG_WISP_SCALE = 1 / 165;

/**
 * How fast the wisps travel, in world units per second.
 *
 * Six times the banks. Cold katabatic wind moves the light stuff and leaves the
 * heavy stuff behind, and reproducing that ratio is most of what makes this read
 * as one wind rather than as two unrelated animations. The small Z component
 * shears the field so streamers grow and dissolve as they pass instead of
 * sliding through unchanged.
 */
const FOG_WISP_DRIFT = [34.0, 4.0];

/**
 * The wisp layer's scale height, in world units above FOG_BASE.
 *
 * A quarter of the banks' 175, which is what makes it a different thing rather
 * than a faster copy: blowing snow is picked up off the surface and stays near
 * it, so the streamers hug the drifts and thin out well below the ridgelines.
 * The igloo's dome, at 47, sits about half way up the layer — air moves past
 * its shoulders and is gone by the crown.
 */
const FOG_WISP_HEIGHT = 44.0;

/**
 * How much extinction a saturated wisp adds, as an ABSOLUTE density.
 *
 * IT USED TO BE A MULTIPLE OF fogDensity AND THAT WAS THE BUG. The wisps were
 * conceived as weather inside the haze, so they were scaled by it — which
 * meant that clearing the haze cleared the wind along with it, and the scene
 * went from too foggy to no air at all in one move. They are not a modulation
 * of the medium; they are the only medium anyone is meant to see.
 *
 * So this is a density in its own units, and the two numbers are now
 * independent: the standing haze can go to nothing while the streamers stay
 * exactly as strong as they were.
 *
 * A saturated column comes out around a third of the way to fog colour, which
 * is a streamer you can clearly watch cross the frame and cannot mistake for
 * the scene being foggy.
 */
/**
 * THE MIST'S OWN COLOUR, and it is not the fog's.
 *
 * Everything used to mix toward fogColor because there was only one
 * atmospheric material in the scene. There are two now and they are physically
 * different things. FOG_COLOR is distance haze: air, seen through kilometres of
 * itself, which takes the colour of the sky. This is blowing snow — actual ice
 * crystals in suspension, each one scattering nearly all of the light that hits
 * it — and suspended snow is white for the same reason lying snow is.
 *
 * Under a blue sky the difference is not subtle. Haze goes blue and mist stays
 * white, and a ribbon of white drifting across a blue-shadowed slope is the
 * thing the reference actually shows.
 *
 * Very slightly cool rather than pure white: it is lit by the sky along with
 * everything else.
 */
const FOG_WISP_COLOR = [0.94, 0.96, 0.99];

/*
 * RAISED FROM 0.0022, ONCE THE HAZE WAS ACTUALLY GONE.
 *
 * The first value was set while the standing fog was still there, and it was
 * being flattered by it: a streamer only has to add a little extinction to be
 * visible against air that is already half-grey. Against clear air it has to
 * carry the whole read on its own, and at 0.0022 it did not — the wisps
 * measured out at a few luminance points over the mountain behind them, which
 * is below the threshold of vision on a moving image.
 *
 * This is the number that decides whether there is visible wind in this scene
 * at all, so it gets set against what it has to be seen ON: the mid-distance
 * ranges, which sit well below fog colour. A saturated column now lands about
 * half way to the fog colour over them and close to nothing over the lit
 * foreground snow, which is already near that value — so the streamers show
 * exactly where the brief wants them and stay out of the foreground.
 *
 * BACK DOWN TO 0.0022, AND THE NOTE ABOVE IS NOT WRONG — IT IS COMPETING.
 *
 * The argument for 0.0042 is that a streamer has to be seen ON something, and
 * the something it picked is the mid-distance ranges. Those are now the ranges
 * carrying the exposed rock, and a saturated column landing HALF WAY to fog
 * colour over them is exactly enough to erase it: measured by rendering the
 * rock mask as a flat red, the hills came back salmon rather than red, which
 * is the mist covering them and nothing else.
 *
 * Both features want the same pixels and only one of them can have most of
 * them. The rock wins because it is the landscape and the wisps are weather.
 *
 * AND NOW IT IS ZERO — the layer is off, not merely thinned.
 *
 * Halving it was a compromise and it still cost the ranges most of their
 * contrast, because the wisps are near-white and they are drawn IN FRONT of
 * the exact surfaces the stone lives on. There is no density at which a
 * near-white veil over the hills leaves the stone under it alone; it only
 * decides how much is left. The brief is an open, sunlit frame with clear air
 * between the camera and the ranges, so the layer goes.
 *
 * Everything below still compiles and the constants are all still here — the
 * march, the drift, the wind axis, the crest threshold — so restoring the
 * weather is this one number and nothing else.
 */
const FOG_WISP_DENSITY = 0.0;

/**
 * Where the wisps stop, in world units from the lens.
 *
 * THE DISTANCE GATE IS A LOOK, NOT AN OPTIMISATION. Air a kilometre away is
 * moving too, and if it is drawn moving then the whole frame churns and there
 * is nothing still to measure the movement against. Holding the far ranges calm
 * is what lets the middle ground read as fast.
 *
 * Note this is a distance along the RAY, not a distance to the fragment: a peak
 * 1500 units out still has the first 520 units of air in front of it marched, so
 * streamers cross it. That is the shot in the reference — wisps in front of the
 * mountains, mountains themselves stable.
 */
const FOG_WISP_REACH = 520.0;
const FOG_WISP_STEPS = 7;
/** Where the layer starts falling away, so the gate has no edge on it. */
const FOG_WISP_FADE = 240.0;

/**
 * The threshold that turns a noise field into filaments.
 *
 * Left as raw noise this is a haze that varies, which is what the old single
 * layer was. Ramping it steeply between two values well above the mean keeps
 * only the crests, and the crests of a stretched field are long thin strands
 * with clear air between them. Widen the pair and it goes back to haze; narrow
 * it and the strands get hard edges and read as ribbons.
 */
/*
 * WIDENED DOWNWARD, from 0.46. With the haze gone the frame needs more air in
 * it, and there are two ways to get it: make each strand denser, or have more
 * of them. Density alone starts to read as smoke — a few very solid objects
 * moving through clear air. Dropping the low edge instead recruits the shoulders
 * of each crest, so strands get wider and more of them clear the threshold,
 * which is the shape a gust actually has.
 */
const FOG_WISP_LOW = 0.40;
const FOG_WISP_HIGH = 0.86;

/* -------------------------------------------------------------------------
   TURBULENCE
   ----------------------------------------------------------------------

   AS A WARP OF THE SAMPLING DOMAIN, not as a term added to the result. Adding
   noise to the density gives a field that fizzes in place; displacing the
   coordinate the density is read at MOVES the material, so a streamer bends and
   its bend travels along it. That is the difference between a texture flickering
   and air being disturbed.

   Sines rather than more noise lookups, deliberately. The warp has to be
   evaluated at every sample of every fragment, and a noise call is four hashes;
   three sines cost roughly a fifth of one and, because the frequencies are
   incommensurate and applied on different axes, the result does not read as
   periodic. Noise buys nothing here that is worth that.

   Each entry is [ spatial frequency, rate in radians per second, amplitude in
   world units ].
*/
/** The long meander: the whole flow wandering across the valley. */
const FOG_TURB_LONG = [0.0042, 0.23, 78.0];
/** A shorter waver on top, so single streamers snake. */
const FOG_TURB_SHORT = [0.0125, 0.51, 26.0];
/** Height shear — layers at different altitudes slide at different phases. */
const FOG_TURB_LIFT = [0.052, 0.74, 14.0];

/**
 * EDDIES ROUND THE HERO OBJECT.
 *
 * Air does not pass through a dome, it goes around it, and the wake is the one
 * place in this shot where the wind interacts with something the eye already
 * knows the shape of. Getting it there is worth more than the same amount of
 * motion anywhere else in frame.
 *
 * Modelled as a tangential displacement of the sampling domain that decays
 * exponentially with radius from the mound — the cheapest thing that curls a
 * field. It is not a solved flow and does not need to be: at this density all
 * that has to survive is the impression that the streamers bend around the
 * igloo rather than through it.
 *
 * The strength breathes slowly, because a static swirl welded to a fixed
 * landmark starts to read as a lens artefact.
 */
const FOG_EDDY_RADIUS = 120.0;
const FOG_EDDY_STRENGTH = 34.0;

/**
 * THE FLOW FIELD — where a sample "really" comes from, once the wind has moved
 * it.
 *
 * Everything about the air's motion is in here, and it is one function because
 * both media have to be pushed by the SAME wind. Two layers turbulating
 * independently do not read as one atmosphere at two scales, they read as two
 * effects; passing amount scales the whole displacement instead, so the banks
 * get a gentler version of exactly the flow the wisps get.
 *
 * It returns a position, not a density. Nothing here knows or cares what will
 * be sampled at the point it hands back — which is what lets the same warp
 * serve a 300-unit bank field and a 165-unit wisp field without either of them
 * knowing about the other.
 */
const FOG_WIND_GLSL = `
  vec2 fogWind( vec3 p, float t, float amount ) {
    vec2 q = p.xz;

    /*
     * The meander, on the CROSSWIND axis of the input and displacing ALONG the
     * wind. Reading the phase from p.z means neighbouring streamers — which are
     * separated in z — are at different phases, so they snake independently
     * instead of the whole field waving as one sheet.
     */
    q.x += sin( p.z * ${FOG_TURB_LONG[0]} + t * ${FOG_TURB_LONG[1]} ) * ${FOG_TURB_LONG[2].toFixed(1)} * amount;
    q.x += sin( p.z * ${FOG_TURB_SHORT[0]} - t * ${FOG_TURB_SHORT[1]} + 2.1 ) * ${FOG_TURB_SHORT[2].toFixed(1)} * amount;

    /*
     * Height shear. Wind over snow is slower at the surface than a few metres
     * up, and the visible consequence is that a streamer is not vertical: its
     * top is carried ahead of its base. Phasing the displacement on p.y is the
     * cheap version of that, and it is most of why this reads as a volume
     * rather than as a layer painted at one altitude.
     */
    q.x += sin( p.y * ${FOG_TURB_LIFT[0]} + t * ${FOG_TURB_LIFT[1]} ) * ${FOG_TURB_LIFT[2].toFixed(1)} * amount;

    /* A little waver across the wind as well, so the streaks are not a comb. */
    q.y += sin( p.x * ${(FOG_TURB_SHORT[0] * 0.7).toFixed(5)} + t * ${(FOG_TURB_SHORT[1] * 0.8).toFixed(3)} ) * ${(FOG_TURB_SHORT[2] * 0.55).toFixed(1)} * amount;

    /*
     * The eddy round the mound — see FOG_EDDY_RADIUS. A tangential push whose
     * magnitude decays with radius curls the field; the breathing term keeps it
     * from sitting on the landmark as a fixed swirl.
     */
    vec2 rel = p.xz - vec2( ${MOUND_AT[0].toFixed(1)}, ${MOUND_AT[1].toFixed(1)} );
    float rd = length( rel );
    float curl = exp( -rd / ${FOG_EDDY_RADIUS.toFixed(1)} )
      * ${FOG_EDDY_STRENGTH.toFixed(1)} * amount
      * ( 0.65 + 0.35 * sin( t * 0.4 - rd * 0.03 ) );
    q += vec2( -rel.y, rel.x ) / max( rd, 1.0 ) * curl;

    return q;
  }
`;

/**
 * The fragment's world position, and a value-noise fbm to read it with.
 *
 * PULLED OUT OF THE FOG, WHICH IS WHERE IT USED TO LIVE. It was the fog's
 * private business right up until the outcrops needed the same two things —
 * where in the world this fragment is, and a low-frequency field over it — and
 * a second copy of either would be a redeclaration and a compile error, not a
 * duplication you find later by reading.
 *
 * So it is one prefix, added once, and both passes read from it. Every pass
 * that wants world-space anything goes through here.
 */
const worldSpace = (shader) => {
  shader.vertexShader = `varying vec3 vFogWorld;
     ${shader.vertexShader}`.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
     vFogWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`
  );

  shader.fragmentShader = `varying vec3 vFogWorld;
     ${GROUND_FOG_GLSL}
     ${shader.fragmentShader}`;
};

/**
 * The rock maps, bound as extra samplers.
 *
 * A SECOND MATERIAL WAS THE OBVIOUS ALTERNATIVE AND IT CANNOT WORK HERE. Two
 * meshes with two materials means two surfaces at the same place fighting over
 * the depth buffer, or a second draw of a 262k-triangle plane — and either way
 * the blend between them would be a hard edge, because a material is uniform
 * over whatever it is applied to. Blending has to happen per fragment, so both
 * sets of maps have to be reachable from one shader.
 *
 * Textures attached through onBeforeCompile uniforms are uploaded and bound the
 * same way the material's own slots are; the only thing they do not get is the
 * automatic UV transform, which is why the scale is passed in explicitly below.
 */
const rockMaps = (shader, maps, scale, relief, crackScale) => {
  shader.uniforms.uRockMap = { value: maps.colorMap };
  shader.uniforms.uRockRough = { value: maps.roughnessMap };
  shader.uniforms.uRockNormal = { value: maps.normalMap };
  shader.uniforms.uRockScale = { value: scale };
  shader.uniforms.uRockRelief = { value: relief };
  /* Where the generator's relief actually sits — see reliefStops. These are the
     edges the exposed/filled decision is made on, so the split is a quartile of
     the real field rather than a number somebody liked the look of. */
  shader.uniforms.uRockLow = { value: maps.patchStops.p35 };
  shader.uniforms.uRockHigh = { value: maps.patchStops.p88 };
  shader.uniforms.uGlazeLow = { value: maps.patchStops.p05 };
  shader.uniforms.uGlazeHigh = { value: maps.patchStops.p20 };
  shader.uniforms.uRockLowRelief = { value: maps.reliefStops.p25 };
  shader.uniforms.uRockHighRelief = { value: maps.reliefStops.p75 };
  /*
   * The cracks are sampled from the same texture at a much coarser scale — see
   * CRACK_TILE. One extra fetch of a sampler that is already bound.
   */
  shader.uniforms.uCrackScale = { value: crackScale };

  shader.fragmentShader = `uniform sampler2D uRockMap;
     uniform sampler2D uRockRough;
     uniform sampler2D uRockNormal;
     uniform float uRockScale;
     uniform float uRockRelief;
     uniform float uRockLow;
     uniform float uRockHigh;
     uniform float uGlazeLow;
     uniform float uGlazeHigh;
     uniform float uRockLowRelief;
     uniform float uRockHighRelief;
     uniform float uCrackScale;
     ${shader.fragmentShader}`;
};

/**
 * ATMOSPHERIC HAZE, RAYMARCHED — a medium the scene sits inside, with weather
 * moving through it.
 *
 * WHY THIS OWNS THE WHOLE FOG COMPUTATION rather than layering onto three's.
 * three offers fog as a function of DISTANCE alone, and distance alone cannot
 * describe air: a peak and the valley behind it at the same range come out
 * identically hazed, so the atmosphere reads as a flat veil hung at one depth.
 * Replacing the chunk outright is the only way to make the haze depend on how
 * high, and through what, you are looking.
 *
 * THE MODEL. Density falls off exponentially with altitude and varies through
 * the volume, and what reaches the eye is that density integrated along the ray
 * to the surface.
 *
 *   rho(p) = rho0 * exp( -(p.y - base) / H ) * weather(p.xz, t)
 *   tau    = integral of rho along the ray
 *
 * WHY THIS MARCHES INSTEAD OF USING THE CLOSED FORM. The height falloff alone
 * has an analytic integral, and this used it — one exp, no loop. That version
 * is in the history and it was correct and it was DEAD: uniform air has nothing
 * moving in it, and a landscape whose only motion is snowfall reads as a
 * photograph.
 *
 * The obvious way to add movement is to multiply the analytic answer by a noise
 * field, and that is the trap. Two versions did it, and both sampled the field
 * at the FRAGMENT's world position — which makes the amount of haze a function
 * of where the ground happens to be, so a patch of thicker air paints itself
 * onto the hillside as a soft grey blotch. It reads as a cloud shadow because
 * structurally that is exactly what it is: a field projected down onto terrain.
 *
 * Air does not vary across the surface you are looking at, it varies along the
 * LINE OF SIGHT — so the only honest way to have both movement and no
 * projection is to sample the density at points in the VOLUME and sum. Which is
 * what this does. Two fragments at different depths now look through different
 * air, and a bank drifts between the camera and a ridge rather than sliding
 * across the ridge's face.
 *
 * THE COST is FOG_STEPS single-octave noise lookups per fragment — one octave,
 * not the three fogFbm uses, because the weather wanted here is one large soft
 * scale and the extra octaves would be paid for at every step to add detail
 * finer than a bank.
 *
 * THE DITHER IS NOT OPTIONAL. Six samples along a ray hundreds of units long is
 * a coarse integral, and starting every ray at the same offset makes the error
 * identical for neighbouring pixels — which is visible as smooth banded shells
 * standing in the air. Offsetting each ray by a per-pixel hash turns that
 * coherent banding into fine noise, which at this contrast is invisible.
 */
const groundFog = (shader, uTime) => {
  shader.uniforms.uTime = uTime;

  shader.fragmentShader = `uniform float uTime;
     ${FOG_WIND_GLSL}
     ${shader.fragmentShader}`.replace(
    /*
     * REPLACED, NOT APPENDED. three's chunk has already mixed toward the fog
     * colour by the time anything downstream could run, so the original value
     * is gone and there is no way to reach the result from outside. Owning the
     * computation is what makes a different fog model possible at all.
     */
    '#include <fog_fragment>',
    `#ifdef USE_FOG
     {
       vec3 toFrag = vFogWorld - cameraPosition;
       float dist = length( toFrag );
       vec3 dir = toFrag / max( dist, 1e-4 );

       /* Per-pixel offset into the first step — see the note above. */
       float jitter = fogHash( gl_FragCoord.xy );

       /* The wind axis, in the domain-compressed space the fields are read in.
          See FOG_WIND_STRETCH: this is what makes a blob into a streamer. */
       const vec2 windAxis = vec2( ${FOG_WIND_STRETCH.toFixed(3)}, 1.0 );

       /* ---------------------------------------------------------------
          THE DEEP AIR. Aerial perspective, and the slow banks moving in it.
          This is the term that reaches the far ranges, so it is the one that
          has to stay calm out there — hence the narrow weather spread and the
          reduced share of the flow field it is given.
          --------------------------------------------------------------- */
       float ds = dist / float( ${FOG_STEPS} );
       float tau = 0.0;

       for ( int i = 0; i < ${FOG_STEPS}; i ++ ) {
         vec3 p = cameraPosition + dir * ( ( float( i ) + jitter ) * ds );

         /* Altitude falloff: the layer itself. */
         float h = exp( -( p.y - ${FOG_BASE.toFixed(1)} ) / ${FOG_SCALE_HEIGHT.toFixed(1)} );

         /*
          * The weather, drifting. Sampled in world space so the banks belong to
          * the world rather than to the screen, and offset by time on both axes
          * at different rates so the field slides rather than translating
          * rigidly along one direction.
          *
          * A THIRD OF THE FLOW FIELD. Heavy air is not pushed around as readily
          * as the streamers in front of it, and — more practically — this term
          * carries the whole distance. Turbulating it hard makes the mountains
          * boil.
          */
         vec2 q = fogWind( p, uTime, 0.34 );
         float n = fogNoise(
           ( q + vec2( uTime * ${FOG_DRIFT[0].toFixed(1)}, uTime * ${FOG_DRIFT[1].toFixed(1)} ) )
           * ${FOG_WEATHER_SCALE.toFixed(5)} * windAxis
         );

         tau += h * mix( ${FOG_WEATHER_MIN.toFixed(2)}, ${FOG_WEATHER_MAX.toFixed(2)}, n );
       }

       tau *= fogDensity * ${FOG_GAIN.toFixed(2)} * ds;

       /* ---------------------------------------------------------------
          THE WISPS. A second, shallower, much faster medium marched only over
          the near and middle ground — see the FOG_WISP_* block for why it is a
          separate march rather than another octave of the one above.
          --------------------------------------------------------------- */
       float reach = min( dist, ${FOG_WISP_REACH.toFixed(1)} );
       float dw = reach / float( ${FOG_WISP_STEPS} );
       float wisps = 0.0;

       for ( int i = 0; i < ${FOG_WISP_STEPS}; i ++ ) {
         float t = ( float( i ) + jitter ) * dw;
         vec3 p = cameraPosition + dir * t;

         /*
          * Clamped below the base, unlike the layer above. At a 44-unit scale
          * height a sample thirty units under the snow would evaluate to nearly
          * three times full density, and rays that grazed a dip came back with
          * a bright smear on them. A layer sitting ON the ground has a top, not
          * an unbounded floor.
          */
         float h = exp( -max( p.y - ${FOG_BASE.toFixed(1)}, 0.0 ) / ${FOG_WISP_HEIGHT.toFixed(1)} );

         vec2 q = fogWind( p, uTime, 1.0 );
         float n = fogNoise(
           ( q + vec2( uTime * ${FOG_WISP_DRIFT[0].toFixed(1)}, uTime * ${FOG_WISP_DRIFT[1].toFixed(1)} ) )
           * ${FOG_WISP_SCALE.toFixed(5)} * windAxis
         );

         /* Crests only — this is what makes strands instead of haze. */
         n = smoothstep( ${FOG_WISP_LOW.toFixed(2)}, ${FOG_WISP_HIGH.toFixed(2)}, n );

         /* And out by the far end of the reach, so the gate has no edge. */
         float fade = 1.0 - smoothstep( ${FOG_WISP_FADE.toFixed(1)}, ${FOG_WISP_REACH.toFixed(1)}, t );

         /*
          * IN AGAIN OVER THE FIRST SIXTY UNITS, which is not symmetry with the
          * far fade — it is a different problem. Fog colour is lighter than the
          * mountains and DARKER than the lit foreground snow, so a streamer
          * that reaches the lens does not veil the near ground, it dirties it:
          * grey smears sliding over the brightest part of the frame, which read
          * as a soiled lens rather than as air. Holding the layer off the
          * camera keeps the wisps where they are supposed to be seen, which is
          * across the middle ground against the ranges.
          */
         fade *= smoothstep( 0.0, 60.0, t );

         wisps += h * n * fade;
       }

       /*
        * TWO MEDIA, TWO MIXES — and they cannot be summed into one.
        *
        * The aerial haze and the blown snow have different colours now (see
        * FOG_WISP_COLOR), and optical depth is only additive between media that
        * scatter the same light. Adding the wisps into the aerial depth and mixing once
        * toward fogColor would paint the mist the colour of the distance, which
        * is precisely the thing that stops it reading as snow in the air.
        *
        * Applied in order: the haze first, because it is behind — it is the
        * whole column of air out to the surface — and the mist over it, because
        * it lives in the near part of that column, between the ridges and the
        * lens.
        */
       float aerial = clamp( 1.0 - exp( -max( tau, 0.0 ) ), 0.0, 1.0 );
       gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, aerial );

       /* Its own density, not a share of fogDensity — see FOG_WISP_DENSITY. */
       float mistTau = wisps * ${FOG_WISP_DENSITY.toFixed(5)} * dw;
       float mist = clamp( 1.0 - exp( -max( mistTau, 0.0 ) ), 0.0, 1.0 );
       gl_FragColor.rgb = mix(
         gl_FragColor.rgb,
         vec3( ${FOG_WISP_COLOR[0]}, ${FOG_WISP_COLOR[1]}, ${FOG_WISP_COLOR[2]} ),
         mist
       );
     }
     #endif`
  );
};

const screeAndSnow = (shader) => {
  /*
   * NO DETILING PASS.
   *
   * There was one here that sampled each map twice — once normally, once
   * rotated at an incommensurate scale — and blended with a weight that drifted
   * across the surface. It was meant to break the 137x UV repeat.
   *
   * It did not, because the repeat was never the problem: bisecting with
   * normalScale at zero showed the streaks surviving in the ALBEDO with no
   * normal perturbation at all. Worse, blending in a second sample at 2.3x
   * scale under a spatially varying weight generates broad flowing bands of its
   * own — so a fix for waves that were not there was adding waves that were.
   */
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <normal_fragment_maps>',
    `#include <normal_fragment_maps>

     /*
      * NO SLOPE BLEND. This used to read the geometric normal and blend
      * between scree and packed snow by how upward-facing the ground was.
      * The idea was right and the execution made waves.
      *
      * MEASURED: over the near field the geometric normal's Y runs from 0.83
      * to 1.00 with a median of 0.98, and 40% of the surface sat inside the
      * smoothstep(0.72, 0.975) transition. The terrain also carries a fine
      * displacement term, so within that window normal.Y oscillates rapidly
      * from one quad to the next — and because the blend drove relief, colour
      * AND roughness at once, that oscillation came out as bright striations
      * running along the contours. They looked like a tiling artefact and were
      * not: a UV repeat would run straight across the plane regardless of the
      * landform, whereas these followed the hills, which is what gave it away.
      *
      * A slope blend can only work on terrain whose slope range is wide
      * compared to its surface noise. This one's is not, so the material is
      * uniform and the landform is described by lighting alone.
      */
     float snowDist = length( vViewPosition );
     float snowFade = 1.0 - smoothstep( 140.0, 620.0, snowDist );

     /*
      * A SECOND, MUCH LONGER FADE — FOR COLOUR ONLY.
      *
      * snowFade above is an aliasing guard and it is tuned for NORMALS, which
      * is the case where fading early is mandatory: averaging a field of
      * opposing normals gives a flat normal whose roughness no longer matches,
      * so unresolvable relief does not soften, it goes wrong and crawls.
      *
      * Colour has no such failure. Averaging two albedos gives the albedo in
      * between, which is exactly what a mipmap is for and exactly what distance
      * should do. Holding the two to one fade meant the ground lost its grain
      * ninety units out — and the measurements say the reference's MID band
      * carries a spread of 90 against our 33, so most of what was missing was
      * missing right there, well beyond where relief can survive.
      */
     /*
      * PUSHED BACK, from 260/940.
      *
      * The paragraph above is the right argument and it did not go far enough.
      * Colour genuinely has no aliasing failure at distance — a mipmap averages
      * two albedos into the albedo between them, which is what should happen —
      * so the only reason to fade it at all is that eventually it stops being
      * resolvable and is wasted work.
      *
      * 260 is well before that point. Screenshotted beside igloo.inc, its hills
      * carry visible snow grain and exposed rock right back to the ranges,
      * while ours turn smooth and plasticky just past the igloo and the middle
      * distance reads as flat cardboard cutouts rather than as ground. That is
      * the single biggest remaining difference between the two frames, and it
      * is this line.
      *
      * The NORMALS are untouched — snowFade still fades relief on its own,
      * earlier and for the reason given above, which is the fade that actually
      * guards against crawling. This one carries colour, scree and cracks, none
      * of which can shimmer the way an averaged normal can.
      */
     float grainFade = 1.0 - smoothstep( 520.0, 1800.0, snowDist );

     /*
      * THE FRONT/BACK SPLIT, and it is the single gate every rock term now
      * passes through.
      *
      * The reference divides its landscape in two and the line is sharp. The
      * near ground — the drift the igloo stands in and the swells either side
      * of it — is unbroken snow: not a stone in it, no grain, nothing but wind
      * texture. Everything rocky is BEHIND that, on the hills and peaks, where
      * the slopes get steep enough to shed snow and the exposed faces come
      * through as dark bands.
      *
      * That is a real distinction and not an artistic one. Snow accumulates on
      * flat and gentle ground and stays; it slides off anything steep. The
      * foreground here is a snowfield and the background is mountain, so one is
      * covered and the other is not.
      *
      * EVERY ROCK TERM WAS GATED THE OTHER WAY ROUND. The two distance fades in
      * this shader — grainFade and the old bareFade — both faded rock OUT with
      * distance, because they were written as aliasing guards: fine detail
      * cannot resolve at range, so it was removed at range. Correct as far as
      * it goes, and it produced the exact inverse of the intended picture — a
      * gravelly foreground under clean white hills.
      *
      * So this is a fade IN. Nothing rocky exists inside 230 units, it arrives
      * over the next two hundred, and the aliasing guards still clip it at the
      * far end where it genuinely cannot be drawn.
      */
     float rockZone = smoothstep( 230.0, 430.0, snowDist );
     normal = normalize( mix( normalize( vNormal ), normal, snowFade ) );

     /*
      * SNOW LYING ON THE GROUND.
      *
      * Taken from the GEOMETRIC normal, not the mapped one. Snow settles by
      * gravity, so where it lies depends on which way the LANDFORM faces —
      * reading the perturbed normal would let every bump in the texture vote
      * and the result comes out as speckle rather than as drifts.
      *
      * The window is wide (0.45 to 0.95) on purpose. A narrow one put most of
      * the surface inside the transition, and since the terrain carries fine
      * displacement the value oscillated from quad to quad and banded along the
      * contours — the same failure that cost a long hunt earlier.
      *
      * BROKEN UP BY THE ROCK'S OWN ALBEDO. A clean slope threshold gives a
      * drawn snow line, which no real ground has. Using the surface's own
      * brightness as a mask means snow gathers on the raised parts and the
      * hollows stay dark, so the edge is ragged and follows the rock.
      */
     vec3 wGeo = inverseTransformDirection( normalize( vNormal ), viewMatrix );
     float lying = smoothstep( 0.45, 0.95, wGeo.y );
     float relief = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
     float patchy = mix( 0.35, 1.0, smoothstep( 0.30, 0.62, relief ) );
     /*
      * THE SNOW LINE — snow taken OFF the hills, and left on everything in
      * front of them.
      *
      * Up to here the ground has been snow with rock allowed to show through on
      * the steep parts, which is the right model for a snowfield and the wrong
      * one for a mountain. Above the snow line the relationship inverts: the
      * ground is rock, and snow is what has managed to LODGE on it — in the
      * gullies, on the benches, anywhere the angle is shallow enough or the
      * hollow deep enough to hold it. That is why a peak reads as dark with
      * white in its creases rather than as white with dark patches.
      *
      * TWO TERMS, AND THE WORLD-SPACE ONE IS THE IMPORTANT HALF. Slope alone
      * gives the speckle this shader has produced before: every fragment
      * decides for itself, so what comes out is a fine mottle rather than a
      * mountainside with bare faces and filled gullies. A low-frequency field
      * read in WORLD space instead paints in large coherent areas — one flank
      * stripped, the hollow beside it filled — which is what the eye reads as a
      * snow line. 1/154 units, so a patch is about the width of the igloo's
      * mound: big enough to be a face, small enough that several fit on a hill.
      *
      * Gated on rockZone, so the front of the shot is untouched: the drift the
      * igloo stands in and the swells either side of it keep every bit of their
      * snow. This only starts beyond 430 units, which is where the hills are.
      */
     /*
      * THE THRESHOLD IS NARROW AND HIGH, AND THE FIRST TRY WAS NEITHER.
      *
      * It was smoothstep( 0.34, 0.64 ) over an fbm whose values cluster around
      * 0.5 — so nearly every fragment on the back landed somewhere in the
      * middle of the ramp and came out about half bare. Half the snow removed
      * everywhere is not a snow line; it is a wash. The hills went a uniform
      * putty grey with no white left and no rock gained, which is worse than
      * either end.
      *
      * A snow line is close to BINARY. Standing on a mountainside you are on
      * snow or you are on rock; the transition between them is metres wide, not
      * the whole flank. So the ramp is narrowed to a fifth of its width and
      * moved above the field's mean, which puts most of the hill on the snow
      * side and cuts a minority of it clear through to stone — coherent faces
      * with white between them, which is what the reference has and what the
      * marked-up areas point at.
      *
      * THE SLOPE TERM IS DEMOTED TO A NUDGE for the same reason. It varies
      * per-fragment, so anything more than a small share of the sum drags the
      * result back toward the middle everywhere and undoes the threshold.
      */
     /*
      * TWO OCTAVES, NOT ONE, AND NO HEIGHT TERM AT ALL.
      *
      * An earlier pass keyed this on world height — a literal snow line, rock
      * above it and snow below. It is the physical model and it is not the
      * picture wanted here: a height threshold draws a horizontal band across
      * every landform in the frame at once, so the hills all break at the same
      * line and the eye reads a contour map. What the reference actually has is
      * PATCHES — stone showing through in places, with no rule you can state by
      * looking at it — and the ground everywhere else is ice.
      *
      * So the field alone decides, and it is two octaves because one is not
      * enough to look accidental. hillBed at 1/154 units sets where a patch is
      * — about the width of the igloo's mound, big enough to be a face. hillFig
      * at 1/53 breaks its edge so the patch is ragged rather than a blob, which
      * is the difference between rock and a stain.
      */
     float hillBed = fogFbm( vFogWorld.xz * 0.0065 );
     float hillFig = fogFbm( vFogWorld.xz * 0.0190 );
     float hillSlope = 1.0 - smoothstep( 0.86, 0.985, wGeo.y );
     /*
      * THE THRESHOLD IS NARROW AND ABOVE THE FIELD'S MEAN, AND BOTH HALVES OF
      * THAT MATTER.
      *
      * NARROW, because a snow-to-stone edge is metres wide and not a hillside
      * wide. The first version ramped over 0.30 of a field whose measured
      * spread is 0.124, so nearly every fragment landed mid-ramp and came out
      * half bare — the hills went a uniform putty grey with no white left and
      * no rock gained, which is worse than either end. This ramp is 0.07, a bit
      * over half a standard deviation.
      *
      * ABOVE THE MEAN, because ice is the ground and rock is the exception. The
      * combined field is measured at mean 0.50, and cutting at 0.53 leaves
      * roughly a quarter of the back of the landscape bare and three quarters
      * of it under snow.
      *
      * THE SLOPE IS A BIAS ON THE FIELD, NOT A TERM BESIDE IT. Added to the
      * result it contributes a flat quarter over any hillside — it barely
      * varies at this terrain's slopes — and drags everything back to the
      * middle, which is the wash again. Nudging the field's own value instead
      * biases WHICH patches open: steep ground needs a little less noise to go
      * bare and flat ground a little more.
      */
     /*
      * AND IT IS THE COMPLEMENT OF THE FIELD, NOT THE FIELD.
      *
      * The two are the same pattern with the ice and the stone traded, and the
      * trade is not cosmetic: the field's HIGH side is its broad plateaus —
      * the middles of the hills, the parts that face the camera squarely — and
      * cutting rock out of those put stone on the fattest, most-lit part of
      * every landform while the folds between them stayed white. That is the
      * opposite of where a landscape keeps its snow.
      *
      * Its LOW side is the field's troughs, which are narrower and more
      * threaded, so taking rock from there gives ribs and gullies of stone with
      * ice over everything else, which is the arrangement the reference has.
      *
      * THE WINDOW IS WELL BELOW THE FIELD'S MEAN, WHICH IS WHAT MAKES ICE THE
      * GROUND AND STONE THE EXCEPTION.
      *
      * Mirroring it about the mean — 0.450 to 0.525 against a measured mean of
      * about 0.475 — put the cut straight through the middle of the
      * distribution, so half the back of the landscape came out bare. Half is
      * not an exception, it is a second surface, and the hills read as stone
      * with snow on them rather than as an icefield with stone showing through.
      *
      * Dropped by nine hundredths, which is a bit under a standard deviation of
      * the combined field, so roughly a fifth of the back is rock and the other
      * four fifths is ice. The patches keep their size and their spacing — this
      * moves the threshold, not the frequencies.
      */
     float hillBare = 1.0 - smoothstep(
       0.360, 0.435,
       hillBed * 0.66 + hillFig * 0.34 - hillSlope * 0.09
     );
     float hillRock = hillBare * rockZone;

     /*
      * Snow still lies where the field says it lodges — the 0.12 left over is
      * not a fudge, it is the thin cover that survives on rock everywhere
      * except a genuine cliff, and taking it to zero gives faces that read as
      * bare stone in summer rather than as a winter mountain.
      */
     float lay = lying * patchy * ( 1.0 - hillRock * 0.9 );

     /*
      * THIS VALUE IS THE GROUND'S BRIGHTNESS — not the material's color prop.
      *
      * Worth stating plainly because it cost a wasted pass: lay is near 1
      * over any surface facing the sky, which is most of a snowfield, so this
      * mix REPLACES the albedo across nearly the whole frame. Cutting the
      * material tint by 20% moved the measured foreground luminance by 0.3 of
      * a point, because on flat ground the tint is barely in the result.
      *
      * Measured: the reference's foreground sits at luminance 122 and ours at
      * 158, so this comes down by about a quarter. Its blue-minus-red comes
      * down with it — at (0.80, 0.84, 0.91) the snow itself was painted blue,
      * which is where the ground's excess cast survived every change to the
      * tint above.
      */
     /*
      * BACK UP, from 0.432. This value is the snowfield's brightness — the
      * note further up this file says so plainly — and it had been walked down
      * step by step to hit a foreground luminance target while the ground was
      * carrying a full coat of dark rock. With the rock gone the same target is
      * reached by the snow being snow, and snow is not grey.
      */
     /*
      * DOWN, from 0.492. Measured against the reference band by band, our
      * foreground sat at luminance 144 against its 117 — 27 points bright,
      * while the sky already matched. A uniform exposure cut would have taken
      * the sky with it, so the correction belongs here, on the surface that is
      * actually wrong: this value IS the snowfield's brightness, as the note
      * further up this file says.
      */
     /*
      * DOWN AGAIN, from 0.40/0.417/0.444, and measured the same way the note
      * above was — but against a fresh screenshot of igloo.inc rather than the
      * older band figures.
      *
      * Sampled in matching regions: reference sky 178 / near hill 131 /
      * foreground 115. Ours: sky 183 — already right, and left alone — near
      * hill 155, foreground 129. So the sky matched and every SURFACE was 14 to
      * 24 points bright, which is a uniform error on lit ground with the sky
      * innocent, and this constant is the only term all of those share.
      *
      * The separation is the part that matters more than the level. igloo.inc
      * puts 47 luminance points between its sky and its near hills, which is
      * what makes them read as land standing in front of air; ours had 28, so
      * the ridges dissolved into the haze behind them. Scaled to 0.87 — the
      * measured 129-to-115 ratio for the foreground, and close to the hills'
      * own 0.845 — the surfaces come down and the sky stays where it is, which
      * opens that gap without touching a value that was already correct.
      *
      * Both cheaper-looking fixes were tried first and neither worked, because
      * neither is where the brightness is: the material's own color prop is worth
      * about a seventh out here, and thinning the fog moved the hills by one
      * point.
      */
     /*
      * SNOW IS WHITE NOW, from vec3( 0.348, 0.363, 0.386 ).
      *
      * THIS IS THE SNOWFIELD'S BRIGHTNESS AND ALWAYS WAS — the note on the
      * material's own color prop says so explicitly: screeAndSnow mixes up to
      * 85% toward this constant on anything the snow lies on, so the base tint
      * contributes about a seventh of what the camera sees and THIS contributes
      * the rest. Anyone reaching for the material colour to brighten the ground
      * is pulling the wrong lever, which is why that note exists.
      *
      * 0.348 linear is a middle grey. It was arrived at honestly, by matching
      * an overcast reference where the sky is the bright thing and the snow
      * sits below it — under a flat white sky there is no direct light to lift
      * a surface above its own diffuse average, so snow genuinely photographs
      * as grey.
      *
      * Under a clear sky it does not. Fresh snow reflects around 0.8 of the
      * light that hits it across the visible band, which is very nearly the
      * brightest albedo in nature, and in direct sun that is what the camera
      * sees. 0.78 is that number, with the faintest cool bias — snow is not
      * chromatically flat, it absorbs a little more in the red than the blue,
      * which is the same physics that makes deep ice blue.
      *
      * The relationship between lit and shadowed snow is unaffected: albedo
      * scales both equally, and the separation between them comes from the key
      * and the ambient, which moved for their own reasons in Atmosphere.
      */
     diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.820, 0.840, 0.885 ), lay * 0.95 );

     /*
      * THE SUN SIDE GOES WHITE, AND IT IS THE LANDSCAPE'S JOB AS MUCH AS THE
      * IGLOO'S.
      *
      * Snow in direct sun is not a brighter grey, it is white — it is one of
      * the few natural surfaces that genuinely clips. N.L from the key gets
      * part of the way there and then stops, because the key is a fixed
      * intensity and the albedo underneath it is deliberately dark: no amount
      * of shading takes a 0.35 albedo to white.
      *
      * So the slopes that face the light have their PIGMENT lifted, not their
      * illumination. Everything else in the frame is untouched — a slope
      * turned away from the sun keeps exactly the value the grade gave it — so
      * this widens the gap between the lit and unlit sides rather than
      * brightening the picture. Which is the direction the measurements wanted
      * anyway: sampled against igloo.inc the frame spread was 73 against its
      * 84, and a flat landscape was most of the shortfall.
      *
      * smoothstep rather than a linear dot, so only slopes genuinely turned
      * into the light take it and the transition does not creep across ground
      * that is merely side-on.
      *
      * The direction is the same constant the igloo uses, normalised off the
      * key in Atmosphere.jsx. Both have to move if that light moves.
      */
     float sunFace = clamp( dot( wGeo, vec3( 0.6916, 0.4940, -0.5269 ) ), 0.0, 1.0 );
     diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 1.0 ), smoothstep( 0.30, 0.92, sunFace ) * 0.50 );
     /* Dry snow scatters almost completely; bare rock keeps its sheen. */
     roughnessFactor = mix( roughnessFactor, 0.96, lay * 0.85 );

     /*
      * BARE ROCK ON THE STEEP FACES.
      *
      * The reference's hills are not uniformly white — the steep flanks show
      * dark stone, and that is most of what stops its landscape reading as a
      * white sheet. Ours had none anywhere.
      *
      * NO NEW SLOPE TEST, DELIBERATELY. An earlier attempt at rock built its
      * own height band and angle term with its own thresholds, and the note
      * further up this file records why that is dangerous here: a slope blend
      * on terrain whose slope range is narrow compared to its surface noise
      * oscillates from quad to quad and bands along the contours. lying
      * already exists, is already tuned against exactly that failure, and is
      * exactly the signal wanted — rock is simply where snow is NOT. Taking its
      * complement inherits the tuning instead of re-litigating it.
      *
      * Multiplied by patchy for the same reason the snow is: a clean threshold
      * draws a line no hillside has, and letting the surface's own brightness
      * modulate it makes the rock emerge through the thin places.
      */
     /*
      * ITS OWN WINDOW, MATCHED TO THE SLOPES THAT ACTUALLY EXIST.
      *
      * Reusing (1.0 - lying) could not work and it is worth writing down why:
      * lying is smoothstep(0.45, 0.95) and this terrain's geometric normal Y
      * runs 0.83 to 1.00 with a median of 0.98 — measured, recorded further up
      * this file. Over that distribution lying is pinned at 1, so its
      * complement is pinned at 0 and no amount of strength would have shown a
      * single pixel of rock.
      *
      * This window sits inside the range the surface really occupies. The risk
      * the note above flags is real — a blend whose window is narrow relative
      * to the surface noise oscillates quad to quad and bands along the
      * contours — so this is deliberately kept to ALBEDO and roughness, and
      * kept away from the normal, which is what drove the banding last time.
      */
     /*
      * WIDENED AT THE TOP, from smoothstep( 0.88, 0.995 ).
      *
      * wGeo.y is the surface's upward component, so this counts a face as bare
      * once it tilts past about 28 degrees. The window's UPPER edge is what
      * decides how much of a hillside qualifies, and at 0.995 — five degrees
      * off dead level — almost everything that was not a cliff came out as
      * fully snow-covered.
      *
      * The peak in terrain.js now cuts real spur faces into the hill behind the
      * igloo, and this is the term that has to notice them. Bringing the upper
      * edge down to 0.945 (about nineteen degrees) means a spur flank counts as
      * partly bare while the rounded crest above it stays white, which is what
      * draws the ridgeline.
      *
      * IT WAS AT 0.965 FOR ONE PASS AND THAT WAS TOO FAR. Nineteen degrees is a
      * mountain flank; fifteen is most of the rolling ground in the middle
      * distance as well, so every swell in the frame picked up a mottle of dark
      * patches and the landscape read as gravel under snow rather than as snow
      * with rock showing through on the steep parts. The window has to be
      * narrow enough that qualifying for it means something.
      *
      * The lower edge does not move: what was rock before is still rock, and
      * the flat ground is still nowhere near this window.
      */
     /*
      * WIDENED AGAIN, from 0.945 — AND WHAT CHANGED IS THE SNOW, NOT THE SLOPE.
      *
      * The note above records this being pulled back from 0.965 because the
      * landscape came out reading as gravel. That was true and the cause was
      * not the window: the snow albedo was 0.348 at the time, a middle grey, so
      * rock at 0.15 sat only a little below it and the two values MERGED. What
      * the eye got was a surface of similar-toned patches, which is exactly
      * what mud looks like.
      *
      * Snow is at 0.78 now. The same rock against it is a genuine dark against
      * a genuine white, and the eye reads that as two materials rather than as
      * one dirty one — which is what the reference has: near-black faces and
      * near-white snow, with almost nothing in between.
      *
      * So the window can go back out to where it usefully covers a mountain
      * flank. 0.955 is about seventeen degrees off level.
      */
     float bare = ( 1.0 - smoothstep( 0.88, 0.955, wGeo.y ) ) * patchy * rockZone;
     /*
      * AND THIS ONE FADES WITH DISTANCE, which it never did.
      *
      * Every other surface term in this shader is gated on distance, and this
      * one was not — so the painted rock went on at full strength all the way
      * to the horizon. The mountains are steep, bare is a slope term, and the
      * result was that the entire range came out mottled with dark patches: a
      * heap of gravel rather than a snow peak dissolving into haze. It is the
      * single loudest difference between our background and the reference's.
      *
      * Real distant snow shows almost no rock at all, because what little there
      * is has been buried, and because the air in front of it has already
      * flattened everything toward one value. The fade takes it out over the
      * same range the grain goes.
      */
     /*
      * PUSHED BACK, from smoothstep( 180.0, 560.0 ).
      *
      * THE NOTE ABOVE WAS RIGHT FOR THE SCENE IT WAS WRITTEN IN AND IS WRONG
      * FOR THIS ONE. Its argument is that distant snow shows almost no rock
      * because the air in front of it has flattened everything toward one
      * value — and that was true when the far field was most of an optical
      * depth of haze. With the haze gone there is nothing flattening anything,
      * so a bare white dome is not being read as a fogged mountain any more.
      * It is being read as a bare white dome.
      *
      * The mid-ground hills sit between 500 and 800 units out, which is
      * precisely the band this used to delete. Real high ground at that
      * distance is the most legible rock in a landscape, not the least: it is
      * where the snow line sits, and the dark faces above it against the white
      * below are what gives a range its scale.
      *
      * The near edge is unchanged, so the ground the igloo stands on gets no
      * more rock painted on it than before.
      *
      * AND IT IS A WINDOW NOW, NOT A FADE — see rockZone above. This term used
      * to be strongest at the camera and gone by the hills, which is backwards:
      * the foreground is meant to be unbroken snow and the hills are meant to
      * be where the stone is. rockZone opens it at 430 units and this closes it
      * again at 1600, where rock is under a pixel across and arrives as dirt on
      * the horizon rather than as faces.
      */
     /*
      * rockZone is NOT applied here any more. Both inputs to paintedRock now
      * carry it themselves — bare through its own gate below, hillRock through
      * the one it was built with — and multiplying by it a second time would
      * square the ramp, pushing the whole snow line another hundred units out
      * for no reason anyone reading this could have guessed at.
      */
     float bareFade = 1.0 - smoothstep( 1000.0, 1600.0, snowDist );
     /*
      * hillRock JOINS THE SLOPE TERM RATHER THAN REPLACING IT.
      *
      * Removing the snow above is only half of a snow line: what is left
      * underneath is the ice material's own base tint, which is a light grey —
      * so on its own that step produced hills that were merely paler, not
      * rocky. This is the other half, and the two have to use the SAME field or
      * the bare areas and the dark areas land in different places and the
      * result is a mountain with grey patches and separate dark patches.
      *
      * bare stays in the sum because it is doing something hillRock cannot: it
      * is per-fragment and follows the actual surface normal, so it darkens the
      * individual crags and gully walls inside an area that hillRock has
      * already stripped. One paints the snow line, the other draws what is
      * under it.
      */
     /*
      * OVERDRIVEN AT 1.15, deliberately. Removing the snow only uncovers the
      * ice material's own base tint, which is a light grey — so a stripped face
      * that is not also darkened reads as bald rather than as rock, which is
      * exactly how the uniform-grey version failed. Taking the coefficient past
      * one means a fully bare patch saturates this term before the clamp, so
      * where the snow line says rock, the surface goes properly to stone
      * instead of most of the way there.
      */
     float paintedRock = clamp( hillRock * 1.15 + bare * 0.25, 0.0, 1.0 ) * bareFade;
     /*
      * AND IT GOES ON HARDER, from 0.66.
      *
      * Now that the term survives to the hills it has to actually make a snow
      * line on them. At 0.66 the steep faces came out a middle grey — visibly
      * darker than the snow, and nowhere near the near-black the reference has
      * on its exposed rock, so the peak read as a dirty drift rather than as
      * stone with snow lying in its gullies. The contrast between the two is
      * the entire subject.
      */
     /*
      * 0.78, not the 0.86 that was tried alongside the wide slope window: with
      * the slope term narrowed back to real flanks this goes on in far fewer places,
      * and a term that applies rarely can afford to be a little gentler where
      * it does without losing the read.
      */
     diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.072, 0.075, 0.086 ), paintedRock * 0.96 );
     /* Stone keeps a sheen that dry snow has not. */
     roughnessFactor = mix( roughnessFactor, 0.80, paintedRock * 0.6 );

     /* =====================================================================
      * ROCK IN THE ICE — the stone itself, not a tint of it.
      *
      * Everything above this line PAINTS rock: it takes the snow colour and
      * mixes a dark grey in wherever the ground is steep. That is the right
      * thing to do at distance and it is not enough anywhere near the camera,
      * because a flat colour has no relief. Under a low raking key — and this
      * key is at thirty degrees — stone is almost entirely relief: lit crest,
      * black cleft, lit crest. A grey patch lights exactly like the snow
      * around it, which is why the near ground stayed soft however far down
      * the tint went.
      *
      * So the ROCK VARIANT of the same generator is sampled here — albedo,
      * roughness and normal — and mixed in as a MATERIAL rather than as a
      * colour. Its ridged relief is what puts crests and clefts on the ground.
      *
      * The painted version is not removed. It survives in the far field where
      * this fades out, which is exactly the right division of labour: colour is
      * all that survives distance anyway.
      * ================================================================== */

     /*
      * WHY vNormalMapUv AND NOT A WORLD-SPACE PROJECTION.
      *
      * Sampling a normal map means reading its red and green as DIRECTIONS,
      * and a direction is only meaningful in the tangent frame it was built
      * for. three derives that frame from screen-space derivatives of
      * vNormalMapUv (see getTangentFrame), so a rock normal sampled against
      * world XZ would be rotated relative to the frame it is then multiplied
      * by, and the surface would light as though the sun were somewhere else.
      *
      * On this mesh the two are the same thing up to a scale factor — the
      * plane's UVs run linearly across its extent — so scaling the existing UV
      * buys the tighter tile AND keeps the frame honest.
      */
     vec2 rockUv = vNormalMapUv * uRockScale;
     vec3 rockAlbedo = texture2D( uRockMap, rockUv ).rgb;
     vec2 rockData = texture2D( uRockRough, rockUv ).rg;
     /* .g is roughness — three's own convention, which this map has to keep
        because it is bound as a roughnessMap elsewhere — and .r is the smooth
        patch field riding along in the spare channel. */
     float rockRough = rockData.g;
     float rockPatch = rockData.r;

     /*
      * THE HEIGHT FIELD, RECOVERED RATHER THAN SHIPPED AGAIN. The rock variant
      * writes roughness as 0.40 + relief * 0.55 — a straight linear encode of
      * the same field the normal map is the gradient of (see ice-texture.js).
      * Inverting it costs a subtract and a divide, and saves generating,
      * uploading and sampling a fourth 512x512 map for a number already on the
      * GPU.
      */
     float rockH = clamp( ( rockRough - 0.40 ) / 0.55, 0.0, 1.0 );

     /*
      * WHERE THE ROCK IS. Two terms, and the split is the design.
      *
      * bare is the slope term from a few lines up, tuned against this terrain's
      * measured normal distribution — the file records at length what happens
      * to a slope blend here when its window is guessed instead. Reusing it
      * inherits that tuning rather than re-litigating it, and it is the term
      * that puts stone on the steep faces where snow genuinely cannot sit.
      *
      * outcrop is a WORLD-SPACE field, and it is what stops the ground reading
      * as evenly gravelled. Real rock does not surface uniformly across a
      * plain: it comes up in beds, with nothing but snow between them. Taking
      * the patches from world position rather than from UVs means they follow
      * the landscape and not the texture grid — so however hard the rock tile
      * repeats, its patches never do.
      */
     float veins = fogFbm( vFogWorld.xz * 0.0034 );
     float beds = fogFbm( vFogWorld.xz * 0.0130 );
     float outcrop = clamp(
       smoothstep( 0.38, 0.72, veins ) * 0.72 + smoothstep( 0.42, 0.78, beds ) * 0.46,
       0.0, 1.0
     );

     /*
      * SNOW SETTLES IN THE CLEFTS, and this is the whole reason it reads as
      * rock IN ice rather than as two materials side by side. Drifting snow
      * fills the low parts of a fractured surface and blows off the high ones,
      * so crests come out bare and the fissures between them stay white. It is
      * one decision per texel, taken from the rock's own height — no second
      * field, no extra threshold to go wrong.
      */
     /*
      * THREE BANDS, SPLIT ON THE GENERATOR'S OWN QUANTILES.
      *
      * The edges below are percentiles of the relief field, measured when the
      * map was built and handed over as reliefStops — so the proportion of the
      * ground each band covers is fixed by construction, whatever the generator
      * is retuned to do later. Fixed numeric edges cannot do this: an earlier
      * pass guessed 0.26-0.68, which sat below almost the whole field, so every
      * texel came out fully exposed, the rock mixed in at a CONSTANT strength,
      * and the ground went uniformly darker with no grain at all. Measured, the
      * near field's spread got worse — 18 down to 14, against 95.
      *
      * And the proportions matter as much as the split. Cutting at the median
      * gave half dark stone and half bright glaze: a dalmatian, and the
      * reference is nothing like it. Its ground is a pale icy plain that dark
      * rock shows THROUGH — stone is the minority everywhere, and most of the
      * surface is neither extreme.
      *
      *   above p90   bare stone      ~10% of the surface, and the dark end
      *   below p35   wind-glazed ice ~35%, and the bright end
      *   between     plain snow      the majority, untouched
      */
     float exposed = smoothstep( uRockLow, uRockHigh, rockPatch );
     float glazed = 1.0 - smoothstep( uGlazeLow, uGlazeHigh, rockPatch );

     /*
      * THE RELIEF STILL GETS A VOTE, but only a small one, and only inside a
      * band that the patch field has already decided. It is what stops each
      * patch reading as a flat stencilled shape: within a bare one the high
      * points of the fracture pattern are barest, and the ice creeps back into
      * the low ones, so the edges break up along the stone rather than along a
      * smooth contour.
      */
     exposed *= mix( 0.55, 1.0, smoothstep( uRockLowRelief, uRockHighRelief, rockH ) );

     /*
      * FADED OUT WITH DISTANCE, on the same term the snow normals use.
      *
      * Not an aesthetic choice — the same aliasing rule the rest of this file
      * is built around. At 400 units a rock tile is a couple of pixels wide,
      * its relief is below the sampling rate, and the smallest camera movement
      * makes it crawl. That crawl is the failure that cost this scene the
      * entire photographic-backdrop detour. Far ground gets the painted
      * version and nothing else.
      */
     /*
      * A FLOOR UNDER THE WHOLE NEAR FIELD, and this is the change that closed
      * the contrast gap.
      *
      * Gating the rock entirely on slope and outcrop meant the flat ground —
      * which is most of the frame, and all of the foreground — got none of it,
      * and stayed the smooth white sheet the measurements were complaining
      * about. The reference has no such ground anywhere. Even its flattest
      * plain is granular: stone showing through a crust, everywhere the camera
      * is close enough to resolve it.
      *
      * So there is a base level, and the beds and slopes ADD to it rather than
      * being the only source. Multiplied by snowFade like everything else, so
      * it is present exactly where it can be resolved and gone before it can
      * alias.
      */
     /*
      * NO FLOOR ANY MORE. THE GROUND IS SNOW; ROCK IS THE EXCEPTION.
      *
      * There was a base of 0.90 here, meaning nine tenths of the rock material
      * was applied to every square metre of ground in the near field regardless
      * of the landform. It was put there to close a measured contrast gap, and
      * it did — the frame's luminance spread went from 42 to 102 against the
      * reference's 103, and all four band means landed within two points.
      *
      * And the picture was wrong, because those statistics can be produced by
      * two completely different images. A snowfield with deep shading and a
      * gravel pit with mottled pigment have the same histogram. Chasing the
      * number got the gravel pit: the ground came out as dirt with stones in
      * it, which is not what igloo.inc has anywhere in frame. Its ground is
      * smooth wind-packed snow, and the rock is a rare accent on the steepest
      * flanks — not a surface treatment applied everywhere.
      *
      * So the floor is gone entirely and the two honest gates are left to do
      * the work. bare is the slope term, tuned against this terrain's measured
      * normal distribution; outcrop is the world-space bed field. Both are
      * genuinely occasional. On the flat, which is most of the shot, this is
      * now near zero and the ground is simply snow.
      */
     /*
      * A SMALL FLOOR IS BACK, and it is the frame's local contrast rather than
      * its brightness that wants it. The reference's foreground carries a
      * p10-to-p90 spread of 73 and ours had 30: its near ground has genuine
      * darks in it, and with the rock gated purely on slope and bed the flat
      * ground had none at all.
      *
      * 0.2 is a fifth of the strength the old floor had, which is what stopped
      * this reading as gravel — enough grain to give the surface a dark end,
      * far too little to make it a rock field.
      */
     /*
      * THE FLOOR IS GONE AGAIN, AND THIS TIME FOR THE COMPOSITION RATHER THAN
      * FOR THE HISTOGRAM.
      *
      * The three notes above are the whole argument had twice already: a floor
      * of 0.90 made the ground a gravel pit, it was removed, and a fifth of it
      * came back to buy local contrast in the foreground. That last step is the
      * one being undone. It puts rock everywhere near the camera by
      * construction — that is what a floor is — and the near ground is
      * precisely where there is meant to be none.
      *
      * The contrast it was buying is not lost, it has moved: the foreground now
      * gets its dark end from the snow's own relief under a strong key, which
      * is where a real snowfield gets it. Rock is not a texture applied to
      * everything any more; it is what the back of the landscape is made of.
      *
      * Both honest gates ride rockZone with it, so nothing stony survives
      * inside 230 units however steep or bedded the ground happens to be there.
      */
     float stone = clamp( bare * 1.05 + outcrop * 0.42, 0.0, 1.0 ) * grainFade * rockZone;

     /*
      * SALT AND PEPPER, and the two ends have to be pushed APART rather than
      * one of them moved.
      *
      * body is the dark end: near-zero in the clefts, full in the crests, so
      * the exposed stone goes properly dark instead of being averaged with the
      * ice around it. mix( 0.06, ... ) rather than the old 0.34 is what buys
      * that — at 0.34 every cleft carried a third of the rock's darkness and
      * the whole patch sat at a uniform middle grey, which is the mush the
      * spread measurement was reporting.
      */
     float body = stone * exposed;

     /*
      * crust is the bright end: wind-glazed ice pooled in the fissures. Without
      * it the clefts are simply un-darkened snow and the contrast is one-sided
      * — the near ground gets a dark speckle and no highlight, which reads as
      * dirt on the snow rather than as ice between stones.
      *
      * It is taken from its OWN band rather than as the complement of exposed.
      * The complement is 1 wherever stone is 0, which is most of the surface,
      * so glazing everything that is not rock put a bright wash over the whole
      * near field and lifted it 33 points above the reference.
      */
     float crust = stone * glazed;

     /*
      * The map's own range is a warm mid-grey. This takes it cold and dark —
      * the same move the scree instances make — so bedrock and the loose stone
      * lying on it are visibly the same rock. They come out of one generator
      * and should not need explaining to each other.
      */
     /*
      * THE TINT IS COLD AS WELL AS DARK, and both halves are load-bearing.
      *
      * Dark, because the reference's near ground reaches p10 83 and every dark
      * pixel in this frame has to come from somewhere; the ground is the only
      * surface large enough to supply them.
      *
      * Cold, because the generator's rock is a WARM mid-grey — correct for dry
      * stone and wrong under this sky. Its map runs red above blue; a neutral
      * tint would leave the whole near field leaning brown, which is precisely
      * what the first attempt at this looked like.
      */
     /*
      * PIGMENT PULLED RIGHT BACK, AND THE RELIEF GIVEN THE WORK INSTEAD.
      *
      * This file already states the principle, about the ice: "Real ice and
      * rock are close to uniform in albedo. Almost everything you see on them
      * is SHADING — light meeting relief — which changes as the light and the
      * viewer move, and that is what makes a surface read as physical rather
      * than printed."
      *
      * Chasing the reference's measured luminance spread led straight into
      * breaking that rule. The spread was matched — frame p10-p90 of 102
      * against 103 — and the ground still looked wrong, because it was being
      * supplied by a colour pattern that does not move with the light. Zoomed
      * in, ours was terrazzo and the reference's was a bumpy surface.
      *
      * So the tint comes back up toward the stone it actually is, the strength
      * comes down, and uRockRelief goes from 0.9 to 2.4. The contrast is now
      * lit contrast: the same swing in the histogram, produced by geometry
      * rather than by paint, and it changes as the sun and the camera do.
      */
     /*
      * THE DARK END IS ALLOWED TO BE PIGMENT — the bright end was not.
      *
      * Pulling the paint out entirely cost the frame its darks: measured, the
      * foreground's spread fell from 89 to 29 against the reference's 95. That
      * looks like the same mistake in reverse, and it is not, because the two
      * ends are not symmetric. A bright patch that does not move with the light
      * reads as a stain, because nothing in nature is bright from every angle
      * except a source. A DARK patch that does not move is completely ordinary:
      * it is just a darker material, and dark rock genuinely is one. Wet stone
      * and dry snow differ in albedo by a factor of five.
      *
      * So the stone comes back down toward black and the strength comes back
      * up, while the glaze stays gloss.
      */
     /*
      * ROCK GOES DOWN AS THE SNOW GOES UP, from vec3( 0.22, 0.24, 0.30 ).
      *
      * Exposure came up by a fifth and the snow albedo more than doubled, and
      * this term is a multiplier on a sampled albedo — so left alone it would
      * have ridden all of that up with them and the stone would have arrived at
      * the same middle grey it started at, relative to its surroundings.
      *
      * The contrast between white snow and dark rock is the entire subject of
      * the reference: its peaks read because the exposed faces are nearly black
      * against snow that is nearly white. Holding the rock DOWN while
      * everything else rises is what opens that gap.
      *
      * The blue bias comes out at the same time. Stone lit by a blue sky is
      * blue in shadow already, from the ambient; building the tint blue as well
      * doubled it and the outcrops read as slate-coloured rather than as rock.
      */
     diffuseColor.rgb = mix( diffuseColor.rgb, rockAlbedo * vec3( 0.17, 0.17, 0.19 ), body * 0.92 );
     /* The glaze. Brighter than the snow value above and glossier than any of
        it: this is refrozen melt, not powder, and the sheen is most of what
        separates the two materials once they are the same colour in shadow. */
     /*
      * NEARLY GONE, from 0.44. The glaze was drawing discrete white patches a
      * metre across, and a field of those is a dalmatian rather than a snow
      * field. With the terrain smoothed into real rolling mounds there is now
      * plenty of tonal range coming from SHADING — lit flank against shaded
      * flank — and the measured frame spread is already at the reference's. The
      * albedo does not have to supply it any more, and when it does it reads as
      * pattern rather than as light.
      */
     /*
      * THE GLAZE IS GLOSS, NOT PAINT — the same correction the igloo's rims
      * needed, one scale up.
      *
      * Wind-glazed ice on a snowfield is not whiter than the snow around it;
      * measured against dry powder it is very slightly DARKER, because it is
      * denser and scatters less back at you. What it is, is shiny. It returns
      * the sky in a broad soft sheen that slides across the ground as you move,
      * and that sliding is the entire reason the eye calls it ice rather than a
      * pale patch.
      *
      * Painting it lighter — which is what this did — gives the opposite
      * reading: a patch that is bright from every angle is not a reflection, it
      * is a stain. So the albedo lift is nearly gone and the roughness below is
      * doing the work.
      */
     diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.575, 0.596, 0.632 ), crust * 0.05 );
     roughnessFactor = mix( roughnessFactor, rockRough, body * 0.9 );
     roughnessFactor = mix( roughnessFactor, 0.19, crust * 0.85 );

     /*
      * THE NORMAL LAST, AND MOST CAREFULLY.
      *
      * It REPLACES the snow normal rather than adding to it — two tangent-space
      * normals summed give a surface with neither one's shape — and it is
      * weighted by stone rather than by body, because the relief belongs to
      * the whole outcrop, snow-filled clefts included. The clefts ARE the
      * shape. Fading them out where snow lies would flatten precisely the thing
      * the snow is meant to be lying in.
      */
     vec3 rockN = texture2D( uRockNormal, rockUv ).xyz * 2.0 - 1.0;
     rockN.xy *= uRockRelief;
     /*
      * THE CRACKS.
      *
      * They go on last and they are not modulated by the stone mask, because a
      * fracture in the crust is not a property of whether rock is showing —
      * it runs across bare stone and glazed ice alike, and stopping it at the
      * edge of a patch would make it look painted on the patch.
      *
      * Two terms, and both are needed. The DARK is the crack itself: a fissure
      * is a slot the light cannot reach into, so it is genuinely near-black
      * rather than merely a darker shade of the surface. The NORMAL DENT is
      * what stops it reading as a drawn line — a real crack has a lip, so the
      * surface either side of it tips toward the gap, and that tipping catches
      * the low key on one side and shades on the other. A crack with no relief
      * looks like a hair on the lens.
      *
      * Faded on grainFade like everything else: at distance a crack is far
      * below a pixel, and a sub-pixel black line is just noise.
      */
     /*
      * ONLY WHERE THE GROUND IS FLAT. A crust fractures because it is a plate
      * under tension; a slope does not hold one, it sheds. Running the network
      * over the hillsides as well drew dark lines across every flank, which
      * read as scratches on the render rather than as cracks in anything.
      * wGeo.y is the geometric normal's up component, already computed above.
      */
     float crackBed = smoothstep( 0.93, 0.995, wGeo.y );
     float crack =
       ( 1.0 - texture2D( uRockRough, vNormalMapUv * uCrackScale ).b ) * grainFade * crackBed;
     diffuseColor.rgb *= mix( 1.0, 0.34, crack * 0.8 );
     roughnessFactor = mix( roughnessFactor, 0.95, crack * 0.7 );

     /*
      * FINE GRAIN, ON TOP OF THE PATCHES.
      *
      * The bands above are broad by design — metres across — and broad alone is
      * what made the near ground read as camouflage: big soft shapes of light
      * and dark with nothing inside them. Every real snow-over-rock surface is
      * granular at the scale of a fist as well, and that granularity is what
      * the eye uses to decide it is looking at a SURFACE rather than at a
      * pattern painted on one.
      *
      * It is the rock's own relief modulating brightness directly, so it costs
      * a sample already taken. Deliberately small: this is grain, and pushing it
      * turns the ground back into noise.
      */
     diffuseColor.rgb *= mix( 0.96, 1.035, rockH * stone );

     /*
      * WIND SCOUR — long shallow streaks lying across the ground.
      *
      * The last thing separating our snow from the reference's. Its surface is
      * not isotropic: everything on it has been combed one way by the wind, so
      * the drifts, the bare patches and the grain all elongate along a single
      * axis. Noise, sampled on a square grid, has no direction at all, and a
      * field with no direction reads as a generated surface however well it is
      * graded.
      *
      * Anisotropy is the entire trick — the same fbm read at one frequency
      * across the wind and a twentieth of it along, so a feature a metre wide
      * runs twenty metres downwind. World-space, so the streaks lie across the
      * landform rather than following the UV grid, and very low contrast: this
      * is a comb mark, not a stripe.
      */
     float scour = fogFbm( vec2( vFogWorld.x * 0.0022 + vFogWorld.z * 0.0009,
                                 vFogWorld.z * 0.052 - vFogWorld.x * 0.021 ) );
     /*
      * HALVED. Wind scour on packed snow is a texture you notice when you look
      * for it, not a pattern you read from across a valley. At plus or minus
      * 4.5% it was combing visible stripes across the whole near field.
      */
     diffuseColor.rgb *= mix( 0.978, 1.022, scour * grainFade );

     /* snowFade, not grainFade: relief is the half that cannot survive being
        averaged, so it goes back on the short guard. Beyond it the grain lives
        on in colour alone, which is all a distant surface ever shows anyway. */
     normal = normalize( mix( normal, normalize( tbn * rockN ), stone * snowFade * 0.9 ) );`
  );
};
/**
 * THE OPENING SLAB: the world starts as a rectangular block and grows.
 *
 * On the reference the first thing on screen is not a landscape, it is a
 * diorama — a clean rectangular plinth of ground with the igloo on it, floating
 * in the grey, and the land and hills are uncovered outward from it as the
 * camera comes down. That reading is the whole opening, and it is the piece I
 * kept missing: the survey lines are decoration ON it, not the thing itself.
 *
 * DISCARD, NOT SCALE. The obvious implementation is to grow the terrain mesh,
 * and it is wrong: the height field is a function of world position, so a mesh
 * that scales would slide the landscape through itself and the hills would
 * visibly crawl. Cutting fragments instead leaves every feature exactly where
 * it belongs and simply decides how much of it is on screen yet, so the
 * mountains are uncovered rather than grown.
 *
 * A RECTANGLE, NOT A DISC. A circle expanding reads as a spotlight or a wipe. A
 * rectangle with hard corners reads as an OBJECT — a cut block of ground — and
 * that is the difference between a transition and a diorama.
 */
/*
 * THE BLOCK OPENS FROM THE IGLOO'S OWN FOOTPRINT, not from a field.
 *
 * DOWN FROM 190, and 190 was most of the way to the whole visible landscape —
 * so the "reveal" opened from a slab that already filled the frame and there
 * was nothing to watch arrive. The reference starts with the igloo and NOTHING
 * else: no ground beyond the plinth it stands on, just grey and the survey
 * scaffold, and the land is uncovered outward from under it.
 *
 * 34 is a little over the structure's own 30-unit footprint, so the first frame
 * is the dome on a cut block of snow barely wider than itself.
 */
const SLAB_HALF = 34; // half-width of the block it opens from
/*
 * The size of one chunk of ground, in world units.
 *
 * DOWN FROM 26, WHICH WAS AN ORDER OF MAGNITUDE TOO COARSE. At that size the
 * world arrived in a handful of enormous tiles and the growing front read as a
 * chunky staircase — a graphic, obviously drawn.
 *
 * The reference's edge is far finer than that: measured off it, the serrations
 * on the advancing boundary are only a few world units across, small enough
 * that at the opening altitude they read as a slightly ragged, pixelated line
 * and you have to zoom in before you can see they are square at all. That is
 * the effect — the ground is clearly being BUILT out of blocks, but the blocks
 * are near the limit of resolution rather than being the subject.
 *
 * 2.5 puts about a dozen cells across the igloo's own footprint. Down from 5,
 * and from 26 before that — each step made the frontier finer and better, so
 * this is the third pass on the same number rather than a guess.
 *
 * There IS a floor under this, though it is not reached yet: once a cell is
 * smaller than a pixel at the opening altitude the quantisation stops being
 * visible at all and the edge just looks soft, at which point the whole pass is
 * paying for a blockiness nobody can see.
 */
const REVEAL_CELL = 2.5;

const slabReveal = (shader, uReveal) => {
  shader.uniforms.uReveal = uReveal;
  shader.fragmentShader = `uniform float uReveal;
     ${shader.fragmentShader}`.replace(
    /*
     * Injected at the very end of main, after every other pass has had its say.
     * A discard earlier would skip work, but it would also sit before the fog
     * and the grade, and anything that reads gl_FragColor after it would be
     * reading a fragment that no longer exists.
     */
    /\}\s*$/,
    `
     {
       /*
        * NAMED slab, NOT half: half is a reserved word in GLSL ES and using
        * it fails to compile the whole material, which drops the terrain out of
        * the scene entirely with only a console line to say why.
        *
        * Half-extents grow from the slab to well past the terrain, so by the
        * end nothing is cut and the pass costs one compare per fragment.
        * Squared easing: most of the opening happens late, which keeps the
        * block legible as a block for the first part of the move instead of
        * bursting immediately.
        */
       float k = uReveal * uReveal;
       vec2 d = abs( vFogWorld.xz - vec2( ${MOUND_AT[0].toFixed(1)}, ${MOUND_AT[1].toFixed(1)} ) );

       /*
        * THE GROUND ARRIVES IN CHUNKS, NOT AS A SHEET.
        *
        * The cut used to be a clean rectangle expanding through the world,
        * which reads as a sheet of paper being unrolled — a wipe. The land
        * should arrive the way a voxel world streams in: whole cells at a
        * time, so the growing front is a stepped, ragged wall of blocks with
        * squared-off corners rather than a straight edge.
        *
        * QUANTISE FIRST, TEST SECOND. The test is applied to the CELL's centre
        * rather than to the fragment, so every fragment in a cell answers
        * identically and the cell appears all at once. Testing the fragment and
        * then rounding the result would just be a stepped-looking wipe with the
        * cells still filling in gradually.
        */
       float cellSize = ${REVEAL_CELL.toFixed(1)};
       vec2 cell = floor( d / cellSize );
       vec2 cc = ( cell + 0.5 ) * cellSize;

       /*
        * EUCLIDEAN, so the front is a circle.
        *
        * This was max( cc.x, cc.y ) — Chebyshev — which keeps the frontier
        * square and grows the world as a widening rectangular block. That is a
        * defensible diorama read and it is not the one wanted here: the ground
        * should open outward as a disc.
        *
        * The cells are unaffected. They are still square and still resolve one
        * at a time, so the boundary is a circle drawn in little squares —
        * round overall, blocky up close, which is the combination being asked
        * for.
        */
       float reach = length( cc );

       /*
        * Per-cell jitter, so neighbouring cells cross the threshold at slightly
        * different moments. Without it every cell on a ring appears on the same
        * frame and the front is a perfect staircase, which reads as a pattern
        * rather than as terrain loading in.
        */
       float jitter = fract( sin( dot( cell, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );

       /* Runs well past the terrain's own extent so nothing is still cut at the
          end and the pass settles into one compare per fragment. */
       float front = mix( ${SLAB_HALF.toFixed(1)}, 4200.0, k );
       /*
        * A TIGHT jitter band, from ( 0.80 + 0.34 ). At cell size 26 a wide
        * spread was what stopped the front being a perfect staircase; at 5 the
        * cells are small enough that the staircase is already invisible, and
        * the same spread instead scatters loose cells far ahead of the
        * boundary, which reads as the ground fraying rather than as an edge.
        * Narrow keeps the frontier a coherent line with a fine serration on it.
        */
       float outside = reach - front * ( 0.96 + 0.07 * jitter );

       if ( outside > 0.0 ) discard;

       /*
        * NO DARK LIP. There was one here and it had to go.
        *
        * It multiplied fragments near the cut down by up to 72%, to read as the
        * shaded SIDE of a slab and give the block thickness without modelling
        * any. That worked while the cut was one clean rectangle. It does not
        * work now the edge is serrated into cells: the darkening lands on every
        * one of the little squares along the frontier at once, so the world
        * arrives wearing a black fringe that crawls ahead of it — which is the
        * most conspicuous thing in an opening that is otherwise almost white.
        *
        * Cutting cleanly is the better answer anyway. The ground beyond the
        * front is fog-coloured emptiness, so an unshaded edge does not read as
        * a hole; it reads as land that has not arrived yet, which is what it is.
        */
     }
   }`
  );
};

export default function Terrain({ begin = false }) {
  const geometry = useMemo(() => buildTerrainGeometry(512, -300), []);

  /*
   * The same generator as the igloo, at landscape scale.
   *
   * Sharing it is deliberate: the dome is built from the ground it stands on,
   * so the two surfaces should be the same material seen at different sizes.
   * Only the tiling differs — the plane's UVs run 0..1 across its whole extent,
   * so the repeat has to be computed from the world size rather than left at 1
   * the way the igloo's world-scaled UVs allow.
   */
  /*
   * THE NUMBERS NOW LIVE IN lib/ice-sets.js, so the build-time bake and the
   * runtime cannot hold different copies of them. The reasoning stays here.
   *
   * frequency 2.4 — LOWER THAN THE IGLOO'S, because the ground is seen across,
   * not up close. At 4.4 the coarse form was 14 units — grain at landscape
   * scale. At 2.4 it is about 26, which is outcrop size: the ground breaks into
   * rocky swells you can read as terrain rather than as a texture laid over it.
   *
   * bump 2.4, pebbles 0.2 — CALMED RIGHT DOWN, from 4.2 with pebbles at 1.0.
   * The reference's snow is smooth, with fine granularity and wind-scoured
   * streaking over it. Mine was blotchy — a coarse, high contrast relief that
   * reads as rubble or as a texture laid over the ground rather than as the
   * surface of it. The pebbles were the worst of it: at full strength they
   * scatter discrete lumps across a surface that, in the reference, has none.
   * What is left of them is scree grit, and the shader keeps it on the slopes —
   * see screeAndSnow.
   *
   * repeat is passed rather than baked: it is derived from the terrain's world
   * size and sets three's UV transform, not a single generated pixel.
   */
  const snow = useMemo(() => iceMapsFor('snow', SNOW_REPEAT), []);

  /*
   * The rock variant of the same generator, at its own scale.
   *
   * SAME GENERATOR, DIFFERENT SUBSTANCE. The argument for sharing it with the
   * igloo is made above and it holds here too: the stone breaking through the
   * ice, the scree lying on it and the dome standing on it are all built by one
   * piece of code, so they cannot drift apart in feel however long the three
   * are tuned separately.
   *
   * frequency 3.4 — higher than the snow's 2.4: fracture detail is metre-scale,
   * and this tile is half the size to begin with.
   *
   * bump 3.0 — below the igloo's 4.6. The ground is seen at grazing angles
   * almost everywhere and a grazing surface exaggerates relief, the same
   * argument the snow's normalScale note makes below.
   *
   * repeat is left at 1, not ROCK_REPEAT, because these maps are not bound to a
   * material slot — nothing applies three's UV transform to them — so the tile
   * count is applied in the shader instead. Setting it here as well would
   * multiply the two together and put the tile at half a metre.
   */
  const rock = useMemo(() => iceMapsFor('crag'), []);

  /*
   * 0 while the loader is up so the block is already there in the first frame,
   * then driven to 1 over the camera's own descent. Wall clock, not summed
   * deltas — the same correction the camera and the lattice both needed.
   */
  /* One uniform object shared with the compiled shader, so a single write per
     frame reaches it without touching the material. Drives the fog's drift. */
  const uTime = useRef({ value: 0 });
  const uReveal = useRef({ value: 0 });
  const revealStart = useRef(0);
  useFrame((state) => {
    uTime.current.value = state.clock.elapsedTime;

    if (uReveal.current.value < 1) {
      if (!begin) {
        uReveal.current.value = 0;
      } else {
        if (!revealStart.current) revealStart.current = performance.now();
        /* 3.6 s matches CameraRig's descent; a shade longer so the last of the
           land arrives just after the shot settles rather than before it. */
        uReveal.current.value = Math.min(
          1,
          (performance.now() - revealStart.current) / 4200
        );
      }
    }
  });

  /*
   * ORDER IS NOT LOAD-BEARING, and that is worth saying because it looks as
   * though it should be. Each pass either prepends declarations or replaces a
   * distinct #include anchor inside main, so the string they add up to is the
   * same whichever way round they run. What matters is that worldSpace is there
   * at all: both passes after it read vFogWorld and fogFbm, and neither
   * declares them.
   */
  const onCompile = useMemo(
    () => (shader) => {
      worldSpace(shader);
      rockMaps(shader, rock, ROCK_REPEAT / SNOW_REPEAT, 3.0, CRACK_REPEAT / SNOW_REPEAT);
      screeAndSnow(shader);
      groundFog(shader, uTime.current);
      slabReveal(shader, uReveal.current);
    },
    [rock]
  );

  return (
    <mesh geometry={geometry} receiveShadow castShadow={false} frustumCulled={false}>
      {/*
        Slightly warm, quite dark, and very rough. Dark is the counter-intuitive
        part: in heavy fog the ground reads far lighter than its albedo because
        the fog is added on top of it with distance, so a mid-grey ground comes
        out white and featureless a hundred units away.
      */}
      {/*
        No dithering. It exists to break up banding on smooth gradients, and it
        does that by adding noise in SCREEN space — which stays put while the
        geometry slides under it, so any camera movement makes the pattern crawl
        across the hills. On a fog-graded landscape that reads as flicker.
      */}
      <meshStandardMaterial
        /* THE MAIN MOVE OF THE GRADE, down from #aeb7c2. The ground covers most
        of the frame, so its tint sets the whole picture's level — and at
        #aeb7c2 it sat close enough to the sky that the fog had nothing to
        grade between. */
        /*
        MEASURED AGAINST THE REFERENCE, not chosen by eye.
        
        Sampled in bands, igloo.inc runs sky 181 / far hills 166 / mid 134 /
        foreground 122 — a fall of 59 luminance points from top to bottom. Ours
        ran 167 / 160 / 158 / 158: a fall of 9. The picture was flat, and it was
        flat because the GROUND was 36 points too bright, sitting level with its
        own sky so the fog had nothing to grade between.
        
        This also carried most of the excess blue. The reference's ground has a
        blue-minus-red of about +17; #96a2b0 is +26. Darker and closer to
        neutral, so the cold comes from the light and the haze rather than from
        the dirt being painted blue.
      */
        /*
         * LIFTED, from #6d727c. Same argument as the snow value above: this was
         * walked down while the ground was wearing a coat of rock, and with the
         * rock gone it was holding the snowfield at a dishwater grey.
         */
        /* NOT THE LEVER FOR THE SNOWFIELD'S BRIGHTNESS, despite being the
           obvious candidate. screeAndSnow mixes up to 85% toward a constant on
           anything the snow lies on, so this contributes about a seventh of
           what the camera sees out there; cutting it by 14% moved the measured
           foreground by five points. The brightness lives at that mix — see the
           note on it. This stays as the grade left it. */
        /*
         * LIFTED WITH THE SNOW CONSTANT, from #6a707a.
         *
         * The note above is right that this is not the snowfield's lever — it
         * is about a seventh of what is seen out there. But a seventh of the
         * frame's brightest surface is not nothing, and leaving it at a dark
         * grey while the other six sevenths went white left a persistent
         * muddiness in exactly the places the snow layer thins.
         */
        color="#aab4c2"
        roughness={0.94}
        metalness={0}
        map={snow.colorMap}
        aoMap={snow.aoMap}
        aoMapIntensity={0.85}
/*
          THE FILL IS WHAT WAS KILLING THE CONTRAST.
          
          Measured, the reference's p10-to-p90 luminance spread is 101 and ours
          was 43 — and unlike the brightness, that gap does not close by
          darkening albedo, because albedo scales the lit and the shadowed
          equally. A surface with no dark end has too much light arriving from
          everywhere, and here that is the environment rig: at 1.1 it was
          filling every slope facing away from the key, so nothing in the frame
          could get properly dark.
          
          Atmosphere.jsx already records this exact finding for the key light —
          "the ambient term comes down at the same time, because it is a
          constant added to every pixel and so is pure spread-killer". The same
          argument applies to image-based fill and had not been carried over.
        */
        /*
         * BACK UP FROM 0.26 — for a different reason than it was cut for.
         *
         * It came down to deepen the shadows, and that worked: a constant fill
         * added to every pixel is a pure spread-killer and the frame's dark end
         * needed the room. But the environment is not only fill — it is the
         * only thing a SPECULAR surface has to reflect, and the glazed ice
         * above is now specular. At 0.26 there was nothing for it to catch, so
         * dropping its roughness did nothing and the ice stayed invisible.
         *
         * 0.34 is affordable now because the darks come from the rock's relief
         * rather than from starving the fill.
         */
        envMapIntensity={0.34}
        roughnessMap={snow.roughnessMap}
        normalMap={snow.normalMap}
        /* Gentler than the igloo's. The ground is seen at grazing angles almost
           everywhere, and a grazing surface exaggerates any normal detail —
           the same strength that reads as texture on the dome reads as gravel
           spread over the snow field. */
        /*
         * RAISED FROM 0.62 with the rock relief. The old value was set against
         * a surface whose only normal detail was fine snow grain, where a
         * grazing view exaggerates any perturbation into gravel. The rock's
         * relief is the opposite case — it is the SHAPE of the ground at metre
         * scale, and under-driving it is what left the near field looking
         * printed.
         */
        normalScale={[1.35, 1.35]}
        onBeforeCompile={onCompile}
      />
    </mesh>
  );
}
