import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Lenis from 'lenis';
import { SEGMENTS, scrollState } from '../chapters.js';

// One scroll position, and everything in the world is a function of it.
// The numbers live in refs, not state. Progress changes every frame and useState would reconcile the scene graph sixty
// times a second to produce the same graph. Consumers read .current inside useFrame and mutate transforms directly.
// A real scrollbar with a tall spacer rather than overflow:hidden, so keyboard scrolling, find-in-page and restore all work.
// Lenis supplies the weight, raw wheel events are stepped and abrupt.

const ScrollContext = createContext(null);

export function useWorldScroll() {
  const ctx = useContext(ScrollContext);
  if (!ctx) throw new Error('useWorldScroll must be used inside <ScrollProvider>');
  return ctx;
}

export default function ScrollProvider({ children, locked = false }) {
  // 0..JOURNEY.end along the camera curve. Still called progress because everything already reads it as the journey.
  const progress = useRef(0);
  // signed scroll velocity, normalised
  const velocity = useRef(0);
  // How hard we're travelling, 0..1, and not the same number as velocity.
  // Derived here because velocity only moves when Lenis emits, so anything reading it directly holds its last value
  // forever instead of returning to rest. This is integrated in the rAF loop, which runs whether or not anything scrolls.
  // Also because two consumers want it and have to agree, smoothing the same signal twice would let them drift apart.
  // Asymmetric on purpose, fast attack so it starts the instant you push, slow release so it coasts to a stop.
  const flight = useRef(0);
  const cut = useRef(0);
  const page = useRef(0);
  const total = useRef(0);
  // Seconds into the opening descent, on a clock CameraRig runs. Terrain and Lattice read it rather than keeping their
  // own, so the land's reveal and the survey web finish with the camera at whatever speed it went.
  const intro = useRef(0);
  const lenis = useRef(null);

  // The extent is in pixels, so the viewport height has to be state. The work page's length is a measurement and the
  // world's stretches have to convert with the same vh the frame loop uses, or the two disagree about where the cut is.
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
      // Reduced motion switches off the smoothing, not the scrolling. Disabling scroll entirely would strand the reader.
      smoothWheel: !reduce,
      lerp: reduce ? 1 : 0.085,
      wheelMultiplier: 0.9,
    });

    lenis.current = instance;

    instance.on('scroll', ({ velocity: v }) => {
      // clamped, a trackpad fling spikes this to values that make anything reading it overshoot
      velocity.current = Math.max(-1, Math.min(1, v / 60));
    });

    // velocity is already divided by 60, so a wheel notch lands near 0.1. At the old gain of 2.4 a notch barely
    // registered and the blur only arrived with a firm scroll.
    const FLIGHT_GAIN = 5;
    // per-second rates for 1 - exp(-rate * dt), framerate independent, this scene runs at 60 or half that while building
    const ATTACK = 14;
    const RELEASE = 3.6;

    let last = performance.now();
    const state = { journey: 0, cut: 0, page: 0 };

    // The cut is scrubbed frame by frame, so you can hold in the middle of the blur as long as your hand is on the wheel.
    // Let go for IDLE_MS and it settles to the side you were nearer. Not locked, touch the wheel and it's yours again.
    const IDLE_MS = 1200;
    const COMMIT = 0.5;
    // The cut never plays faster than this end to end. A wheel thrown hard crosses the whole cut in a fraction of a
    // second and the blur went by in a blink. A slow scroll still scrubs it frame by frame.
    const CUT_MIN_SECONDS = 1.8;
    const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    let settling = false;
    let lastInput = performance.now();
    const onInput = () => {
      lastInput = performance.now();
      settling = false;
    };
    window.addEventListener('wheel', onInput, { passive: true });
    window.addEventListener('touchmove', onInput, { passive: true });
    window.addEventListener('keydown', onInput);

    let frame = requestAnimationFrame(function raf(time) {
      instance.raf(time);

      // Read every frame rather than in the scroll event. Lenis only emits while moving, and a resize changes what a
      // given scroll position means without moving it, so the cut would sit at its old position until the next wheel.
      scrollState(instance.scroll, vhRef.current, state);
      progress.current = state.journey;
      const cutStep = Math.min(0.05, (time - last) / 1000) / CUT_MIN_SECONDS;
      cut.current += Math.max(-cutStep, Math.min(cutStep, state.cut - cut.current));
      page.current = state.page;
      total.current =
        instance.limit > 0 ? Math.min(1, Math.max(0, instance.scroll / instance.limit)) : 0;

      // only once the hand is off and Lenis has finished gliding, so a settle never cuts a scroll short
      if (
        !settling &&
        time - lastInput > IDLE_MS &&
        Math.abs(instance.velocity) < 0.2
      ) {
        const vh = vhRef.current;
        const worldPx = SEGMENTS.world * vh;
        const cutPx = SEGMENTS.cut * vh;
        const commitPx = worldPx + cutPx * COMMIT;
        const s = instance.scroll;

        // a pixel or two of margin at both ends, the native scroll position is rounded and a scroll resting a hair off
        // its target would otherwise settle again forever
        let target = null;
        if (s > 1 && s < commitPx) target = 0;
        else if (s >= commitPx && s < worldPx + cutPx - 1) target = worldPx + cutPx + 2;

        if (target !== null) {
          settling = true;
          instance.scrollTo(target, {
            duration: reduce ? 0 : target === 0 ? 1.6 : 1.1, // home is longer and gentler, it's undoing something
            immediate: reduce,
            easing: easeInOut,
            onComplete: () => {
              settling = false;
            },
          });
          // immediate scrolls don't call onComplete in every Lenis version
          if (reduce) settling = false;
        }
      }

      // clamped, a backgrounded tab resumes with an enormous dt and an unclamped exponential would snap across in a frame
      const dt = Math.min(0.05, (time - last) / 1000);
      last = time;

      const target = Math.min(1, Math.abs(velocity.current) * FLIGHT_GAIN);
      const rate = target > flight.current ? ATTACK : RELEASE;
      flight.current += (target - flight.current) * (1 - Math.exp(-rate * dt));
      // Snapped, so the resting frame is exactly the graded one. An exponential only approaches zero and a residual
      // 0.001 leaves a permanent sliver of edge light and a sub-pixel colour fringe on a still page.
      if (flight.current < 0.002) flight.current = 0;

      frame = requestAnimationFrame(raf);
    });

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('wheel', onInput);
      window.removeEventListener('touchmove', onInput);
      window.removeEventListener('keydown', onInput);
      instance.destroy();
      lenis.current = null;
    };
  }, []);

  // No scrolling while the loader is up. Lenis is stopped and the root stops overflowing so keys and the scrollbar
  // can't move it either. Declared after the effect that creates Lenis, so on the first run the instance exists.
  useEffect(() => {
    const root = document.documentElement;
    if (locked) {
      lenis.current?.stop();
      root.style.overflow = 'hidden';
    } else {
      lenis.current?.start();
      root.style.overflow = '';
    }
    return () => {
      root.style.overflow = '';
    };
  }, [locked]);

  // the spacer changed height, make Lenis's limit follow at once rather than on its own observer's schedule
  useEffect(() => {
    lenis.current?.resize();
  }, [vh, pageHeight]);

  const value = useMemo(
    () => ({ progress, velocity, flight, cut, page, total, intro, lenis, setPageHeight }),
    []
  );

  // Never shorter than a screen. A document ending before the cut could finish would strand the wipe half way at the
  // bottom of the scrollbar, which a short page or one still loading would do.
  const extent = (SEGMENTS.world + SEGMENTS.cut) * vh + Math.max(pageHeight, vh);

  return (
    <ScrollContext.Provider value={value}>
      {children}
      {/* The scroll extent. The canvas is fixed and fills the viewport, so without this the document is one screen tall
          and there's nothing to scroll. Its height is the entire pacing control, see SEGMENTS in chapters.js. */}
      <div
        style={{
          height: `${Math.round(extent)}px`,
          // Transparent to the pointer or it eats every event meant for the world. This is a normal-flow element after
          // a fixed canvas, so it paints over the whole viewport and hit-tests first, silently breaking every hover
          // and click while the picture still looks correct. Scrolling is unaffected, Lenis listens on the window.
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      />
    </ScrollContext.Provider>
  );
}
