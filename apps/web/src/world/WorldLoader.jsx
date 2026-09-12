import { useEffect, useRef, useState } from 'react';

// Stays up until the world is actually ready, and ready is a list of real events rather than a timer.
// Lifting earlier is what made the opening descent stutter, it played while the build was still going on underneath.
// Not drei's useProgress, that reads three's loading manager and almost nothing here goes through three's loaders.
// The baked files are fetched by hand and the expensive part, building the scene and compiling shaders, isn't a download.
// Within a step the bar creeps toward the next mark but never reaches it, since a blocking build can't report progress.
export default function WorldLoader({ ready, steps = [], name = '' }) {
  const [opening, setOpening] = useState(false);
  const [gone, setGone] = useState(false);
  const barRef = useRef(null);
  const pctRef = useRef(null);
  const shown = useRef(0); // furthest the bar has been, so it never moves backwards

  const total = Math.max(1, steps.length);
  const doneCount = steps.filter((s) => s.done).length;
  const current = steps.find((s) => !s.done);

  // written straight to the nodes, nothing that changes per frame goes through React state
  const write = (value) => {
    if (barRef.current) barRef.current.style.transform = `scaleX(${value.toFixed(4)})`;
    if (pctRef.current) pctRef.current.textContent = `${Math.round(value * 100)}%`;
  };

  // restarted on every finished step, so the creep measures time spent in this step and starts again from the new mark
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

  // fill, then open with the iris, then unmount
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
