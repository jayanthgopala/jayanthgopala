import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useWorldScroll } from './scroll/ScrollProvider.jsx';
import { scramble } from '../crystals/scramble.js';
import { copy, externalUrl, mediaUrl } from '../lib/api.js';
import WaterStage from './water/WaterStage.jsx';
import { initialOf } from './water/glyph.js';

// The project index, shown as water in the shape of each project's initial.
// Scrolling moves between projects; clicking opens the one on screen.

const pad = (n) => String(n).padStart(2, '0');

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

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
    description:
      'Jobs are delivered exactly once across restarts and partitions, with backoff and dead-lettering. A lease table in Postgres does the arbitration, so there is no separate coordinator to lose.',
    tech: ['Go', 'Postgres', 'gRPC'],
    repoUrl: 'github.com/example/orbit',
  },
  {
    slug: 'glacier-cms',
    title: 'Glacier CMS',
    summary: 'Headless CMS on the edge, one binary, zero cold starts.',
    description:
      'Content is compiled to immutable bundles at publish time, so a read is a cache hit and nothing touches the database on the request path.',
    tech: ['TypeScript', 'Cloudflare', 'D1'],
    liveUrl: 'example.com',
  },
  {
    slug: 'signal-lens',
    title: 'Signal Lens',
    summary: 'Realtime log search over millions of lines a second.',
    description:
      'An inverted index kept in memory per shard, with a bloom filter in front so a miss costs nothing. Queries stream results as they land rather than waiting for the slowest shard.',
    tech: ['Rust', 'Kafka', 'React'],
    liveUrl: 'example.com',
    repoUrl: 'github.com/example/signal-lens',
  },
  {
    slug: 'meridian',
    title: 'Meridian',
    summary: 'Timezone-aware scheduling that survives DST.',
    description:
      'Stores intent rather than instants, so a 09:00 standup stays at 09:00 when the clocks move. Every recurrence is re-resolved against the current tz database.',
    tech: ['TypeScript', 'Temporal API', 'SQLite'],
    repoUrl: 'github.com/example/meridian',
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
    slug: 'bedrock',
    title: 'Bedrock',
    summary: 'Schema migrations with no downtime and no locks.',
    description:
      'Expand and contract, driven from a declarative target schema. The planner refuses any step that would take an exclusive lock on a hot table.',
    tech: ['Python', 'Postgres'],
    repoUrl: 'github.com/example/bedrock',
  },
  {
    slug: 'ilium',
    title: 'Ilium',
    summary: 'A tiny dependency-free plotting library.',
    tech: ['TypeScript', 'Canvas'],
    repoUrl: 'github.com/example/ilium',
  },
  {
    slug: 'drift-detector',
    title: 'Drift Detector',
    summary: 'Catches infrastructure that no longer matches its definition.',
    description:
      'Walks the live cloud account nightly and diffs it against the committed Terraform state, opening one pull request per divergence instead of a wall of alerts.',
    tech: ['Go', 'Terraform', 'AWS'],
    liveUrl: 'example.com',
    repoUrl: 'github.com/example/drift',
  },
  {
    slug: 'katabatic',
    title: 'Katabatic',
    summary: 'Backpressure-aware queue for slow consumers.',
    description:
      'Producers are slowed at the source rather than buffered into oblivion, so a stalled consumer degrades throughput instead of exhausting memory.',
    tech: ['Rust', 'Redis'],
    repoUrl: 'github.com/example/katabatic',
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
  const reduced = useReducedMotion();

  const list = useMemo(
    () =>
      // ?demo wins outright rather than only filling an empty list, so the
      // stand-ins are reachable while there is real content too. Dev only.
      (DEMO ? DEMO_PROJECTS : projects).filter(
        (p) => p.published !== false
      ),
    [projects]
  );

  const letters = useMemo(() => list.map((p, i) => initialOf(p, i)), [list]);

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
        layer.style.opacity = (reduced ? c : smoothstep(0.55, 0.95, c)).toFixed(3);
      }

      const nextLive = c >= 0.5;
      if (nextLive !== isLive) {
        isLive = nextLive;
        setLive(nextLive);
      }

      const nextStage = c >= 0.35;
      if (nextStage !== hasStage) {
        hasStage = nextStage;
        setMounted(nextStage);
      }

      const step = Math.max(1, window.innerHeight);
      const next = Math.min(
        Math.max(list.length - 1, 0),
        Math.max(0, Math.round(page.current / step))
      );
      if (next !== shown) {
        shown = next;
        setIndex(next);
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [cut, page, reduced, list.length]);

  const onOpen = useCallback(() => {
    setOpen((current) => (current ? current : list[index] ?? null));
  }, [list, index]);

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
