import { copy, externalUrl } from '../lib/api.js';
import { SocialIcon, ArrowUpRight } from '../components/Icons.jsx';
import { useReveal } from './lib/reveal.js';
import BrushLayer from './BrushLayer.jsx';

/**
 * The three list sections: the path, the toolkit and the close.
 *
 * They share this file because they share one idea — a stack of entries
 * separated by brush strokes rather than by borders — and splitting three
 * variations of the same twenty lines across three files would hide that.
 *
 * What none of them have: cards, surfaces, rounded corners, pills or a box
 * around anything. Separation comes from space and from a painted rule, which
 * is what an editorial page uses and what a dashboard does not.
 */

/** A painted divider. Far cheaper than it looks: one narrow band of bundles. */
function Rule({ seed }) {
  return <BrushLayer className="cx-rule" seed={seed} count={3} band={[300, 400]} weight={0.7} />;
}

function Row({ children, index }) {
  const [ref, shown] = useReveal({ threshold: 0.3 });

  return (
    <li ref={ref} className="cx-row" data-in={shown || undefined} style={{ '--i': index }}>
      {index > 0 && <Rule seed={30 + index} />}
      <div className="cx-row-body">{children}</div>
    </li>
  );
}

/**
 * Experience and education on one rail.
 *
 * Merged rather than rendered as two sections: they are one chronology, and
 * giving each its own heading and its own furniture doubles the chrome to say
 * the same thing twice.
 */
export function PathRail({ experience = [], education = [], content = {} }) {
  const entries = [
    ...experience.map((item) => ({ kind: 'role', item })),
    ...education.map((item) => ({ kind: 'study', item })),
  ];

  if (entries.length === 0) return null;

  return (
    <ol className="cx-rows">
      {entries.map(({ kind, item }, index) => (
        <Row key={`${kind}-${item.id ?? index}`} index={index}>
          <div className="cx-row-lead">
            {item.period && <span className="cx-meta-single">{item.period}</span>}
          </div>

          <div className="cx-row-main">
            <h3 className="cx-row-title">
              {kind === 'role'
                ? item.title
                : [item.qualification, item.field].filter(Boolean).join(' · ') ||
                  item.institution}
            </h3>

            <p className="cx-row-org">
              {kind === 'role' ? item.organisation : item.institution}
              {item.location && <span className="cx-dim"> · {item.location}</span>}
            </p>

            {/* Achievements read differently from roles, so they are flagged
                rather than silently mixed into the same sequence. */}
            {item.kind === 'achievement' && (
              <span className="cx-meta-single cx-accent">
                {copy(content, 'cine.achievement', 'Achievement')}
              </span>
            )}
            {item.grade && <span className="cx-meta-single cx-accent">{item.grade}</span>}

            {item.description && <p className="cx-row-desc">{item.description}</p>}

            {item.tech?.length > 0 && (
              <ul className="cx-meta">
                {item.tech.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            )}

            {item.url && (
              <a
                className="cx-underline"
                href={externalUrl(item.url)}
                target="_blank"
                rel="noreferrer noopener"
              >
                {copy(content, 'cine.view', 'View')}
                <ArrowUpRight width={13} height={13} />
              </a>
            )}
          </div>
        </Row>
      ))}
    </ol>
  );
}

/**
 * The toolkit, as columns of plain names.
 *
 * No meters. The proficiency numbers exist in the database and minimal mode
 * shows them, but a row of progress bars is the single most dashboard-like
 * element a portfolio can contain, and this section is a list of what the work
 * is made of rather than a self-assessment.
 */
export function StackColumns({ stack = [] }) {
  if (stack.length === 0) return null;

  const grouped = stack.reduce((acc, item) => {
    const key = item.category || 'Other';
    (acc[key] ||= []).push(item);
    return acc;
  }, {});

  return (
    <div className="cx-stack">
      {Object.entries(grouped).map(([category, items], index) => (
        <StackColumn key={category} category={category} items={items} index={index} />
      ))}
    </div>
  );
}

function StackColumn({ category, items, index }) {
  const [ref, shown] = useReveal({ threshold: 0.25 });

  return (
    <div ref={ref} className="cx-stack-col" data-in={shown || undefined} style={{ '--i': index }}>
      <span className="cx-eyebrow">{category}</span>
      <ul className="cx-stack-list">
        {items.map((item) => (
          <li key={item.id ?? item.name}>{item.name}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The close. The email address is the largest thing in the section, because
 * after a page this long the one thing a visitor might want to do should not be
 * behind a button labelled "Contact".
 */
export function ContactBlock({ profile, socials = [], content = {} }) {
  const [ref, shown] = useReveal({ threshold: 0.2 });

  return (
    <div ref={ref} className="cx-contact" data-in={shown || undefined}>
      {profile.email && (
        <a className="cx-mail" href={`mailto:${profile.email}`}>
          {profile.email}
        </a>
      )}

      {socials.length > 0 && (
        <ul className="cx-socials">
          {socials.map((social) => (
            <li key={social.id ?? social.url}>
              <a
                href={externalUrl(social.url)}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={social.label}
              >
                <SocialIcon icon={social.icon} />
                <span>{social.label}</span>
              </a>
            </li>
          ))}
        </ul>
      )}

      <p className="cx-colophon">
        © {new Date().getFullYear()} {profile.name}
        {copy(content, 'footer.note', '') && ` · ${copy(content, 'footer.note', '')}`}
      </p>
    </div>
  );
}
