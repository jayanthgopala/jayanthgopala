import { useEffect, useRef, useState } from 'react';

/**
 * The loading screen for the world.
 *
 * WHY IT IS NOT DRIVEN BY drei's useProgress. That hook reads three's loading
 * manager, which counts network fetches — and this scene fetches nothing. Every
 * texture is generated on the CPU and the terrain is displaced vertex by vertex,
 * so the manager reports 100% instantly while the browser is still frozen doing
 * the actual work. A progress bar wired to it would sit at full before anything
 * existed and then the page would hang.
 *
 * The real cost here is SYNCHRONOUS, which is also why it cannot be measured
 * from inside. A blocking loop does not yield, so nothing can sample it. What
 * can be done is to guarantee the loader is PAINTED before that loop starts —
 * hence the two-frame handshake in WorldSite: the loader renders, the browser
 * paints it, and only then does the Stage mount and begin its work. Without
 * that the loader would be queued behind the very thing it exists to cover and
 * the user would see a white page instead.
 *
 * The bar is therefore an honest indeterminate: it advances on a curve that
 * eases toward the end but never reaches it, and only completes when the world
 * signals it is ready. Faking exact percentages would be a lie about something
 * genuinely unmeasurable.
 */
export default function WorldLoader({ ready }) {
  const [opening, setOpening] = useState(false);
  const [gone, setGone] = useState(false);
  const barRef = useRef(null);
  const startedAt = useRef(0);

  /* Approach-but-never-arrive, written straight to the node — the same reason
     the HUD's progress bar is: it changes every frame and must not re-render. */
  useEffect(() => {
    if (ready) return undefined;
    startedAt.current = performance.now();

    let frame = 0;
    const tick = () => {
      const seconds = (performance.now() - startedAt.current) / 1000;
      /* Asymptotic: fast at first, then slower, capped short of full. */
      const value = 1 - Math.exp(-seconds * 0.75);
      if (barRef.current) {
        barRef.current.style.transform = `scaleX(${(value * 0.92).toFixed(4)})`;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ready]);

  /* Fill, then open with curved iris transition, then unmount */
  useEffect(() => {
    if (!ready) return undefined;
    if (barRef.current) barRef.current.style.transform = 'scaleX(1)';
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
        <p className="w-loader-mark">Portfolio</p>
        <span className="w-loader-bar" aria-hidden="true">
          <i ref={barRef} />
        </span>
        <p className="w-loader-note">Building the world</p>
      </div>
    </div>
  );
}
