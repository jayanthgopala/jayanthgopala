import { useEffect, useRef, useState } from 'react';
import { copy } from '../lib/api.js';
import '../styles/preloader.css';

const SESSION_KEY = 'pf_preloaded';
const HOLD_MS = 320;
const FADE_MS = 420;

const wasPreloaded = () => {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
};

// Initial site loading screen with circular progress indicator
export default function Preloader({ content = {}, ready }) {
  const [percent, setPercent] = useState(0);
  const [phase, setPhase] = useState(() => (wasPreloaded() ? 'done' : 'loading'));

  const raf = useRef(0);
  const timers = useRef([]);
  const current = useRef(0);
  const readyAt = useRef(0);
  const readyFrom = useRef(0);

  const readyRef = useRef(ready);
  readyRef.current = ready;

  useEffect(() => {
    if (phase !== 'loading') return;

    const start = performance.now();
    let cancelled = false;

    const finish = () => setPhase('exiting');

    const tick = (now) => {
      if (cancelled) return;

      let next;
      if (!readyRef.current) {
        next = 90 * (1 - Math.exp(-(now - start) / 620));
      } else {
        if (!readyAt.current) {
          readyAt.current = now;
          readyFrom.current = current.current;
        }
        const t = Math.min(1, (now - readyAt.current) / 520);
        next = readyFrom.current + (100 - readyFrom.current) * t;
      }

      current.current = next;
      setPercent(next);

      if (next >= 99.9) {
        timers.current.push(setTimeout(finish, HOLD_MS));
        return;
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

  // Mark session storage once exit animation finishes
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

  // Fallback timeout in case asset loading stalls
  useEffect(() => {
    if (phase === 'done') return;
    const id = setTimeout(() => setPhase('done'), 8000);
    return () => clearTimeout(id);
  }, [phase]);

  // Lock document scroll while preloader is visible
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
