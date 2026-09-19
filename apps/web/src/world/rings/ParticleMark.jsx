import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  Color,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from 'three';
import { iconPoints } from './geometry.js';
import { sound } from '../lib/sound.js';
import { MODEST } from '../water/device.js';
import { LOGO_Y, TUBE_BOTTOM, TUBE_TOP, CASE_RADIUS } from './layout.js';

// The mark, as thousands of little beads suspended in the chamber.
//
// Beads, not points. A point sprite is a flat disc that takes no light, and at
// this distance a field of them reads as dust on the lens; what the chamber
// wants is solid glossy spheres that each catch the studio and throw a
// highlight, so the mark has surface and body. So this is one InstancedMesh of
// small icosahedra, shaded by the room's own Environment.
//
// Every bead has two homes: a place on the current mark, and a place on a slow
// helix winding the length of the tube. `uForm` chooses between them, so the
// same beads are a stream of fluid on the way down and a recognisable mark once
// the room arrives — no second system, and no cross-fade.
//
// Once the mark is formed it is still. Nothing is held back to keep circling
// past it and nothing drifts in place: the helix is only how the beads arrive
// and how they leave, and the chamber settles when the room does.
//
// Everything here is built in the mark's own frame, centred on the mark, so the
// tube's ends are the plain constants TUBE_BOTTOM/TUBE_TOP and the pointer only
// has to be shifted, never rotated, to join it.

/**
 * Beads in the chamber.
 *
 * High, because the beads themselves are small: coverage goes with the square
 * of the radius, so finer beads need far more of them before the mark reads as
 * solid rather than as a screen of dots.
 */
const COUNT = MODEST ? 2200 : 5000;

/** Seconds the beads take to come apart and settle into the next mark. */
const MORPH_SECONDS = 1.7;

/**
 * How wide the mark is drawn.
 *
 * Two thirds of the bore, not three quarters. The gap between the edge of the
 * mark and the glass is the only room the beads have to be disturbed into —
 * fill the tube with the mark and every push lands them on the wall.
 */
const MARK_SIZE = 0.86;

/** Beads stay this far inside the glass, so none of them hang through it. */
const STREAM_RADIUS = CASE_RADIUS * 0.82;

/**
 * Fraction of the beads held back in the stream once the mark forms.
 *
 * None. Every bead goes into the mark and the chamber comes to rest — a drift
 * left circling a finished mark reads as an idle animation rather than as
 * something that has arrived.
 */
const HOLD = 0;

/**
 * Turns the stream makes between the foot of the tube and its mouth.
 *
 * Under two. More than that and the helix is wound tighter than the chamber is
 * wide, so from the front the beads read as an even scatter instead of as one
 * ribbon sweeping across it — which is the whole shape being drawn here.
 */
const TWIST = 1.7;

/**
 * Bead radius, smallest to largest. The mark takes the larger half.
 *
 * Small. At the room view these come out about five pixels across, which is
 * where the mark stops looking like gravel and starts looking like a powder.
 */
const BEAD = [0.0055, 0.0125];

/** Radius of the clear ball the pointer opens in the cloud, in world units. */
const VOID_RADIUS = 0.17;

/**
 * How the mark behaves when it is pushed.
 *
 * A spring, not a turntable. Dragging spins it and it swings back to face the
 * room, overshooting once or twice on the way — so it can be whipped around and
 * played with, and it always comes to rest readable rather than edge-on.
 */
const SPIN = { grab: 0.014, spring: 4.4, damp: 1.45, max: 11 };

/** How far the cloud leans toward the pointer, in radians. */
const LEAN = { yaw: 0.13, pitch: 0.09, ease: 2.4 };

/** How far it leans toward whichever arrow is being hovered, in radians. */
const NUDGE = 0.2;

const UP = new Vector3(0, 1, 0);

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * Per-bead motion, injected into MeshStandardMaterial's vertex shader.
 *
 * Only `transformed` is replaced: the normals, the environment and the lighting
 * are all three's own, which is the point of doing it this way rather than
 * writing a shader from scratch and having to light the beads by hand.
 */
const BEAD_VERTEX = /* glsl */ `
  attribute vec3 aTarget;
  attribute vec3 aFrom;
  attribute vec4 aRand;
  attribute vec3 aSpiral; // x = start angle, y = orbit radius, z = signed rise
  attribute float aScale;

  uniform float uMix;
  uniform float uFlow;
  uniform float uShow;
  uniform float uForm;
  uniform float uBottom;
  uniform float uTop;
  uniform float uTwist;
  uniform float uHold;
  uniform float uBore;
  uniform float uReach;
  uniform vec3 uTouch;
  uniform float uTouchAmt;
  uniform float uSpin;

  varying float vLit;

  vec3 beadOffset() {
    float span = uTop - uBottom;

    // --- the stream --------------------------------------------------------
    // A helix running the tube end to end and wrapping, wide across the middle
    // and drawn in toward both ends, so from the front it reads as one ribbon
    // sweeping across the chamber rather than as a cylinder of specks.
    float rise = aSpiral.z;
    float t = fract( aRand.x + uFlow * rise / span );
    float y = uBottom + t * span;
    float waist = 0.34 + 0.66 * sin( 3.14159 * t );
    float radius = aSpiral.y * waist;
    float angle = aSpiral.x + t * uTwist * sign( rise ) + uFlow * 0.12 * sign( rise );
    vec3 stream = vec3( cos( angle ) * radius, y, sin( angle ) * radius );

    // Beads that reach the foot settle there a moment before going round
    // again, so there is always a drift pooled on the plinth.
    float pool = smoothstep( 0.12, 0.0, t );
    stream.y = mix( stream.y, uBottom + 0.035 * aRand.y, pool );
    stream.xz = mix( stream.xz, stream.xz * ( 0.5 + 0.9 * aRand.z ), pool );

    // --- the mark ----------------------------------------------------------
    // Staggered per bead, so it comes apart and re-forms in a wave.
    float d = clamp( ( uMix - aRand.w * 0.3 ) / 0.7, 0.0, 1.0 );
    d = d * d * ( 3.0 - 2.0 * d );
    float burst = sin( 3.14159 * d );

    vec3 dir = normalize( aRand.xyz * 2.0 - 1.0 + 1e-3 );
    vec3 mark = mix( aFrom, aTarget, d ) + dir * burst * ( 0.16 + 0.3 * aRand.w );

    // --- which home this bead takes ----------------------------------------
    // uHold is normally zero, so every bead ends on the mark. It is kept as a
    // uniform rather than compiled away because it is the one dial that puts a
    // drift back in the chamber.
    float hold = uHold > 0.0 ? step( aRand.w, uHold ) : 0.0;
    float form = uForm * ( 1.0 - hold ) * ( 1.0 - 0.55 * burst );

    vec3 p = mix( stream, mark, form );

    // Loose and wide until the room arrives.
    p += dir * ( 1.0 - uShow ) * ( 0.9 + aRand.w );

    // --- the pointer -------------------------------------------------------
    // Two things happen where the pointer is.
    //
    // First, a void. Every bead inside a ball around the pointer is carried out
    // to its surface, so the cursor sits in a clear hole rather than in a
    // crowd. The radius is jittered per bead, which keeps the edge of the hole
    // ragged instead of leaving a shell of beads sitting on a perfect sphere.
    vec3 away = p - uTouch;
    float dist = length( away );
    vec3 outward = normalize( away + 1e-4 );

    float shell = ${VOID_RADIUS.toFixed(3)} * ( 1.0 + 0.5 * aRand.x );
    if ( dist < shell ) p = uTouch + outward * mix( dist, shell, uTouchAmt );

    // Second, around the void the mark stops holding. The beads are not welded
    // to each other, so they break up — but along a field read from where each
    // bead is, not from its own random number. Neighbours get nearly the same
    // answer and travel together, which is what makes the cloud clump and
    // stream instead of dissolving into an even fog.
    float reach = exp( -dist * dist * 2.4 ) * uTouchAmt;

    vec3 q = p * 2.4;
    vec3 flow = vec3(
      sin( q.y + uFlow * 0.5 ),
      sin( q.z - uFlow * 0.42 ),
      sin( q.x + uFlow * 0.36 )
    );
    vec3 swirl = normalize( vec3( -p.z, 0.0, p.x ) + 1e-4 );

    // No vertical bias anywhere in this: any mean drift up or down and the
    // whole cloud migrates to one end of the tube and packs there.
    vec3 disturb = flow * 0.2
                 + swirl * ( 0.1 + 0.26 * aRand.x )
    // Squared, so most beads move a little and a few are thrown well clear.
    // Those few are the wisps trailing off the cloud.
                 + dir * ( 0.06 + 0.62 * aRand.y * aRand.y );

    // Capped before it is applied, and this is the important part. The tube is
    // barely wider than the mark, so an uncapped field asks most beads to go
    // further than there is room for, the clamp below then puts every one of
    // them on the glass, and circling the pointer sweeps the whole cloud out
    // into a shell against the wall. Capped to the headroom, the clamp almost
    // never fires and the cloud churns in place instead.
    float mag = length( disturb );
    if ( mag > uReach ) disturb *= uReach / mag;
    p += disturb * reach;

    // Still inside the glass, whatever the flow asks for. A bead hanging
    // through the tube wall is the one thing here that reads as a bug rather
    // than as fluid.
    float bore = length( p.xz );
    if ( bore > uBore ) p.xz *= uBore / bore;
    p.y = clamp( p.y, uBottom + 0.03, uTop - 0.03 );

    // How hard this bead was touched, for the fragment shader to light it —
    // and how hard the whole mark is being spun, so whipping it round reads as
    // putting energy into something rather than as sliding a picture about.
    vLit = max( reach, uTouchAmt * smoothstep( shell * 2.4, shell, dist ) );
    vLit = max( vLit, uSpin * ( 0.35 + 0.65 * aRand.z ) );

    return p;
  }
`.replace('${VOID_RADIUS.toFixed(3)}', VOID_RADIUS.toFixed(3));

/** Rasterising and sampling a mark blocks the main thread, so each is built in its own idle slot. */
function useIconTargets(socials) {
  const [targets, setTargets] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let handle = 0;
    const built = [];
    // With a deadline, always. A plain requestIdleCallback on this page can be
    // starved for tens of seconds behind the world's own loading, and until
    // these are built there is no mark to show at all.
    const idle = window.requestIdleCallback
      ? (fn) => window.requestIdleCallback(fn, { timeout: 400 })
      : (fn) => setTimeout(fn, 16);
    const cancelIdle = window.cancelIdleCallback || clearTimeout;

    const step = () => {
      if (cancelled) return;
      const i = built.length;
      if (i >= socials.length) {
        setTargets(built);
        return;
      }
      built.push(iconPoints(socials[i].icon, socials[i].label, COUNT, MARK_SIZE, 101 + i * 17));
      handle = idle(step);
    };

    setTargets(null);
    handle = idle(step);
    return () => {
      cancelled = true;
      cancelIdle(handle);
    };
  }, [socials]);

  return targets;
}

/**
 * @param touch Shared with the glass, which already raycasts the pointer
 *   against the tube: `{ point, amt }` in world space.
 */
/**
 * @param nudge Optional ref holding -1, 0 or 1: which way the mark should lean
 *   because an arrow is being hovered. A look at what pressing it would do.
 */
export default function ParticleMark({ socials, index, levels, reduced = false, touch, nudge }) {
  const shown = useRef(0);
  const flow = useRef(0);
  // A morph is under way and `aFrom` still holds the mark being left behind.
  const morphing = useRef(false);
  const local = useMemo(() => new Vector3(), []);

  const group = useRef(null);
  // Where the mark has been spun to, how fast, and the drag doing the spinning.
  const spin = useRef({ angle: 0, vel: 0, from: null });
  // Where the pointer is on screen, and where the lean has eased to so far.
  const lean = useRef({ tx: 0, ty: 0, x: 0, y: 0, n: 0 });

  // Dragging anywhere spins the mark. The room already treats a press that
  // turned into a drag as not a click, so this costs the links nothing.
  useEffect(() => {
    if (reduced) return undefined;

    const onMove = (event) => {
      lean.current.tx = (event.clientX / window.innerWidth) * 2 - 1;
      lean.current.ty = -((event.clientY / window.innerHeight) * 2 - 1);

      const held = spin.current.from;
      if (held === null) return;
      spin.current.vel += (event.clientX - held) * SPIN.grab;
      spin.current.vel = Math.max(-SPIN.max, Math.min(SPIN.max, spin.current.vel));
      spin.current.from = event.clientX;
    };
    const onDown = (event) => {
      spin.current.from = event.clientX;
    };
    const onUp = () => {
      spin.current.from = null;
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointercancel', onUp, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [reduced]);

  const targets = useIconTargets(socials);

  const uniforms = useMemo(
    () => ({
      uMix: { value: 1 },
      uFlow: { value: 0 },
      uShow: { value: 0 },
      uForm: { value: 0 },
      uBottom: { value: TUBE_BOTTOM },
      uTop: { value: TUBE_TOP },
      uTwist: { value: TWIST },
      uHold: { value: HOLD },
      uBore: { value: CASE_RADIUS * 0.9 },
      // The room between the edge of the mark and the glass. Nothing may be
      // displaced further than this, or it ends up against the wall.
      uReach: { value: CASE_RADIUS * 0.9 - MARK_SIZE * 0.5 },
      uTouch: { value: new Vector3(0, -999, 0) },
      uTouchAmt: { value: 0 },
      uSpin: { value: 0 },
    }),
    []
  );

  const material = useMemo(() => {
    // Glossy white ceramic. The room's Environment is a dark surround, so each
    // bead comes back with a bright rim and a grey belly — which is the only
    // reason a white bead is visible against a white room at all.
    const m = new MeshStandardMaterial({
      // Ice, not ceramic: a hint of blue in the body, a wetter finish, and the
      // environment turned up so each bead carries a sharp highlight.
      color: new Color('#f2f7ff'),
      roughness: 0.3,
      metalness: 0.02,
      envMapIntensity: 1.35,
    });

    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${BEAD_VERTEX}`)
        .replace('#include <begin_vertex>', 'vec3 transformed = position * aScale + beadOffset();');
      // Touched beads light from within, for as long as the pointer is on
      // them. Added to the emissive rather than the diffuse, so they read as
      // glowing rather than as merely paler.
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying float vLit;`)
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>

          // Ice reads as ice because light goes a little way into it and comes
          // back at the edges. A Fresnel term on the emissive is the cheap
          // stand-in for that: cool, and only where the bead turns away.
          float iceRim = pow( 1.0 - abs( dot( normal, normalize( vViewPosition ) ) ), 3.0 );
          totalEmissiveRadiance += vec3( 0.34, 0.5, 0.74 ) * iceRim * 0.24;

          // And where the pointer is on them, they light from within — warm,
          // like everything else lighting this room from below.
          totalEmissiveRadiance += vec3( 1.0, 0.88, 0.72 ) * vLit * 1.7;`
        );
    };
    // Without this the injected program would share three's cache entry with
    // any other standard material of the same configuration.
    m.customProgramCacheKey = () => 'bead-mark';
    return m;
  }, [uniforms]);

  const mesh = useMemo(() => {
    if (!targets?.length) return null;

    // Detail 0: twenty triangles a bead. At the size these are drawn that is
    // indistinguishable from detail 1 and a quarter of the geometry, which is
    // the difference between this room running and not.
    const geometry = new IcosahedronGeometry(1, 0);
    const instanced = new InstancedMesh(geometry, material, COUNT);
    instanced.frustumCulled = false;

    // The beads are placed entirely in the vertex shader, so every instance
    // carries the identity matrix and instancing is only used to get them all
    // drawn in one call.
    const dummy = new Object3D();
    dummy.updateMatrix();
    for (let i = 0; i < COUNT; i += 1) instanced.setMatrixAt(i, dummy.matrix);
    instanced.instanceMatrix.needsUpdate = true;

    const first = targets[0];
    const target = new InstancedBufferAttribute(first.slice(), 3);
    const from = new InstancedBufferAttribute(first.slice(), 3);
    target.setUsage(DynamicDrawUsage);
    from.setUsage(DynamicDrawUsage);

    const rand = new Float32Array(COUNT * 4);
    for (let i = 0; i < rand.length; i += 1) rand[i] = Math.random();

    const spiral = new Float32Array(COUNT * 3);
    const scale = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i += 1) {
      // Held out near the wall. The square root spreads the beads evenly over
      // the disc, and the floor is high deliberately: a stream that runs down
      // the axis passes straight through the mark's face, and the negative
      // space in the middle of the Octocat is most of what makes it readable.
      const r = STREAM_RADIUS * (0.55 + 0.45 * Math.sqrt(Math.random()));
      const down = Math.random() < 0.3;
      spiral[i * 3] = Math.random() * Math.PI * 2;
      spiral[i * 3 + 1] = r;
      spiral[i * 3 + 2] = (down ? -1 : 1) * (0.14 + Math.random() * 0.26);

      // Beads held back for the stream take the small half of the size range
      // and the ones that build the mark take the large half. With nothing
      // held back that is every bead, and the mark reads as solid. The test
      // matches the shader's, which holds back a bead whose aRand.w is under
      // HOLD.
      const inStream = HOLD > 0 && rand[i * 4 + 3] < HOLD;
      const t = Math.random();
      scale[i] = inStream
        ? BEAD[0] + (BEAD[1] - BEAD[0]) * t * 0.45
        : BEAD[0] + (BEAD[1] - BEAD[0]) * (0.45 + 0.55 * t);
    }

    geometry.setAttribute('aTarget', target);
    geometry.setAttribute('aFrom', from);
    geometry.setAttribute('aRand', new InstancedBufferAttribute(rand, 4));
    geometry.setAttribute('aSpiral', new InstancedBufferAttribute(spiral, 3));
    geometry.setAttribute('aScale', new InstancedBufferAttribute(scale, 1));

    shown.current = 0;
    return instanced;
  }, [targets, material]);

  useEffect(
    () => () => {
      mesh?.geometry.dispose();
      mesh?.dispose();
    },
    [mesh]
  );
  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    if (!targets?.length || !mesh) return;
    const next = ((index % targets.length) + targets.length) % targets.length;
    if (next === shown.current) return;

    const target = mesh.geometry.attributes.aTarget;
    const from = mesh.geometry.attributes.aFrom;
    from.array.set(target.array);
    target.array.set(targets[next]);
    target.needsUpdate = true;
    from.needsUpdate = true;
    shown.current = next;
    uniforms.uMix.value = reduced ? 1 : 0;
    morphing.current = !reduced;
  }, [index, targets, mesh, uniforms, reduced]);

  useFrame((state, delta) => {
    if (!mesh) return;
    const dt = Math.min(delta, 0.05);
    const show = levels.current.show;

    // The stream has its own clock, so reduced motion can stop it without
    // freezing the morph between marks with it.
    if (!reduced) flow.current += dt;
    uniforms.uFlow.value = flow.current;

    uniforms.uShow.value = show;
    // Fluid on the way down, the mark once the room is here.
    uniforms.uForm.value = clamp01((show - 0.55) / 0.4);
    uniforms.uMix.value = Math.min(1, uniforms.uMix.value + dt / MORPH_SECONDS);

    // Once the morph lands, the mark being left behind is copied over, so
    // `aFrom` and `aTarget` hold the same thing and the beads sit on the
    // current mark whatever the blend between them says. Without this the
    // resting picture is only correct while the blend sits exactly at 1, and
    // anything holding it short leaves the previous mark on screen.
    if (morphing.current && uniforms.uMix.value >= 1) {
      const target = mesh.geometry.attributes.aTarget;
      const from = mesh.geometry.attributes.aFrom;
      from.array.set(target.array);
      from.needsUpdate = true;
      morphing.current = false;
    }

    // --- spin and lean ------------------------------------------------------
    // The spring pulls the mark back to facing the room; the damping is what
    // makes it feel like it has weight rather than like it is on a spindle.
    const s = spin.current;
    if (!reduced) {
      s.vel += -s.angle * SPIN.spring * dt;
      s.vel *= Math.exp(-dt * SPIN.damp);
      s.angle += s.vel * dt;

      const l = lean.current;
      const ease = 1 - Math.exp(-dt * LEAN.ease);
      l.x += (l.tx - l.x) * ease;
      l.y += (l.ty - l.y) * ease;
      // Eased the same way as the lean, so hovering an arrow tips the mark
      // toward it and letting go tips it back.
      l.n += ((nudge?.current ?? 0) - l.n) * ease;

      if (group.current) {
        group.current.rotation.y = s.angle + l.x * LEAN.yaw + l.n * NUDGE;
        group.current.rotation.x = -l.y * LEAN.pitch;
      }

      // Charge from the spin, easing off as it settles.
      const energy = Math.min(1, Math.abs(s.vel) * 0.16);
      uniforms.uSpin.value = energy * 0.5;

      // The chamber's glass takes the strain of the spin. Fed every frame with
      // how hard it is turning and which way, so it bends with the mark rather
      // than firing a one-off click at it.
      if (show > 0.8) sound.glass(energy * 0.85, s.vel * 4);
      else if (energy > 0) sound.glass(0, 0);

      // And the beads themselves. They are a body of loose matter in a jar, so
      // they get the fluid voice: it rises with how hard the mark is being
      // spun and with how much the pointer is stirring it, and falls to nothing
      // when the chamber is at rest. Fed every frame rather than triggered, so
      // it swells and dies away with the motion instead of clicking.
      const stir = touch && !reduced ? touch.amt : 0;
      sound.waterPhysics({
        angSpeed: Math.abs(s.vel) * 0.55 + stir * 0.5,
        rotX: group.current?.rotation.x ?? 0,
        rotY: s.angle,
        rippleSpeed: stir * 0.16,
        focus: show,
      });
    }

    // The glass raycasts the pointer already; this only has to bring its hit
    // down into the mark's own frame. Its depth is mostly flattened out on the
    // way: the ray strikes the near wall of the tube, and a disturbance centred
    // there acts on the mark from in front of it rather than from inside it,
    // which is not where the pointer looks like it is. The spin is undone as
    // well, since the beads are placed in the mark's frame and that frame has
    // turned under the pointer.
    if (touch && !reduced) {
      local.copy(touch.point);
      local.y -= LOGO_Y;
      local.applyAxisAngle(UP, -(group.current?.rotation.y ?? 0));
      local.z *= 0.2;

      // A droplet each time the pointer moves across the cloud, its pitch set
      // by where in the chamber it is. Rate-limited by the sound engine, which
      // ignores anything under its own speed floor.
      const moved = local.distanceTo(uniforms.uTouch.value);
      if (touch.amt > 0.25) {
        sound.waterRipple(
          moved * 0.5,
          0.5 + local.x / (CASE_RADIUS * 2),
          0.5 + (local.y - TUBE_BOTTOM) / (TUBE_TOP - TUBE_BOTTOM)
        );
      }

      // And one plip as the pointer first lands in the cloud, not a stream of
      // them: the threshold is crossed on the way in and not again until it
      // lets go.
      if (touch.amt > 0.3 && uniforms.uTouchAmt.value <= 0.3) sound.drop(0.45);
      uniforms.uTouch.value.copy(local);
      uniforms.uTouchAmt.value = touch.amt;
    } else {
      uniforms.uTouchAmt.value = 0;
      // Let the fluid voice fall silent with everything else.
      if (!reduced) sound.waterPhysics({ focus: 0 });
    }

    mesh.visible = show > 0.001;
  });

  if (!mesh) return null;

  return (
    <group ref={group} position={[0, LOGO_Y, 0]}>
      <primitive object={mesh} />
    </group>
  );
}
