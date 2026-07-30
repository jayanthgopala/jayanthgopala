import { useState } from 'react';
import { Reveal, useTilt } from '../lib/motion.jsx';
import { mediaUrl, copy, externalUrl } from '../lib/api.js';
import { GitHubIcon, ArrowUpRight } from './Icons.jsx';
import Lightbox from './Lightbox.jsx';
import '../styles/projects.css';

function ProjectCard({ project, index, featuredLabel, onEnlarge }) {
  const tilt = useTilt({ max: 4 });

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

          <p className="project-summary">{project.summary || project.description}</p>

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
