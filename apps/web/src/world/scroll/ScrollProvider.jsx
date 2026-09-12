import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Lenis from 'lenis';
import { SEGMENTS, scrollState } from '../chapters.js';

// Global scroll provider mapping native window scroll to 3D world progress and cut transition
const ScrollContext = createContext(null);

export function useWorldScroll() {
  const ctx = useContext(ScrollContext);
  if (!ctx) throw new Error('useWorldScroll must be used inside <ScrollProvider>');
  return ctx;
}

export default function ScrollProvider({ children, locked = false }) {
  const progress = useRef(0);
  const velocity = useRef(0);
  const flight = useRef(0); // Smoothed speed magnitude (0 to 1) for motion blur and flares
  const cut = useRef(0);
  const page = useRef(0);
  const total = useRef(0);
  const intro = useRef(0);
  const lenis = useRef(null);

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
      smoothWheel: !reduce,
      lerp: reduce ? 1 : 0.085,
      wheelMultiplier: 0.9,
    });

    lenis.current = instance;

    instance.on('scroll', ({ velocity: v }) => {
      velocity.current = Math.max(-1, Math.min(1, v / 60));
    });

    const FLIGHT_GAIN = 5;
    const ATTACK = 14;
    const RELEASE = 3.6;

    let last = performance.now();
    const state = { journey: 0, cut: 0, page: 0 };

    const IDLE_MS = 1200;
    const COMMIT = 0.5;
    const CUT_MIN_SECONDS = 1.2;
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

      scrollState(instance.scroll, vhRef.current, state);
      progress.current = state.journey;
      const cutStep = Math.min(0.05, (time - last) / 1000) / CUT_MIN_SECONDS;
      cut.current += Math.max(-cutStep, Math.min(cutStep, state.cut - cut.current));
      page.current = state.page;
      total.current =
        instance.limit > 0 ? Math.min(1, Math.max(0, instance.scroll / instance.limit)) : 0;

      // Auto-settle transition if scroll is paused mid-way
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

        let target = null;
        if (s > 1 && s < commitPx) target = 0;
        else if (s >= commitPx && s < worldPx + cutPx - 1) target = worldPx + cutPx + 2;

        if (target !== null) {
          settling = true;
          instance.scrollTo(target, {
            duration: reduce ? 0 : target === 0 ? 1.6 : 1.1,
            immediate: reduce,
            easing: easeInOut,
            onComplete: () => {
              settling = false;
            },
          });
          if (reduce) settling = false;
        }
      }

      const dt = Math.min(0.05, (time - last) / 1000);
      last = time;

      const target = Math.min(1, Math.abs(velocity.current) * FLIGHT_GAIN);
      const rate = target > flight.current ? ATTACK : RELEASE;
      flight.current += (target - flight.current) * (1 - Math.exp(-rate * dt));
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

  // Lock scrolling while preloader curtain is active
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

  useEffect(() => {
    lenis.current?.resize();
  }, [vh, pageHeight]);

  const value = useMemo(
    () => ({ progress, velocity, flight, cut, page, total, intro, lenis, setPageHeight }),
    []
  );

  const extent = (SEGMENTS.world + SEGMENTS.cut) * vh + Math.max(pageHeight, vh);

  return (
    <ScrollContext.Provider value={value}>
      {children}
      {/* Spacer element defining native scrollbar height */}
      <div
        style={{
          height: `${Math.round(extent)}px`,
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      />
    </ScrollContext.Provider>
  );
}
