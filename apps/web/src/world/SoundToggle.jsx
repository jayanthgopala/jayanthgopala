import { useEffect, useState } from 'react';
import { useWorldScroll } from './scroll/ScrollProvider.jsx';
import { windState } from './lib/wind.js';
import { sound } from './lib/sound.js';

// The ambient sound toggle, shared by the HUD (WorldSite.jsx) and the
// project detail (WorkPage.jsx).
export default function SoundToggle({ className = '' } = {}) {
  const [on, setOn] = useState(() => sound.enabled);
  let scrollCtx = null;
  try {
    scrollCtx = useWorldScroll();
  } catch {
    // Standalone fallback when outside ScrollProvider
  }
  const flight = scrollCtx?.flight || { current: 0 };
  const cut = scrollCtx?.cut || { current: 0 };
  const ringCut = scrollCtx?.ringCut || { current: 0 };

  // Buffer the pad track up front so the first toggle starts immediately.
  useEffect(() => {
    sound.preload();
    const unsub = sound.subscribe((active) => setOn(active));
    return () => {
      unsub();
    };
  }, []);

  // Pause audio when document is hidden.
  useEffect(() => {
    if (!on) return undefined;
    const onVisibility = () => {
      if (document.hidden) sound.stop();
      else sound.start();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [on]);

  // Feed velocity and cut progress to sound engine.
  useEffect(() => {
    if (!on) return undefined;
    let frame = 0;
    let last = performance.now();
    let previous = cut.current;
    let previousRing = ringCut.current;

    const tick = (now) => {
      const dt = Math.max(0.001, (now - last) / 1000);
      last = now;
      const progress = cut.current;
      const ring = ringCut.current;
      sound.air(windState.cursorForce, flight.current);
      // One whoosh voice serves both cuts; whichever is under way drives it.
      if (progress < 1 || ring <= 0) sound.cut(progress, (progress - previous) / dt);
      else sound.ringCut(ring, (ring - previousRing) / dt);
      previous = progress;
      previousRing = ring;
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [on, flight, cut, ringCut]);

  const toggle = () => {
    if (sound.enabled) sound.stop();
    else sound.start();
  };

  return (
    <button
      type="button"
      className={`w-sound${on ? ' is-on' : ''}${className ? ` ${className}` : ''}`}
      onClick={toggle}
      aria-pressed={on}
    >
      <span className="w-sound-bars" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      Sound: {on ? 'On' : 'Off'}
    </button>
  );
}
