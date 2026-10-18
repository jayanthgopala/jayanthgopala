import { useEffect, useState } from 'react';
import { useWorldScroll } from './scroll/ScrollProvider.jsx';
import { windState } from './lib/wind.js';
import { sound } from './lib/sound.js';

// Sound is on by default and the visitor's choice is remembered. Browsers refuse
// to play audio before the page has been touched, so "on" starts at the first
// touch, key press or scroll; an explicit off is kept across visits.
const PREF_KEY = 'world.sound';
const readPref = () => {
  try {
    return window.localStorage.getItem(PREF_KEY);
  } catch {
    return null;
  }
};
const writePref = (value) => {
  try {
    window.localStorage.setItem(PREF_KEY, value);
  } catch {
    /* private mode: the choice just lasts the visit */
  }
};

let autoStartArmed = false;
function armAutoStart() {
  if (autoStartArmed || typeof window === 'undefined') return;
  autoStartArmed = true;
  const events = ['pointerdown', 'touchstart', 'keydown', 'wheel'];
  const go = () => {
    events.forEach((name) => window.removeEventListener(name, go, true));
    if (readPref() !== 'off' && !sound.enabled) sound.start();
  };
  events.forEach((name) => window.addEventListener(name, go, { capture: true, passive: true }));
  // Sometimes allowed straight away (a returning visitor); harmless if not.
  if (readPref() !== 'off') {
    try {
      sound.start();
    } catch {
      /* wait for the first touch */
    }
  }
}

// The ambient sound toggle, shared by the HUD (WorldSite.jsx) and the
// project detail (WorkPage.jsx).
export default function SoundToggle({ className = '' } = {}) {
  const [live, setLive] = useState(() => sound.enabled);
  // Until the first touch lets audio play, the default "on" is pending: show it
  // as on, so the button states what will happen rather than what has not yet.
  const [pending, setPending] = useState(() => !sound.enabled && readPref() !== 'off');
  const on = live || pending;
  let scrollCtx = null;
  try {
    scrollCtx = useWorldScroll();
  } catch {
    // Standalone fallback when outside ScrollProvider
  }
  const flight = scrollCtx?.flight || { current: 0 };
  const cut = scrollCtx?.cut || { current: 0 };
  const ringCut = scrollCtx?.ringCut || { current: 0 };

  // Buffer the pad track once the world is up, so the first toggle starts
  // immediately without its 9 MB competing with the load.
  useEffect(() => {
    armAutoStart();
    const warm = setTimeout(() => sound.preload(), 12000);
    const unsub = sound.subscribe((active) => {
      setLive(active);
      if (active) setPending(false);
    });
    return () => {
      clearTimeout(warm);
      unsub();
    };
  }, []);

  // Pause audio when document is hidden.
  useEffect(() => {
    if (!live) return undefined;
    const onVisibility = () => {
      if (document.hidden) sound.stop();
      else sound.start();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [live]);

  // Feed velocity and cut progress to sound engine.
  useEffect(() => {
    if (!live) return undefined;
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
  }, [live, flight, cut, ringCut]);

  const toggle = () => {
    if (on) {
      writePref('off');
      setPending(false);
      sound.stop();
    } else {
      writePref('on');
      sound.start();
    }
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
