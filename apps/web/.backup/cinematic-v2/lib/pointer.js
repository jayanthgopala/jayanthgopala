import { useEffect, useRef } from 'react';

/**
 * Pointer position as two eased 0..1 values, written to --mx and --my on the
 * element, once per frame, without a single React render.
 *
 * Raw pointer coordinates are far too responsive to read as parallax: the scene
 * snaps to the cursor and feels weightless. Easing toward the target on a rAF
 * loop is what gives it mass, and doing it through a CSS custom property means
 * every layer that wants to move can read the same value at its own depth
 * without any of them being React state.
 *
 * The loop parks itself once the value has settled. A page left open in a
 * background tab should not hold a core busy interpolating 0.5 toward 0.5.
 */
export function usePointerParallax({ ease = 0.055 } = {}) {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarse = window.matchMedia('(pointer: coarse)').matches;

    // Centre and stop. Touch has no pointer to follow, and under reduced
    // motion the scene holds its resting composition.
    if (reduce || coarse) {
      node.style.setProperty('--mx', '0.5');
      node.style.setProperty('--my', '0.5');
      return;
    }

    const target = { x: 0.5, y: 0.5 };
    const current = { x: 0.5, y: 0.5 };
    let frame = 0;
    let running = false;

    const write = () => {
      node.style.setProperty('--mx', current.x.toFixed(4));
      node.style.setProperty('--my', current.y.toFixed(4));
    };

    const tick = () => {
      current.x += (target.x - current.x) * ease;
      current.y += (target.y - current.y) * ease;
      write();

      if (
        Math.abs(current.x - target.x) < 0.0004 &&
        Math.abs(current.y - target.y) < 0.0004
      ) {
        running = false;
        frame = 0;
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    const start = () => {
      if (running) return;
      running = true;
      frame = requestAnimationFrame(tick);
    };

    const onMove = (event) => {
      target.x = Math.min(1, Math.max(0, event.clientX / window.innerWidth));
      target.y = Math.min(1, Math.max(0, event.clientY / window.innerHeight));
      start();
    };

    // Recentre when the pointer leaves the window. Without this the scene stays
    // pushed to whatever corner the cursor exited at, and anyone who switches
    // windows comes back to a lopsided composition.
    const onLeave = () => {
      target.x = 0.5;
      target.y = 0.5;
      start();
    };

    write();
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, [ease]);

  return ref;
}
