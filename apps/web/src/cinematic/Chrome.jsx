import { copy } from '../lib/api.js';

/**
 * The fixed furniture: a progress rail and a shot counter that never move while
 * the acts travel behind them.
 *
 * This is the single cheapest thing that separates a "long page" from a
 * "sequence". Without persistent chrome a scroll story reads as sections; with
 * it, the frame holds still and the world moves through it — which is what a
 * camera does.
 *
 * Both pieces stay live under reduced motion. They are orientation aids in a
 * document with no visible scrollbar chapters, not decoration.
 */
export function ProgressRail({ acts, active }) {
  return (
    <div className="cx-rail" aria-hidden="true">
      <span className="cx-rail-line">
        {/* --doc is written by useDocumentProgress on <html>, so the fill costs
            one custom-property write per frame and no React render. */}
        <span className="cx-rail-fill" />
      </span>

      <ol className="cx-rail-ticks">
        {acts.map((act, index) => (
          <li
            key={act.id}
            className="cx-rail-tick"
            data-active={index === active || undefined}
            data-passed={index < active || undefined}
          />
        ))}
      </ol>
    </div>
  );
}

export function ShotCounter({ acts, active }) {
  const act = acts[active] || acts[0];
  const pad = (n) => String(n + 1).padStart(2, '0');

  return (
    <div className="cx-counter">
      {/* aria-live rather than silence: for a screen-reader user the acts are
          just headings, and announcing the act on arrival is the equivalent of
          the visual counter ticking over. */}
      <span className="cx-counter-index" aria-hidden="true">
        {pad(active)}
        <span className="cx-counter-total">/{pad(acts.length - 1)}</span>
      </span>
      <span className="cx-counter-name" aria-live="polite">
        {act?.label}
      </span>
    </div>
  );
}

/**
 * Scroll hint under the first shot. Disappears for good once the visitor has
 * scrolled — a hint that keeps insisting after it has been obeyed is nagging.
 */
export function ScrollHint({ content }) {
  return (
    <div className="cx-hint" aria-hidden="true">
      <span className="cx-hint-label">{copy(content, 'cine.scroll', 'Scroll')}</span>
      <span className="cx-hint-line" />
    </div>
  );
}
