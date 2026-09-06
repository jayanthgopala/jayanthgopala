import { copy, externalUrl } from '../lib/api.js';
import { ArrowUpRight } from '../components/Icons.jsx';
import { useSceneVar, useEntered } from './lib/scene.js';

/**
 * ACT V — RECORD.
 *
 * Experience and education on one rail, as a single travel through time rather
 * than two stacked sections with two headings and two sets of the same
 * furniture. Splitting them was minimal mode's answer; here the camera runs
 * down one line and the entries pass it.
 *
 * The rail's fill is driven by the scene's own --p, so the line draws at
 * exactly the rate you scroll and reverses when you scroll back. An entrance
 * animation would play once and then sit inert for the rest of the visit.
 */

function Entry({ children, index }) {
  const [ref, entered] = useEntered({ threshold: 0.3 });

  return (
    <li className="cx-rec-entry" ref={ref} data-in={entered || undefined} style={{ '--i': index }}>
      <span className="cx-rec-node" aria-hidden="true" />
      <div className="cx-rec-card">{children}</div>
    </li>
  );
}

export default function ActRecord({ experience = [], education = [], content = {}, id }) {
  const sceneRef = useSceneVar();
  if (experience.length === 0 && education.length === 0) return null;

  /*
   * One list, two shapes. Tagging at merge time rather than rendering two lists
   * keeps the rail continuous — a second <ol> would restart the line and put a
   * seam in the middle of the travel.
   */
  const entries = [
    ...experience.map((item) => ({ kind: 'experience', item })),
    ...education.map((item) => ({ kind: 'education', item })),
  ];

  return (
    <section className="cx-act cx-record" id={id} data-tone="ink" ref={sceneRef}>
      <div className="cx-record-inner">
        <header className="cx-act-head">
          <span className="cx-eyebrow">{copy(content, 'cine.recordEyebrow', 'Record')}</span>
          <h2 className="cx-act-title">
            {copy(content, 'cine.recordTitle', 'Experience & education')}
          </h2>
        </header>

        <ol className="cx-rec-rail">
          <span className="cx-rec-line" aria-hidden="true">
            <span className="cx-rec-line-fill" />
          </span>

          {entries.map(({ kind, item }, index) =>
            kind === 'experience' ? (
              <Entry key={`x-${item.id ?? index}`} index={index}>
                <div className="cx-rec-head">
                  <h3 className="cx-rec-title">{item.title}</h3>
                  {item.period && <span className="cx-rec-period">{item.period}</span>}
                </div>

                {(item.organisation || item.location) && (
                  <p className="cx-rec-org">
                    {item.organisation}
                    {item.location && <span className="cx-rec-dim"> · {item.location}</span>}
                  </p>
                )}

                {/* Achievements read differently from roles, so they are flagged
                    rather than silently mixed into the same sequence. */}
                {item.kind === 'achievement' && (
                  <span className="cx-rec-badge">
                    {copy(content, 'cine.achievement', 'Achievement')}
                  </span>
                )}

                {item.description && <p className="cx-rec-desc">{item.description}</p>}

                {item.tech?.length > 0 && (
                  <ul className="cx-rec-tech">
                    {item.tech.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                )}

                {item.url && (
                  <a
                    className="cx-link"
                    href={externalUrl(item.url)}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {copy(content, 'cine.view', 'View')}
                    <ArrowUpRight width={13} height={13} />
                  </a>
                )}
              </Entry>
            ) : (
              <Entry key={`e-${item.id ?? index}`} index={index}>
                <div className="cx-rec-head">
                  <h3 className="cx-rec-title">
                    {[item.qualification, item.field].filter(Boolean).join(' · ') ||
                      item.institution}
                  </h3>
                  {item.period && <span className="cx-rec-period">{item.period}</span>}
                </div>

                <p className="cx-rec-org">
                  {item.institution}
                  {item.location && <span className="cx-rec-dim"> · {item.location}</span>}
                </p>

                {item.grade && <span className="cx-rec-badge">{item.grade}</span>}
                {item.description && <p className="cx-rec-desc">{item.description}</p>}
              </Entry>
            )
          )}
        </ol>
      </div>
    </section>
  );
}
