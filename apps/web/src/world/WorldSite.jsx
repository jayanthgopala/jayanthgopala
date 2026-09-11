import { useCallback, useEffect, useRef, useState } from 'react';
import ScrollProvider, { useWorldScroll } from './scroll/ScrollProvider.jsx';
import { createWind } from './lib/wind.js';
import Stage from './Stage.jsx';
import WorkPage from './WorkPage.jsx';
import { loadBakedWorld } from './lib/baked.js';
import { ACTS, actAt } from './chapters.js';
import '../styles/world.css';

/**
 * The world route: a fixed canvas, a scroll extent, and a thin HUD over it.
 *
 * The HUD is deliberately DOM rather than in-scene. The reference site renders
 * even its wordmark as MSDF geometry inside WebGL, which looks superb and costs
 * it selectable text, real links, screen-reader access and find-in-page. Text
 * that is *part of the world* — headlines standing in the fog at depth — will be
 * drawn in-scene where the depth is the point. Text that is *chrome* stays in
 * the DOM where it belongs.
 */

/**
 * The current act, as state.
 *
 * The one place a scroll-driven value is allowed to become React state, because
 * it changes seven times across the whole journey rather than sixty times a
 * second. It is polled on a frame loop and only committed when the act actually
 * changes, so the tree re-renders exactly seven times.
 */
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

/**
 * The sound control.
 *
 * OFF BY DEFAULT, AND THAT IS NOT A PREFERENCE. Every browser blocks audio
 * until a gesture, so a control that claimed to be on would be lying on first
 * load — and sound that starts by itself on a portfolio is the behaviour people
 * install blockers for. The first click is what both starts the context and
 * turns it on, which is exactly the gesture the policy wants.
 *
 * The wind itself is built lazily inside createWind, so a visitor who never
 * touches this never allocates an AudioContext at all.
 */
function SoundToggle() {
  const [on, setOn] = useState(false);
  const wind = useRef(null);

  useEffect(() => {
    wind.current = createWind();
    return () => {
      wind.current?.dispose();
      wind.current = null;
    };
  }, []);

  /* Stop when the tab is hidden. A backgrounded tab playing wind is the thing
     people hunt through their tabs to find and close. */
  useEffect(() => {
    if (!on) return undefined;
    const onVisibility = () => {
      if (document.hidden) wind.current?.stop();
      else wind.current?.start();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [on]);

  const toggle = () => {
    const next = !on;
    setOn(next);
    if (next) wind.current?.start();
    else wind.current?.stop();
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

function Hud({ profile = {} }) {
  const act = useActiveAct();

  return (
    <div className="w-hud">
      <header className="w-hud-top">
        <p className="w-mark">{profile.name || 'Portfolio'}</p>
        <p className="w-role">{profile.role || ''}</p>
      </header>

      <footer className="w-hud-bottom">
        <SoundToggle />
        <span className={`w-hint${act.id === 'work' ? ' is-away' : ''}`}>Scroll to travel</span>      </footer>
    </div>
  );
}

/*
 * Dev-only crash reporter.
 *
 * A component that throws inside the R3F Canvas takes down the whole canvas
 * subtree and leaves a correctly-sized, entirely blank canvas behind — visually
 * identical to a scene that simply has nothing in it. The error goes to the
 * console, which is exactly where an automated browser session cannot reliably
 * read it. Mirroring it onto an attribute makes the failure visible in the DOM,
 * which is the one channel that always works.
 */
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

/**
 * Run `done` after the browser has had two frames to paint — or after a short
 * timer if it is never going to give us any.
 *
 * THE TIMER IS NOT A BELT-AND-BRACES FALLBACK, IT IS THE FIX FOR A REAL BUG.
 *
 * requestAnimationFrame does not fire in a hidden tab. Not late — never, for as
 * long as the tab stays in the background. This handshake gates whether the
 * Stage mounts at all, so a visitor who opens the site in a background tab (a
 * middle-click, a "open link in new tab", a session restore) and switches to it
 * a minute later finds the loader still sitting there, and it stays there: the
 * callback that was supposed to start the world was scheduled for a frame that
 * had not happened yet, and switching to the tab does not retroactively run it.
 *
 * It also makes the world untestable in any automated browser, where the tab is
 * very often not the visible one — which is how this was found.
 *
 * Racing a timeout against the frames keeps the good behaviour when the tab IS
 * visible (the loader gets its two frames to paint before the main thread is
 * taken for a second by the terrain build) and guarantees the world is built
 * either way. Whichever fires first wins and the other is cancelled.
 */
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
  /* Comfortably longer than two frames on any machine that is actually
     painting, so the rAF path wins whenever there is one. */
  const timer = setTimeout(finish, 120);

  return () => {
    cancelAnimationFrame(outer);
    cancelAnimationFrame(inner);
    clearTimeout(timer);
  };
}

export default function WorldSite({ site = {} }) {
  useCrashReporter();

  /*
   * THE EXTENT IS NOT A PAGE COUNT ANY MORE.
   *
   * It was `pages={3}`: three screens for one camera move. The world now hands
   * over to the work page part-way down, so the scroll is three stretches —
   * the journey, the cut, the page — set in SEGMENTS in chapters.js, with the
   * page's length measured rather than chosen. The pacing control lives there
   * now: more screens in a stretch slows every beat in it together.
   */

  /*
   * THE TWO-FRAME HANDSHAKE, and it is the whole reason the loader is visible
   * at all.
   *
   * Mounting <Stage /> kicks off a great deal of SYNCHRONOUS work — three
   * generated texture sets and a 512x512 displaced terrain. Synchronous means
   * the browser cannot paint while it runs. Render the loader and the Stage in
   * the same commit and the loader is queued behind the freeze it exists to
   * cover, so the user stares at a blank page and then the finished world
   * appears: the loader is technically present and never seen.
   *
   * Waiting two animation frames guarantees a paint has landed before the work
   * starts. One frame is not enough — the first fires before the commit's paint
   * on some browsers. The same handshake runs again afterwards to decide when
   * the world is actually up.
   */
  const [mountStage, setMountStage] = useState(false);
  const [framesReady, setFramesReady] = useState(false);
  const [iglooReady, setIglooReady] = useState(false);

  /*
   * THE LOADER COMES DOWN WHEN THE IGLOO IS THERE, NOT WHEN THE STAGE IS.
   *
   * The two-frame handshake below only knows that the scene graph has been
   * committed and painted once. It cannot know about the igloo, because the
   * igloo is the one thing in this world that is FETCHED — a 392 KB .bin and
   * two textures — and that fetch starts after the canvas is already up. So the
   * loader was lifting on a world with a hole in it, and the first thing a
   * visitor saw was the igloo popping in, or worse, assembling.
   *
   * Both conditions, and the fetch is the one that actually gates it.
   */
  const ready = framesReady && iglooReady;

  const handleIglooReady = useCallback(() => setIglooReady(true), []);

  /*
   * THE BAKED ASSETS ARE FETCHED BEFORE THE STAGE EXISTS, not by it.
   *
   * Everything downstream reads heights and material maps synchronously, from
   * inside useMemo and useFrame — the terrain's vertex loop, the scree scatter,
   * the igloo's footing, the camera rig's ground clearance every frame. None of
   * those can await, and making them able to would mean pushing async through
   * the whole scene graph for the sake of one fetch. So the fetch is hoisted
   * out in front of all of it: by the time anything asks, lib/baked.js has the
   * answer in memory and hands it over synchronously.
   *
   * RUN ALONGSIDE THE PAINT HANDSHAKE, NOT AFTER IT. The two are independent —
   * one waits on the network, the other on the compositor — and sequencing them
   * would add one to the other for no reason. The fetch is asynchronous, so it
   * cannot delay the loader's paint the way the old synchronous generation did.
   *
   * loadBakedWorld resolves rather than rejects when the assets are missing,
   * having already logged it, and the generators run as they always did. So a
   * failed or absent bake costs the seventeen seconds this removed and nothing
   * else — which is exactly where the site was before.
   */
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

  /*
   * A loader that waits on a fetch must not be able to outlive it.
   *
   * IglooBlocks reports ready on failure as well as on success, so this covers
   * only the case it cannot report from — a request that never settles at all,
   * on a connection bad enough to hang rather than error. The world behind is
   * complete apart from the igloo, so showing it is strictly better than a
   * loading screen that never leaves.
   */
  useEffect(() => {
    if (!mountStage || iglooReady) return undefined;
    const id = setTimeout(() => setIglooReady(true), 20_000);
    return () => clearTimeout(id);
  }, [mountStage, iglooReady]);

  return (
    <ScrollProvider>
      {mountStage && <Stage onIglooReady={handleIglooReady} begin={ready} />}
      <WorkPage projects={site.projects} />
      <Hud profile={site.profile} />
    </ScrollProvider>
  );
}
