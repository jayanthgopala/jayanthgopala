/**
 * Scroll and pointer plumbing for cinematic mode.
 *
 * Everything here is deliberately kept *out* of React state. A scene running at
 * 60fps that calls `setState` every frame re-renders the whole act sixty times a
 * second; the same value written to a CSS custom property costs one style
 * recalculation on the compositor and nothing else. So the rule in this file is:
 *
 *   React owns structure. rAF owns motion. They meet at a CSS variable.
 *
 * The only hooks that return state are the ones whose value changes rarely
 * (which act is on screen, whether a shot has been entered) — those genuinely
 * need to re-render.
 *
 * Nothing here is imported by minimal mode.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Maps `value` from [a,b] onto 0..1, clamped. The workhorse of every beat sheet. */
export const phase = (value, a, b) => clamp01((value - a) / (b - a));

/** Smoothstep — takes the corners off a linear ramp so nothing starts or stops abruptly. */
export const smooth = (t) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

export const lerp = (a, b, t) => a + (b - a) * t;

export const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Coarse pointer => phone/tablet. Drives every desktop-only interaction. */
export const isTouch = () =>
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

/**
 * Writes a scene's scroll progress (0..1) to `--p` on the element itself, every
 * frame, without a single React render.
 *
 * The scene is taller than the viewport and holds a `position: sticky` stage.
 * Progress is how far the scene has travelled past the top of the viewport, so
 * a shot gets a fixed budget of scroll distance and the stage never collides
 * with whatever follows it.
 *
 * Measured from the element's own rect rather than `window.scrollY` so it stays
 * correct no matter what sits above it — and so it survives content above it
 * changing height after hydration, which `scrollY` maths does not.
 *
 * Returns the ref to attach. Read the value in CSS as `var(--p)`; read it in JS
 * from `el.style.getPropertyValue('--p')` if you must, but prefer CSS.
 */
export function useSceneVar(varName = '--p') {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // Under reduced motion the shot never plays. Pin it at the resting state
    // rather than 0 — several beats treat 0 as "nothing revealed yet", and a
    // scene stuck there would show an empty stage.
    if (reducedMotion()) {
      node.style.setProperty(varName, '1');
      node.dataset.static = '';
      return;
    }

    let frame = 0;
    let last = -1;

    const measure = () => {
      frame = 0;
      const rect = node.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const p = travel <= 0 ? 0 : clamp01(-rect.top / travel);

      // Sub-thousandth changes are invisible and still cost a style recalc.
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
 * Pointer position as two smoothed 0..1 values on `--mx` / `--my`.
 *
 * Raw pointer coordinates are far too responsive to read as a camera — the
 * scene snaps to the cursor and feels weightless. Easing toward the target on
 * a rAF loop is what gives it mass, and it is the same interpolation the video
 * scrubber uses, for the same reason.
 *
 * The loop parks itself when the value has settled: a portfolio left open in a
 * background tab should not burn a core holding 0.5 steady.
 */
export function usePointerVar({ ease = 0.07, enabled = true } = {}) {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled || isTouch() || reducedMotion()) return;

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

      const settled =
        Math.abs(current.x - target.x) < 0.0005 && Math.abs(current.y - target.y) < 0.0005;

      if (settled) {
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

    // Recentre when the pointer leaves the window, otherwise the camera stays
    // yawed at whatever angle it was at when the cursor crossed the edge.
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
  }, [ease, enabled]);

  return ref;
}

/**
 * True once the element has been on screen. Used for one-shot entrance reveals,
 * so this is one of the few places a render is the right answer — it fires once
 * per element for the whole session.
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
 * Tracks which act owns the viewport, and mirrors its tone onto <html>.
 *
 * The acts paint their own backgrounds, so the ink→paper cut happens
 * geometrically at the section seam — no JavaScript involved, and therefore no
 * strobing when a scroll lands exactly on the boundary. What *does* need
 * telling is the fixed chrome: the nav, the progress rail and the ask button
 * float above whichever act is behind them and have to invert with it.
 *
 * `rootMargin` collapses the viewport to a thin band at 45% height, so exactly
 * one act qualifies at a time and the handover happens at a well-defined line
 * rather than wherever two observers happen to overlap.
 */
export function useActTracker(actIds) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const nodes = actIds
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
  }, [actIds]);

  return active;
}

/**
 * Overall scroll progress through the document, on `--doc` of <html>.
 *
 * Cheap enough to run unconditionally and it drives the progress rail, which is
 * the one piece of chrome that must stay live even under reduced motion — it is
 * an orientation aid, not decoration.
 */
export function useDocumentProgress() {
  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;

    const measure = () => {
      frame = 0;
      const travel = root.scrollHeight - window.innerHeight;
      root.style.setProperty('--doc', travel <= 0 ? '0' : clamp01(window.scrollY / travel).toFixed(4));
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

/**
 * Splits a string into words wrapped in spans, for staggered line reveals.
 *
 * Returns plain data rather than JSX so the caller decides the element and can
 * key the stagger off the index. Whitespace is preserved by rendering the
 * spaces between words, not by relying on `display: inline-block` collapsing.
 */
export function useWords(text) {
  return useCallback(() => String(text || '').split(/\s+/).filter(Boolean), [text])();
}
