import { useEffect, useRef, useState } from 'react';

/**
 * The loading screen for the world.
 *
 * IT STAYS UP UNTIL THE WORLD IS ACTUALLY READY, and "ready" is a list of real
 * events rather than a timer. WorldSite hands in the steps it can observe —
 * the baked terrain fetched, the scene built and painted, the igloo in, the
 * shaders compiled and the frames running smoothly — and the screen lifts only
 * when every one has happened. Lifting earlier is what made the opening
 * descent stutter: it played while all of that was still going on underneath.
 *
 * WHY NOT drei's useProgress. That hook reads three's loading manager, which
 * counts network fetches through three's loaders — and almost nothing here goes
 * through them. The terrain and textures are baked files fetched by hand, and
 * the most expensive work of all (building the scene, compiling its shaders) is
 * not a download. A bar wired to it sat at 100% while the browser was frozen.
 *
 * THE BAR IS HONEST ABOUT WHAT IT KNOWS. Each finished step moves it to that
 * step's mark. Within a step it creeps toward the next mark but never reaches
 * it, because nothing inside a step can be measured — a blocking build does not
 * yield to report its progress. So it can slow, but it cannot lie: it will not
 * show a step as done before it is.
 *
 * Nothing that changes per frame goes through React state; the bar and the
 * percentage are written straight to their nodes.
 */
export default function WorldLoader({ ready, steps = [], name = '' }) {
  const [opening, setOpening] = useState(false);
  const [gone, setGone] = useState(false);
  const barRef = useRef(null);
  const pctRef = useRef(null);
  /* The furthest the bar has been, so it never moves backwards. */
  const shown = useRef(0);

  const total = Math.max(1, steps.length);
  const doneCount = steps.filter((s) => s.done).length;
  const current = steps.find((s) => !s.done);

  const write = (value) => {
    if (barRef.current) barRef.current.style.transform = `scaleX(${value.toFixed(4)})`;
    if (pctRef.current) pctRef.current.textContent = `${Math.round(value * 100)}%`;
  };

  /* Restarted on every finished step, so the creep measures time spent in THIS
     step and starts again from the new mark. */
  useEffect(() => {
    if (ready) return undefined;
    const since = performance.now();
    let frame = 0;

    const tick = () => {
      const seconds = (performance.now() - since) / 1000;
      const creep = (1 - Math.exp(-seconds * 0.9)) * 0.85;
      shown.current = Math.max(shown.current, (doneCount + creep) / total);
      write(shown.current);
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ready, doneCount, total]);

  /* Fill, then open with the iris, then unmount. */
  useEffect(() => {
    if (!ready) return undefined;
    shown.current = 1;
    write(1);
    const openTimer = setTimeout(() => setOpening(true), 240);
    const unmountTimer = setTimeout(() => setGone(true), 1700);
    return () => {
      clearTimeout(openTimer);
      clearTimeout(unmountTimer);
    };
  }, [ready]);

  if (gone) return null;

  return (
    <div
      className={`w-loader${ready ? ' is-ready' : ''}${opening ? ' is-opening' : ''}`}
      role="status"
      aria-live="polite"
      aria-label="Loading the world"
    >
      <div className="w-loader-curtain" />
      <div className="w-loader-inner">
        <p className="w-loader-mark">{name || 'Portfolio'}</p>
        <span className="w-loader-bar" aria-hidden="true">
          <i ref={barRef} />
        </span>
        <p className="w-loader-note">
          <span ref={pctRef} className="w-loader-pct" aria-hidden="true">
            0%
          </span>
          <span>{ready ? 'Ready' : current?.label || 'Loading'}</span>
        </p>
      </div>
    </div>
  );
}
