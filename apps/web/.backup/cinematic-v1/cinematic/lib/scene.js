/**
 * Scroll and pointer plumbing for cinematic mode.
 *
 * One rule governs this file: React owns structure, requestAnimationFrame owns
 * motion, and the two meet at a CSS custom property. A scene running at 60fps
 * that calls setState re-reconciles its whole subtree sixty times a second to
 * change a number no component reads; the same value written to a custom
 * property costs one style recalculation and nothing else.
 *
 * The only hooks here that return state are the ones whose value changes rarely
 * — which act is on screen, whether an element has been seen — because those
 * genuinely do need a render.
 *
 * Nothing in this directory is imported by minimal mode.
 */

import { useEffect, useRef, useState } from 'react';

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const lerp = (a, b, t) => a + (b - a) * t;

export const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Coarse pointer means phone or tablet — every hover-driven affordance checks this. */
export const isTouch = () =>
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

/**
 * Publishes a scene's scroll progress as --p on the element itself, 0 to 1,
 * once per frame, without a single React render.
 *
 * A scene is taller than the viewport and holds a position:sticky stage inside
 * it; progress is how far the scene has travelled past the top of the viewport.
 * That is what gives a shot a fixed budget of scroll distance and stops the
 * stage colliding with whatever follows it.
 *
 * Measured from the element's own rect rather than window.scrollY, so it stays
 * correct no matter what sits above it — including content above it changing
 * height after the payload lands, which scrollY arithmetic gets wrong.
 */
export function useSceneVar(varName = '--p') {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // Under reduced motion nothing scrubs. Parking at 1 is right for scenes
    // that reveal content — they read as "already revealed" — and the one act
    // where it is wrong overrides it in CSS.
    if (reducedMotion()) {
      node.style.setProperty(varName, '1');
      return;
    }

    let frame = 0;
    let last = -1;

    const measure = () => {
      frame = 0;
      const rect = node.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const p = travel <= 0 ? 0 : clamp01(-rect.top / travel);

      // Changes below a thousandth are invisible and still cost a recalc.
      if (Math.abs(p - last) < 0.0005) return;
      last = p;
      node.style.setProperty(varName, p.toFixed(4));
    };

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    measure();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [varName]);

  return ref;
}

/**
 * Pointer position as two eased 0..1 values on --mx and --my.
 *
 * Raw pointer coordinates are far too responsive to read as a camera: the
 * scene snaps to the cursor and feels weightless. Easing toward the target on
 * a rAF loop is what gives it mass.
 *
 * The loop parks itself once the value has settled. A portfolio left open in a
 * background tab should not hold a core busy interpolating 0.5 toward 0.5.
 */
export function usePointerVar({ ease = 0.07 } = {}) {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || isTouch() || reducedMotion()) return;

    const target = { x: 0.5, y: 0.5 };
    const current = { x: 0.5, y: 0.5 };
    let frame = 0;
    let running = false;

    const write = () => {
      node.style.setProperty('--mx', current.x.toFixed(4));
      node.style.setProperty('--my', current.y.toFixed(4));
    };

    const tick = () => {
      current.x = lerp(current.x, target.x, ease);
      current.y = lerp(current.y, target.y, ease);
      write();

      if (
        Math.abs(current.x - target.x) < 0.0005 &&
        Math.abs(current.y - target.y) < 0.0005
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
      target.x = clamp01(event.clientX / window.innerWidth);
      target.y = clamp01(event.clientY / window.innerHeight);
      start();
    };

    // Recentre when the pointer leaves the window. Without this the frame
    // stays yawed at whatever angle the cursor exited at, and someone who
    // switches windows comes back to a crooked shot.
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

/**
 * True once the element has been on screen. One of the few places a render is
 * the right answer, because it fires exactly once per element per session.
 */
export function useEntered({ threshold = 0.25, rootMargin = '0px 0px -12% 0px' } = {}) {
  const ref = useRef(null);
  const [entered, setEntered] = useState(() => reducedMotion());

  useEffect(() => {
    const node = ref.current;
    if (!node || reducedMotion()) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setEntered(true);
        observer.disconnect();
      },
      { threshold, rootMargin }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold, rootMargin]);

  return [ref, entered];
}

/**
 * Which act owns the viewport.
 *
 * rootMargin collapses the viewport to a thin band at 45% height, so exactly
 * one act qualifies at a time and the handover happens on a defined line
 * rather than wherever two observers happen to overlap. The 3D engine measures
 * against the same line, which is what keeps the world's palette cut and the
 * text's colour change on the same frame.
 *
 * `ids` must be a stable array. Passing a freshly-built one on every render
 * re-creates the observer continuously, and — when the same array feeds the
 * world — tears down and rebuilds a WebGL context along with it.
 */
export function useActTracker(ids) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const nodes = ids
      .map((id, index) => ({ index, node: document.getElementById(id) }))
      .filter((entry) => entry.node);

    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const match = nodes.find((n) => n.node === entry.target);
          if (match) setActive(match.index);
        }
      },
      { rootMargin: '-45% 0px -55% 0px', threshold: 0 }
    );

    nodes.forEach(({ node }) => observer.observe(node));
    return () => observer.disconnect();
  }, [ids]);

  return active;
}

/**
 * Overall document progress on --doc of the root element.
 *
 * Cheap enough to run unconditionally, and it drives the progress rail — the
 * one piece of chrome that stays live under reduced motion, because it is an
 * orientation aid in a document with no visible chapters, not decoration.
 */
export function useDocumentProgress() {
  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;

    const measure = () => {
      frame = 0;
      const travel = root.scrollHeight - window.innerHeight;
      root.style.setProperty(
        '--doc',
        travel <= 0 ? '0' : clamp01(window.scrollY / travel).toFixed(4)
      );
    };

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    measure();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      root.style.removeProperty('--doc');
    };
  }, []);
}
