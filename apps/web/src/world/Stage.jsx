import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { AdaptiveEvents, Preload } from '@react-three/drei';
import Atmosphere from './environment/Atmosphere.jsx';
import Sky from './environment/Sky.jsx';
import Terrain from './environment/Terrain.jsx';
import Scree from './environment/Scree.jsx';
import Weather from './environment/Weather.jsx';
import Lattice from './environment/Lattice.jsx';
import IglooBlocks from './structures/IglooBlocks.jsx';
import CameraRig from './camera/CameraRig.jsx';
import Diagnostics from './Diagnostics.jsx';
import { EffectComposer, Bloom, Vignette, ChromaticAberration, TiltShift2 } from '@react-three/postprocessing';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { Vector2 } from 'three';
import { useWorldScroll } from './scroll/ScrollProvider.jsx';

/**
 * The lens fringing, as its own component so it can have a frame loop.
 *
 * An effect's props are read when it is constructed, so animating `offset` by
 * re-rendering <ChromaticAberration offset={...}> would rebuild the pass every
 * frame. Holding a ref to the effect and writing into the Vector2 it already
 * owns mutates the uniform in place instead — the same reason the terrain
 * shaders take a `{ value }` object rather than a prop.
 *
 * SCALED ON THE FRAME, NOT IN PIXELS. The offset is in UV units, so a fixed
 * number splits a 4K frame by four times as many pixels as a 720p one. Dividing
 * by the drawing buffer width keeps the fringe the same physical width of the
 * picture on every display.
 */
function TravelFringe() {
  const { flight } = useWorldScroll();
  const ref = useRef(null);
  /* Constructed once. Passing a literal would build a new Vector2 per render. */
  const initial = useRef(new Vector2(0, 0));

  useFrame((state) => {
    const effect = ref.current;
    if (!effect) return;

    /*
     * Cubed, and it is a stronger curve than the igloo's edge light uses.
     *
     * Fringing is the more conspicuous of the two effects — it acts on the
     * whole frame rather than on one object — so at a matching ramp it arrives
     * long before the picture is actually moving fast enough to justify it, and
     * a gentle scroll comes out looking like a broken display. A cube keeps it
     * out of the way until the travel is genuinely quick.
     */
    const amount = flight.current * flight.current * flight.current;
    /* 5.5 px at the frame edge at full travel, measured on a 1536-wide canvas —
       enough to read as a lens and well short of looking like a fault. */
    const px = 5.5 / state.gl.getDrawingBufferSize(scratch).x;
    /* Y is the smaller term. A real lens disperses radially, and the frame is
       wider than it is tall, so an equal split reads as a vertical smear. */
    effect.offset.set(amount * px, amount * px * 0.55);
  });

  return <ChromaticAberration ref={ref} offset={initial.current} radialModulation modulationOffset={0.3} />;
}

/**
 * The smear while the camera is pulling away.
 *
 * WHY TILT-SHIFT AND NOT A MOTION BLUR. A true motion blur needs a velocity
 * buffer — the renderer has to know where each fragment was last frame — and
 * this version of @react-three/postprocessing ships no MotionBlur effect to
 * build one (its blur-adjacent exports are Autofocus, DepthOfField, TiltShift
 * and TiltShift2). DepthOfField could fake it by pulling focus off the subject,
 * but it is a bokeh pass over a depth buffer and it is by far the most
 * expensive thing that could be added to this chain.
 *
 * TiltShift2 blurs by DISTANCE FROM A BAND across the frame, which is the shape
 * the effect needs anyway. Retreating from something holds the middle of the
 * picture comparatively still while the edges rush outward, so the smear
 * belongs at the edges and the subject — which stays dead centre for the whole
 * pull-away — stays readable inside it. That it is also cheap is a bonus rather
 * than the reason.
 *
 * Zero when the page is still, like everything else driven off `flight`, so the
 * opening frame is untouched.
 */
function TravelSmear() {
  const { flight } = useWorldScroll();
  const ref = useRef(null);

  useFrame(() => {
    const effect = ref.current;
    if (!effect) return;
    /*
     * NEARLY LINEAR, AND STRONGER — this pass now carries the whole sensation
     * of speed on its own.
     *
     * It used to be one of three things saying "the shot is moving": the blur,
     * the colour fringing, and an edge glow on the igloo itself. The glow is
     * gone (see the note in IglooBlocks — the building should not light up
     * because the camera moved), so a curve tuned to be one voice among three
     * is now too quiet to be the only one.
     *
     * The exponent comes down from 2 to 1.35 so the smear arrives early in the
     * move rather than only at full tilt, and the ceiling goes up: on the
     * reference a firm scroll genuinely softens the whole picture, it is not a
     * subtle touch.
     */
    const t = flight.current;
    effect.blur = Math.pow(t, 1.35) * 1.45;
  });

  /* A NARROWER sharp band than the first pass used (0.62), so more of the frame
     is in the smear — but a wide feather, because the transition from sharp to
     blurred has to be invisible. A hard edge on that band announces itself as a
     horizontal stripe and the shot reads as a photograph of a model. */
  return <TiltShift2 ref={ref} blur={0} focusArea={0.38} feather={0.58} />;
}

/* Module scope: getDrawingBufferSize writes into the vector it is handed, and
   allocating one per frame is a garbage-collection pause per frame. */
const scratch = new Vector2();

/**
 * The persistent world.
 *
 * There is exactly one <Canvas> for the entire site and it never unmounts. Every
 * act is a stretch of one camera path through one scene graph — no act mounts or
 * unmounts a scene of its own. Swapping scenes per section is the thing that
 * makes a page read as "several 3D widgets" rather than as a place, and it also
 * throws away the WebGL context's warm state on every transition.
 *
 * The canvas is fixed behind the document; the scroll extent that drives it is a
 * spacer element supplied by ScrollProvider. So the page scrolls normally and
 * the world is what responds.
 */

export default function Stage({ onIglooReady, begin = false }) {
  return (
    /*
     * The fixed layer is a wrapper of ours, not the Canvas itself.
     *
     * R3F writes position, width and height as INLINE styles onto the element it
     * puts the className on, and inline styles beat a stylesheet rule — so
     * styling `.w-canvas` to be fixed and full-viewport silently lost to R3F's
     * own `position: relative`. That left the canvas in normal flow at its
     * default 300x150, rendering the world into a stamp in the corner of a page
     * that otherwise showed nothing but the fog-coloured background.
     *
     * Owning the positioned element instead lets R3F keep its wrapper at 100% of
     * whatever box we hand it, and we decide what that box is.
     */
    <div className="w-stage">
      <Canvas
        className="w-canvas"
        shadows
        /*
         * Capped device pixel ratio. Retina and 4K screens report 2 or 3, and
         * rendering a fogged terrain at 3x costs nine times the fragments for a
         * difference nobody can see through the fog. 1.75 is the point where the
         * ridge silhouettes stop showing stair-stepping.
         */
        dpr={[1, 1.75]}
        gl={{
          antialias: true,
          /*
           * A GLOBAL 8% TRIM, rather than pulling every albedo down again.
           * The grade is where it should be relatively — lit snow against
           * shadow against sky — and the whole thing simply sits a little
           * bright. Exposure moves all three together and leaves the ratios
           * between them alone, which is exactly what "slightly too bright"
           * asks for and what re-tinting surfaces would destroy.
           */
          /*
           * DOWN FROM 0.92, AND IT IS THE LAST STEP OF THE GRADE.
           *
           * With the reframe the measured bands came out uniformly 15 to 20
           * points above the reference — sky 201 against 181, hills 181 against
           * 162, foreground 137 against 126 — while the CONTRAST already
           * matched: frame spread 102 against 103. A uniform error with the
           * ratios already right is precisely what exposure is for. Re-tinting
           * surfaces to fix it would have to be done four times over and would
           * damage the spread that took the whole grade to get.
           */
          /*
           * BACK UP TO 0.86, from 0.71.
           *
           * Every argument above is a measurement against an OVERCAST
           * reference, and it was correct: a flat white sky over a hazed
           * landscape sits at a low key, and the whole frame had to come down
           * to meet it. The reference is now a clear sunlit one, where the
           * subject is snow in direct sun — the brightest natural surface there
           * is under the brightest natural light there is.
           *
           * The reasoning in the note holds exactly as written: this is still
           * the right lever precisely because the error is uniform and the
           * ratios are already set by the albedo and the key. It is being moved
           * the other way for the same reason it was moved down.
           */
          toneMappingExposure: 0.86,
          powerPreference: 'high-performance',
          /* No alpha: the scene is fully opaque, so compositing the canvas
             against the page every frame is wasted bandwidth. */
          alpha: false,
          stencil: false,
          /* Dev only: readPixels needs the buffer to survive the frame, and
             Diagnostics uses it to measure flicker. Off in production. */
          preserveDrawingBuffer: import.meta.env.DEV,
        }}
        /*
         * near is 3, not 0.5. Depth precision is distributed by the near:far
         * ratio, so a very close near plane spends most of the depth buffer on
         * the first few units and leaves the distant hills fighting over the
         * remainder — which shows up as shimmering ridges at the horizon. The
         * camera never comes within 3 units of anything (the rig keeps a 2.4
         * clearance above the terrain), so this costs nothing.
         */
        camera={{ fov: 42, near: 4, far: 2600, position: [0, 62, 330] }}
      >
        {/* Nothing here suspends today, but the character GLB will, and a
            fallback of null means the world simply keeps rendering without him
            rather than the whole canvas blanking while he loads. */}
        <Suspense fallback={null}>
          <Sky />
          {/* begin drives the opening slab: the ground starts as a block and
              uncovers the land and hills as the camera comes down. */}
          <Terrain begin={begin} />
          {/* Loose stone on the ground. It goes with the terrain rather than
              with the igloo because it is landscape, not set dressing — the
              apron happens to bank against the dome the way drift does. */}
          <Scree />
          <Weather />
          <Atmosphere />

          {/*
            NO GROUND MESH. The plate carries the snow field.

            The procedural terrain existed to give the igloo somewhere to stand,
            but the backdrop already photographs a snow plain running to the
            mountains — so the mesh was a second, worse version of the same
            thing sitting in front of it, and every attempt to blend the two
            traded one seam for another. Deleting it removes the seam entirely.

            It also removes the last geometry that moved under the camera, which
            is what the flicker measurements kept pointing at.
          */}

          {/*
            The one interactive object in the world. Everything else is
            scenery; this answers the cursor.

            THE BAKED MODEL, NOT THE PROCEDURAL SHELL. Same slot, same radius
            of 22, same yaw — the composition is unchanged and the camera did
            not move. What changed is the body: 74 blocks carrying their own
            bake, drawn as one BatchedMesh, each addressable by batchId, so the
            cursor can pick out a single block and knock it loose.

            structures/Igloo.jsx is left in the tree. It is the procedural
            version this replaces and it still builds; nothing imports it.
          */}
          <IglooBlocks at={[-30, 252]} onReady={onIglooReady} />

          <Preload all />
        </Suspense>

        {/* Outside Suspense: the camera must be driven even while assets load,
            or the first frames after a load pop from the default position. */}
        {/* begin gates the opening descent: it waits at the top of the move
            until the loading screen has actually come down. */}
        <CameraRig begin={begin} />

        {/* The survey web over the opening shot. Same begin signal, so it
            clears in step with the descent it belongs to. Outside Suspense
            with the camera, because it is part of the move rather than part of
            the scenery. */}
        <Lattice at={[-30, 252]} begin={begin} />

        {/*
          Drops resolution when the framerate falls and restores it when there is
          headroom. On a scroll-driven film a dropped frame is felt as a stutter
          in the camera move, so trading sharpness for smoothness is the right
          way round here.
        */}
        {/*
          Bloom, and it is doing structural work rather than decoration: the
          light inside the igloo escapes through the mortar joints as very thin
          bright lines, and a thin bright line without bloom is just an aliased
          edge. Spreading it is what turns the spill into a glow.

          A high luminance threshold keeps it off the snow and the fog — only
          the escaping light and the lit rims are bright enough to qualify, so
          the rest of the world is untouched.
        */}
        <EffectComposer disableNormalPass>
          {/*
            COLOUR FRINGING WHILE TRAVELLING, AND IT IS ZERO WHEN STILL.

            Scroll the reference quickly and the frame splits into red and cyan
            at the edges — most visible across the foreground snow, where there
            is a large area of near-flat tone for it to shear. It is what makes
            the movement feel like it is being photographed through a lens
            rather than like a camera transform being applied, and it is the
            other half of the same sensation the igloo's edge light supplies.

            Driven from the SAME `flight` value as that edge light, which is why
            the value is derived once in ScrollProvider instead of at each
            consumer: two independent smoothings of the same velocity drift
            apart under fast scrolling, and the fringing and the glow then read
            as two separate effects rather than as one impression of speed.

            It sits AFTER Bloom. Aberration is a property of the lens, so it
            should displace the bloom's halo along with everything else;
            fringing first and then blooming the result spreads the split until
            it reads as a colour cast rather than as a lens.
          */}
          <Bloom
            intensity={1.15}
            /*
             * THIS NUMBER HAS TO SIT ABOVE THE SKY, and at 0.72 it did not.
             *
             * The fog colour has a relative luminance of 0.749, so the entire
             * horizon was over the threshold and the whole sky was being
             * bloomed. Every small camera movement then pushed swathes of
             * pixels back and forth across the cutoff, and the background
             * shimmered — worst near the horizon, where the largest area of the
             * frame sits closest to that luminance.
             *
             * At 0.92 nothing in the landscape qualifies: only the light
             * escaping the igloo's joints and the lit rims are bright enough,
             * which is all the bloom was ever for.
             */
            /*
             * DOWN FROM 0.92 NOW THE JOINTS GLOW AGAIN.
             *
             * That value was set to keep bloom off the sky — the note below
             * records the fog sitting at luminance 0.749 and the whole horizon
             * being bloomed at 0.72. The sky has since come down and the block
             * edges have come up, so there is room between them again, and the
             * edges need it: what makes the reference's joints read as light
             * escaping rather than as white paint is the halo around them, and
             * a halo is what a bloom pass is.
             *
             * 0.80 clears the brightest snow with margin and catches the
             * joints, which is the whole intended job.
             */
            luminanceThreshold={0.8}
            luminanceSmoothing={0.28}
            mipmapBlur
          />
          {/*
            A VIGNETTE, AND IT IS DOING TONAL WORK RATHER THAN DECORATION.

            Measured against the reference, our frame's dark end was the last
            thing missing: igloo.inc's foreground reaches p10 83 and ours sat at
            105 with every albedo in the ground already pushed nearly to black.
            The reason it could go no further is the key — at intensity 4.6 even
            a 0.03 albedo renders around 0.14, so there is no darkness left to
            find in the materials.

            Its frame is darkest in the corners, which is not something a
            landscape does on its own: it is a lens. A vignette supplies the
            missing dark where the reference has it, costs one multiply in a
            pass that is already running, and does it without touching the
            grade of anything in the middle of the shot — which is the part
            that already measured correctly.

            Kept wide (a high offset) and gentle. A tight vignette announces
            itself as an effect; this one should only be noticeable as the frame
            feeling like it was photographed.
          */}
          <Vignette offset={0.26} darkness={0.52} eskil={false} />
          <TravelSmear />
          <TravelFringe />
        </EffectComposer>

        {/*
          AdaptiveDpr IS DELIBERATELY ABSENT, and that is the fix for the
          blinking.

          It drops the pixel ratio when the framerate dips and raises it when
          there is headroom — sensible in principle, pathological with a bloom
          pass. Lowering the resolution makes the frame cheaper, which restores
          the framerate, which makes it raise the resolution again, which costs
          the framerate: the scene oscillates between two pixel ratios several
          times a second and the whole canvas visibly flashes.

          A fixed dpr costs a little on weak machines and never flickers, which
          is the better trade for something meant to be looked at.
        */}
        <AdaptiveEvents />

        {/* Reports draw counts onto <html data-world-stats>. See Diagnostics for
            why that goes through the DOM rather than a global. */}
        {import.meta.env.DEV && <Diagnostics />}
      </Canvas>
    </div>
  );
}
