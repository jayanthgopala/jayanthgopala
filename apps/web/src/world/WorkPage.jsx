import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useWorldScroll } from './scroll/ScrollProvider.jsx';
import { CUT_PARALLAX } from './chapters.js';
import { scramble } from '../crystals/scramble.js';
import { externalUrl, mediaUrl } from '../lib/api.js';

/**
 * The page the cut lands on: the projects, as a plain column of text.
 *
 * TEXT ONLY. The ground under it — the pale ice and its dot grid — is drawn on
 * the canvas by IceCut, so the wipe can reveal it; this layer is transparent
 * and sits between the canvas and the HUD. Real text, real links, selectable
 * and findable, for the same reason the HUD is DOM (see WorldSite).
 *
 * IT RIDES THE CUT. While the wipe runs, the column is pushed down by exactly
 * the parallax the shader applies to the ground, so text and ground rise
 * together as one page. After the cut the column scrolls by the scroll that
 * remains, and the ground stays put — the reference's room does not scroll
 * either; the things in it move.
 *
 * Everything that changes per frame is written straight to the nodes, the
 * same way the HUD's progress bar is.
 */

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const pad = (n) => String(n).padStart(2, '0');

/*
 * Dev only: /world?demo fills the page with sample projects when the API is
 * not reachable locally, the same switch /work has. import.meta.env.DEV is
 * false in a production build, so none of this ships.
 */
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

/**
 * A line whose text decodes out of noise on arrival.
 *
 * The node has no React children on purpose. scramble() owns its textContent
 * while it runs, and a text node React thinks it owns but that has been
 * replaced underneath it is a text node React can no longer update.
 */
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
  /* Both of these change a handful of times per visit, never per frame. */
  const [live, setLive] = useState(false);
  const [arrival, setArrival] = useState(0);

  const list = (DEMO && projects.length === 0 ? DEMO_PROJECTS : projects).filter(
    (p) => p.published !== false
  );

  /* The page's length is the last stretch of the scroll extent, so the
     provider has to know it — and it changes when projects load and when
     screenshots arrive. */
  useEffect(() => {
    const col = colRef.current;
    if (!col) return undefined;
    const observer = new ResizeObserver(() => setPageHeight(col.offsetHeight));
    observer.observe(col);
    return () => observer.disconnect();
  }, [setPageHeight]);

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
        /* Positive is down: the shader samples the ground from above, which
           shows it lower on screen, by this share of the frame. */
        const rise = reduced ? 0 : CUT_PARALLAX * q * q * window.innerHeight;
        col.style.transform = `translate3d(0, ${(rise - page.current).toFixed(2)}px, 0)`;
        /* The text arrives after the ground, the way the reference's labels
           come in once the room has settled. */
        layer.style.opacity = (reduced ? c : smoothstep(0.55, 0.95, c)).toFixed(3);
      }

      /* Half-way is where the page is more there than not. Before it the
         layer is inert, so Tab never lands on a link nobody can see. */
      const nextLive = c >= 0.5;
      if (nextLive !== isLive) {
        isLive = nextLive;
        setLive(nextLive);
      }

      /* Decode on every arrival, re-armed once the page has been left. */
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
