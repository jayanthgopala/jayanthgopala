import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useWorldScroll } from './scroll/ScrollProvider.jsx';
import { scramble } from '../crystals/scramble.js';
import { copy, externalUrl, mediaUrl } from '../lib/api.js';
import WaterStage from './water/WaterStage.jsx';
import { labelsFor } from './water/glyph.js';

// The project index, shown as water in the shape of each project's initial.
// Scrolling moves between projects; clicking opens the one on screen.

const pad = (n) => String(n).padStart(2, '0');

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Local dev mock data. Never reaches a production build.
const DEV = import.meta.env.DEV;

// ?demo forces the stand-ins even when real projects exist, for comparing the
// two. Without it they are only a fallback — see below.
const FORCE_DEMO =
  DEV &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('demo');

const DEMO_PROJECTS = [
  {
    slug: 'orbit-scheduler',
    title: 'Orbit Scheduler',
    summary: 'Distributed job scheduler with exactly-once delivery.',
    description:
      'Jobs are delivered exactly once across restarts and partitions, with backoff and dead-lettering. A lease table in Postgres does the arbitration, so there is no separate coordinator to lose.',
    tech: ['Go', 'Postgres', 'gRPC'],
    liveUrl: 'example.com',
    repoUrl: 'github.com/example/orbit',
  },
  {
    slug: 'bedrock',
    title: 'Bedrock',
    summary: 'Schema migrations with no downtime and no locks.',
    description:
      'Expand and contract, driven from a declarative target schema. The planner refuses any step that would take an exclusive lock on a hot table.',
    tech: ['Python', 'Postgres'],
    repoUrl: 'github.com/example/bedrock',
  },
  {
    slug: 'whiteout',
    title: 'Whiteout',
    summary: 'Chaos testing for edge workers.',
    description:
      'Injects latency, partitions and cold starts into a staging deployment, then asserts the SLO held. Failures replay deterministically from the recorded seed.',
    tech: ['Go', 'Workers', 'OpenTelemetry'],
    liveUrl: 'example.com',
  },
  {
    slug: 'ilium',
    title: 'Ilium',
    summary: 'A tiny dependency-free plotting library.',
    tech: ['TypeScript', 'Canvas'],
    repoUrl: 'github.com/example/ilium',
  },
];

// Tracks the preference live, so toggling it in devtools settles the water
// without a reload.
function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

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

// Everything a project has to say, revealed only on request.
function Detail({ project, number, onClose }) {
  const [arrival, setArrival] = useState(0);
  const closeRef = useRef(null);

  useEffect(() => {
    setArrival((n) => n + 1);
    closeRef.current?.focus();
  }, [project]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const tech = project.tech || [];
  const hasDescription = project.description && project.description !== project.summary;
  const hasLinks = project.liveUrl || project.repoUrl;

  return (
    <div className="w-detail" role="dialog" aria-modal="true" aria-label={project.title}>
      <div className="w-detail-panel">
        <button
          ref={closeRef}
          type="button"
          className="w-detail-close"
          onClick={onClose}
          aria-label="Close project"
        >
          [ Close ]
        </button>

        <Decoded as="p" className="w-work-code" text={`PROJECT_${pad(number)}`} arrival={arrival} />
        <Decoded
          as="h2"
          className="w-work-title"
          text={project.title || 'Untitled'}
          arrival={arrival}
          delay={120}
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
            alt={`${project.title} screenshot`}
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
      </div>
    </div>
  );
}

export default function WorkPage({ projects = [], content = {} }) {
  const { cut, page, setPageHeight } = useWorldScroll();
  const layerRef = useRef(null);
  const [live, setLive] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(null);
  // Continuous scroll position through the list. The integer part selects which
  // two letters exist; the fraction drives the slide, read every frame by the
  // stage so the motion tracks the wheel instead of replaying a fixed tween.
  const position = useRef(0);
  const reduced = useReducedMotion();

  const list = useMemo(() => {
    const real = projects.filter((p) => p.published !== false);
    // In development an empty list means the API is not running or the database
    // is bare, and an empty page teaches nothing about how this looks. Standing
    // in automatically is more useful than an instruction to add ?demo.
    if (DEV && (FORCE_DEMO || real.length === 0)) return DEMO_PROJECTS;
    return real;
  }, [projects]);

  // Shortest prefix that tells each project apart from the others.
  const letters = useMemo(() => labelsFor(list), [list]);

  // One viewport of scroll per project, so the letters change at a readable
  // rate rather than flicking past.
  useEffect(() => {
    const apply = () => setPageHeight(Math.max(1, list.length) * window.innerHeight);
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [list.length, setPageHeight]);

  // Frame loop: fade the layer in with the cut, and read the current project
  // off the page scroll.
  useEffect(() => {
    let frame = 0;
    let isLive = false;
    let hasStage = false;
    let shown = 0;

    const tick = () => {
      const c = cut.current;
      const layer = layerRef.current;

      if (layer) {
        layer.style.opacity = (reduced ? c : smoothstep(0.22, 0.55, c)).toFixed(3);
      }

      const nextLive = c >= 0.3;
      if (nextLive !== isLive) {
        isLive = nextLive;
        setLive(nextLive);
      }

      const nextStage = c >= 0.15;
      if (nextStage !== hasStage) {
        hasStage = nextStage;
        setMounted(nextStage);
      }

      const step = Math.max(1, window.innerHeight);
      const raw = Math.min(
        Math.max(list.length - 1, 0),
        Math.max(0, page.current / step)
      );
      position.current = raw;

      const whole = Math.floor(raw);
      if (whole !== shown) {
        shown = whole;
        setIndex(whole);
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [cut, page, reduced, list.length]);

  const onOpen = useCallback(() => {
    // Mid-slide the letter on screen is the nearer of the two, not the one the
    // integer index happens to name.
    const focused = Math.round(position.current);
    setOpen((current) => (current ? current : list[focused] ?? null));
  }, [list]);

  const onClose = useCallback(() => setOpen(null), []);

  return (
    <section
      ref={layerRef}
      className={`w-work${live ? ' is-live' : ''}`}
      inert={!live}
      aria-label="Selected work"
    >
      {mounted && list.length > 0 && (
        <WaterStage
          active={live && !open}
          calm={reduced}
          letters={letters}
          index={index}
          position={position}
          onOpen={onOpen}
        />
      )}

      {list.length === 0 && <p className="w-work-empty">No projects published yet.</p>}

      {list.length > 0 && !open && (
        <p className="w-water-hint" aria-hidden="true">
          {copy(content, 'world.jarHint', 'Scroll to browse · Click to open')}
        </p>
      )}

      {open && (
        <Detail
          project={open}
          number={list.indexOf(open) + 1}
          onClose={onClose}
        />
      )}
    </section>
  );
}
