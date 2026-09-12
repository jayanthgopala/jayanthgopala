import { useCallback, useEffect, useRef, useState } from 'react';
import ScrollProvider, { useWorldScroll } from './scroll/ScrollProvider.jsx';
import { windState } from './lib/wind.js';
import { sound } from './lib/sound.js';
import Stage from './Stage.jsx';
import WorkPage from './WorkPage.jsx';
import WorldLoader from './WorldLoader.jsx';
import MinimalLink from './MinimalLink.jsx';
import { loadBakedWorld } from './lib/baked.js';
import { ACTS, actAt } from './chapters.js';
import { copy } from '../lib/api.js';
import '../styles/world.css';

// Track current act based on scroll progress.
function useActiveAct() {
  const { progress } = useWorldScroll();
  const [act, setAct] = useState(ACTS[0]);
  const current = useRef(ACTS[0].id);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const next = actAt(progress.current);
      if (next.id !== current.current) {
        current.current = next.id;
        setAct(next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [progress]);

  return act;
}

// Ambient sound toggle.
function SoundToggle() {
  const [on, setOn] = useState(false);
  const { flight, cut } = useWorldScroll();

  // Buffer the pad track up front so the first toggle starts immediately.
  useEffect(() => {
    sound.preload();
    return () => sound.dispose();
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

    const tick = (now) => {
      const dt = Math.max(0.001, (now - last) / 1000);
      last = now;
      const progress = cut.current;
      sound.air(windState.cursorForce, flight.current);
      sound.cut(progress, (progress - previous) / dt);
      previous = progress;
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [on, flight, cut]);

  const toggle = () => {
    const next = !on;
    setOn(next);
    if (next) sound.start();
    else sound.stop();
  };

  return (
    <button
      type="button"
      className={`w-sound${on ? ' is-on' : ''}`}
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

function Hud({ profile = {}, content = {} }) {
  const act = useActiveAct();

  return (
    <div className="w-hud">
      <header className="w-hud-top">
        <div className="w-hud-brand">
          <p className="w-mark">{profile.name || 'Portfolio'}</p>
          <p className="w-role">{profile.role || ''}</p>
        </div>
        {/* Navigation link to minimal mode */}
        <MinimalLink label={copy(content, 'world.minimal', 'Minimal')} />
      </header>

      <footer className="w-hud-bottom">
        <SoundToggle />
        <span className={`w-hint${act.id === 'work' ? ' is-away' : ''}`}>Scroll to travel</span>      </footer>
    </div>
  );
}

// Mirror unhandled errors to DOM in dev mode.
function useCrashReporter() {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onError = (e) => {
      document.documentElement.dataset.worldError = String(
        (e.error && e.error.stack) || e.message || e
      ).slice(0, 400);
    };
    const onRejection = (e) => {
      document.documentElement.dataset.worldError = `unhandled rejection: ${String(e.reason).slice(0, 380)}`;
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
}

// Ensures the DOM has painted before blocking work begins.
function afterTwoFrames(done) {
  let inner = 0;
  let settled = false;

  const finish = () => {
    if (settled) return;
    settled = true;
    done(true);
  };

  const outer = requestAnimationFrame(() => {
    inner = requestAnimationFrame(finish);
  });
  const timer = setTimeout(finish, 120);

  return () => {
    cancelAnimationFrame(outer);
    cancelAnimationFrame(inner);
    clearTimeout(timer);
  };
}

export default function WorldSite({ site = {} }) {
  useCrashReporter();

  const [mountStage, setMountStage] = useState(false);
  const [framesReady, setFramesReady] = useState(false);
  const [iglooReady, setIglooReady] = useState(false);
  const [warmed, setWarmed] = useState(false);

  const ready = framesReady && iglooReady && warmed;

  const handleIglooReady = useCallback(() => setIglooReady(true), []);
  const handleWarm = useCallback(() => setWarmed(true), []);

  // Preload baked height and texture assets before mounting stage.
  useEffect(() => {
    let cancelled = false;
    let cancelFrames = () => {};

    const painted = new Promise((resolve) => {
      cancelFrames = afterTwoFrames(resolve);
    });

    Promise.all([loadBakedWorld(), painted]).then(() => {
      if (!cancelled) setMountStage(true);
    });

    return () => {
      cancelled = true;
      cancelFrames();
    };
  }, []);

  useEffect(() => {
    if (!mountStage) return undefined;
    return afterTwoFrames(setFramesReady);
  }, [mountStage]);

  // Fallback timeout in case asset fetch hangs.
  useEffect(() => {
    if (!mountStage || iglooReady) return undefined;
    const id = setTimeout(() => setIglooReady(true), 20_000);
    return () => clearTimeout(id);
  }, [mountStage, iglooReady]);

  // Loading steps tracked by WorldLoader.
  const loadSteps = [
    { label: 'Fetching the terrain', done: mountStage },
    { label: 'Building the world', done: framesReady },
    { label: 'Bringing in the igloo', done: iglooReady },
    { label: 'Compiling shaders', done: warmed },
  ];

  return (
    <ScrollProvider locked={!ready}>
      {mountStage && (
        <Stage
          onIglooReady={handleIglooReady}
          begin={ready}
          warm={framesReady && iglooReady}
          onWarm={handleWarm}
        />
      )}
      <WorkPage projects={site.projects} content={site.content} />
      <Hud profile={site.profile} content={site.content} />
      <WorldLoader ready={ready} steps={loadSteps} name={site.profile?.name} />
    </ScrollProvider>
  );
}
