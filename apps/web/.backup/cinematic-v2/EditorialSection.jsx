import { useReveal } from './lib/reveal.js';

/**
 * The shell every cinematic section below the hero is built on.
 *
 * It owns four things and nothing else: an index number, a small tracked-out
 * eyebrow, a very large serif title, and generous vertical space. Everything
 * that varies between sections is the children.
 *
 * The head is deliberately NOT centred. A centred heading over a left-aligned
 * body is the layout every developer portfolio arrives at by default, and it is
 * most of what makes them look alike. Hanging the index in the margin and
 * running the title from the left edge of the measure is an editorial move that
 * costs nothing and immediately reads as a magazine rather than a landing page.
 */
export default function EditorialSection({
  id,
  /** The act this section is, 1..7. Structural only — the rail finds sections
      by id — but it makes the sequence legible in the inspector, which matters
      when the story is spread across five components. */
  act,
  index,
  eyebrow,
  title,
  lead,
  children,
  tone = 'ink',
  className = '',
}) {
  const [ref, shown] = useReveal();

  return (
    <section
      id={id}
      ref={ref}
      className={`cx-section ${className}`.trim()}
      data-act={act}
      data-tone={tone}
      data-in={shown || undefined}
    >
      <div className="cx-wrap">
        <header className="cx-head">
          {index != null && (
            <span className="cx-index" aria-hidden="true">
              {String(index).padStart(2, '0')}
            </span>
          )}

          <div className="cx-head-body">
            {eyebrow && <span className="cx-eyebrow">{eyebrow}</span>}
            {title && <h2 className="cx-title">{title}</h2>}
            {lead && <p className="cx-lead">{lead}</p>}
          </div>
        </header>

        {children}
      </div>
    </section>
  );
}
