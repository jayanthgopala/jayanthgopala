import { Reveal } from '../lib/motion.jsx';
import { copy, externalUrl } from '../lib/api.js';
import { ArrowUpRight } from './Icons.jsx';
import '../styles/timeline.css';

/**
 * Shared timeline used by both Education and Experience.
 *
 * They render identically — a rail, a marker per entry, and a card — and differ
 * only in which fields they surface. Two components would have been two sets of
 * the same CSS to keep in sync.
 */
function TimelineList({ items, renderItem }) {
  return (
    <ol className="timeline">
      {items.map((item, i) => (
        <Reveal as="li" key={item.id ?? i} delay={Math.min(i, 4) * 80} className="timeline-item">
          <span className="timeline-marker" aria-hidden="true" />
          <div className="timeline-card card">{renderItem(item)}</div>
        </Reveal>
      ))}
    </ol>
  );
}

export function Education({ education = [], content = {} }) {
  if (education.length === 0) return null;

  return (
    <section className="section" id="education">
      <div className="container">
        <div className="section-head">
          <Reveal>
            <span className="eyebrow">{copy(content, 'education.eyebrow', 'Background')}</span>
          </Reveal>
          <Reveal delay={70}>
            <h2 className="h2">{copy(content, 'education.title', 'Education')}</h2>
          </Reveal>
        </div>

        <TimelineList
          items={education}
          renderItem={(e) => (
            <>
              <div className="timeline-head">
                <h3 className="timeline-title">
                  {[e.qualification, e.field].filter(Boolean).join(' · ') || e.institution}
                </h3>
                {e.period && <span className="timeline-period mono">{e.period}</span>}
              </div>

              <p className="timeline-org">
                {e.institution}
                {e.location && <span className="timeline-dim"> · {e.location}</span>}
              </p>

              {e.grade && <span className="timeline-badge">{e.grade}</span>}
              {e.description && <p className="timeline-desc">{e.description}</p>}
            </>
          )}
        />
      </div>
    </section>
  );
}

export function Experience({ experience = [], content = {} }) {
  if (experience.length === 0) return null;

  return (
    <section className="section" id="experience">
      <div className="container">
        <div className="section-head">
          <Reveal>
            <span className="eyebrow">{copy(content, 'experience.eyebrow', 'Track record')}</span>
          </Reveal>
          <Reveal delay={70}>
            <h2 className="h2">
              {copy(content, 'experience.title', 'Experience & Achievements')}
            </h2>
          </Reveal>
        </div>

        <TimelineList
          items={experience}
          renderItem={(x) => (
            <>
              <div className="timeline-head">
                <h3 className="timeline-title">{x.title}</h3>
                {x.period && <span className="timeline-period mono">{x.period}</span>}
              </div>

              {(x.organisation || x.location) && (
                <p className="timeline-org">
                  {x.organisation}
                  {x.location && <span className="timeline-dim"> · {x.location}</span>}
                </p>
              )}

              {/* Achievements read differently from roles, so they're flagged
                  rather than silently mixed into the same list. */}
              {x.kind === 'achievement' && <span className="timeline-badge">Achievement</span>}

              {x.description && <p className="timeline-desc">{x.description}</p>}

              {x.tech?.length > 0 && (
                <ul className="timeline-tech">
                  {x.tech.map((t) => (
                    <li key={t} className="pill timeline-tech-item">
                      {t}
                    </li>
                  ))}
                </ul>
              )}

              {x.url && (
                <a
                  className="timeline-link"
                  href={externalUrl(x.url)}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  View <ArrowUpRight width={13} height={13} />
                </a>
              )}
            </>
          )}
        />
      </div>
    </section>
  );
}
