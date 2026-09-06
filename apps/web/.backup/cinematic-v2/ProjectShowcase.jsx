import { useState } from 'react';
import { mediaUrl, externalUrl, copy } from '../lib/api.js';
import { GitHubIcon, ArrowUpRight } from '../components/Icons.jsx';
import Lightbox from '../components/Lightbox.jsx';
import { useReveal } from './lib/reveal.js';

/**
 * A project as an editorial spread rather than a card.
 *
 * The composition alternates: odd entries put the plate left and the copy
 * right, even entries reverse it. That single rule is what stops a list of
 * projects reading as a grid — a column of identically-arranged blocks is a
 * table however large you set the type.
 *
 * The plate is the dominant element and the words behave like a magazine
 * caption: a number, a very large title, one paragraph, and a rule of small
 * tracked-out metadata. There are no borders, no rounded corners, no pills and
 * no surface behind anything, because every one of those is what makes a
 * portfolio look like a dashboard.
 *
 * Every field is optional and every one is guarded — a half-filled row is the
 * normal state of a project the moment it is created.
 */
function Entry({ project, index, labels, onEnlarge }) {
  const [ref, shown] = useReveal({ threshold: 0.12 });

  const shot = project.screenshot ? mediaUrl(project.screenshot) : '';
  const summary = project.summary || project.description || '';

  return (
    <article
      ref={ref}
      className="cx-work-entry"
      data-in={shown || undefined}
      data-flip={index % 2 === 1 || undefined}
    >
      <div className="cx-work-plate">
        {shot ? (
          <button
            type="button"
            className="cx-work-plate-btn"
            onClick={() => onEnlarge(shot, `${project.title} screenshot`)}
            aria-label={`Enlarge ${project.title} screenshot`}
          >
            <img src={shot} alt={`${project.title} screenshot`} loading="lazy" decoding="async" />
          </button>
        ) : (
          /* No screenshot yet. An accent-free initial keeps the spread's rhythm
             instead of collapsing the entry to a column of text. */
          <div className="cx-work-plate-empty" aria-hidden="true">
            <span>{project.title?.[0] || '·'}</span>
          </div>
        )}
      </div>

      <div className="cx-work-copy">
        <span className="cx-work-index" aria-hidden="true">
          {String(index + 1).padStart(2, '0')}
        </span>

        <h3 className="cx-work-title">{project.title}</h3>

        {summary && <p className="cx-work-summary">{summary}</p>}

        {project.tech?.length > 0 && (
          <ul className="cx-meta">
            {project.tech.slice(0, 6).map((tech) => (
              <li key={tech}>{tech}</li>
            ))}
          </ul>
        )}

        {(project.liveUrl || project.repoUrl) && (
          <div className="cx-work-links">
            {project.liveUrl && (
              <a
                className="cx-underline"
                href={externalUrl(project.liveUrl)}
                target="_blank"
                rel="noreferrer noopener"
              >
                {labels.live}
                <ArrowUpRight width={13} height={13} />
              </a>
            )}
            {project.repoUrl && (
              <a
                className="cx-underline"
                href={externalUrl(project.repoUrl)}
                target="_blank"
                rel="noreferrer noopener"
              >
                <GitHubIcon width={13} height={13} />
                {labels.source}
              </a>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

export default function ProjectShowcase({ projects = [], loading, content = {} }) {
  const [enlarged, setEnlarged] = useState(null);

  const labels = {
    live: copy(content, 'cine.live', 'Live'),
    source: copy(content, 'cine.source', 'Source'),
    empty: copy(content, 'projects.empty', 'No projects published yet.'),
  };

  const published = projects.filter((p) => p.published !== false);

  if (loading) {
    return (
      <div className="cx-work-list" aria-busy="true">
        {[0, 1].map((i) => (
          <div key={i} className="cx-work-entry cx-work-skeleton" data-flip={i % 2 === 1 || undefined} />
        ))}
      </div>
    );
  }

  if (published.length === 0) return <p className="cx-lead">{labels.empty}</p>;

  return (
    <>
      <div className="cx-work-list">
        {published.map((project, index) => (
          <Entry
            key={project.id ?? project.slug}
            project={project}
            index={index}
            labels={labels}
            onEnlarge={(src, alt) => setEnlarged({ src, alt })}
          />
        ))}
      </div>

      <Lightbox src={enlarged?.src} alt={enlarged?.alt} onClose={() => setEnlarged(null)} />
    </>
  );
}
