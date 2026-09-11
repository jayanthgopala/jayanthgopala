import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { CAMERA_CURVE, INTRO, TARGET_CURVE } from '../chapters.js';
import { useWorldScroll } from '../scroll/ScrollProvider.jsx';
import { heightAt } from '../lib/terrain.js';

/**
 * Drives the camera along the journey.
 *
 * Runs entirely inside useFrame, mutating the camera in place. Nothing here
 * touches React state, so the scene graph is reconciled once and then simply
 * animated — see ScrollProvider for why that matters.
 *
 * THE DAMPING IS THE CRAFT. Sampling the spline at the raw scroll value gives a
 * camera welded to the wheel: it starts and stops dead, and the world feels
 * weightless. Instead the rig keeps its own `eased` progress that chases the
 * scroll value exponentially, so the camera accelerates into a move and coasts
 * out of it, still travelling for a moment after the wheel stops. That trailing
 * motion is most of what separates a scroll-driven film from a scrubber.
 *
 * Framerate-independent, via 1 - exp(-lambda * dt). The naive `v += (t - v) *
 * 0.1` per frame is the usual way this is written and it is wrong: it damps
 * twice as fast at 120fps as at 60, so the camera has different weight on
 * different machines.
 */

/** The aim leads slightly looser than the body, so turns feel like a head turn. */
const TARGET_LAMBDA = 2.0;
/**
 * Pointer parallax, in world units.
 *
 * THE LENS DOES NOT MOVE. IT TURNS, AND IT TURNS ABOUT A FIXED POINT.
 *
 * This went the other way for one pass — the body translating and the aim
 * taking the same offset, so the camera dollied without rotating. That is the
 * purer parallax and it is not the shot: it slides the camera off the framing
 * the spline authored, it walks the lens toward the ground on a steep lean, and
 * because a translation cannot turn the view it leaves the sky welded to the
 * viewport while everything else moves under it.
 *
 * So the body term is gone entirely — not set to zero, removed, because a
 * constant nothing multiplies is a constant someone will change and wonder why
 * it did nothing — and the camera sits exactly where the curve puts it. The
 * pointer moves the AIM, which rotates the lens about that fixed point: one
 * pivot, no travel, the way a camera on a tripod head works.
 *
 * WIDER, from 0.9. That number was set as a trim on top of a body move that was
 * doing most of the work; with the body gone it is the whole of the movement
 * and it has to carry it. At 4.4 a full corner-to-corner sweep of the cursor
 * turns the lens by something over two degrees, which moves the frame by around
 * a twentieth of its width — a lean you can see, well short of a pan.
 *
 * The vertical is kept to 0.45 of the horizontal where it is applied. A camera
 * pitching as far as it yaws reads as a wobble, and the frame has much less
 * headroom above the ridges than it has width.
 */
const AIM_PARALLAX = 4.4;

/** Minimum gap between the lens and the ground. */
const GROUND_CLEARANCE = 2.4;

/* Damping with a deadband — see the note in Igloo.jsx. Without it the camera
   aim creeps toward its target for ever and the whole frame is re-rendered
   fractionally offset every frame, which reads as shimmer on any fine detail. */
const SETTLED = 0.0005;

/*
 * THE OPENING DESCENT.
 *
 * The camera starts high above the igloo and comes down into the held frame.
 * Expressed as an OFFSET from the held position rather than as a second
 * waypoint, so there is exactly one place that decides where the shot ends up
 * — the curve — and the intro is a thing that happens on the way to it. Change
 * the framing and the descent follows it automatically.
 *
 * Up and slightly in: it falls, and pulls back as it falls, which keeps the
 * dome growing in frame all the way down instead of looming and then receding.
 */
const INTRO_OFFSET = [-14, 176, -68];

/* Smootherstep. Zero velocity AND zero acceleration at both ends, which is
   what stops the landing reading as a stop — an ease-out cubic still arrives
   with acceleration on it and the frame visibly jolts as it settles. */
const smootherstep = (k) => k * k * k * (k * (k * 6 - 15) + 10);

const damp = (current, target, lambda, dt) => {
  if (Math.abs(target - current) < SETTLED) return target;
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
};

export default function CameraRig({ begin = true }) {
  const { camera } = useThree();
  const { progress, intro: introClock } = useWorldScroll();
  /* Dev only: the shared intro clock, readable from the console. */
  if (import.meta.env.DEV) window.__introClock = introClock;

  const pointer = useRef({ x: 0, y: 0 });
  /* Not state: it is read and written every frame and nothing renders off it. */
  const intro = useRef({ last: 0, rushed: false, done: false });

  /* The rig's OWN progress, chasing the scroll value rather than equalling it.
     Sampling the spline at the raw value makes the camera stop dead the instant
     the wheel does, which is what makes a scroll-driven shot feel weightless. */
  const eased = useRef(0);

  const position = useRef(new Vector3());
  const target = useRef(new Vector3());
  const smoothedTarget = useRef(new Vector3());
  const started = useRef(false);

  /*
   * WHAT KIND OF POINTER, AND WHETHER A FINGER IS STILL DOWN.
   *
   * state.pointer keeps the last position it was given, and on a touchscreen
   * the last position is wherever the last tap was — so the lens leaned toward
   * that spot and stayed there for the rest of the visit. A mouse never has
   * this problem, because a mouse is always somewhere. So a lifted finger
   * counts as no pointer at all, and the lens eases back to centre.
   */
  const touch = useRef({ type: 'mouse', down: false });
  useEffect(() => {
    const onDown = (e) => {
      touch.current.type = e.pointerType;
      if (e.pointerType === 'touch') touch.current.down = true;
    };
    const onUp = (e) => {
      if (e.pointerType === 'touch') touch.current.down = false;
    };
    const onMove = (e) => {
      if (e.pointerType === 'mouse') touch.current.type = 'mouse';
    };
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointercancel', onUp, { passive: true });
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  useFrame((state, delta) => {
    // A tab restored from the background delivers one enormous delta, which
    // would snap the camera to its target and discard all the inertia.
    const dt = Math.min(delta, 1 / 20);

    /*
     * TRAVELLING AGAIN — and the objection that stopped it last time no longer
     * applies, because the path has been turned around.
     *
     * This used to read getPointAt(0) and nothing else: the camera held the
     * opening frame forever, because the authored journey ran down -Z past the
     * igloo and out the far side, and scrolling away from the igloo was losing
     * the one thing worth looking at. That was true of THAT path.
     *
     * The path in chapters.js now swings around to the entrance and goes in
     * through it. Every waypoint is closer to the structure than the one before
     * it, so there is no point on the rail where scrolling costs you the
     * subject — it is the opposite, scrolling is how you get inside.
     *
     * THE DAMPING IS THE POINT, and it is why this reads as a camera move
     * rather than as a scrubber: `eased` chases the raw scroll value
     * exponentially instead of tracking it, so the lens accelerates into the
     * move and coasts out of it. See the note at the top of the file.
     */
    eased.current = damp(eased.current, progress.current, 3.2, dt);

    CAMERA_CURVE.getPointAt(eased.current, position.current);
    TARGET_CURVE.getPointAt(eased.current, target.current);

    /*
     * The descent, as a decaying offset on the held position.
     *
     * `begin` is false while the loading screen is still up, and the camera
     * simply SITS at the top of the move for as long as that lasts — the intro
     * does not start and then get covered, it waits. Which matters, because the
     * one thing that must not happen is the descent playing behind the loader
     * and the visitor being handed a static frame at the end of it.
     */
    /*
     * THE INTRO CLOCK, run here and read by Terrain and Lattice too.
     *
     * WALL CLOCK, NOT CLAMPED dt — AND THAT IS A CORRECTNESS FIX. dt above is
     * clamped to 1/20 s so one long frame cannot detonate a spring, which is
     * right for physics and wrong for a TIMELINE: summing clamped deltas made a
     * 3.6 s descent take 36 real seconds at 2 fps. So the clock advances by the
     * real time between frames, and the move takes its length on any machine.
     *
     * AND IT HURRIES WHEN THE VISITOR SCROLLS. The descent used to run its full
     * 3.6 s whatever happened, and a scroll made during it did move the rig —
     * but 176 units of offset on top of the path swamped it, so the page looked
     * deaf until the camera landed. Now the first scroll speeds the whole
     * opening up (INTRO.rush), it wraps up in well under a second, and the
     * scroll has the camera.
     *
     * It keeps running past the camera's own landing to INTRO.tail, because the
     * land's reveal is timed a shade longer than the fall.
     */
    if (begin && introClock.current < INTRO.tail) {
      const now = performance.now();
      const t = intro.current;
      if (!t.last) t.last = now;
      if (progress.current > 0.0005) t.rushed = true;
      const speed = t.rushed ? INTRO.rush : 1;
      introClock.current = Math.min(INTRO.tail, introClock.current + ((now - t.last) / 1000) * speed);
      t.last = now;
    }

    let arrived = 1;
    if (!intro.current.done) {
      const k = begin ? Math.min(1, introClock.current / INTRO.seconds) : 0;
      arrived = smootherstep(k);
      if (k >= 1) intro.current.done = true;
      const remaining = 1 - arrived;
      position.current.x += INTRO_OFFSET[0] * remaining;
      position.current.y += INTRO_OFFSET[1] * remaining;
      position.current.z += INTRO_OFFSET[2] * remaining;
    }

    // Pointer parallax, applied to the BODY and only to the body — see the
    // constants above. The aim term is held at zero because rotating the lens
    // is what slides the world against a screen-fixed sky.
    /* 4.6, up from 3.2: at the old rate a bigger throw took visibly longer to
       arrive, so the lean felt heavier rather than larger. The damping is still
       what gives the move its weight — this only stops the lag growing with the
       amplitude. */
    /* A lifted finger is no pointer — see `touch` above. */
    const lifted = touch.current.type === 'touch' && !touch.current.down;
    pointer.current.x = damp(pointer.current.x, lifted ? 0 : state.pointer.x, 4.6, dt);
    pointer.current.y = damp(pointer.current.y, lifted ? 0 : state.pointer.y, 4.6, dt);
    /* Faded in with the descent. At full strength during the fall the parallax
       fights a move fifty times its size and reads as the camera wobbling on
       the way down; by the time it matters, the shot has landed. */
    const lean = arrived;
    /*
     * The aim swings, the body does not — see the constants above. This is a
     * rotation about the point the curve puts the lens at, so the sky, the
     * hills and the igloo all sweep together as one picture rather than sliding
     * against each other.
     */
    target.current.x += pointer.current.x * AIM_PARALLAX * lean;
    target.current.y += pointer.current.y * AIM_PARALLAX * 0.45 * lean;

    // Never let the ground come through the lens. The path is authored as a
    // floor, and this is what makes that authoring safe against a change to the
    // terrain constants.
    const ground = heightAt(position.current.x, position.current.z) + GROUND_CLEARANCE;
    if (position.current.y < ground) position.current.y = ground;

    camera.position.copy(position.current);

    // The aim is damped a second time, on top of the already-damped progress.
    // One pass alone still snaps when the target curve changes direction
    // quickly; the second pass is what rounds the corner off.
    if (!started.current) {
      smoothedTarget.current.copy(target.current);
      started.current = true;
    } else {
      smoothedTarget.current.x = damp(smoothedTarget.current.x, target.current.x, TARGET_LAMBDA, dt);
      smoothedTarget.current.y = damp(smoothedTarget.current.y, target.current.y, TARGET_LAMBDA, dt);
      smoothedTarget.current.z = damp(smoothedTarget.current.z, target.current.z, TARGET_LAMBDA, dt);
    }

    camera.lookAt(smoothedTarget.current);
  });

  return null;
}
