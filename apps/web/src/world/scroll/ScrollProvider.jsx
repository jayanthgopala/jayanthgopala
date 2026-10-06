import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Lenis from 'lenis';
import { RINGS, SEGMENTS, ringsStart, scrollState } from '../chapters.js';


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
  // Set by WorkPage while its about/project stops are on screen: { lo, hi, snap }
  // in document scroll px. The scroll may not run past the stops either side of
  // what is displayed, and at rest it settles on `snap`. Null anywhere else.
  const pageLeash = useRef(null);

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

    // The project page scrolls as igloo.inc's does (read from its bundle):
    // continuously, the wheel scaled down a little (PAGE_WHEEL), and the
    // scroll target never more than PAGE_MAX_LEAD screens ahead of what is
    // shown, the rest of a hard flick thrown away, so every project passes in
    // turn. Once the wheel has been quiet for PAGE_IDLE_MS it glides, slowly
    // and in-out, onto the nearest project.
    const PAGE_WHEEL = 0.75;
    const PAGE_MAX_LEAD = 0.45;

    const instance = new Lenis({
      smoothWheel: !reduce,
      lerp: reduce ? 1 : 0.07,
      wheelMultiplier: 0.9,
      // On the project page (see PAGE_MAX_LEAD): no stops, a pace cap; past
      // the last project the scroll carries on into the rings.
      virtualScroll: (data) => {
        // The opening's glides: scrolling on does not rush one, and scrolling
        // the other way stops it and sends it back where it came from.
        if (glideNow.dir !== 0) {
          const d = data.deltaY;
          if (d && Math.sign(d) !== glideNow.dir) {
            const { runEnd, pageAt } = worldStops();
            const back =
              glideNow.to === runEnd ? (glideNow.dir > 0 ? 0 : pageAt) : glideNow.to === pageAt ? runEnd : runEnd;
            worldGlide(back);
          }
          if (data.event.cancelable) data.event.preventDefault();
          return false;
        }
        if (!data.event.type.includes('wheel')) return true;
        const leash = pageLeash.current?.stops?.length ? pageLeash.current : null;
        // Past the opening, the page's pace holds all the way down, rings
        // included, so nothing past the projects runs away faster than they do.
        if (!leash && instance.scroll < worldStops().pageAt - 3) return true;
        const hi = leash ? leash.hi : Infinity;
        const lo = leash ? leash.lo : -Infinity;
        const swallow = () => {
          if (data.event.cancelable) data.event.preventDefault();
          return false;
        };
        const d = data.deltaY * PAGE_WHEEL;
        if (!d) return swallow();
        const from = instance.targetScroll;
        const at = instance.scroll;
        const lead = PAGE_MAX_LEAD * vhRef.current;
        let step = d;
        if (d > 0) step = Math.min(d, Math.max(0, Math.min(hi, at + lead) - from));
        else step = Math.max(d, Math.min(0, Math.max(lo, at - lead) - from));
        if (step === 0) return swallow();
        data.deltaY = step;
        return true;
      },
    });

    lenis.current = instance;

    instance.on('scroll', ({ velocity: v }) => {
      velocity.current = Math.max(-1, Math.min(1, v / 60));
    });

    const FLIGHT_GAIN = 5;
    const ATTACK = 14;
    const RELEASE = 3.6;

    let last = performance.now();
    const state = {
      journey: 0, cut: 0, page: 0, ringCut: 0, ringFall: 0, ringNear: false,
    };

    const IDLE_MS = 1200;
    const PAGE_IDLE_MS = 1400;
    const COMMIT = 0.5;
    const CUT_MIN_SECONDS = 1.2;
    // The fall follows the scroll with exponential easing, so it glides into
    // place instead of moving at one speed and stopping dead; the ceiling (full
    // descents per second) keeps a flick travelling through every ring.
    const FALL_FOLLOW = 4.2;
    const FALL_RATE = 1.6 / RINGS.fall;
    // The glides, end to end: the boat's run (the first scroll off the top),
    // the cut to the page (the next scroll), and from the ring cut to the
    // contact room.
    const BOAT_GLIDE_SECONDS = 7;
    const CUT_GLIDE_SECONDS = 2.6;
    // One scroll off the top goes all the way to the page: the pull-back and
    // the cut in a single glide, and one scroll back up returns to the igloo.
    const OPENING_GLIDE_SECONDS = 4.2;
    // An even, unhurried ease for the boat's run.
    const easeSine = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);
    const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    let settling = false;
    // A locked glide under way (from the top to the page, or into the
    // contact room): nothing else settles the scroll meanwhile.
    let gliding = false;
    let lastTop = 0;

    // The opening's two resting places: the end of the boat's run, and the
    // top of the page past the cut.
    function worldStops() {
      const vhW = vhRef.current;
      return { runEnd: SEGMENTS.world * vhW, pageAt: (SEGMENTS.world + SEGMENTS.cut) * vhW + 2 };
    }

    // A glide between the opening's resting places, either way: the boat's
    // run (0 to runEnd) or the cut (runEnd to pageAt), at the same pace in
    // both directions. Starting part-way (turned round mid-glide) takes the
    // matching share of the time.
    const glideNow = { dir: 0, to: 0 };
    function worldGlide(to) {
      const { runEnd, pageAt } = worldStops();
      const from = instance.scroll;
      const boat = Math.max(from, to) <= runEnd + 3;
      const whole = Math.min(from, to) < runEnd - 3 && Math.max(from, to) > runEnd + 3;
      const span = whole ? pageAt : boat ? runEnd : pageAt - runEnd;
      const share = Math.min(1, Math.max(0.15, Math.abs(to - from) / span));
      const seconds = whole ? OPENING_GLIDE_SECONDS : boat ? BOAT_GLIDE_SECONDS : CUT_GLIDE_SECONDS;
      gliding = true;
      glideNow.dir = Math.sign(to - from) || 1;
      glideNow.to = to;
      instance.scrollTo(to, {
        duration: reduce ? 0 : seconds * share,
        immediate: reduce,
        force: true,
        easing: boat && !whole ? easeSine : easeInOut,
        onComplete: () => {
          gliding = false;
          glideNow.dir = 0;
        },
      });
      if (reduce) {
        gliding = false;
        glideNow.dir = 0;
      }
    }

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

      // Backstop for scrolling Lenis does not smooth (touch, keys, reduced motion).
      const leash = pageLeash.current;
      if (leash) {
        const s = instance.scroll;
        const held = s > leash.hi + 1 ? leash.hi : s < leash.lo - 1 ? leash.lo : null;
        if (held !== null) {
          instance.scrollTo(held, { immediate: true, force: true });
          scrollState(held, vhRef.current, state, pageHeightRef.current);
        }
      }

      progress.current = state.journey;
      const cutStep = Math.min(0.05, (time - last) / 1000) / CUT_MIN_SECONDS;
      cut.current += Math.max(-cutStep, Math.min(cutStep, state.cut - cut.current));

      // The ring cut is rate limited like the first, and the fall waits for it
      // to finish so the shaft is never already rushing past mid-cut.
      ringCut.current += Math.max(-cutStep, Math.min(cutStep, state.ringCut - ringCut.current));
      const frameDt = Math.min(0.05, (time - last) / 1000);
      // The camera's path runs on from the cut into the fall without a
      // break (see descentU), so the fall never waits for the cut.
      const fallTarget = state.ringFall;
      const fallPull = (fallTarget - ringFall.current) * (1 - Math.exp(-FALL_FOLLOW * frameDt));
      const fallCap = FALL_RATE * frameDt;
      // Soft limit: follows the pull while it is small and eases toward the cap
      // as it grows, so a flick never switches into a flat constant speed.
      ringFall.current += fallPull / (1 + Math.abs(fallPull) / Math.max(fallCap, 1e-6));
      if (Math.abs(fallTarget - ringFall.current) < 1e-4) ringFall.current = fallTarget;
      ringNear.current = state.ringNear;

      // Off the top, one scroll glides through the pull-back and the cut to
      // the page; one scroll up from the page glides back to the igloo. If a
      // settle ever leaves the scroll resting at the end of the run, the next
      // scroll carries on from there either way. (See worldGlide for turning
      // one round.)
      {
        const { runEnd, pageAt } = worldStops();
        const s = instance.scroll;
        if (!gliding && lastTop < 2 && s >= 2 && s < pageAt - 3) {
          worldGlide(pageAt);
        } else if (!gliding && Math.abs(lastTop - pageAt) < 3 && s < pageAt - 3 && s > 2) {
          worldGlide(0);
        } else if (!gliding && Math.abs(lastTop - runEnd) < 3 && s > runEnd + 2 && s < pageAt - 3) {
          worldGlide(pageAt);
        } else if (!gliding && Math.abs(lastTop - runEnd) < 3 && s < runEnd - 3 && s > 2) {
          worldGlide(0);
        }
        lastTop = s;
      }

      // Down the rings the scroll leads, both ways (as igloo.inc's). Left
      // part-way down the shaft once the wheel has been quiet a while, the
      // descent finishes by itself, slowly, into the room; near the top it is
      // left be (the cut's own settle handles the start).
      if (ringReady.current && pageHeightRef.current > 0) {
        const vhS = vhRef.current;
        const ringFrom = (SEGMENTS.world + SEGMENTS.cut) * vhS + ringsStart(pageHeightRef.current, vhS);
        const fallFrom = ringFrom + RINGS.cut * vhS;
        const endPx = fallFrom + RINGS.fall * vhS + 2;
        const s = instance.scroll;
        const fallAt = (s - fallFrom) / (RINGS.fall * vhS);
        if (
          !settling &&
          !gliding &&
          time - lastInput > PAGE_IDLE_MS &&
          fallAt > 0.15 &&
          s < endPx - 2
        ) {
          settling = true;
          const gap = (endPx - s) / vhS;
          instance.scrollTo(endPx, {
            duration: reduce ? 0 : Math.min(8, Math.max(2, gap * 4)),
            immediate: reduce,
            easing: easeInOut,
            onComplete: () => {
              settling = false;
            },
          });
          if (reduce) settling = false;
        }
      }
      page.current = state.page;
      total.current =
        instance.limit > 0 ? Math.min(1, Math.max(0, instance.scroll / instance.limit)) : 0;

      // Left between two projects once the wheel has been quiet a while, the
      // page glides onto the nearer one, slowly: as igloo.inc does, 1.6 to
      // 2.4 s depending how far, eased in and out.
      const snapTo = pageLeash.current?.snap;
      if (
        !settling &&
        !gliding &&
        snapTo != null &&
        time - lastInput > PAGE_IDLE_MS &&
        Math.abs(instance.scroll - snapTo) > 1
      ) {
        settling = true;
        const gap = Math.abs(instance.scroll - snapTo) / vhRef.current;
        instance.scrollTo(snapTo, {
          duration: reduce ? 0 : Math.min(2.4, Math.max(1.6, gap * 6)),
          immediate: reduce,
          easing: easeInOut,
          onComplete: () => {
            settling = false;
          },
        });
        if (reduce) settling = false;
      }

      // Auto-settle transition if scroll is paused mid-way through the cut
      if (
        !settling &&
        !gliding &&
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
        // Anywhere in the world stretch is a place to rest (the boat's run);
        // part-way into the cut, it falls back to the cut's start.
        if (s > worldPx + 1 && s < commitPx) target = worldPx;
        else if (s >= commitPx && s < worldPx + cutPx - 1) target = worldPx + cutPx + 2;
        else if (hasPage && s > ringFrom + 1 && s < ringCommit) target = ringFrom;
        else if (hasPage && s >= ringCommit && s < ringFrom + ringCutPx - 1) target = ringFrom + ringCutPx + 2;

        if (target !== null) {
          settling = true;
          instance.scrollTo(target, {
            duration: reduce ? 0 : 1.1,
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
      ringCut, ringFall, ringNear, ringReady, pageLeash,
    }),
    []
  );

  // Development only: a handle for inspecting scenes from the console or an
  // automated browser, where a background tab gets too few frames to scroll
  // anywhere. Never present in a production build.
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    window.__worldScroll = value;
    return () => {
      delete window.__worldScroll;
    };
  }, [value]);

  // World and cut, the project page up to the ring cut, then the cut, the fall
  // and the room the site ends in, plus the viewport itself — the page's last
  // screen of scroll is the viewport, and without it the room would be cut
  // short of its own length.
  const extent =
    (SEGMENTS.world + SEGMENTS.cut) * vh +
    ringsStart(pageHeight, vh) +
    (RINGS.cut + RINGS.fall + RINGS.room) * vh +
    vh;

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
