import { useState } from 'react';
import { copy, externalUrl } from '../lib/api.js';
import { GitHubIcon, ArrowUpRight } from '../components/Icons.jsx';
import { useSceneVar, useEntered } from './lib/scene.js';

const pad = (n) => String(n + 1).padStart(2, '0');

/**
 * ACT III — THE WORK.
 *
 * One project, one shot. Each gets its own scene with a sticky stage, so a
 * project holds the whole screen for its beat instead of scrolling past as a
 * card in a grid. That is the biggest single difference between this and
 * minimal mode's project list, and it is what makes the work read as a body of
 * case studies rather than a portfolio wall.
 *
 * Everything is driven by the row: title, summary, description, tech, links,
 * screenshot and accent all come from the database. Adding a project in the
 * admin panel adds a shot, and the contact sheet, the counter and the rail all
 * recount themselves. Every field is optional and every one is guarded, because
 * a half-filled row is the normal state of a project the moment it is created.
 */

/**
 * One project's beat.
 *
 * The screenshot is NOT rendered here — it is a texture on the slab orbiting
 * the figure. What lives in the DOM is the caption: a bordered plaque carrying
 * the title and a short summary, plus an arrow that opens the rest.
 *
 * Putting the copy in a plaque rather than setting it loose on the page is what
 * keeps it readable over a moving 3D scene without dropping a scrim behind it,
 * and it is the reference's own device.
 */
function Shot({ project, index, total, labels, hovered, opened, onSelect }) {
  const sceneRef = useSceneVar();
  const [bodyRef, entered] = useEntered({ threshold: 0.2 });

  const summary = project.summary || project.description || '';
  // Only offer the disclosure when the long copy says something the summary
  // does not, or it expands to a duplicate of the line above it.
  const detail =
    project.description && project.description !== summary ? project.description : '';

  const isOpen = opened === index;
  const isHot = hovered === index;

  return (
    <article
      className="cx-shot"
      id={`work-${project.slug || project.id || index}`}
      ref={sceneRef}
    >
      <div className="cx-shot-stage">
        <figure
          className="cx-card"
          ref={bodyRef}
          data-in={entered || undefined}
          data-hot={isHot || undefined}
          data-open={isOpen || undefined}
        >
          <header className="cx-card-head">
            <span className="cx-card-index">
              {pad(index)}
              <em>/{pad(total - 1)}</em>
            </span>
            {project.featured && <span className="cx-card-flag">{labels.featured}</span>}
          </header>

          <h3 className="cx-card-title">{project.title}</h3>

          {summary && <p className="cx-card-summary">{summary}</p>}

          {project.tech?.length > 0 && (
            <ul className="cx-card-tech">
              {project.tech.slice(0, 6).map((tech) => (
                <li key={tech}>{tech}</li>
              ))}
            </ul>
          )}

          {detail && (
            <>
              {/* The grid-row trick: 0fr to 1fr animates a height the browser
                  can actually interpolate, which `height: auto` is not. The
                  inner wrapper carries the spacing, because padding on the grid
                  item itself survives the collapsed row and leaves a gap. */}
              <div className="cx-card-more" id={`more-${index}`}>
                <div>
                  <p>{detail}</p>
                </div>
              </div>

              <button
                type="button"
                className="cx-card-toggle"
                aria-expanded={isOpen}
                aria-controls={`more-${index}`}
                onClick={() => onSelect(index)}
              >
                <span>{isOpen ? labels.less : labels.more}</span>
                <ArrowUpRight className="cx-card-arrow" width={14} height={14} />
              </button>
            </>
          )}

          <div className="cx-card-links">
            {project.liveUrl && (
              <a
                className="cx-link cx-link-primary"
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
                className="cx-link"
                href={externalUrl(project.repoUrl)}
                target="_blank"
                rel="noreferrer noopener"
              >
                <GitHubIcon width={13} height={13} />
                {labels.source}
              </a>
            )}
          </div>
        </figure>
      </div>
    </article>
  );
}

/**
 * The contact sheet: every shot listed before the sequence starts.
 *
 * A pinned sequence costs a viewport of scroll per project, which is exactly
 * what makes it feel cinematic and exactly what makes it slow to skim. This is
 * the escape hatch — jump to a project, or just see how many there are before
 * committing to the scroll.
 */
function ContactSheet({ projects, labels }) {
  const [ref, entered] = useEntered({ threshold: 0.3 });
  const [hover, setHover] = useState(-1);

  return (
    <ol className="cx-sheet" ref={ref} data-in={entered || undefined} onPointerLeave={() => setHover(-1)}>
      {projects.map((project, index) => (
        <li key={project.id ?? project.slug} style={{ '--i': index }}>
          <a
            className="cx-sheet-row"
            href={`#work-${project.slug || project.id || index}`}
            data-dim={hover > -1 && hover !== index ? '' : undefined}
            onPointerEnter={() => setHover(index)}
            onFocus={() => setHover(index)}
            onBlur={() => setHover(-1)}
          >
            <span className="cx-sheet-index">{pad(index)}</span>
            <span className="cx-sheet-title">{project.title}</span>
            <span className="cx-sheet-tech">{(project.tech || []).slice(0, 3).join(' · ')}</span>
            <span className="cx-sheet-arrow" aria-hidden="true">
              <ArrowUpRight width={14} height={14} />
            </span>
          </a>
        </li>
      ))}

      {projects.length === 0 && <li className="cx-sheet-empty">{labels.empty}</li>}
    </ol>
  );
}

export default function ActWork({
  projects = [],
  loading,
  content = {},
  id,
  hovered = -1,
  opened = -1,
  onSelect = () => {},
}) {
  const labels = {
    featured: copy(content, 'projects.featured', 'Featured'),
    empty: copy(content, 'projects.empty', 'No projects published yet.'),
    live: copy(content, 'cine.live', 'Live'),
    source: copy(content, 'cine.source', 'Source'),
    more: copy(content, 'cine.more', 'More'),
    less: copy(content, 'cine.less', 'Less'),
  };

  const published = projects.filter((p) => p.published !== false);

  return (
    <section className="cx-act cx-work" id={id} data-tone="paper">
      <div className="cx-work-intro">
        <header className="cx-act-head">
          <span className="cx-eyebrow">{copy(content, 'projects.eyebrow', 'Selected work')}</span>
          <h2 className="cx-act-title">{copy(content, 'projects.title', 'Featured projects')}</h2>
          <p className="cx-act-lead">
            {copy(content, 'projects.lead', 'Systems I’ve designed, built and shipped end to end.')}
          </p>
        </header>

        {loading ? (
          <ol className="cx-sheet" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <li key={i} style={{ '--i': i }}>
                <span className="cx-sheet-row cx-sheet-skeleton" />
              </li>
            ))}
          </ol>
        ) : (
          <ContactSheet projects={published} labels={labels} />
        )}
      </div>

      {published.map((project, index) => (
        <Shot
          key={project.id ?? project.slug}
          project={project}
          index={index}
          total={published.length}
          labels={labels}
          hovered={hovered}
          opened={opened}
          onSelect={onSelect}
        />
      ))}
    </section>
  );
}
