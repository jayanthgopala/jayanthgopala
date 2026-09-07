import { useMemo } from 'react';
import { Environment, Sparkles } from '@react-three/drei';
import { makeWinterSkyEnv } from './Sky.jsx';

/**
 * Light, air and dust.
 *
 * THE ENVIRONMENT MAP IS BUILT AT RUNTIME, NOT DOWNLOADED. drei's <Environment>
 * is normally used with `preset`, which pulls an HDRI from a CDN — a hundred-odd
 * megabytes of someone else's photograph, an external request on every load, and
 * a hard dependency on a third-party host staying up. <Lightformer> children
 * instead let the environment be *composed* out of emissive planes that are
 * rendered to a cubemap once at startup. Same image-based lighting, no asset, no
 * network, and every value is ours to art-direct.
 *
 * That is what gives procedural geometry its expensive look. A directional light
 * plus an ambient term produces the flat, plastic shading that marks out a
 * first-week Three.js scene; image-based lighting gives broad soft gradients
 * across a surface and is most of the difference on its own.
 *
 * The composition is a real overcast sky: one very large soft source overhead,
 * two dimmer horizon bands for bounce, and a faint warm one low and behind to
 * keep the shadow side from going dead grey.
 *
 * FOG IS THE DEPTH CUE, and it is doing structural work rather than decorative.
 * Exponential-squared fog is what turns a finite terrain into an apparently
 * endless one: the far edge of the ground plane never has to be seen, because it
 * dissolves long before it is reached. It also separates the ridges into legible
 * planes of depth, which is the entire look of the reference.
 */

/** Matched to the fog colour. A horizon that differs from the fog is a seam. */
/*
 * COOLED AND DROPPED, from #a8aeb8.
 *
 * Graded against the reference: the difference between the two was never a
 * warm cast — there is not a warm value anywhere in this scene — it was that
 * this one sits lighter and flatter. Everything was clustered in a narrow band
 * around 70% grey, so the landscape had no depth to give away, and the small
 * amount of blue it did carry was swamped by that brightness.
 *
 * Pulling the ground values down and the blue up widens the gap between lit
 * snow and shadowed snow, which is where the cold reads from.
 */
/*
 * WARMED AND LIFTED FOR A BLUE SKY, from #a6aab4.
 *
 * This is the ambient floor's colour, and its whole job is to be the light that
 * is NOT the sun — which under an open sky is the sky itself. A grey ambient
 * under a blue sky puts neutral light in every shadow, and shadows on snow are
 * the bluest thing in a winter landscape, so it read as the shading being
 * dirty rather than cold.
 */
export const HORIZON = '#b6c4d8';
/*
 * Sampled out of the backdrop plate, not chosen.
 *
 * The background image is composited behind the scene and is never fogged, so
 * wherever our ground fades out it has to fade to the plate's own colour or
 * there is a visible band of the wrong grey along the horizon. #8a919e is the
 * average of the image between its horizon and its mid-ground — the strip our
 * terrain actually meets.
 */
/*
 * MEASURED, NOT PICKED. Sampled off the reference, its far hills sit at
 * #a1a5b0 — that is the colour distance fades TO, so it is what this has to be.
 * The old #9faab6 carried a blue-minus-red of +23 against the reference's +15,
 * which is where the scene's excess blue was entering: everything far enough
 * away to be fogged was being tinted by it.
 */
/*
 * RAISED WITH THE SKY, from #a6aab4.
 *
 * The far hills are mostly fog by the time they reach the lens, so their
 * measured value is very nearly this colour — and at #a6aab4 they came out at
 * 151 against the reference's 162. Fog colour is the direct lever on that band
 * and very nearly the only one.
 */
/*
 * RAISED TO MEET THE SKY, from #979ca6.
 *
 * THE HILLS WERE NOT A DENSITY PROBLEM, WHICH IS WHY THINNING THE FOG DID
 * NOTHING TO THEM EARLIER. At 0.0034 a mountain six hundred units out is
 * already ninety-eight per cent fogged — it IS this colour, near enough
 * exactly. So what the eye was reading as a ridge was simply this value sitting
 * against the sky: measured, fog 156 against a sky of 183, a 27-point
 * silhouette painted by the fog itself.
 *
 * Sampled off igloo.inc, its far peaks come out at 182 against a sky of 178.
 * Four points. They are not faint, they are gone — the distance there does not
 * resolve into anything at all, and that is what makes its middle ground read
 * as middle ground.
 *
 * At luminance 180 this is within a few points of our own sky, so anything far
 * enough to be fully fogged now dissolves instead of silhouetting. Near and
 * mid-ground are barely touched: they are hardly fogged, so they keep the grade
 * they were given.
 */
/*
 * PALE BLUE-WHITE, from the neutral grey #b0b4bd.
 *
 * There are two things left for this to colour and they both want the same
 * value. The first is the small amount of aerial haze on the far edge of the
 * ground plane; the second is the standard exp2 fog on everything that is not
 * terrain. Under a blue sky both of those are lit by that sky, so a neutral
 * grey is wrong in the same way a grey ambient is — it is the one part of the
 * frame that would still be overcast.
 *
 * The drifting ground mist has its OWN colour now and does not read this: see
 * FOG_WISP_COLOR in Terrain.jsx. Snow-white mist and distance haze are two
 * different materials and were never really one value.
 */
export const FOG_COLOR = '#c8d6e6';

export default function Atmosphere() {
  /* Built once. It is a 256x128 canvas, but rebuilding it per render would
     also force three to re-convolve it into a PMREM every time. */
  const skyEnv = useMemo(() => makeWinterSkyEnv(), []);

  return (
    <>
      {/* Squared falloff, tuned so ridges a few hundred units out are still
          just readable as silhouettes rather than gone entirely. */}
      {/* Denser than before. The ground only has to reach far enough to carry
          the igloo and its shadow — beyond that the plate takes over, and a
          short fade is what hides the join. */}
      {/*
        DENSER, from 0.00085. The reference loses its mountains into the haze
        by the middle distance and this held them crisp to the horizon — which
        is most of why the two read as different air. Aerial perspective is the
        depth cue doing the work in that image.
      */}
      {/*
        DENSER, from 0.00246.

        The reference's depth comes from air. Its nearest hills are already
        half-dissolved and its far range is a flat silhouette barely separable
        from the sky — you can count four or five distinct planes receding, and
        every one of them is defined by how much haze is in front of it rather
        than by its own detail. Ours were too legible: you could read ridge
        detail on a peak a kilometre away, which is what made the background
        look like geometry rather than distance.
      */}
      {/*
        DENSER, from 0.0034.

        This is the aerial perspective — the flat, distance-only part of the
        haze, under the drifting banks the terrain shader adds on top. At 0.0034
        our furthest ranges still came through as distinct grey silhouettes,
        while the reference's are so nearly gone that you read them as a change
        in the sky rather than as mountains. That gap is what made our
        background look like layered cut-outs.

        0.0042 is a small move on the near ground (at 60 units the factor rises
        from 0.04 to 0.06, which is invisible) and a large one at the back,
        which is exactly where the difference was.
      */}
      {/*
        THE STANDING HAZE IS GONE — 0.0042 to 0.0026 to 0.0009, and the last
        step is a change of intent rather than another trim.

        Every note above this line is an argument for MORE air, made while the
        reference was a still frame: in a still, atmosphere is the only thing
        that can express distance, so the density kept climbing until the far
        ranges dissolved. That reasoning is sound and it produced a scene whose
        depth was entirely a veil.

        Once the air MOVES, the veil is in the way. Motion is a far stronger
        depth cue than haze — near air crossing the frame quickly against far
        air that barely shifts separates the planes by itself, and it does it
        without taking the contrast off the landscape. So the haze retires to
        what it is actually needed for, which is only to keep the far edge of
        the ground plane from arriving as a hard line, and the wind does the
        depth.

        WHAT THIS NUMBER STILL CONTROLS. It is three's own exp2 density, so it
        is the fog on everything that is NOT the terrain — the igloo, the
        scree, the lattice. Those are all near, and at 0.0009 they are
        effectively unfogged, which is the point: the dome now reads at its own
        contrast instead of through a wash.

        Terrain reads it too, as the base for the aerial term in Terrain.jsx —
        but the wisps there no longer scale off it. Clearing the air was making
        the moving air vanish with it, and the two are separate things now.
      */}
      <fogExp2 attach="fog" args={[FOG_COLOR, 0.0009]} />

      {/* A low ambient floor only. The environment map does the real lighting;
          this just stops crevices reading as pure black. */}
      <ambientLight intensity={0.04} color={HORIZON} />

      {/*
        One shadow-casting key, LOW BUT NOT RAZOR-LOW — about 30 degrees.

        IT WAS AT 13 DEGREES, and that turned out to amplify every artefact the
        ground had. At a grazing angle N.L on flat snow is around 0.2, so the
        shading sits on the steep part of the cosine curve and the smallest
        change in surface normal swings the result enormously — fine normal-map
        detail that should read as texture came out as hard light and dark
        banding running along the slopes. Raising it to 30 degrees roughly
        doubles N.L and puts the shading somewhere the curve is flatter, which
        keeps the modelling without the amplification.

        THE MEASUREMENT THAT FORCED THIS. Sampled over a region, the reference
        snow has a p10-to-p90 luminance spread of 48; ours had 8. The medians
        already matched, which is why matching albedo alone changed nothing: the
        scene was the right average value and still read as mud, because a
        surface with no bright end and no dark end has no form. What was missing
        was not brightness, it was CONTRAST WITHIN the surface.

        A high light lands at a similar angle on every part of a gently rolling
        field, so every part comes back the same value. Dropping it to a grazing
        angle means the slope facing it returns nearly all of it and the slope
        behind returns almost none, and the drifts model themselves. The ambient
        term comes down at the same time, because it is a constant added to
        every pixel and so is pure spread-killer — it was setting a floor that
        no shadow could go below.
      */}
      <directionalLight
        castShadow
/*
         * MIRRORED IN X, from [-210, 150, 140]. The key was coming over the
         * left shoulder and throwing the igloo's shadow out to the right; the
         * reference is lit from the upper right.
         *
         * Only the sign changes. The elevation this sits at — about 30 degrees
         * — is not a look, it is the result of the measurement in the note
         * above: the reference snow has a p10-to-p90 luminance spread of 48 and
         * a higher key gave 8, because a light that lands at a similar angle
         * everywhere returns a similar value everywhere. Swinging it round
         * without preserving that height would undo the contrast this scene was
         * rebuilt to get.
         */
        /*
         * SWUNG BACK ALONG Z, from +140 to -160.
         *
         * The camera sits at z 370 and looks toward 250, so +z was the camera's
         * own side: the key was over the viewer's shoulder, which lights the
         * face of everything and flattens it. At -160 the sun is behind the
         * igloo instead, and the dome is lit from beyond — the faces turned
         * toward the lens fall into shade and the light rakes across the tops
         * and rims, which is where the reference gets its separation from.
         *
         * X and Y are untouched, so it stays high and to the right.
         *
         * THE SHADERS CARRY A COPY OF THIS DIRECTION, normalised, and they do
         * not read it from here — there is no uniform plumbed through
         * onBeforeCompile. Both Terrain.jsx and IglooBlocks.jsx have
         * vec3( 0.6916, 0.4940, -0.5269 ) and both must move if this does.
         */
        /*
         * SWUNG INTO FRAME, from [210, 150, -160].
         *
         * The reference has the sun IN THE PICTURE — a blowout at the top right
         * corner, half-hidden behind the near ridge — and that is not a
         * decoration, it is the whole reason its ridges have bright rims and
         * its valleys glow. A sun you cannot see is a sun the frame has to be
         * told about; a sun you can see is one the frame demonstrates.
         *
         * The old position was 73 degrees off the lens axis, so nothing of it
         * was ever on screen however bright the sky painted it. Solved instead
         * from where it has to LAND: the camera sits at [1.6, 42, 370] looking
         * at [-24.4, 24.1, 250], so its forward is (-0.212, -0.147, -0.966) and
         * its right is (0.966, 0, -0.210). Measured off the reference, its sun
         * sits 32 degrees right of the lens axis and about 16 above it; placing
         * ours at 33 degrees of bearing and 18 of elevation gives (0.332,
         * 0.309, -0.891), which puts the disc just past the top right corner
         * and its wash across it — the reference's framing exactly, where the
         * core is clipped and what you actually see is the glare.
         *
         * ELEVATION COMES DOWN — 29 degrees to 18 — and deliberately not further.
         * The note above records that the 30-degree height is not a look but the
         * result of a measurement: it is what gives the snow a p10-to-p90 spread
         * of 48 instead of 8, and that a razor-low 13 degrees puts the shading
         * on the steep part of the cosine curve where fine normal detail turns
         * into hard banding. The reference's own sun solves to about 11, which
         * is inside that failure; 18 buys most of the raking without entering
         * it, and the glare still clips the corner because the wash is broad.
         *
         * IT IS NOW A BACKLIGHT, which is the other half of the reference. With
         * the sun in front of the camera the light travels TOWARD the lens, so
         * every ridge between here and it is rimmed and every face turned to us
         * falls into its own shade. That is where the reference's separation
         * between planes comes from.
         *
         * THREE OTHER PLACES CARRY THIS DIRECTION, normalised, and none of them
         * read it from here: Sky.jsx's SUN and makeWinterSkyEnv's SUN_U/SUN_V,
         * and the sunFace terms in Terrain.jsx and IglooBlocks.jsx, which are
         * now vec3( 0.3324, 0.3090, -0.8910 ). All must move if this does.
         */
        position={[101, 94, -272]}
        // Raised with the environment cut, so the total light on the scene
        // holds roughly steady while far more of it arrives from one direction.
        // That trade is the whole of "modelling": same exposure, more form.
        /*
         * DOWN FROM 6.4, AND IT IS A RATIO THAT FORCED IT RATHER THAN A LEVEL.
         *
         * Measured against a screenshot of igloo.inc, every lit surface came
         * out 10 to 25 luminance points bright while the sky matched to within
         * five. Albedo could not close it: the constant that actually controls
         * the snowfield was cut 13% and the foreground moved two points, and
         * the igloo's tint was cut 12% and moved one. Surfaces that do not
         * respond to their own pigment are light-limited, not pigment-limited.
         *
         * And the number that was actually wrong is a RATIO, which no exposure
         * change can reach: sky-over-foreground was 1.44 against the
         * reference's 1.55. Exposure scales the sky and the ground together and
         * leaves that quotient exactly where it was. Only changing how much
         * light reaches the ground — while the sky, which is background rather
         * than a lit surface, stays put — opens it.
         *
         * The note above is right that this was raised to buy modelling, and
         * that is preserved: what comes down is the key, not the key's
         * DIRECTION or its elevation, so the p10-to-p90 spread that the 30
         * degree angle produces is untouched. The scene is lit less, not lit
         * flatter.
         */
        /*
         * UP FROM 4.6, WITH THE SKY.
         *
         * The old value was solved against an overcast: the note below it
         * records cutting the key until the sky-to-foreground ratio matched a
         * flat white sky. That ratio belongs to a different weather. Under a
         * clear sky the sun is a far stronger source relative to the ambient,
         * which is exactly what gives the reference its hard bright faces and
         * deep blue shadows — the thing an overcast cannot have.
         */
        intensity={5.4}
        /* Down from #f4f8fb, which was near enough white to be one. A key that
           bright leaves no room between a lit face and the sky behind it; this
           is the same light with the top taken off it and a little blue left
           in, so snow in full light still reads as snow and not as paper. */
        /*
         * WARMED AND BRIGHTENED, from #dce4ec.
         *
         * Direct sun that has come through a thin clear atmosphere is very
         * slightly warm, and against the blue ambient that difference is what
         * separates lit snow from shadowed snow as COLOUR rather than only as
         * value. Both light and shadow being blue is what made the earlier
         * scene read as monochrome however far the contrast was pushed.
         */
        color="#fff4e2"
        shadow-mapSize={[2048, 2048]}
        /*
         * NORMAL BIAS, not just depth bias — and this is what fixes the banding
         * on the vault.
         *
         * shadow-bias offsets the comparison by a constant in depth. That works
         * on surfaces facing the light and fails on curved ones: as a surface
         * turns away, one shadow-map texel covers more and more depth, so a
         * fixed offset stops being enough and the surface starts shadowing
         * itself in stripes that follow the curvature. The dome's flat block
         * faces were fine; the barrel vault, which curves through ninety
         * degrees, was banded from end to end.
         *
         * normalBias moves the sample point ALONG THE SURFACE NORMAL instead,
         * so the offset scales with how obliquely the light hits — exactly the
         * quantity that was causing the problem. Depth bias is kept small
         * alongside it for the flat cases.
         */
        shadow-bias={-0.00025}
        shadow-normalBias={0.85}
        shadow-camera-near={1}
        shadow-camera-far={620}
        /* Wide enough to contain the whole colonnade. A shadow camera that
           only covers part of a structure does not fail loudly — the bays
           outside it simply stop casting, and the eye reads that as the light
           changing halfway down the valley. */
        shadow-camera-left={-430}
        shadow-camera-right={430}
        shadow-camera-top={430}
        shadow-camera-bottom={-430}
      />

      {/*
        THE SKY ITSELF IS THE LIGHT SOURCE NOW.

        This was four <Lightformer> planes — an emissive rig standing in for a
        sky. It worked, but it lit the world with something that looked nothing
        like what the camera sees, so the reflections in the ice never agreed
        with the background behind it. Feeding the same generated sky in as the
        environment map means the glint on a block is a reflection of the actual
        sky above it, which is most of what sells a reflective material.

        Still no download: see makeWinterSkyEnv in Sky.jsx for why this is
        generated rather than fetched.
      */}
      <Environment map={skyEnv} />

      {/*
        Airborne dust. Deliberately sparse and slow — this is the one element
        that is always moving, so it is what tells you the world is live rather
        than a still, and any more of it immediately reads as a screensaver.

        The volume follows the camera implicitly by being large enough to cover
        the whole corridor, which is far cheaper than repositioning it per frame.
      */}
      {/* BISECT: Sparkles removed */}

    </>
  );
}
