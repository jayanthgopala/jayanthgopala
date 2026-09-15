import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Lenis from 'lenis';
import { FALL_PAST_LAST, RINGS, SEGMENTS, ringsStart, scrollState } from '../chapters.js';

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
  const ringCut = useRef(0); // Cut from the project page into the ring shaft (0 to 1)
  const ringFall = useRef(0); // Camera fall through the rings into the room (0 to 1)
  const ringNear = useRef(false); // Close enough to the rings to mount them
  const ringReady = useRef(false); // Ring scene prepared; until then the page ends at the last project
  const pageHeightRef = useRef(0);

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
      lerp: reduce ? 1 : 0.07,
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
    const state = { journey: 0, cut: 0, page: 0, ringCut: 0, ringFall: 0, ringNear: false };

    const IDLE_MS = 1200;
    const COMMIT = 0.5;
    const CUT_MIN_SECONDS = 1.2;
    // The fall follows the scroll with exponential easing, so it glides into
    // place instead of moving at one speed and stopping dead; the ceiling (full
    // descents per second) keeps a flick travelling through every ring.
    const FALL_FOLLOW = 2.4;
    const FALL_RATE = 0.45;
    const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    let settling = false;
    let lastScroll = 0;
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

      scrollState(instance.scroll, vhRef.current, state, pageHeightRef.current);

      // Until the ring scene has finished preparing, the page ends at the last
      // project. A scroll made while it loads can neither start the cut nor
      // bank distance that later carries straight through to the contact room.
      if (!ringReady.current && pageHeightRef.current > 0) {
        const vhNow = vhRef.current;
        const ringFrom = (SEGMENTS.world + SEGMENTS.cut) * vhNow + ringsStart(pageHeightRef.current, vhNow);
        if (instance.scroll > ringFrom) {
          instance.scrollTo(ringFrom, { immediate: true, force: true });
          scrollState(ringFrom, vhNow, state, pageHeightRef.current);
        }
      }

      progress.current = state.journey;
      const cutStep = Math.min(0.05, (time - last) / 1000) / CUT_MIN_SECONDS;
      cut.current += Math.max(-cutStep, Math.min(cutStep, state.cut - cut.current));

      // The ring cut is rate limited like the first, and the fall waits for it
      // to finish so the shaft is never already rushing past mid-cut.
      ringCut.current += Math.max(-cutStep, Math.min(cutStep, state.ringCut - ringCut.current));
      const frameDt = Math.min(0.05, (time - last) / 1000);
      const fallTarget = ringCut.current < 1 ? 0 : state.ringFall;
      const fallPull = (fallTarget - ringFall.current) * (1 - Math.exp(-FALL_FOLLOW * frameDt));
      const fallCap = FALL_RATE * frameDt;
      // Soft limit: follows the pull while it is small and eases toward the cap
      // as it grows, so a flick never switches into a flat constant speed.
      ringFall.current += fallPull / (1 + Math.abs(fallPull) / Math.max(fallCap, 1e-6));
      if (Math.abs(fallTarget - ringFall.current) < 1e-4) ringFall.current = fallTarget;
      ringNear.current = state.ringNear;

      // Past the last ring, carry on into the contact room. Crossing that point
      // on the way down glides the scroll to the room's end, so the camera
      // arrives in the room rather than stopping at its threshold. Only on the
      // way down: scrolling back up from the room is never pulled back.
      if (ringReady.current && pageHeightRef.current > 0) {
        const vhS = vhRef.current;
        const fallFrom =
          (SEGMENTS.world + SEGMENTS.cut) * vhS +
          ringsStart(pageHeightRef.current, vhS) +
          RINGS.cut * vhS;
        const passPx = fallFrom + RINGS.fall * vhS * FALL_PAST_LAST;
        const endPx = fallFrom + RINGS.fall * vhS + 2;
        const s = instance.scroll;

        if (!settling && lastScroll < passPx && s >= passPx && s < endPx - 2) {
          settling = true;
          instance.scrollTo(endPx, {
            duration: reduce ? 0 : 1.6,
            immediate: reduce,
            easing: easeInOut,
            onComplete: () => {
              settling = false;
            },
          });
          if (reduce) settling = false;
        }
        lastScroll = s;
      }
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

        const hasPage = pageHeightRef.current > 0;
        const ringFrom = worldPx + cutPx + ringsStart(pageHeightRef.current, vh);
        const ringCutPx = RINGS.cut * vh;
        const ringCommit = ringFrom + ringCutPx * COMMIT;

        let target = null;
        if (s > 1 && s < commitPx) target = 0;
        else if (s >= commitPx && s < worldPx + cutPx - 1) target = worldPx + cutPx + 2;
        else if (hasPage && s > ringFrom + 1 && s < ringCommit) target = ringFrom;
        else if (hasPage && s >= ringCommit && s < ringFrom + ringCutPx - 1) target = ringFrom + ringCutPx + 2;

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
    pageHeightRef.current = pageHeight;
    lenis.current?.resize();
  }, [vh, pageHeight]);

  const value = useMemo(
    () => ({
      progress, velocity, flight, cut, page, total, intro, lenis, setPageHeight,
      ringCut, ringFall, ringNear, ringReady,
    }),
    []
  );

  // World and cut, the project page up to the ring cut, then the cut, the fall
  // and the room. The last screen of that is the viewport itself.
  const extent =
    (SEGMENTS.world + SEGMENTS.cut) * vh +
    ringsStart(pageHeight, vh) +
    (RINGS.cut + RINGS.fall + RINGS.room) * vh;

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
