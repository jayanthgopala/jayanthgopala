import { useEffect, useState } from 'react';

/**
 * The act marker: a thin rail down the right edge listing the sequence, with
 * the act you are currently inside picked out.
 *
 * A scroll-driven page this long needs to tell you two things at all times —
 * where you are and how much is left — and the reference does it with almost
 * nothing: a hairline and a few words. So this is a hairline and a few words.
 * No scrollbar styling, no dots that grow, no percentage.
 *
 * WHICH ACT IS ACTIVE IS DECIDED BY THE VIEWPORT'S MIDDLE, not by whichever
 * section happens to be most visible. An observer with a root inset to a
 * zero-height band across the centre of the screen fires exactly once per
 * boundary crossing, so there is never a moment where two acts are both "in
 * view" and the highlight flickers between them. Getting this from a scroll
 * listener would mean measuring every section on every frame.
 *
 * The fill line reads --page, the document progress the page already publishes,
 * so the rail costs one observer and no scroll handler of its own.
 */
export default function ChapterRail({ acts = [] }) {
  /*
   * Both the active act and the tone of the ground it is drawn on. The rail is
   * fixed over sections that alternate ink and paper, and a single colour is
   * invisible over one of them — so it reads the section's own data-tone as it
   * passes rather than guessing from the scroll position.
   */
  const [active, setActive] = useState({ id: acts[0]?.id, tone: 'ink' });

  useEffect(() => {
    if (acts.length === 0) return;

    const nodes = acts
      .map((act) => document.getElementById(act.id))
      .filter(Boolean);

    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          setActive({
            id: entry.target.id,
            tone: entry.target.dataset.tone || 'ink',
          });
        });
      },
      /* A one-pixel band across the middle of the viewport. The negative
         margins collapse the root to that line; an element "intersects" it
         only while it is the thing under the centre of the screen. */
      { rootMargin: '-50% 0px -50% 0px', threshold: 0 }
    );

    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [acts]);

  if (acts.length === 0) return null;

  return (
    <nav className="cx-rail" data-tone={active.tone} aria-label="Sequence">
      <span className="cx-rail-line" aria-hidden="true">
        <i />
      </span>

      <ol className="cx-rail-list">
        {acts.map((act, i) => (
          <li key={act.id}>
            <a
              href={`#${act.id}`}
              className="cx-rail-act"
              data-active={act.id === active.id || undefined}
              aria-current={act.id === active.id ? 'true' : undefined}
            >
              <span className="cx-rail-num">{String(i + 1).padStart(2, '0')}</span>
              <span className="cx-rail-name">{act.label}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
