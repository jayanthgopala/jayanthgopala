import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { CAMERA_CURVE, INTRO, TARGET_CURVE } from '../chapters.js';
import { useWorldScroll } from '../scroll/ScrollProvider.jsx';
import { heightAt } from '../lib/terrain.js';

// Drives the camera along the journey, entirely inside useFrame, mutating in place.
// The damping is the craft. Sampling the spline at the raw scroll value gives a camera welded to the wheel that starts
// and stops dead. The rig keeps its own eased progress chasing the scroll, so it accelerates in and coasts out.
// Framerate independent via 1 - exp(-lambda * dt). The usual v += (t - v) * 0.1 damps twice as fast at 120fps as at 60.

// the aim leads looser than the body, so turns feel like a head turn
const TARGET_LAMBDA = 2.0;

// Pointer parallax in world units. The lens does not move, it turns about a fixed point.
// Translating the body instead was tried: it slides the camera off the framing the spline authored, walks the lens
// toward the ground on a steep lean, and leaves the sky welded to the viewport because a translation can't turn the view.
// At 4.4 a corner-to-corner sweep turns the lens a bit over two degrees, a lean you can see and well short of a pan.
// The vertical is kept to 0.45 of it, a camera pitching as far as it yaws reads as a wobble.
const AIM_PARALLAX = 4.4;

const GROUND_CLEARANCE = 2.4;

// Deadband, or the aim creeps toward its target forever and the frame is re-rendered fractionally offset every frame,
// which reads as shimmer on any fine detail.
const SETTLED = 0.0005;

// The descent, as an offset from the held position rather than a second waypoint, so the curve alone decides where the
// shot ends up and changing the framing moves the descent with it.
// Up and slightly in, so the dome grows in frame all the way down instead of looming and then receding.
const INTRO_OFFSET = [-14, 176, -68];

// Zero velocity and zero acceleration at both ends, which stops the landing reading as a stop.
// An ease-out cubic still arrives with acceleration on it and the frame visibly jolts as it settles.
const smootherstep = (k) => k * k * k * (k * (k * 6 - 15) + 10);

const damp = (current, target, lambda, dt) => {
  if (Math.abs(target - current) < SETTLED) return target;
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
};

export default function CameraRig({ begin = true }) {
  const { camera } = useThree();
  const { progress, intro: introClock } = useWorldScroll();

  const pointer = useRef({ x: 0, y: 0 });
  const intro = useRef({ last: 0, rushed: false, done: false });

  // the rig's own progress, chasing the scroll value rather than equalling it
  const eased = useRef(0);

  const position = useRef(new Vector3());
  const target = useRef(new Vector3());
  const smoothedTarget = useRef(new Vector3());
  const started = useRef(false);

  // state.pointer keeps the last position it was given, and on a touchscreen that's wherever the last tap was, so the
  // lens leaned toward that spot for the rest of the visit. A lifted finger counts as no pointer at all.
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
    // a tab restored from the background delivers one enormous delta, which would snap the camera and discard the inertia
    const dt = Math.min(delta, 1 / 20);

    eased.current = damp(eased.current, progress.current, 3.2, dt);

    CAMERA_CURVE.getPointAt(eased.current, position.current);
    TARGET_CURVE.getPointAt(eased.current, target.current);

    // begin is false while the loader is up and the camera sits at the top of the move, the intro waits rather than
    // playing behind the curtain and handing the visitor a static frame at the end of it.
    //
    // Wall clock, not the clamped dt above. Summing clamped deltas made a 3.6s descent take 36 real seconds at 2fps.
    // It hurries when the visitor scrolls, 176 units of offset used to swamp their scroll and the page looked deaf.
    // It runs past the camera's landing to INTRO.tail because the land's reveal is timed a shade longer than the fall.
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

    const lifted = touch.current.type === 'touch' && !touch.current.down;
    pointer.current.x = damp(pointer.current.x, lifted ? 0 : state.pointer.x, 4.6, dt);
    pointer.current.y = damp(pointer.current.y, lifted ? 0 : state.pointer.y, 4.6, dt);
    // Faded in with the descent. At full strength during the fall it fights a move fifty times its size and reads as
    // the camera wobbling on the way down.
    const lean = arrived;
    // The aim swings and the body doesn't, so the sky, hills and igloo sweep together as one picture.
    target.current.x += pointer.current.x * AIM_PARALLAX * lean;
    target.current.y += pointer.current.y * AIM_PARALLAX * 0.45 * lean;

    // Never let the ground come through the lens. The path is authored as a floor and this is what makes that safe
    // against a change to the terrain constants.
    const ground = heightAt(position.current.x, position.current.z) + GROUND_CLEARANCE;
    if (position.current.y < ground) position.current.y = ground;

    camera.position.copy(position.current);

    // Damped a second time on top of the already damped progress. One pass still snaps when the target curve changes
    // direction quickly, the second rounds the corner off.
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
