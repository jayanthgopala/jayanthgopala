import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Lenis from 'lenis';
import { SEGMENTS, scrollState } from '../chapters.js';

/**
 * The scroll spine of the whole experience.
 *
 * One scroll position is published here, and everything in the world is a
 * function of it: where the camera is on its spline, how far through the cut
 * to the work page, how far down that page, which chapter's type is legible.
 *
 * THE NUMBERS LIVE IN REFS, NOT IN STATE. This is the single most important
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

export default function ScrollProvider({ children }) {
  /**
   * 0..JOURNEY.end along the camera curve. Read every frame; never triggers a
   * render.
   *
   * STILL CALLED `progress`, and still the camera's number, even though the
   * document now runs on past the world. Everything that already read it —
   * the rig, the act marker, the glitch pass — reads the journey, and keeping
   * the name keeps all of them correct without touching them.
   */
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
  /** 0..1 through the cut from the world to the work page. */
  const cut = useRef(0);
  /** Pixels scrolled into the work page after the cut has finished. */
  const page = useRef(0);
  /** 0..1 through the whole document. */
  const total = useRef(0);
  const lenis = useRef(null);

  /*
   * THE EXTENT IS IN PIXELS NOW, and the viewport height is state because of
   * it. The old spacer was `${pages * 100}vh` and needed nothing from JS; the
   * work page's length is a measurement, and the world's stretches have to be
   * converted with the same viewport height the frame loop uses, or the two
   * disagree about where the cut is.
   */
  const [vh, setVh] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight));
  const [pageHeight, setPageHeight] = useState(0);
  const vhRef = useRef(vh);

  useEffect(() => {
    vhRef.current = vh;
  }, [vh]);

  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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

    instance.on('scroll', ({ velocity: v }) => {
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
    /* Reused every frame rather than allocated. */
    const state = { journey: 0, cut: 0, page: 0 };

    /*
     * THE CUT PLAYS ITSELF THROUGH ONCE IT STARTS.
     *
     * Scrubbed, the cut could be parked anywhere — half a world and half a
     * page on screen, for as long as the wheel happened to stop there. So the
     * moment the scroll enters it, Lenis is handed the rest of the way: down
     * into the cut carries on to the page, fully arrived; up out of the page
     * carries on back to the world. Still driven through the scroll position,
     * so every frame of it is the same frame a slow scroll would have shown,
     * and it still runs backwards on the way back.
     *
     * LOCKED while it plays, or the next wheel notch would fight it and the
     * cut would stutter. 1.4 seconds is long enough to see the wipe and short
     * enough that nobody reaches for the wheel again waiting for it.
     */
    const CUT_SECONDS = 1.4;
    const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    let playing = false;

    let frame = requestAnimationFrame(function raf(time) {
      instance.raf(time);

      /*
       * Positions are read here, every frame, rather than in the scroll event.
       * Lenis only emits while it is moving, and a resize changes what a given
       * scroll position MEANS without moving it — read in the event, the cut
       * would sit at its old position after a resize until the next wheel.
       */
      scrollState(instance.scroll, vhRef.current, state);
      progress.current = state.journey;
      cut.current = state.cut;
      page.current = state.page;
      total.current =
        instance.limit > 0 ? Math.min(1, Math.max(0, instance.scroll / instance.limit)) : 0;

      /* A hair of margin at both ends: the native scroll position is rounded,
         and a cut sitting at 0.9999 would otherwise re-trigger forever. */
      if (!playing && state.cut > 0.005 && state.cut < 0.995) {
        const vh = vhRef.current;
        const down = instance.direction >= 0;
        const target = down
          ? (SEGMENTS.world + SEGMENTS.cut) * vh + 2
          : SEGMENTS.world * vh - 2;
        playing = true;
        instance.scrollTo(target, {
          duration: reduce ? 0 : CUT_SECONDS,
          immediate: reduce,
          easing: easeInOut,
          lock: true,
          force: true,
          onComplete: () => {
            playing = false;
          },
        });
        /* immediate scrolls do not call onComplete in every Lenis version. */
        if (reduce) playing = false;
      }

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

  /* The spacer changed height; make sure Lenis's limit follows at once rather
     than on its own observer's schedule. */
  useEffect(() => {
    lenis.current?.resize();
  }, [vh, pageHeight]);

  const value = useMemo(
    () => ({ progress, velocity, flight, cut, page, total, lenis, setPageHeight }),
    []
  );

  /*
   * The page stretch is never shorter than a screen. A document that ended
   * before the cut could finish would leave the wipe stranded half-way at the
   * bottom of the scrollbar, and a short page — or one still loading — would
   * do exactly that.
   */
  const extent = (SEGMENTS.world + SEGMENTS.cut) * vh + Math.max(pageHeight, vh);

  return (
    <ScrollContext.Provider value={value}>
      {children}
      {/*
        The scroll extent. The canvas is fixed and fills the viewport, so without
        this the document is exactly one screen tall and there is nothing to
        scroll — the world would be frozen at progress 0 with no way to advance.
        Its height is the entire pacing control for the experience: see
        SEGMENTS in chapters.js.
      */}
      <div
        style={{
          height: `${Math.round(extent)}px`,
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
