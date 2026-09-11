import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { BufferAttribute, BufferGeometry, Color, Vector3 } from 'three';
import { heightAt } from '../lib/terrain.js';
import { loadIgloo } from '../../igloo/Igloo.js';
import { BlockPhysics } from '../../igloo/BlockPhysics.js';
import { IglooInteraction } from '../../igloo/IglooInteraction.js';
import { LOOK } from '../lib/lighting.js';

/**
 * The baked igloo, standing in the world.
 *
 * This is the join between two things that were built separately: the 74-block
 * BatchedMesh with its own physics and pointer handling (src/igloo/), and the
 * cinematic scene (src/world/). Everything interactive is REUSED FROM THERE
 * rather than reimplemented here — loadIgloo, BlockPhysics and IglooInteraction
 * are imported as they stand, and the same code still drives the standalone
 * page. What this component adds is only the wiring.
 *
 * NOTHING HERE OWNS A RENDERER, A CAMERA OR A FRAME LOOP.
 *
 * The standalone page has all three: its own WebGLRenderer, a PerspectiveCamera
 * it frames itself, and a requestAnimationFrame loop calling tick(). Mounting
 * that inside the world would mean a second WebGL context compositing over the
 * first, a camera fighting CameraRig, and two loops stepping the same physics.
 * So the page's tick() body is what moves here, and it moves into useFrame —
 * which IS the existing loop. The camera comes from useThree, so the blocks are
 * raycast against whatever CameraRig has the lens doing this frame. The pointer
 * listeners attach to gl.domElement, the canvas that already exists.
 *
 * The one thing deliberately NOT carried over is the standalone camera
 * parallax. IglooInteraction still computes it — the standalone needs it — and
 * here it is simply ignored, because CameraRig already leans the lens on
 * state.pointer and two parallax systems on one camera read as drift.
 */

/* Nodes in the measurement network. Carried over from the procedural igloo so
   the world keeps the readout it had. */
const MAX_NODES = 5;
const LINE_VERTICES = MAX_NODES + 1;

/*
 * Hover pressure below which a block does not get a crosshair.
 *
 * RAISED FROM 0.12, which was set when hover was a block plus a neighbour list
 * and every marked block was genuinely moving. Against the radial field it
 * marks the wrong things: the field reaches eleven blocks, and at 0.12 the
 * faintest qualifiers lift about a fifth of what the block under the cursor
 * does — so crosshairs landed on blocks that look stationary, and the network
 * read as tracking things the mouse was not interacting with.
 *
 * 0.42 keeps it to the blocks that are visibly out of the wall — in practice
 * the four or five nearest the cursor, which is what the readout is for.
 */
const NODE_FLOOR = 0.42;


/*
 * THE BLOCKS THAT CARRY THE BUILDING.
 *
 * Anything whose centroid sits below this never moves. Measured off the
 * manifest, the courses sit at y = 2.9, 8.8, 14.7, 20.3, 25.1 and 28.6, so a
 * cut at 5 takes the ground course and nothing else: the fourteen blocks of
 * ring 1 plus the two entrance blocks level with them, sixteen in all.
 *
 * By HEIGHT and not by ring index, because ring 0 in the manifest is the
 * entrance porch and runs from y 2.9 all the way to 13 — freezing "ring 0"
 * would pin half the porch and leave the dome's own bottom course free, which
 * is precisely backwards.
 *
 * A dome whose feet drift is a dome that is floating. Everything above can
 * breathe; the course standing on the ground cannot.
 */
const BASE_COURSE_Y = 5;

/*
 * THE IDLE SWEEP: two strokes from the same side, then rest, on a loop.
 *
 * A wave of pressure crosses the dome in local X, twice, both times entering
 * from the same side — and then the igloo is completely still for longer than
 * it moved. The pause is what makes it read as breathing rather than as an
 * animation on a loop: continuous motion at this amplitude stops being noticed
 * within about ten seconds, and then it is just noise the eye has to suppress.
 *
 * BOTH PASSES RUN THE SAME WAY, which is the whole reason this is not simply
 * "out and back". A wave that retraces itself reads as something being dragged
 * to and fro — the return tells you the first pass was a mechanism. Two
 * identical passes read as the same event happening twice.
 *
 * The jump from the end of the first pass to the start of the second is not
 * visible, and SWEEP_REACH is why: the front travels out to 1.45 dome radii
 * before the pass ends, so it has already left the shell when it resets to the
 * far side. The wave disappears off one edge and reappears off the other with
 * no block in between to show the seam.
 *
 * It is written through applyHover, so the sweep and the cursor share one
 * channel and one spring. That means they compose for free — max() takes
 * whichever is larger — and there is no second motion system that could ever
 * disagree with the first about where a block is.
 */
const SWEEP_STROKE = 2.6; // seconds for one pass across
const SWEEP_PASSES = 2; // both in the same direction
const SWEEP_PAUSE = 3.4; // seconds of stillness after the last one
const SWEEP_CYCLE = SWEEP_STROKE * SWEEP_PASSES + SWEEP_PAUSE;
/* Past 1 so the front enters and leaves beyond the dome's own edge, rather
   than materialising on the first block and vanishing off the last. */
const SWEEP_REACH = 1.45;
const SWEEP_WIDTH = 0.34; // gaussian half-width, in dome radii
/*
 * Well under a hover. The sweep should be visible and never compete with the
 * response to an actual cursor.
 *
 * DOWN AGAIN BECAUSE hoverPush WENT UP, not because the sweep changed. This
 * is a FRACTION of that push, so every time the cursor is asked to throw
 * blocks further the idle would drift up with it unless this comes down to
 * meet it — and an ambient motion that grows to match the interaction stops
 * being ambient. 0.42 -> 0.23 -> 0.16 -> 0.112 across three rounds, each
 * holding the sweep at the same ~1 unit of travel it has always had.
 */
const SWEEP_AMOUNT = 0.112;

/*
 * WHERE THE IGLOO ACTUALLY MEETS THE GROUND.
 *
 * heightAt() at the placement point alone is the wrong question, and here it is
 * wrong by 4.8 units. The terrain at [-30, 252] is a shallow bowl: the centre
 * samples at 15.78 while the ring the dome's wall stands on runs 19.4 to 20.6,
 * so seating the model — whose own base is exactly y=0 — on the centre sample
 * dropped the entire bottom course under the snow. Every block was placed
 * correctly relative to every other; the whole structure was simply sunk.
 *
 * A dome stands on a RING, not on its middle, so the ring is what gets
 * sampled, and the answer is its highest point. A block sitting slightly proud
 * of the ground still reads as standing on it; a block below the ground is
 * buried, and there is no recovering that at any camera angle. What is left on
 * the low side of the ring is a gap under half a unit, which the Scree apron
 * already banks against.
 *
 * Sampling rather than hardcoding an offset means this stays correct if the
 * terrain constants or the placement ever move.
 */
const FOOTPRINT = 30; // the entrance porch reaches 28.5; the dome wall stops at 22
const SEAT_ARC = 24; // samples around the ring
const SEAT_BANDS = 4; // radii sampled, from 0.72 of the footprint outward

function seatHeight(ax, az) {
  let top = -Infinity;
  for (let b = 0; b < SEAT_BANDS; b += 1) {
    const r = FOOTPRINT * (0.72 + (0.28 * b) / (SEAT_BANDS - 1));
    for (let a = 0; a < SEAT_ARC; a += 1) {
      const t = (a / SEAT_ARC) * Math.PI * 2;
      const h = heightAt(ax + Math.cos(t) * r, az + Math.sin(t) * r);
      if (h > top) top = h;
    }
  }
  return top;
}

const worldVec = new Vector3();
const projA = new Vector3();
const projB = new Vector3();

/**
 * Settled snow on skyward faces.
 *
 * Lifted from the procedural igloo's material so the two read as the same
 * masonry, minus the parts that cannot come with it: that version also tinted
 * block edges and leaked interior light through the joints, both driven by
 * custom aDepth / aEdge attributes generated alongside its geometry. The baked
 * blocks have no such attributes — their relief is in the bake — so only the
 * half that depends on nothing but the surface normal survives.
 *
 * The insertion point matters: roughnessFactor is declared by
 * roughnessmap_fragment, which the standard shader includes before
 * normal_fragment_maps, so it is in scope here and not before.
 */
const iceShader = (shader) => {


  /*
   * aEdge rides in from the bake — see Igloo.js for how it is derived. Both
   * declarations are prepended rather than injected into a chunk, because the
   * attribute has to be visible to the whole vertex program.
   */
  /*
   * vExcite IS SAMPLED HERE, IN THE VERTEX STAGE, AND THAT IS NOT A STYLE
   * CHOICE — IT IS THE ONLY STAGE WHERE IT CAN BE.
   *
   * A BatchedMesh carries per-instance colour, and the obvious way to read it
   * in the fragment shader is three's own vColor. That silently does not work.
   * USE_BATCHING_COLOR is added to the VERTEX prefix only — there is exactly
   * one occurrence of the define in the whole library — while
   * color_pars_fragment declares vColor for USE_COLOR and USE_COLOR_ALPHA and
   * nothing else. So the vertex stage dutifully computes the instance colour
   * into vColor and the fragment stage has never heard of it.
   *
   * Nothing errors. A '#if defined( USE_BATCHING_COLOR )' in the fragment
   * shader is simply always false, which is why the first attempt at this
   * compiled cleanly, rendered cleanly, and glowed not at all.
   *
   * Turning on material.vertexColors would pull the fragment declarations in,
   * but USE_COLOR also requires a real 'color' attribute on the geometry — a
   * quarter of a megabyte of white, uploaded so that a define lines up. Taking
   * the value across in a varying of our own costs one float per vertex and no
   * attribute at all.
   */
  shader.vertexShader =
    'attribute float aEdge;\nattribute float aEntrance;\nvarying float vEdge;\nvarying float vEntrance;\nvarying float vFacing;\nvarying float vExcite;\nvarying vec3 vCorner;\n' +
    shader.vertexShader.replace(
      '#include <begin_vertex>',
      [
        '#include <begin_vertex>',
        '  vEdge = aEdge;',
        /* Constant across a block — see the note in Igloo.js for why the flag
           rides in the geometry rather than in the instance colour. */
        '  vEntrance = aEntrance;',
        /*
         * INSIDE OR OUTSIDE, decided per vertex.
         *
         * The blocks arrive centroid-relative, so a vertex only knows where it
         * sits inside its own block — it has no idea which of its faces looks
         * out at the landscape and which looks into the igloo. The batching
         * matrix supplies exactly that: multiplying through it puts the vertex
         * and its normal into the DOME's coordinates, where the answer is just
         * whether the normal agrees with the direction out from the centre.
         *
         * normalize( bPos ) rather than a horizontal radius, so the crown works
         * too — up there "outward" is very nearly straight up, and a horizontal
         * radial would be undefined at the pole.
         */
        '  #ifdef USE_BATCHING',
        '    mat4 bMat = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );',
        '    vec3 bPos = ( bMat * vec4( transformed, 1.0 ) ).xyz;',
        '    vec3 bNor = normalize( mat3( bMat ) * objectNormal );',
        '    vec3 domeOut = length( bPos ) > 0.001 ? normalize( bPos ) : vec3( 0.0, 1.0, 0.0 );',
        '    vFacing = dot( bNor, domeOut );',
        '  #else',
        '    vFacing = 1.0;',
        '  #endif',
        /*
         * THE PER-BLOCK EXCITEMENT, READ BACK IN THE VERTEX STAGE.
         *
         * It has to happen here and not in the fragment shader. three defines
         * USE_BATCHING_COLOR for the vertex stage only — color_pars_fragment
         * declares vColor for USE_COLOR and USE_COLOR_ALPHA and nothing else —
         * so a fragment-side read compiles cleanly, is silently always false,
         * and does nothing. See the note at the top of this function.
         *
         * BlockPhysics encodes each block's excitement as an instance colour
         * ABOVE one: setRGB( 1 + g*0.30, 1 + g*0.38, 1 + g*0.52 ). A
         * BatchedMesh keeps instance colours in a Float32 texture, so values
         * over 1 survive instead of clamping, which is what makes this
         * recoverable at all. Blue has the largest coefficient and therefore
         * the best resolution, so the amount is undone from that channel.
         */
        '  #ifdef USE_BATCHING_COLOR',
        '    vec4 bCol = getBatchingColor( getIndirectIndex( gl_DrawID ) );',
        '    vExcite = clamp( ( bCol.b - 1.0 ) / 0.52, 0.0, 1.0 );',
        '  #else',
        '    vExcite = 0.0;',
        '  #endif',
        /*
         * WHICH WAY A ROUNDED EDGE WOULD FACE.
         *
         * The blocks are baked with hard edges and re-cutting the mesh is not
         * something a material can do. But at this distance the giveaway for a
         * sharp edge is not its silhouette, it is that the shading changes in
         * one step across it. Bending the NORMAL toward the block's own corner
         * direction as the edge is approached puts a gradient there instead,
         * which is what a bevel looks like from any distance where you cannot
         * count the pixels.
         *
         * transformed is centroid-relative, so normalising it gives the
         * direction from the block's middle out to this vertex — exactly the
         * way a rounded-off corner points. The epsilon keeps normalize from
         * dividing by zero on a vertex that lands on the centroid. Carried in
         * view space so it can be mixed straight into the shading normal.
         */
        '  vCorner = normalize( normalMatrix * ( mat3( bMat ) * normalize( transformed + vec3( 1e-5 ) ) ) );',
        /*
         * NOTHING TOUCHES THE VERTICES. The blocks are exactly as modelled.
         *
         * Two goes at cutting a fillet here have been backed out. The first
         * pulled edge vertices toward each block's centroid, which is wrong on
         * this mesh because the vertex data is centroid-relative in MODEL
         * space rather than in each block's own frame — every block not
         * square-on to the axes came in skewed instead of rounded. The second
         * retracted along objectNormal, which fixes that and does cut an even
         * corner, but any radius large enough to be visible with the blocks
         * seated is also large enough to be visibly not the shape that was
         * modelled.
         *
         * Which is the actual conclusion: a bevel is a modelling decision, and
         * faking it by moving someone's vertices at draw time trades a shape
         * they chose for one they did not. If the corners should be rounder,
         * the place to round them is the source model, where each block's own
         * frame is known and the result can be looked at before it ships.
         *
         * What survives is the shading bevel below, which bends the normal
         * near an edge and moves nothing. It softens how a corner catches the
         * light without altering the block.
         */
      ].join('\n')
    );

  shader.fragmentShader = 'varying float vEdge;\nvarying float vEntrance;\nvarying float vFacing;\nvarying float vExcite;\nvarying vec3 vCorner;\n' + shader.fragmentShader.replace(
    '#include <normal_fragment_maps>',
    [
      '#include <normal_fragment_maps>',
      'vec3 skyward = inverseTransformDirection( normalize( vNormal ), viewMatrix );',
      'float collects = smoothstep( 0.22, 0.66, skyward.y );',
      'float bare = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );',
      'float drift = mix( 0.35, 1.0, smoothstep( 0.30, 0.68, bare ) );',
      'float lying = collects * drift;',
      /*
       * DARKENED AND NEUTRALISED, from vec3(0.65,0.69,0.75) at 0.55.
       *
       * THIS LINE, NOT THE TINT, IS WHAT SETS THE DOME'S COLOUR. It mixes
       * toward a CONSTANT, so wherever the surface faces the sky it replaces
       * the albedo rather than modulating it — and on a dome that is most of
       * what the camera can see. Dropping the tint by 12% moved the rendered
       * body by one luminance point, because the tint was being mixed out from
       * under itself.
       *
       * The old constant is luminance 176 with a blue-minus-red of 25, which is
       * brighter than the reference's SKY and was dragging the dome to 109
       * against its 94, at B-R 30 against its 23. This one is 137/18: still
       * clearly snow lying on the blocks, no longer paint over them.
       */
      /*
       * RAISED WITH THE GROUND, from vec3( 0.45, 0.472, 0.50 ).
       *
       * This is the snow that has settled on the blocks, and it is the same
       * snow that is lying everywhere else in the scene — so it has to be the
       * same value. Terrain's snow constant went to 0.78 and this did not
       * follow it for one pass, which put grey drifts on top of a white
       * landscape: the caps read as dirt on the dome rather than as snowfall.
       */
      'diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.940, 0.965, 0.995 ), lying * 0.65 );',
      'float edgeFrost = smoothstep( 0.80, 0.98, vEdge );',
      'diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.94, 0.97, 1.00 ), edgeFrost * 0.35 );',
      'roughnessFactor = mix( roughnessFactor, 0.95, lying * 0.85 );',
      /*
       * THE EDGES CATCH LIGHT AGAIN — AND THIS IS A REVERSAL, SO HERE IS WHY.
       *
       * A note further down ("NO GLOSS ON THE EDGES") records this being
       * removed, on the grounds that it was the third route by which white had
       * crept onto the outward faces and that the blocks should not carry a
       * bright line on the side the camera sees.
       *
       * Put the two frames side by side and that last premise is simply not
       * what the reference does. igloo.inc's dome carries a distinct bright
       * line along the upper edge of every block WHILE STANDING STILL — it is
       * what draws the masonry and what makes the shell read as stacked snow
       * rather than as one moulded grey shape. Ours, with the gloss gone, is
       * the moulded grey shape: the courses are visible only as darker seams.
       *
       * The note's own text concedes this was "the most defensible of the
       * three" because it is a REFLECTION and therefore dies in shadow, which
       * is the behaviour the emissive versions got wrong. That is exactly the
       * property being relied on here: an edge in shade stays grey, so the dome
       * never lights up as a wireframe — the line appears only where there is a
       * sky or a sun for the bevel to find.
       *
       * WEAKER AND NARROWER than the version that was pulled: it sharpens the
       * top edges into the light and stops well short of outlining the block.
       * Snow is diffuse, so this is a small departure from the honest value —
       * but a wind-packed snow edge really is burnished, and 0.62 is still a
       * matte surface by any normal reading.
       */
      'float glossEdge = smoothstep( 0.86, 1.00, vEdge );',
      'roughnessFactor = mix( roughnessFactor, 0.72, glossEdge * 0.35 );',
      /*
       * THE BEVEL, AND IT IS WIDER AND HARDER THAN THE FIRST ATTEMPT.
       *
       * 0.45/0.55 rounded the corners just enough to lose the hard step and no
       * further, which read as slightly soft bricks. On the reference the
       * corner radius is a real fraction of the block — they are closer to
       * pillows than to bricks — so the band starts much earlier and takes the
       * normal most of the way over.
       *
       * It stops short of 1.0 deliberately. Bending the normal all the way to
       * the corner direction removes the flat face entirely and every block
       * turns into a pebble; leaving some of the true normal in is what keeps a
       * face reading as a face with rounded-off edges.
       */
      /* Matched to the geometry above — same narrow band, so the shading
         turns exactly where the surface does. Wider than the geometry and the
         face picks up a gradient that nothing in the silhouette explains,
         which is what made the blocks look soft all over instead of sharp-
         faced with rounded corners. Strong across that short span, because a
         fillet turns fast. */
      /* Matched to the geometry above, so the shading turns exactly where the
         surface does. Wider than the geometry and the face picks up a gradient
         nothing in the silhouette explains — which is what made the blocks look
         soft all over rather than flat-faced with rounded corners. */
      'float bevel = smoothstep( 0.55, 1.00, vEdge );',
      'normal = normalize( mix( normal, vCorner, bevel * 0.75 ) );',
      /*
       * A DISTURBED BLOCK CATCHES THE SUN.
       *
       * On the reference the blocks the cursor lifts do not merely move, they
       * go a brilliant snow white while the shell beside them stays grey. That
       * is not a glow ON the block — it is the block turning a fresh face up to
       * a very bright sky. A wall of snow that was edge-on to the light swings
       * over and takes it full on.
       *
       * So it is weighted by how much the surface faces the KEY, and the
       * direction is normalised straight off the light in Atmosphere.jsx,
       * position [210, 150, 140]. Move that light and this has to move with it:
       * it is one of the few numbers here that is duplicated rather than
       * derived, because onBeforeCompile has no uniform plumbed through to it
       * and adding one for a constant is not worth the machinery.
       *
       * The 0.28 floor keeps the shaded side from staying dead grey — snow
       * bounces a great deal of light around even out of direct sun.
       *
       * WHITENING THE ALBEDO, NOT ADDING EMISSIVE, is what makes this read as
       * light falling on snow: the block still takes the scene's shading, so
       * its form survives instead of flattening into a white cut-out. The
       * emissive further down does only the part albedo cannot — carry it over
       * the bloom threshold.
       */
      /*
       * NO HOVER-DRIVEN WHITENING, AND THE POINT IS THAT IT IS NOT NEEDED.
       *
       * There was a term here that mixed a disturbed block's albedo up to 92%
       * toward pure white. It came from the right observation — on the
       * reference, lifted blocks go brilliant white — but it produced the wrong
       * thing: at that strength the block loses its texture and its shading and
       * becomes a flat white panel, which reads as a light switching on rather
       * than as snow in sun. That is the fourth and last way white was getting
       * onto the outward faces.
       *
       * It is not needed because the sun term below already does it, honestly.
       * That term is driven by the WORLD NORMAL, which rotates with the block —
       * so a block that lifts 8.8 units and leans 30 degrees genuinely turns
       * faces toward the sun that were edge-on to it a moment earlier, and they
       * brighten because the geometry moved, not because something was added.
       *
       * Which is also why the reference's lifted blocks look the way they do:
       * its dome is dark grey, so a face swinging into the light is a large
       * jump. Ours is already near-white at rest, so the same jump is smaller —
       * and faking the difference is what turned the blocks into panels.
       */
      'vec3 sunDir = vec3( 0.3722, 0.6464, -0.6660 );',
      'vec3 wNrm = inverseTransformDirection( normalize( vNormal ), viewMatrix );',
      'float sunDot = dot( wNrm, sunDir );',
      'float sunFace = clamp( sunDot, 0.0, 1.0 );',
      /*
       * THE SUN LANDS ON THE IGLOO WHETHER OR NOT IT IS BEING TOUCHED, and
       * leaving that out was an error worth naming. The whitening was gated
       * entirely on the cursor, so the moment the same treatment went onto the
       * landscape the igloo sat visibly darker than the snow it stands on —
       * the one object in the frame the sun was apparently missing.
       *
       * Same curve as the terrain uses, a little weaker so the dome still
       * reads as a built thing against the field behind it.
       */
      'diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.98, 0.99, 1.00 ), smoothstep( 0.25, 0.85, sunFace ) * 0.45 );',

      /*
       * AND THE OTHER HALF OF IT: THE FACES THE SUN DOES NOT REACH.
       * Lifted floor to 0.68 so shadows stay luminous pastel ice blue rather than dark navy.
       */
      'diffuseColor.rgb *= mix( 0.68, 1.0, smoothstep( -0.45, 0.30, sunDot ) );',


      /*
       * THE BRIGHT LINE ALONG THE CURVE IS A SPECULAR, NOT A GLOW.
       *
       * This is the half the first bevel missed. Rounding the normal alone
       * gives the edge a gradient but leaves it as matte as the face, so it
       * goes grey rather than catching anything — and on the reference the
       * corner carries a hard bright line that clearly moves with the light.
       *
       * A rounded edge presents every angle between its two faces, so
       * somewhere along it there is always a normal pointing straight back at
       * the sun or the sky. Making just that band glossy is what lets it find
       * them. Because it is roughness and not emissive, the line only appears
       * where there is something to reflect: an edge in shadow stays dark,
       * which is exactly the behaviour the emissive version got wrong.
       *
       * LAST, so it wins. The snow mix above drives roughness to 0.96 and the
       * sunlit mix to 0.99, and either would flatten this back out if it came
       * afterwards.
       */
      /*
       * NO GLOSS ON THE EDGES. The bevel is shape only.
       *
       * A specular band along every rounded edge lived here, and it was the
       * third time white had crept onto the outward faces by a different
       * route: first a constant emissive rim, then a wide emissive spill, then
       * this. Physically it was the most defensible of the three — a
       * reflection, so it died in shadow — but it is still a bright line drawn
       * around every block on the side the camera sees, which is the thing
       * being asked not to happen.
       *
       * The bevel above still does the whole job it was added for: it removes
       * the one-step shading change that reads as a sharp edge. Rounding is
       * geometry, not shine, and it survives without this.
       *
       * Snow is diffuse anyway, so leaving roughness where the snow mix put it
       * is also the honest value for it.
       */
    ].join('\n')
  )
    /*
     * LIGHT IN THE ICE, AND IT IS EMISSIVE RATHER THAN A BRIGHTER ALBEDO.
     *
     * The reference's blocks are lit from inside: a hard bright line along
     * every edge, and a softer luminosity through the body of the block that
     * makes it read as ice rather than as stone. Albedo can do neither. A
     * brighter diffuse still needs a light to face, so it goes dark exactly
     * where the reference is brightest — the shadowed side — and it can never
     * exceed the light falling on it, so it can never bloom.
     *
     * TWO TERMS, and they are different materials rather than one effect at
     * two strengths:
     *
     *   RIM   the joint. Thin, near-white, and the part that survives at a
     *         distance — it is what draws the masonry.
     *   CORE  the body. Broad, dimmer, bluer, and INVERTED against the rim so
     *         the two never stack in the same pixels and clip together.
     *
     * BOTH SCALE WITH DISTURBANCE, which is what ties the glow to the cursor.
     * BlockPhysics writes each block's excitement into its instance colour as
     * a value ABOVE one, and a BatchedMesh keeps its colours in a Float32
     * texture, so that survives to the shader instead of clamping. Undoing the
     * encoding here recovers the 0..1 amount. At rest the rim sits under the
     * bloom threshold and reads as a crisp lit edge; disturbed, it goes well
     * over and the bloom pass turns it into escaping light, which is the whole
     * effect.
     */
    .replace(
      '#include <emissivemap_fragment>',
      [
        '#include <emissivemap_fragment>',
        /*
         * LIGHT ON THE INSIDE OF THE SHELL, AND IT IS ALWAYS ON.
         *
         * Two corrections got this to the right place. Lighting the block's
         * EDGES painted white frosting around every one of them; widening that
         * to carry across the face then lit the OUTER faces, which turned the
         * dome into a grid of glowing panels. Both were the same mistake — the
         * light was being put on the surface the camera can see directly,
         * which is the one surface a lamp inside the igloo cannot reach.
         *
         * The lamp is inside, so the lit surface is the inner wall. From
         * outside you see it only through the joints, and the wider a joint
         * opens the more of it shows — which is the effect, and it comes out
         * of the geometry rather than being drawn on.
         *
         * No excitement term: this burns whether or not anything is being
         * hovered, because a light inside a building does not switch off when
         * nobody is looking at it.
         */
        /*
         * TIGHTENED, from -0.08/-0.55.
         *
         * That band opened almost the moment a surface stopped facing outward,
         * so every block's side walls — the ones canted only slightly inward,
         * which are plainly visible from outside at this angle — carried some
         * of the lamp. The light was not staying inside the shell, it was
         * wrapping onto it.
         *
         * Starting at -0.35 means a surface has to be properly turned away
         * from the landscape before it sees any of the lamp, and full strength
         * waits until -0.75, which is very nearly facing the middle of the
         * dome. What the camera sees directly gets none of it, and the light
         * shows only where a joint has opened far enough to look through —
         * which is the whole reason for putting it inside.
         */
        /*
         * OPENED SLIGHTLY, from -0.35/-0.75.
         *
         * The reasoning in the note above is right — the lamp is inside, so the
         * inner wall is the lit surface and the light should only show where a
         * joint has opened far enough to look through. But -0.35 tuned the band
         * so tight that from the hero framing almost nothing came through: our
         * mortar lines read as dark seams where the reference's carry a faint
         * seam of light along them even with the page at rest.
         *
         * -0.30/-0.70 is a small widening, not a return to the -0.08/-0.55 the
         * note rejected. A surface still has to be properly turned away from the
         * landscape before it sees any of the lamp; there is just slightly more
         * of it visible through the gaps.
         */
        'float innerFace = smoothstep( -0.30, -0.70, vFacing );',
        /* Brightest at the joints, where the gap actually is, but never zero —
           the whole inner wall is lit and the joints are the hot part of it. */
        'float atJoint = 0.55 + 0.45 * smoothstep( 0.15, 0.95, vEdge );',
        'totalEmissiveRadiance += vec3( 1.00, 0.80, 0.48 ) * 3.60 * innerFace * atJoint;',
        /*
         * THE ARCH, AND IT IS THE ONE PLACE THE REFERENCE GLOWS WHILE STANDING
         * STILL.
         */
        'float archGlow = ( 0.70 + 0.30 * vExcite ) * vEntrance;',
        'float archRim = smoothstep( 0.84, 1.00, vEdge ) * archGlow;',
        'totalEmissiveRadiance += vec3( 1.00, 0.84, 0.52 ) * 4.60 * archRim;',
        /*
         * NO OPENING GLOW ON THE IGLOO. Removed, and this is the fifth time
         * light has been put on these outward faces and taken off again.
         *
         * The other four were constant or scroll-driven and were wrong for
         * reasons the notes above set out. This one was different: it ran once
         * on load, so the igloo arrived as a lit wireframe and resolved into
         * snow, which is what the reference's opening does.
         *
         * It still came off, and the reason is worth recording because it is
         * not the reason the others did. At this camera angle the opening looks
         * almost straight down onto the dome, and a broad emissive wash across
         * curved blocks does not read as a wireframe from above — it pools into
         * bright irregular smears wherever the surface turns toward the lens,
         * so the shell looked stained rather than drawn. The edge term alone
         * could not carry it without the wash, and the wash could not be made
         * to behave at that angle.
         *
         * What still does the opening work is the LATTICE and the terrain
         * reveal: the scaffold is up before the ground is, and the land is
         * uncovered outward from under the structure. The igloo simply stands
         * there while it happens, which is enough.
         */
        /*
         * NO EDGE LIGHT WHILE TRAVELLING. Removed deliberately, and this is the
         * FOURTH time a glow on the outward faces has been taken back off.
         *
         * The three notes above record constant versions being removed for
         * turning the dome into a grid of lit panels. This one was different in
         * kind — it was zero at rest and only rose with scroll velocity, so it
         * could not touch the graded opening frame — and it was still wrong,
         * for a reason none of those notes had reached: the igloo lighting up
         * because the CAMERA is moving makes the building a readout of the
         * scroll position. Nothing about pulling away from a structure should
         * change what the structure is doing.
         *
         * The speed of the move is now carried entirely by the lens — the blur
         * and the colour fringing in Stage.jsx — which is where a sensation of
         * speed belongs, because it is the camera that is moving and not the
         * subject. The igloo just sits there and gets smaller.
         */
        /*
         * NO EMISSIVE ON THE OUTER FACES, and that was the mistake here.
         *
         * A disturbed block turning white is a LIT surface, not a lamp. Adding
         * emissive to carry it over the bloom threshold made the block glow —
         * it went bright in shadow as well as in sun, which is the one thing a
         * surface catching sunlight never does, and it read as the block
         * switching on rather than as the light finding it.
         *
         * The whitening is albedo alone now (see catchLight above), so the
         * block can only be as bright as the light actually falling on it. The
         * one emissive term left on this material is the inner wall, which is
         * a real light source: there is a lamp behind it.
         */
      ].join('\n')
    );
};

/**
 * The scene's grade, applied to a material that was lit for a different room.
 *
 * loadIgloo builds its material for the standalone page: exposure 0.82, a
 * RoomEnvironment IBL and a 1.35 key. The world runs exposure 0.71 with a 6.4
 * directional key and the generated winter sky as its environment — far more
 * light arriving from one direction — so the same material comes out of it
 * blown flat. The baked basecolor peaks at 234-255 per channel and there is no
 * headroom above that for shading to work in.
 *
 * color on a MeshStandardMaterial multiplies the map, so pulling it down is the
 * one lever that takes the whole texture with it and leaves the relief in the
 * bake intact. #6f7684 lands the dome in the same band the procedural blocks
 * occupied at #626a7c, which was graded against the reference.
 */
function gradeForWorld(material, tint) {
  material.color = new Color(tint);
  material.roughness = 0.8;
  /*
   * DOWN FROM 0.32, WITH THE ALBEDO GOING UP.
   *
   * The environment is a bright sky and it arrives from every direction, so it
   * is the term that fills the shadow side — the one place this scene now wants
   * to stay dark. A brighter dome under the same fill is a dome with less
   * contrast on it, so the two have to move opposite ways to keep the modelling.
   */
  material.envMapIntensity = 0.45;
  material.onBeforeCompile = iceShader;
  material.needsUpdate = true;
}

export default function IglooBlocks({
  at = [-30, 252],
  yaw = 1.24,
  /*
   * THE MODEL IS DRAWN AT THE PROPORTIONS IT WAS BUILT AT. Do not scale it.
   *
   * A 1.44x vertical stretch lived here briefly, reasoned from a measurement:
   * the bake is 44 units across and 31.3 tall, 0.71 as tall as it is wide,
   * where igloo.inc's dome measures about 1.02 — and stretching Y would also
   * have turned the 9.3 x 5.9 blocks into squares. The arithmetic was right and
   * the result was wrong. A non-uniform scale does not make a dome taller, it
   * makes it a squashed dome pulled upward: the curve of the shell, the arch of
   * the porch and every block's bevel all distort together, and the entrance in
   * particular came out tall and pinched.
   *
   * If the silhouette should genuinely be taller, that is a change to the
   * SOURCE MODEL, where the shell can be rebuilt at the right profile and the
   * courses re-laid to suit it. It is not something a scale on the group can
   * fake.
   */
  /*
   * MEASURED AGAINST igloo.inc, not reasoned from the procedural blocks.
   *
   * #6f7684 was derived by analogy — it put the dome in the band the old
   * procedural igloo occupied. Screenshotted side by side, that came out at
   * luminance 110 against the reference's 97, and carrying a blue-minus-red of
   * +35 against its +23. Too light, and much too blue: the dome was reading as
   * tinted ice where the reference reads as grey snow that the SKY happens to
   * be cooling.
   *
   * The scene amplifies albedo blue by about 1.67 (the environment is a winter
   * sky, so what little blue is in the pigment gets multiplied by what is in
   * the light). So the albedo is corrected for what comes out the far end, not
   * for what it looks like in a swatch: B-R of +14 in, +23 rendered; and the
   * whole thing scaled to 0.88 to take the 13 points of luminance off.
   */
  /*
   * THE ICE IS WHITE NOW, from #585d62.
   *
   * EVERY NUMBER IN THE NOTE ABOVE IS A MEASUREMENT AGAINST AN OVERCAST, and
   * that is the only reason it is being overturned. Its method was right — read
   * the rendered luminance rather than the swatch, correct the albedo for what
   * the environment does to it on the way out — and the target it was matching
   * was a dome under a flat white sky, where an ice block is lit by nothing but
   * scattered light and genuinely photographs as a mid grey.
   *
   * Under a clear sky with a strong key it does not. The blocks are cut snow,
   * the same material as the ground they stand in, and the ground is now at an
   * albedo of 0.78 — so a dome sitting at 0.11 was not reading as ice in
   * shadow, it was reading as stone. Against a white snowfield it looked like a
   * different substance, which is the one thing an igloo must not look like.
   *
   * The method is kept: this is still a multiplier on the baked basecolor, so
   * it takes the whole texture with it and leaves the relief in the bake
   * intact, and it is still held below white to keep headroom for the key to
   * shade into. The dome is the brightest object in frame and it still has to
   * have a dark side.
   */
  /*
   * BACK TO #585d62, AND THE MEASUREMENT ABOVE IS WHY IT WAS RIGHT ALL ALONG.
   *
   * It was taken to #c6d0dc for one pass, on the reasoning that the blocks are
   * cut snow and the ground had just gone to an albedo of 0.78, so the dome had
   * to follow it. The reasoning is sound about the material and wrong about the
   * picture: the reference dome is not white. It is a cool mid grey standing in
   * a white field, and that contrast is the only thing separating the subject
   * from the snow it is built in. A white igloo on white ground has no
   * silhouette — it dissolves into its own setting, which is exactly what it
   * did.
   *
   * Snow that has SETTLED on the blocks is a different surface and stays
   * bright; see the lying-snow constant in iceShader. Cut, packed, shadowed ice
   * reads darker than fresh snowfall lying on top of it, which is the
   * distinction that makes a block wall look built rather than moulded.
   */
  /*
   * LIFTED TO #b4bfcc, AND THE POINT IS WHERE THE DARK COMES FROM.
   *
   * This has now been at #585d62 (dark grey) and at #c6d0dc (near white) and
   * both were wrong in the same way: they tried to settle the dome's overall
   * value with PIGMENT. Dark pigment gave a dome that was dark all over,
   * including the faces in full sun, which reads as a structure built out of
   * some other, darker material than the snow around it. Light pigment gave one
   * that was pale all over, including the faces turned away from the sun, which
   * reads as a lamp.
   *
   * A block of cut snow is nearly as light as the field it was cut from. What
   * makes half of the dome dark is that the sun is not on that half — and that
   * is a LIGHTING difference, so it belongs in the shading and not in the
   * albedo. The albedo goes up to sit near the snow, and the shadow term below
   * takes the unlit faces down.
   *
   * Still held under the snow's 0.78, because a curved wall of blocks catches
   * less sky than open ground does and because the dome must not dissolve into
   * the field behind it. It is the subject; it keeps a silhouette.
   */
  tint = '#c2d6ea',
  /** Extra clearance above the seated height, in world units. Positive lifts
   *  the dome further out of the snow; negative settles it back in. */
  lift = 0,
  /** Called once the igloo is standing — or once it is known it never will be.
   *  WorldSite holds the loading screen up until this fires. */
  onReady,
}) {
  const { camera, gl, size } = useThree();

  const groupRef = useRef(null);
  const lineRef = useRef(null);
  const anchorRefs = useRef([]);
  const nodeRefs = useRef([]);
  const valueRefs = useRef([]);

  const [rig, setRig] = useState(null);

  /*
   * Held in a ref, and that is load-bearing rather than tidiness.
   *
   * The loader effect below keys on [camera, gl, tint]. If onReady were in that
   * list, a parent re-rendering with a fresh arrow function would change its
   * identity, tear down the igloo and fetch the whole model again — and the
   * parent here is WorldSite, which re-renders on exactly the state this
   * callback sets. That is a loop that refetches 392 KB every time it closes.
   */
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  const origin = useMemo(() => {
    const [ax, az] = at;
    return [ax, seatHeight(ax, az) + lift, az];
  }, [at, lift]);

  const lineGeometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(LINE_VERTICES * 3), 3));
    return g;
  }, []);

  /*
   * Load, build the physics, attach the pointer handling.
   *
   * Async, and deliberately NOT suspending. Stage wraps the scene in a Suspense
   * boundary with a null fallback, so a suspending igloo would blank every
   * sibling — sky, terrain, weather — until the .bin and both textures landed.
   * Loading beside the world instead means the world is up immediately and the
   * igloo assembles into it, which is also the better shot.
   */
  useEffect(() => {
    let live = true;
    let built = null;

    loadIgloo({ base: '/igloo/', renderer: gl })
      .then((igloo) => {
        if (!live) {
          igloo.dispose();
          return;
        }

        gradeForWorld(igloo.mesh.material, tint);
        /* One body, always on screen, and it is the subject of the shot. The
           per-object culling test costs more than it can save here. */
        igloo.mesh.frustumCulled = false;

        const physics = new BlockPhysics(igloo.blocks, {
          radius: igloo.radius,
          config: {
            /*
             * HOVER IS THE WHOLE INTERACTION. Nothing is ever knocked loose.
             *
             * The launch tuning that used to sit here is gone rather than
             * merely unused: with click wired out below, every one of those
             * numbers (gravity, launch speed, drag, spin, the return delay)
             * described a state no block in this scene can enter, and a config
             * that documents impossible behaviour is worse than no config.
             * BlockPhysics still has the whole ballistic path — the standalone
             * page uses it — this scene simply never asks for it.
             */
            /*
             * UP FROM 0.03 AND 0.1. The old values were tuned as a "this one"
             * cue — a nudge to say which block the cursor had found — and at
             * the distance this camera sits that was nearly invisible: 0.66
             * units of travel on a 22-unit dome, perhaps two pixels on screen.
             * At 0.105 a hovered block lifts 2.3 units and leans twelve
             * degrees, which reads clearly as the block coming away from the
             * wall while still being nothing like a launch.
             */
            /*
             * UP AGAIN, from 0.105 and 0.21. At 2.3 units the lift was real
             * but the blocks stayed inside the shell's own thickness, so they
             * read as loosening rather than as coming off it. 0.19 puts the
             * block under the cursor 4.2 units clear — most of a block's own
             * depth — which is the separation the reference shows.
             */
            /*
             * UP AGAIN, from 0.19 and 0.3. At 4.2 units a hovered block came
             * most of its own depth out of the wall; at 0.28 it clears the
             * shell completely — 6.2 units — and leans 23 degrees, so the gap
             * behind it opens wide enough to see the lit inner wall through,
             * which is the whole point of the light being in there.
             */
            /*
             * UP AGAIN, from 0.28 and 0.4 — 0.40 puts the block under the
             * cursor 8.8 units out, which is well clear of the shell and about
             * two fifths of the dome's own radius, leaning 30 degrees with it.
             * The reason to go this far is the light: the wider the block
             * swings away, the more of the lit inner wall behind it is exposed,
             * so the size of the movement and the brightness of the hole it
             * opens are the same number.
             */
            hoverPush: igloo.radius * 0.4,
            hoverTilt: 0.52,
            /*
             * MUCH WIDER, from 0.68. Measured off the reference frame with the
             * cursor marked on it: one point near the middle of the dome has
             * most of a quadrant in the air — twelve to fifteen blocks, out to
             * the shell's edge — where 0.68 disturbed about ten in a tight
             * disc. It should read as the shell opening around your hand, not
             * as a patch directly under it.
             *
             * Set by counting rather than by eye: 0.82 averages 13 blocks over
             * every point on the dome. 1.05 was tried first and put 21 in the
             * air, which stops being a hand opening the shell and becomes the
             * roof coming off.
             */
            hoverReach: igloo.radius * 0.82,
            /* "Very subtle secondary reaction" — the ring around the hovered
               block acknowledges it and no more. */
            neighbourFalloff: 0.28,

            /* The RETURNING spring. Nothing in this scene enters that state
               any more — click is wired out and the assemble is gone — so these
               are here as the tuning the path WOULD use, not as live values.
               BlockPhysics defaults cover it if they are ever dropped. */
            returnFreq: 0.62,
            returnDamping: 1.0,
          },
        });

        /*
         * NO ASSEMBLE ANIMATION. The igloo is complete in its first frame.
         *
         * There used to be one here: every block seeded outward along its own
         * normal and handed to the RETURNING spring, so the dome built itself.
         * It read well in the physics test, which stepped a clean 60 Hz and had
         * it home in under four seconds. In the browser it took roughly twenty.
         *
         * The reason is the dt clamp, and it is not a bug in the clamp. This
         * scene mounts three generated texture sets and a displaced terrain, so
         * the frames right after load are long; every one of them is clamped to
         * 1/20 s before it reaches the spring, so the physics advances far
         * slower than the wall clock exactly when the assemble is running. The
         * clamp is correct — without it a long frame detonates a stiff spring —
         * which makes a load-time animation the wrong thing to own.
         *
         * And with the loader now held up until this point, an assemble would
         * play entirely behind the loading screen and never be seen anyway. So
         * the blocks start where they were built and the first frame is a whole
         * igloo, which is what the loader is there to promise.
         */
        /* The ground course is pinned before anything can touch it — see
           BASE_COURSE_Y. physics.frozen is honoured by applyHover, nudge and
           launch alike, so this covers the cursor and the sweep at once. */
        for (const b of igloo.blocks) {
          if (b.centroid[1] < BASE_COURSE_Y) physics.frozen[b.id] = 1;
        }

        /*
         * NO BLOCK ASSEMBLE. The igloo is whole from its first frame.
         *
         * One was written here, and then the reference's actual opening turned
         * out not to contain it: its igloo is already solid while the camera is
         * still high, and what plays over the top is a survey lattice — see
         * environment/Lattice.jsx. Blocks flying together was a guess at what
         * the opening was, and a wrong one.
         */

        physics.writeTo(igloo.mesh);

        const interaction = new IglooInteraction({
          /*
           * CLICK IS INERT HERE, and it is switched off at the source: the
           * pointerdown listener is never attached, so a press on the igloo is
           * not swallowed, not preventDefault-ed and not raycast — it simply
           * passes through like a press on the sky. The cursor follows suit and
           * shows a crosshair rather than a pointer, since a pointer over
           * something unpressable advertises an interaction that is not there.
           */
          click: false,

          /* But a finger is not a click. On a touchscreen there is no hover to
             answer, so a finger held on the dome stands in for one: the
             blocks under it lift, follow a sideways drag, and settle when it
             lifts. A vertical swipe still scrolls the page. */
          touchHover: true,

          /* The canvas that already exists. IglooInteraction adds its passive
             pointer listeners to it and raycasts once per frame — it does not
             create anything of its own. */
          dom: gl.domElement,
          camera,
          mesh: igloo.mesh,
          blocks: igloo.blocks,
          physics,
        });

        built = { igloo, physics, interaction };
        setRig(built);
        onReadyRef.current?.();

      })
      .catch((err) => {
        console.error('[world] igloo failed to load', err);
        if (import.meta.env.DEV) {
          document.documentElement.dataset.worldError = `igloo: ${err.message}`;
        }
        /* Ready in the sense the loader cares about: nothing more is coming.
           The rest of the world is intact and showing it beats a loading
           screen that never lifts. */
        onReadyRef.current?.();
      });

    return () => {
      live = false;
      if (built) {
        built.interaction.dispose();
        built.igloo.dispose();
      }
      setRig(null);
    };
  }, [camera, gl, tint]);

  /*
   * One frame, inside the loop the world already runs.
   *
   * This is the body of the standalone page's tick(), minus the two lines that
   * moved the camera and the one that called renderer.render — both of which
   * belong to the world now.
   */
  useFrame((state, delta) => {



    if (!rig) return;
    const { igloo, physics, interaction } = rig;

    /* Clamped for the same reason CameraRig clamps: a tab returning from the
       background delivers one enormous delta, and a stiff spring integrated
       across it does not slow down, it explodes. */
    const dt = Math.min(delta, 1 / 20);

    /*
     * The idle sweep, written BEFORE the interaction so that a real cursor
     * always wins: applyHover keeps the larger of the two, and the interaction
     * asserts a full 1.0 on the block under the pointer.
     */
    const phase = state.clock.elapsedTime % SWEEP_CYCLE;
    const moving = phase < SWEEP_STROKE * SWEEP_PASSES;
    /*
     * The modulo is what makes the second pass identical to the first rather
     * than a continuation of it — every pass starts again at the same edge.
     * null for the whole pause, and null is what actually stops the motion:
     * with nothing written the pressure decays and every block settles.
     */
    const front = moving
      ? -SWEEP_REACH + ((phase % SWEEP_STROKE) / SWEEP_STROKE) * SWEEP_REACH * 2
      : null;

    if (front !== null) {
      for (let i = 0; i < physics.count; i += 1) {
        if (physics.frozen[i]) continue;
        const u = physics.rest[i * 3] / igloo.radius;
        const d = (u - front) / SWEEP_WIDTH;
        const amount = Math.exp(-d * d) * SWEEP_AMOUNT;
        if (amount > 0.01) physics.applyHover(i, amount);
      }
    }

    interaction.update(dt);
    physics.step(dt);
    physics.writeTo(igloo.mesh);

    // --- Measurement network ------------------------------------------------
    /* Carried over from the procedural igloo, reading hover pressure instead of
       its per-instance amount. Same readout, same styles, different source. */
    const group = groupRef.current;
    const nodes = [];
    /* Only while the pointer is actually on the igloo. The sweep writes the
       same pressure channel the crosshairs read, so without this the whole
       measurement network would light up and track across the dome every few
       seconds on its own, which reads as the page doing something rather than
       as a response to the reader. */
    /* The eased strength rather than the raw hit, so the crosshairs do not
       blink out every time the ray slips between two blocks. */
    const live = interaction.strength > 0.12;
    for (let i = 0; live && i < physics.count; i += 1) {
      const amount = physics.push[i];
      if (amount < NODE_FLOOR) continue;
      const o = i * 3;
      nodes.push({
        amount,
        x: physics.rest[o] + physics.offset[o],
        y: physics.rest[o + 1] + physics.offset[o + 1],
        z: physics.rest[o + 2] + physics.offset[o + 2],
      });
    }

    nodes.sort((a, b) => b.amount - a.amount);
    const chain = nodes.slice(0, MAX_NODES);

    /* Wind the polygon by angle about its own centroid, or the polyline
       crosses itself as the cursor moves and reads as a scribble. */
    if (chain.length > 2) {
      let cx = 0;
      let cy = 0;
      for (const nd of chain) {
        cx += nd.x;
        cy += nd.y;
      }
      cx /= chain.length;
      cy /= chain.length;
      chain.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    }

    for (let n = 0; n < MAX_NODES; n += 1) {
      const node = chain[n];
      const nodeEl = nodeRefs.current[n];
      const label = valueRefs.current[n];
      const anchor = anchorRefs.current[n];

      if (!node) {
        if (nodeEl) nodeEl.style.opacity = '0';
        if (anchor) anchor.position.set(0, -9999, 0);
        continue;
      }

      if (anchor) anchor.position.set(node.x, node.y, node.z);

      const next = chain[(n + 1) % chain.length];
      if (label && next && group) {
        worldVec.set(node.x, node.y, node.z);
        projA.copy(group.localToWorld(worldVec)).project(camera);
        worldVec.set(next.x, next.y, next.z);
        projB.copy(group.localToWorld(worldVec)).project(camera);

        const px = Math.hypot(
          ((projB.x - projA.x) * size.width) / 2,
          ((projB.y - projA.y) * size.height) / 2
        );
        label.textContent = String(Math.round(px)).padStart(2, '0');
      }

      if (nodeEl) nodeEl.style.opacity = String(Math.min(1, node.amount * 2.2));
    }

    const linePos = lineGeometry.attributes.position;
    if (chain.length > 1) {
      for (let n = 0; n < chain.length; n += 1) {
        linePos.setXYZ(n, chain[n].x, chain[n].y, chain[n].z);
      }
      // Close the ring, then park the unused vertices on the first point.
      for (let n = chain.length; n < LINE_VERTICES; n += 1) {
        linePos.setXYZ(n, chain[0].x, chain[0].y, chain[0].z);
      }
      linePos.needsUpdate = true;
      if (lineRef.current) lineRef.current.visible = true;
    } else if (lineRef.current) {
      lineRef.current.visible = false;
    }
  });

  return (
    <group ref={groupRef} position={origin} rotation={[0, yaw, 0]}>
      {/* dispose={null}: the mesh, its material and both textures are owned
          by the effect above and released by loadIgloo's own dispose(). Letting
          R3F also dispose it on unmount would free the same GPU resources
          twice. */}
      {rig && <primitive object={rig.igloo.mesh} dispose={null} />}

      {/*
        BOTH LIGHTS ARE THE PROCEDURAL IGLOO'S, UNCHANGED.

        They are not decoration on this object, they are what the scene's post
        chain was tuned around: Bloom sits at luminanceThreshold 0.8 precisely
        so that nothing in the landscape qualifies and the light escaping this
        structure does. Dropping them would leave the bloom pass running with
        nothing to find.
      */}
      <pointLight
        position={[0, 12.5, -3.5]}
        intensity={LOOK.igloo.lamp.intensity}
        distance={70}
        decay={2}
        color={LOOK.igloo.lamp.color}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-near={0.4}
        shadow-camera-far={48}
        shadow-normalBias={0.4}
      />

      {/*
        Entrance fill. The baked porch reaches 28.5 units toward the camera, so
        this sits inside its mouth rather than at the dome wall.

        BROUGHT FORWARD AND UP IN LEVEL, from [0, 5.6, 20.5] at 180/31.

        The reference's arch does not just have a lit rim, it throws a soft pool
        onto the drift in front of the opening — which is most of what sells the
        mouth as a way in rather than as a dark patch on the wall. At 20.5 this
        sat far enough back inside the tunnel that its falloff was spent before
        it reached open ground, so the porch interior lit and the snow outside
        did not.

        25.4 puts it just inside the lip with the range to spill past it, and
        dropping it to 4.6 aims more of that spill at the ground instead of at
        the tunnel ceiling. It stays ONE light: a second one placed outside to
        paint the pool directly would light the drift from an angle the doorway
        cannot account for, which is the tell that it was added rather than
        escaping.
      */}
      <pointLight
        position={[0, 4.6, 25.4]}
        intensity={LOOK.igloo.porch.intensity}
        distance={46}
        decay={2}
        color={LOOK.igloo.porch.color}
      />

      <line ref={lineRef} geometry={lineGeometry} frustumCulled={false} visible={false}>
        <lineBasicMaterial color="#ffffff" transparent opacity={0.85} depthTest={false} />
      </line>

      {Array.from({ length: MAX_NODES }, (_, i) => (
        <group
          key={i}
          ref={(el) => {
            anchorRefs.current[i] = el;
          }}
        >
          <Html center zIndexRange={[10, 0]} wrapperClass="w-measure-wrap">
            <span
              className="w-node"
              ref={(el) => {
                nodeRefs.current[i] = el;
              }}
            >
              <span className="w-node-cross">+</span>
              <span
                className="w-node-value"
                ref={(el) => {
                  valueRefs.current[i] = el;
                }}
              />
            </span>
          </Html>
        </group>
      ))}
    </group>
  );
}
