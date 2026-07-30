import { useEffect, useRef, useState } from 'react';
import { copy } from '../lib/api.js';
import '../styles/preloader.css';

const SESSION_KEY = 'pf_preloaded';
const HOLD_MS = 320; // beat at 100% before the fade
const FADE_MS = 420;

const wasPreloaded = () => {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * Cinematic-mode intro overlay.
 *
 * Shown once per browser session, not once per page load — an entrance
 * animation is a first impression, and re-running it on every navigation turns
 * a flourish into a toll booth.
 *
 * Two phases: ease toward 90% while the payload is in flight, then run to 100
 * once it lands. The counter is decorative, so it deliberately refuses to show
 * 100% before the data is actually there.
 *
 * All sequencing lives inside the rAF loop. Driving it from an effect keyed on
 * `percent` does not work: the value changes every frame, so the effect's
 * cleanup cancels the dismissal timer ~16ms after each time it is set, and the
 * overlay sticks at 100% forever.
 */
export default function Preloader({ content = {}, ready }) {
  const [percent, setPercent] = useState(0);
  const [phase, setPhase] = useState(() => (wasPreloaded() ? 'done' : 'loading'));

  const raf = useRef(0);
  const timers = useRef([]);
  const current = useRef(0);
  const readyAt = useRef(0);
  const readyFrom = useRef(0);

  // `ready` is read inside the loop, so keep a ref rather than restarting the
  // animation (and its clock) when it flips.
  const readyRef = useRef(ready);
  readyRef.current = ready;

  useEffect(() => {
    if (phase !== 'loading') return;

    const start = performance.now();
    let cancelled = false;

    // Only flips the phase. The unmount timer lives in its own effect below:
    // scheduling it here put it in `timers.current`, and the phase change then
    // triggered this effect's cleanup, which cleared the very timer meant to
    // finish the transition. The overlay faded to opacity 0 but never
    // unmounted, and the scroll lock never released — an invisible overlay
    // holding the page hostage.
    const finish = () => setPhase('exiting');

    const tick = (now) => {
      if (cancelled) return;

      let next;
      if (!readyRef.current) {
        // Decelerating toward the 90% ceiling.
        next = 90 * (1 - Math.exp(-(now - start) / 620));
      } else {
        if (!readyAt.current) {
          readyAt.current = now;
          readyFrom.current = current.current;
        }
        // Linear run-in, so the last stretch doesn't crawl asymptotically.
        const t = Math.min(1, (now - readyAt.current) / 520);
        next = readyFrom.current + (100 - readyFrom.current) * t;
      }

      current.current = next;
      setPercent(next);

      if (next >= 99.9) {
        timers.current.push(setTimeout(finish, HOLD_MS));
        return; // stop the loop — this is what lets the timer survive
      }
      raf.current = requestAnimationFrame(tick);
    };

    raf.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf.current);
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [phase]);

  // Exit transition, owned by its own effect so no other cleanup can cancel it.
  useEffect(() => {
    if (phase !== 'exiting') return;
    const id = setTimeout(() => {
      setPhase('done');
      try {
        sessionStorage.setItem(SESSION_KEY, '1');
      } catch {
        /* non-fatal */
      }
    }, FADE_MS);
    return () => clearTimeout(id);
  }, [phase]);

  /**
   * Failsafe. Whatever happens to the counter — a stalled fetch, a bug like the
   * one above — the overlay tears itself down after this. An entrance animation
   * must never be able to trap the page behind a scroll lock.
   */
  useEffect(() => {
    if (phase === 'done') return;
    const id = setTimeout(() => setPhase('done'), 8000);
    return () => clearTimeout(id);
  }, [phase]);

  // Lock scrolling only while the overlay is actually visible. Holding it
  // through the fade means a stuck exit leaves the page unscrollable.
  useEffect(() => {
    if (phase !== 'loading') return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [phase]);

  if (phase === 'done') return null;

  const value = Math.round(percent);
  const circumference = 2 * Math.PI * 34;

  return (
    <div
      className="preloader"
      data-exiting={phase === 'exiting' || undefined}
      role="status"
      aria-live="polite"
    >
      <div className="preloader-ring">
        <svg viewBox="0 0 80 80" width="80" height="80" aria-hidden="true">
          <circle cx="40" cy="40" r="34" className="preloader-track" />
          <circle
            cx="40"
            cy="40"
            r="34"
            className="preloader-progress"
            style={{
              strokeDasharray: circumference,
              strokeDashoffset: circumference * (1 - percent / 100),
            }}
          />
        </svg>
        <div className="preloader-value">
          <span className="preloader-percent">{value}%</span>
          <span className="preloader-load">Load</span>
        </div>
      </div>

      <div className="preloader-copy">
        <span className="preloader-title">
          {copy(content, 'preloader.title', 'Initializing experience')}
        </span>
        <span className="preloader-sub">
          {copy(content, 'preloader.subtitle', 'Streaming visual frames…')}
        </span>
      </div>

      <div className="preloader-bar">
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
