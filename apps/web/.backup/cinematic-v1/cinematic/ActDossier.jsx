import { copy, externalUrl } from '../lib/api.js';
import { useSceneVar, useEntered } from './lib/scene.js';
import Plaque from './Plaque.jsx';

/**
 * ACT II — DOSSIER.
 *
 * The statement act. One long line of type resolving word by word, then a strip
 * of plaques carrying the facts.
 *
 * Every plaque comes from data that already exists — profile fields, the live
 * status row, the length of the projects and stack collections. Nothing is
 * invented, and nothing is a hardcoded number that will quietly go stale: ship
 * a seventh project and the count says seven. Plaques whose source is empty do
 * not render at all, so a sparse database gives a shorter strip rather than a
 * row of blanks.
 */

/**
 * A fact in the strip along the bottom of the act. Named Fact rather than
 * Plaque because Plaque is the bordered caption card imported above, and the
 * two are different objects doing different jobs — this one is a label over a
 * value in a hairline grid.
 */
function Fact({ label, value, href, index }) {
  const [ref, entered] = useEntered({ threshold: 0.4 });
  if (!value) return null;

  const body = <span className="cx-plaque-value">{value}</span>;

  return (
    <li ref={ref} className="cx-plaque" data-in={entered || undefined} style={{ '--i': index }}>
      <span className="cx-plaque-label">{label}</span>
      {href ? (
        <a
          className="cx-plaque-link"
          href={externalUrl(href)}
          target="_blank"
          rel="noreferrer noopener"
        >
          {body}
        </a>
      ) : (
        body
      )}
    </li>
  );
}

export default function ActDossier({
  profile,
  status = {},
  projects = [],
  stack = [],
  content = {},
  id,
}) {
  const sceneRef = useSceneVar();
  const [headRef, headIn] = useEntered({ threshold: 0.3 });

  const statement = profile.headline || profile.description || '';
  const words = statement.split(/\s+/).filter(Boolean);
  const published = projects.filter((p) => p.published !== false);

  // Reads from the same two content keys the minimal status card uses, so
  // flipping the switch in admin changes both surfaces at once.
  const availability = status.available
    ? status.availabilityNote || copy(content, 'status.available', 'Available for work')
    : copy(content, 'status.unavailable', 'Currently unavailable');

  const progress = Math.min(100, Math.max(0, Number(status.currentProgress) || 0));

  const facts = [
    { label: copy(content, 'cine.factBased', 'Based in'), value: profile.location },
    { label: copy(content, 'cine.factStatus', 'Status'), value: availability },
    {
      label: copy(content, 'cine.factShipped', 'Shipped'),
      value: published.length ? `${published.length} projects` : '',
    },
    {
      label: copy(content, 'cine.factStack', 'Toolkit'),
      value: stack.length ? `${stack.length} technologies` : '',
    },
    { label: copy(content, 'cine.factZone', 'Timezone'), value: status.timezone },
  ];

  return (
    <section className="cx-act cx-dossier" id={id} data-tone="ink" ref={sceneRef}>
      <div className="cx-dossier-inner">
        <header className="cx-act-head">
          <span className="cx-eyebrow">{copy(content, 'cine.dossierEyebrow', 'The craft')}</span>
        </header>

        <h2 className="cx-statement" ref={headRef} data-in={headIn || undefined}>
          {words.map((word, i) => (
            <span className="cx-word" key={`${word}-${i}`} style={{ '--i': i }}>
              {/* The inner span is what moves. Animating the outer one would
                  need overflow:hidden on an inline box, which does not clip —
                  so the mask has to be a wrapper around a moving child. */}
              <span>{word}</span>
            </span>
          ))}
        </h2>

        {/* The one genuinely volatile line on the page, and it only renders when
            something is actually in flight. */}
        {status.currentProject && (
          <div className="cx-current">
            <span className="cx-eyebrow">
              {copy(content, 'cine.currently', 'Currently building')}
            </span>

            <p className="cx-current-name">
              {status.currentProjectUrl ? (
                <a
                  href={externalUrl(status.currentProjectUrl)}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {status.currentProject}
                </a>
              ) : (
                status.currentProject
              )}
            </p>

            <div
              className="cx-current-meter"
              role="meter"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${status.currentProject} progress`}
            >
              <span style={{ '--level': `${progress}%` }} />
              <em className="cx-current-pct">{progress}%</em>
            </div>
          </div>
        )}

        <Plaque side="right" top="18%" tilt={0.4}>
          {copy(
            content,
            'cine.plaque3',
            'The hall resolves. Columns, edges, the shape of a system taking form.'
          )}
        </Plaque>

        <ul className="cx-plaques">
          {facts.map((fact, index) => (
            <Fact key={fact.label} index={index} {...fact} />
          ))}
        </ul>
      </div>
    </section>
  );
}
