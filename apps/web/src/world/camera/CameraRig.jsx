import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { CAMERA_CURVE, INTRO, TARGET_CURVE } from '../chapters.js';
import { useWorldScroll } from '../scroll/ScrollProvider.jsx';
import { heightAt } from '../lib/terrain.js';

// Camera controller interpolating position and look-at targets along spline curves
const TARGET_LAMBDA = 2.0;
const AIM_PARALLAX = 4.4;
const GROUND_CLEARANCE = 2.4;
const SETTLED = 0.0005;
const INTRO_OFFSET = [-14, 176, -68];

// Quintic smootherstep easing
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
  const eased = useRef(0);

  const position = useRef(new Vector3());
  const target = useRef(new Vector3());
  const smoothedTarget = useRef(new Vector3());
  const started = useRef(false);

  // Track pointer interactions across touch and mouse
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
    const dt = Math.min(delta, 1 / 20);

    eased.current = damp(eased.current, progress.current, 3.2, dt);

    CAMERA_CURVE.getPointAt(eased.current, position.current);
    TARGET_CURVE.getPointAt(eased.current, target.current);

    // Initial camera descent animation
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

    // Minimum ground clearance collision offset
    const ground = heightAt(position.current.x, position.current.z) + GROUND_CLEARANCE;
    if (position.current.y < ground) position.current.y = ground;

    camera.position.copy(position.current);

    // Pointer look-at parallax scaled by arrival
    const lifted = touch.current.type === 'touch' && !touch.current.down;
    pointer.current.x = damp(pointer.current.x, lifted ? 0 : state.pointer.x, 4.6, dt);
    pointer.current.y = damp(pointer.current.y, lifted ? 0 : state.pointer.y, 4.6, dt);

    const lean = arrived;
    target.current.x += pointer.current.x * AIM_PARALLAX * lean;
    target.current.y += pointer.current.y * AIM_PARALLAX * 0.45 * lean;

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
