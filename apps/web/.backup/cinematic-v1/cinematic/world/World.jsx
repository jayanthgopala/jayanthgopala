import { useEffect, useRef, useState } from 'react';
import { reducedMotion, isTouch } from '../lib/scene.js';

/**
 * Mounts the 3D world behind the acts, or gets out of the way.
 *
 * Getting out of the way is a first-class outcome rather than an error path.
 * When it happens the acts paint their own backgrounds and the sequence still
 * reads correctly — data-world on the root element is what tells the CSS which
 * of the two is in effect.
 *
 * three.js is loaded on demand. It is roughly 160KB gzipped and minimal mode
 * must never pay for it, so the import lives inside this effect rather than at
 * the top of any module minimal mode touches.
 *
 * `actIds` MUST be a stable reference. It is an effect dependency, and a
 * freshly-built array on each render tears down and re-creates the entire WebGL
 * context — silently, and on every status poll.
 */
export default function World({ actIds, avatarUrl = '', projects = [], screenshotUrl, onHover, onSelect }) {
  const canvasRef = useRef(null);
  const worldRef = useRef(null);
  const [failed, setFailed] = useState(false);

  const hoverRef = useRef(onHover);
  const selectRef = useRef(onSelect);
  hoverRef.current = onHover;
  selectRef.current = onSelect;

  // The latest payload, readable from inside the mount effect. See the note at
  // the mount site for why a ref rather than a dependency.
  const dataRef = useRef({ projects, screenshotUrl });
  dataRef.current = { projects, screenshotUrl };

  useEffect(() => {
    let disposed = false;
    const root = document.documentElement;

    (async () => {
      let Engine;
      try {
        ({ World: Engine } = await import('./engine.js'));
      } catch {
        // A chunk that fails to load is a network problem, not a capability
        // one, and it must not take the page down with it.
        setFailed(true);
        return;
      }

      // Support was established by the caller before this mounted — Act I needs
      // the answer during its first render, so re-probing here would only risk
      // the two disagreeing.
      if (disposed || !canvasRef.current) return;

      // A phone renders the same scene at a lower pixel ratio rather than a
      // cut-down scene: this is a few thousand triangles, so it is fill rate
      // that costs anything, not vertex count.
      const quality = isTouch() ? 'low' : 'high';

      let engine;
      try {
        engine = new Engine(canvasRef.current, { actIds, quality });
      } catch {
        // Context creation can still fail after a clean capability probe — too
        // many live contexts in the tab, a GPU reset, a driver refusing.
        setFailed(true);
        return;
      }

      // StrictMode runs effects twice in development; without this the first
      // pass leaks a whole renderer and its context.
      if (disposed) {
        engine.dispose();
        return;
      }

      worldRef.current = engine;
      root.dataset.world = 'on';

      /*
       * Read through refs rather than closing over the props. The engine is
       * created once and lives for the whole session; capturing the first
       * render's callbacks here would leave it calling stale handlers for as
       * long as the tab stayed open.
       */
      engine.onHover = (index) => hoverRef.current?.(index);
      engine.onSelect = (index) => selectRef.current?.(index);

      /*
       * Apply whatever the payload already holds, immediately.
       *
       * Without this the console comes up empty in development and, on a fast
       * connection, in production too. StrictMode mounts, tears down and
       * remounts: the projects effect below runs against the FIRST engine,
       * that engine is then disposed, and because the effect's dependencies
       * have not changed it never runs again — so the second engine, the one
       * actually on screen, is never told what to display. Seeding from a ref
       * at mount closes that window; the effect below then handles genuine
       * changes.
       */
      engine.setProjects(dataRef.current.projects, dataRef.current.screenshotUrl);

      if (reducedMotion()) {
        engine.renderStatic();
      } else {
        engine.mount();
      }
    })();

    return () => {
      disposed = true;
      delete root.dataset.world;
      worldRef.current?.dispose();
      worldRef.current = null;
    };
  }, [actIds]);

  // Applied after mount rather than passed to the constructor: the avatar URL
  // arrives with the site payload, which lands after the world is already on
  // screen. Swapping it in later is the normal case, not the exception.
  useEffect(() => {
    if (!avatarUrl) return;
    worldRef.current?.setAvatar(avatarUrl);
  }, [avatarUrl]);

  /*
   * Later changes to the payload — a project added in the admin panel becomes a
   * screen on the console without a reload. The mount path above covers the
   * case where the data arrived first; this covers the case where it arrives
   * after. setProjects rebuilds the rail rather than appending to it, so the
   * two overlapping is harmless.
   */
  useEffect(() => {
    worldRef.current?.setProjects(projects, screenshotUrl);
  }, [projects, screenshotUrl]);

  if (failed) return null;

  return (
    <div className="cx-world" aria-hidden="true">
      <canvas ref={canvasRef} className="cx-world-canvas" />
      {/* The scrim, and the reason body copy is readable at all. Its opacity is
          written per frame by the engine as --veil, from a value declared per
          act: the opening shot lets the world through completely, and the acts
          carrying paragraphs push it most of the way back. */}
      <span className="cx-world-veil" />
    </div>
  );
}
