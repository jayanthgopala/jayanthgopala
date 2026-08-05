import { useId, useState } from 'react';
import { Reveal, useTilt } from '../lib/motion.jsx';
import { mediaUrl, copy, externalUrl } from '../lib/api.js';
import { GitHubIcon, ArrowUpRight, ChevronDown, ExpandIcon } from './Icons.jsx';
import Lightbox from './Lightbox.jsx';
import '../styles/projects.css';

function ProjectCard({ project, index, featuredLabel, labels, onEnlarge }) {
  const tilt = useTilt({ max: 4 });
  const [open, setOpen] = useState(false);
  const panelId = useId();

  /*
   * The card leads with `summary`, falling back to `description` when there is
   * no summary. So the disclosure is only meaningful when `description` holds
   * something the card is not already showing — otherwise it would expand to a
   * duplicate of the line above it.
   */
  /*
   * Click feedback. Fired on pointer *down* rather than click so the animation
   * runs during the natural press-and-release, instead of delaying the lightbox
   * to make room for itself.
   */
  function pressFeedback(e) {
    const btn = e.currentTarget;
    const box = btn.getBoundingClientRect();
    btn.style.setProperty('--px', `${e.clientX - box.left}px`);
    btn.style.setProperty('--py', `${e.clientY - box.top}px`);
    // Clearing the attribute and forcing a reflow before setting it again is
    // the only reliable way to replay a CSS animation on a repeated click.
    btn.removeAttribute('data-press');
    void btn.offsetWidth;
    btn.setAttribute('data-press', '');
  }

  const shown = project.summary || project.description;
  const hasDetails = Boolean(project.description) && project.description !== shown;

  return (
    <Reveal delay={Math.min(index, 3) * 90}>
      <article
        ref={tilt.ref}
        onPointerMove={tilt.onPointerMove}
        onPointerLeave={tilt.onPointerLeave}
        className="project card gradient-border"
        data-accent={project.accent || 'iris'}
      >
        <div className="project-media">
          {project.screenshot ? (
            <button
              type="button"
              className="project-media-btn"
              onPointerDown={pressFeedback}
              onClick={() => onEnlarge(mediaUrl(project.screenshot), `${project.title} screenshot`)}
              aria-label={`Enlarge ${project.title} screenshot`}
            >
              <img
                src={mediaUrl(project.screenshot)}
                alt={`${project.title} screenshot`}
                loading="lazy"
                decoding="async"
                width="800"
                height="500"
              />
              {/* Standing affordance — the image is a button, and nothing else
                  on the card says so. Visible at rest rather than on hover,
                  which touch devices never get. */}
              <span className="project-zoom" aria-hidden="true">
                <ExpandIcon width={14} height={14} />
              </span>
              <span className="project-ripple" aria-hidden="true" />
            </button>
          ) : (
            /* No screenshot uploaded yet — an accent-tinted placeholder keeps
               the grid rhythm instead of collapsing the card. */
            <div className="project-media-empty" aria-hidden="true">
              <span>{project.title?.[0] || '·'}</span>
            </div>
          )}
          <span className="project-sheen" aria-hidden="true" />
        </div>

        <div className="project-body">
          <div className="project-heading">
            <h3 className="project-title">{project.title}</h3>
            {project.featured && <span className="project-flag">{featuredLabel}</span>}
          </div>

          <p className="project-summary">{shown}</p>

          {hasDetails && (
            <div className="project-details" data-open={open || undefined}>
              <button
                type="button"
                className="project-details-toggle"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpen((v) => !v)}
              >
                <span className="project-details-rule" aria-hidden="true" />
                <span className="project-details-label">
                  {open ? labels.detailsLess : labels.details}
                </span>
                <ChevronDown className="project-details-chevron" width={14} height={14} />
              </button>

              <div className="project-details-panel" id={panelId}>
                {/* The clipping wrapper carries no spacing of its own — padding
                    on the grid item itself survives the collapsed row and
                    leaves a visible gap. */}
                <div className="project-details-inner">
                  <p>{project.description}</p>
                </div>
              </div>
            </div>
          )}

          {project.tech?.length > 0 && (
            <ul className="project-tech">
              {project.tech.map((tech) => (
                <li key={tech} className="pill project-tech-item">
                  {tech}
                </li>
              ))}
            </ul>
          )}

          <div className="project-links">
            {project.liveUrl && (
              <a
                className="project-link project-link-primary"
                href={externalUrl(project.liveUrl)}
                target="_blank"
                rel="noreferrer noopener"
              >
                Live Demo <ArrowUpRight width={15} height={15} />
              </a>
            )}
            {project.repoUrl && (
              <a
                className="project-link"
                href={externalUrl(project.repoUrl)}
                target="_blank"
                rel="noreferrer noopener"
              >
                <GitHubIcon width={15} height={15} /> GitHub
              </a>
            )}
          </div>
        </div>
      </article>
    </Reveal>
  );
}

export default function Projects({ projects = [], loading, content = {} }) {
  const [enlarged, setEnlarged] = useState(null);
  const onEnlarge = (src, alt) => setEnlarged({ src, alt });
  const featured = projects.filter((p) => p.published !== false);
  const featuredLabel = copy(content, 'projects.featured', 'Featured');
  const labels = {
    details: copy(content, 'projects.details', 'Details'),
    detailsLess: copy(content, 'projects.detailsLess', 'Hide details'),
  };

  return (
    <section className="section" id="projects">
      <div className="container">
        <div className="section-head">
          <Reveal>
            <span className="eyebrow">{copy(content, 'projects.eyebrow', 'Selected work')}</span>
          </Reveal>
          <Reveal delay={70}>
            <h2 className="h2">{copy(content, 'projects.title', 'Featured projects')}</h2>
          </Reveal>
          <Reveal delay={140}>
            <p className="lead">
              {copy(content, 'projects.lead', 'Systems I’ve designed, built and shipped end to end.')}
            </p>
          </Reveal>
        </div>

        {loading ? (
          <div className="project-grid">
            {[0, 1].map((i) => (
              <div key={i} className="project card project-skeleton" />
            ))}
          </div>
        ) : featured.length === 0 ? (
          <p className="lead">{copy(content, 'projects.empty', 'No projects published yet.')}</p>
        ) : (
          <div className="project-grid">
            {featured.map((project, index) => (
              <ProjectCard
                key={project.id ?? project.slug}
                project={project}
                index={index}
                featuredLabel={featuredLabel}
                labels={labels}
                onEnlarge={onEnlarge}
              />
            ))}
          </div>
        )}
      </div>

      <Lightbox src={enlarged?.src} alt={enlarged?.alt} onClose={() => setEnlarged(null)} />
    </section>
  );
}
