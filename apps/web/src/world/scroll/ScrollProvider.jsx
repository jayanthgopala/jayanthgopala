import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import Lenis from 'lenis';

/**
 * The scroll spine of the whole experience.
 *
 * One number — progress from 0 to 1 through the entire journey — is published
 * here, and everything in the world is a function of it: where the camera is on
 * its spline, where the character is, how thick the fog is, which chapter's
 * type is legible.
 *
 * THE NUMBER LIVES IN A REF, NOT IN STATE. This is the single most important
 * decision in the file. Scroll progress changes every frame; putting it in
 * useState would re-render the React tree sixty times a second, and in an R3F
 * app that means reconciling the scene graph sixty times a second to produce
 * exactly the same graph. Everything that consumes progress does so inside
 * useFrame, which reads `.current` directly and mutates object transforms. React
 * renders the world once; the frame loop animates it.
 *
 * A REAL SCROLLBAR, NOT A VIRTUAL ONE. The reference site sets overflow:hidden
 * and synthesises scroll entirely, which costs it keyboard scrolling, the
 * scrollbar, find-in-page and the browser's own restore-position behaviour. A
 * tall spacer element with Lenis smoothing on top gives identical feel and keeps
 * all of that, so the page is still a page.
 *
 * Lenis is what supplies the weight. Raw wheel events are stepped and abrupt;
 * Lenis integrates them into a damped, continuous position, which is why the
 * camera keeps easing for a moment after the wheel stops — the quality the
 * reference site is really trading on.
 */

const ScrollContext = createContext(null);

export function useWorldScroll() {
  const ctx = useContext(ScrollContext);
  if (!ctx) throw new Error('useWorldScroll must be used inside <ScrollProvider>');
  return ctx;
}

export default function ScrollProvider({ children, pages = 8 }) {
  /** 0..1 through the journey. Read every frame; never triggers a render. */
  const progress = useRef(0);
  /** Signed scroll velocity, normalised. Drives motion blur and gait direction. */
  const velocity = useRef(0);
  /**
   * 0..1 "how hard are we travelling right now", and it is NOT the same number
   * as `velocity`.
   *
   * TWO REASONS IT IS DERIVED HERE RATHER THAN AT EACH CONSUMER.
   *
   * First, `velocity` only moves when Lenis emits a scroll event, and Lenis
   * stops emitting once it has settled. Anything reading it directly therefore
   * holds its last value forever instead of returning to rest — a glow driven
   * straight off it would come on and simply stay on. This is integrated in the
   * rAF loop below, which runs whether or not anything is scrolling, so it can
   * actually fall back to zero.
   *
   * Second, two separate consumers want it — the igloo's edge light and the
   * chromatic aberration pass — and they have to agree. Smoothing the same
   * signal twice with two sets of constants would let the fringing and the glow
   * drift apart, which reads as two effects rather than as one sensation of
   * speed.
   *
   * ASYMMETRIC, and deliberately so. Travel should feel like it starts the
   * instant you push and coasts to a stop afterwards, so the attack is fast
   * enough to be immediate and the release is slow enough to trail — the same
   * asymmetry Lenis itself applies to position.
   */
  const flight = useRef(0);
  const lenis = useRef(null);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const instance = new Lenis({
      /* Under reduced motion the smoothing is switched off rather than the
         scrolling: the page still works exactly as a page, it simply stops
         gliding. Disabling scroll entirely would strand the reader. */
      smoothWheel: !reduce,
      lerp: reduce ? 1 : 0.085,
      wheelMultiplier: 0.9,
    });

    lenis.current = instance;

    instance.on('scroll', ({ scroll, limit, velocity: v }) => {
      progress.current = limit > 0 ? Math.min(1, Math.max(0, scroll / limit)) : 0;
      // Clamped, because a trackpad fling can spike this to values that make
      // anything reading it visibly overshoot.
      velocity.current = Math.max(-1, Math.min(1, v / 60));
    });

    /*
     * A scroll that barely moves should not light the world up, and a firm one
     * should saturate it. `velocity` is already divided by 60 and clamped, so a
     * deliberate wheel push lands around 0.3–0.5; this gain puts that most of
     * the way to full and leaves a fling pinned at 1.
     */
    const FLIGHT_GAIN = 2.4;
    /* Per-second rates for `1 - exp(-rate * dt)`. Framerate-independent, which
       matters because this scene runs at 60 on a good machine and half that
       while the terrain is still building. */
    const ATTACK = 14;
    const RELEASE = 3.6;

    let last = performance.now();

    let frame = requestAnimationFrame(function raf(time) {
      instance.raf(time);

      /* Clamped, because a backgrounded tab resumes with an enormous dt and an
         un-clamped exponential would snap the value across in one frame. */
      const dt = Math.min(0.05, (time - last) / 1000);
      last = time;

      const target = Math.min(1, Math.abs(velocity.current) * FLIGHT_GAIN);
      const rate = target > flight.current ? ATTACK : RELEASE;
      flight.current += (target - flight.current) * (1 - Math.exp(-rate * dt));
      /* Snapped, so the resting frame is EXACTLY the graded one. An exponential
         only approaches zero, and a residual 0.001 would leave a permanent
         sliver of edge light and a permanent sub-pixel colour fringe on a still
         page — the two things this whole signal exists to keep out of it. */
      if (flight.current < 0.002) flight.current = 0;

      frame = requestAnimationFrame(raf);
    });

    return () => {
      cancelAnimationFrame(frame);
      instance.destroy();
      lenis.current = null;
    };
  }, []);

  const value = useMemo(() => ({ progress, velocity, flight, lenis, pages }), [pages]);

  return (
    <ScrollContext.Provider value={value}>
      {children}
      {/*
        The scroll extent. The canvas is fixed and fills the viewport, so without
        this the document is exactly one screen tall and there is nothing to
        scroll — the world would be frozen at progress 0 with no way to advance.
        Its height is the entire pacing control for the experience: more pages
        means the same camera path is spread over more scrolling, and every beat
        slows down together.
      */}
      <div
        style={{
          height: `${pages * 100}vh`,
          /*
           * Transparent to the pointer, or it eats every event meant for the
           * world. The canvas is position:fixed at z-index 0 and this spacer is
           * a normal-flow element that comes after it, so it paints on top of
           * the entire viewport and hit-tests first — which silently breaks
           * every hover and click in the scene while leaving the picture
           * looking perfectly correct.
           *
           * Scrolling is unaffected: Lenis listens for wheel and touch on the
           * window, not on this element.
           */
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      />
    </ScrollContext.Provider>
  );
}
