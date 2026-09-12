import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useWorldScroll } from './scroll/ScrollProvider.jsx';
import { CUT_PARALLAX } from './chapters.js';
import { scramble } from '../crystals/scramble.js';
import { externalUrl, mediaUrl } from '../lib/api.js';

// DOM-based project showcase displayed after the world scroll transition
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const pad = (n) => String(n).padStart(2, '0');

// Local dev mock data fallback
const DEMO =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('demo');

const DEMO_PROJECTS = [
  {
    slug: 'orbit-scheduler',
    title: 'Orbit Scheduler',
    summary: 'Distributed job scheduler with exactly-once delivery.',
    description: 'Jobs are delivered exactly once across restarts and partitions, with backoff and dead-lettering.',
    tech: ['Go', 'Postgres', 'gRPC'],
    repoUrl: 'github.com/example/orbit',
  },
  {
    slug: 'glacier-cms',
    title: 'Glacier CMS',
    summary: 'Headless CMS on the edge, one binary, zero cold starts.',
    tech: ['TypeScript', 'Cloudflare', 'D1'],
    liveUrl: 'example.com',
  },
  {
    slug: 'signal-lens',
    title: 'Signal Lens',
    summary: 'Realtime log search over millions of lines a second.',
    tech: ['Rust', 'Kafka', 'React'],
    liveUrl: 'example.com',
    repoUrl: 'github.com/example/signal-lens',
  },
];

// Text element that triggers character decode scramble animation when revealed
function Decoded({ as: Tag = 'span', text, className, arrival, delay = 0 }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    if (ref.current) ref.current.textContent = text;
  }, [text]);

  useEffect(() => {
    if (arrival === 0) return undefined;
    return scramble(ref.current, text, { delay });
  }, [arrival, text, delay]);

  return <Tag ref={ref} className={className} aria-label={text} />;
}

export default function WorkPage({ projects = [] }) {
  const { cut, page, setPageHeight } = useWorldScroll();
  const layerRef = useRef(null);
  const colRef = useRef(null);
  const [live, setLive] = useState(false);
  const [arrival, setArrival] = useState(0);

  const list = (DEMO && projects.length === 0 ? DEMO_PROJECTS : projects).filter(
    (p) => p.published !== false
  );

  // Syncs rendered column height to scroll provider
  useEffect(() => {
    const col = colRef.current;
    if (!col) return undefined;
    const observer = new ResizeObserver(() => setPageHeight(col.offsetHeight));
    observer.observe(col);
    return () => observer.disconnect();
  }, [setPageHeight]);

  // Frame animation loop updating parallax position and opacity during cut
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let isLive = false;
    let arrived = false;

    const tick = () => {
      const c = cut.current;
      const layer = layerRef.current;
      const col = colRef.current;

      if (layer && col) {
        const q = 1 - c;
        const rise = reduced ? 0 : CUT_PARALLAX * q * q * window.innerHeight;
        col.style.transform = `translate3d(0, ${(rise - page.current).toFixed(2)}px, 0)`;
        layer.style.opacity = (reduced ? c : smoothstep(0.55, 0.95, c)).toFixed(3);
      }

      // Enable pointer interaction once transition is past half mark
      const nextLive = c >= 0.5;
      if (nextLive !== isLive) {
        isLive = nextLive;
        setLive(nextLive);
      }

      // Trigger text decode once near completion
      if (!arrived && c >= 0.85) {
        arrived = true;
        setArrival((n) => n + 1);
      } else if (arrived && c < 0.5) {
        arrived = false;
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [cut, page]);

  return (
    <section
      ref={layerRef}
      className={`w-work${live ? ' is-live' : ''}`}
      inert={!live}
      aria-label="Selected work"
    >
      <div ref={colRef} className="w-work-col">
        <p className="w-work-rule">////// Selected work</p>
        <p className="w-work-intro">
          {list.length > 0 ? `${pad(list.length)} projects` : 'Index'}
        </p>

        {list.length === 0 ? (
          <p className="w-work-empty">No projects published yet.</p>
        ) : (
          list.map((project, i) => {
            const title = project.title || 'Untitled';
            const tech = project.tech || [];
            const hasDescription = project.description && project.description !== project.summary;
            const hasLinks = project.liveUrl || project.repoUrl;

            return (
              <article key={project.id ?? project.slug ?? i} className="w-work-item">
                <Decoded
                  as="p"
                  className="w-work-code"
                  text={`PROJECT_${pad(i + 1)}`}
                  arrival={arrival}
                  delay={i * 90}
                />
                <Decoded
                  as="h2"
                  className="w-work-title"
                  text={title}
                  arrival={arrival}
                  delay={120 + i * 90}
                />

                {project.summary && <p className="w-work-lead">{project.summary}</p>}
                {hasDescription && <p className="w-work-body">{project.description}</p>}

                {tech.length > 0 && (
                  <>
                    <p className="w-work-rule">/// Stack</p>
                    <ul className="w-work-tech">
                      {tech.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </>
                )}

                {project.screenshot && (
                  <img
                    className="w-work-shot"
                    src={mediaUrl(project.screenshot)}
                    alt={`${title} screenshot`}
                    loading="lazy"
                    decoding="async"
                    width="800"
                    height="500"
                  />
                )}

                {hasLinks && (
                  <>
                    <p className="w-work-rule">/// Visit</p>
                    <p className="w-work-links">
                      {project.liveUrl && (
                        <a href={externalUrl(project.liveUrl)} target="_blank" rel="noreferrer noopener">
                          [ Live ]
                        </a>
                      )}
                      {project.repoUrl && (
                        <a href={externalUrl(project.repoUrl)} target="_blank" rel="noreferrer noopener">
                          [ Source ]
                        </a>
                      )}
                    </p>
                  </>
                )}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
