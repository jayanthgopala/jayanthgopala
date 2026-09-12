import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Lenis from 'lenis';
import CrystalStage from './CrystalStage.jsx';
import { scramble } from './scramble.js';
import { clamp } from './util.js';
import { externalUrl, mediaUrl } from '../lib/api.js';
import '../styles/crystals.css';

/** Projects presented as interactive 3D crystals at /work. */

/** Screens of scroll per project. */
const STEP = 1.25;

/* Dev demo projects fallback */
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
      'A distributed job scheduler built around a write-ahead log and leased workers.\n\nJobs are delivered exactly once across restarts and partitions, with backoff, dead-lettering and a live dashboard.',
    tech: ['Go', 'Postgres', 'gRPC'],
    accent: 'iris',
    repoUrl: 'github.com/example/orbit',
  },
  {
    slug: 'glacier-cms',
    title: 'Glacier CMS',
    summary: 'Headless CMS on the edge, one binary, zero cold starts.',
    description: 'Content modelled as typed documents, served from edge KV with instant preview.',
    tech: ['TypeScript', 'Cloudflare', 'D1'],
    accent: 'mint',
    liveUrl: 'example.com',
  },
  {
    slug: 'signal-lens',
    title: 'Signal Lens',
    summary: 'Realtime log search over millions of lines a second.',
    description: 'Columnar ingestion, bloom-filtered segments and a query language that feels like grep.',
    tech: ['Rust', 'Kafka', 'React'],
    accent: 'amber',
    repoUrl: 'github.com/example/signal-lens',
  },
  {
    slug: 'north-ledger',
    title: 'North Ledger',
    summary: 'Double-entry accounting API with auditable history.',
    description: 'Immutable journal, idempotent postings and point-in-time balances.',
    tech: ['Python', 'FastAPI', 'Postgres'],
    accent: 'violet',
    liveUrl: 'example.com',
    repoUrl: 'github.com/example/north-ledger',
  },
];

const pad = (n) => String(n).padStart(2, '0');
const techLine = (p) => (p.tech || []).slice(0, 3).join(' / ').toUpperCase() || 'SYSTEM';
const teaser = (p) => {
  const t = (p.summary || p.description || '').toUpperCase().replace(/\s+/g, ' ');
  if (!t) return 'UNLISTED';
  return t.length > 26 ? `${t.slice(0, 26).trim()}…` : t;
};

export default function CrystalSite({ site = {}, loading = false }) {
  const projects = useMemo(() => {
    const live = (site.projects || []).filter((p) => p.published !== false);
    return live.length === 0 && DEMO ? DEMO_PROJECTS : live;
  }, [site.projects]);
  const count = projects.length;
  const countRef = useRef(count);
  countRef.current = count;

  /* Everything that changes per frame lives here and is read by the scene. */
  const shared = useRef({
    fTarget: 0,
    f: 0,
    velocity: 0,
    detail: 0,
    detailTarget: 0,
    intro: 0,
    started: false,
    hoverIndex: -1,
    units: {},
    labels: null,
    onExplore: null,
  });
  const lenisRef = useRef(null);

  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [open, setOpen] = useState(null);
  /* The last project opened — keeps the panel's content while it fades out. */
  const [shown, setShown] = useState(null);

  const wrapRef = useRef(null);
  const labelA = useRef(null);
  const labelB = useRef(null);
  const labelC = useRef(null);
  const lineA = useRef(null);
  const lineB = useRef(null);
  const lineC = useRef(null);
  const codeRef = useRef(null);
  const titleRef = useRef(null);
  const rotRef = useRef(null);
  const techRef = useRef(null);
  const idRef = useRef(null);
  const ctaRef = useRef(null);
  const descRef = useRef(null);
  const closeRef = useRef(null);
  const exploreRef = useRef(null);

  const hasProjects = count > 0;

  useEffect(() => {
    if (!hasProjects) return;
    shared.current.labels = {
      wrap: wrapRef.current,
      labels: [labelA.current, labelB.current, labelC.current],
      lines: [lineA.current, lineB.current, lineC.current],
      rot: rotRef.current,
    };
    shared.current.started = true;
  }, [hasProjects]);

  /* Scroll, snapping, and the two values the DOM needs as state. */
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lenis = new Lenis({ smoothWheel: !reduce, lerp: reduce ? 1 : 0.09, wheelMultiplier: 0.9 });
    lenisRef.current = lenis;

    let lastMove = 0;
    let snapUntil = 0;
    let activeNow = 0;
    let hoverNow = false;

    lenis.on('scroll', ({ scroll, limit, velocity }) => {
      const n = countRef.current;
      const p = limit > 0 ? clamp(scroll / limit, 0, 1) : 0;
      shared.current.fTarget = p * Math.max(0, n - 1);
      shared.current.velocity = clamp(velocity / 60, -1, 1);
      lastMove = performance.now();
    });

    let frame = requestAnimationFrame(function raf(time) {
      lenis.raf(time);
      const now = performance.now();
      const s = shared.current;
      const n = countRef.current;

      if (now - lastMove > 90) s.velocity *= 0.86;

      /* Settle on the nearest crystal once the wheel has stopped. */
      if (n > 1 && !lenis.isStopped && now > snapUntil && now - lastMove > 180 && !lenis.isScrolling) {
        const target = Math.round(s.fTarget);
        if (Math.abs(s.fTarget - target) > 0.003) {
          snapUntil = now + 1200;
          lenis.scrollTo((target / (n - 1)) * lenis.limit, { duration: 0.9 });
        }
      }

      /* Committed only on change, so the DOM re-renders once per crystal. */
      const a = n ? clamp(Math.round(s.f), 0, n - 1) : 0;
      if (a !== activeNow) {
        activeNow = a;
        setActive(a);
      }
      const h = s.hoverIndex === a && s.detailTarget === 0;
      if (h !== hoverNow) {
        hoverNow = h;
        setHovered(h);
      }

      frame = requestAnimationFrame(raf);
    });

    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, []);

  /* Immediate scroll jump for deep links and navigation */
  const jumpTo = useCallback((i) => {
    const lenis = lenisRef.current;
    const n = countRef.current;
    if (!lenis || n < 1) return;
    lenis.resize();
    lenis.scrollTo(n > 1 ? (i / (n - 1)) * lenis.limit : 0, { immediate: true, force: true });
    shared.current.fTarget = i;
    shared.current.f = i;
  }, []);

  const openDetail = useCallback(
    (i, { push = true } = {}) => {
      const p = projects[i];
      if (!p) return;
      const s = shared.current;
      s.detailTarget = 1;
      s.hoverIndex = -1;
      document.body.style.cursor = '';
      lenisRef.current?.stop();
      setOpen(i);
      setShown(i);
      if (push && p.slug && window.location.hash !== `#${p.slug}`) {
        window.history.pushState({ crystal: p.slug }, '', `#${p.slug}`);
      }
    },
    [projects]
  );

  const closeDetail = useCallback(({ fromHistory = false } = {}) => {
    const s = shared.current;
    if (s.detailTarget === 0) return;
    s.detailTarget = 0;
    lenisRef.current?.start();
    setOpen(null);
    if (!fromHistory) {
      if (window.history.state?.crystal) window.history.back();
      else if (window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }
    exploreRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    shared.current.onExplore = openDetail;
  }, [openDetail]);

  /* Deep link: /work#slug lands on that crystal, opened. */
  const linked = useRef(false);
  useEffect(() => {
    if (!hasProjects || linked.current) return undefined;
    linked.current = true;
    const slug = decodeURIComponent(window.location.hash.slice(1));
    const i = slug ? projects.findIndex((p) => p.slug === slug) : -1;
    if (i < 0) return undefined;
    const id = setTimeout(() => {
      jumpTo(i);
      openDetail(i, { push: false });
    }, 60);
    return () => clearTimeout(id);
  }, [hasProjects, projects, jumpTo, openDetail]);

  useEffect(() => {
    const onPop = () => {
      const slug = decodeURIComponent(window.location.hash.slice(1));
      const i = slug ? projects.findIndex((p) => p.slug === slug) : -1;
      if (i >= 0) {
        jumpTo(i);
        openDetail(i, { push: false });
      } else {
        closeDetail({ fromHistory: true });
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [projects, jumpTo, openDetail, closeDetail]);

  useEffect(() => {
    if (open === null) return undefined;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === 'Escape') closeDetail();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, closeDetail]);

  /* Labels decode in whenever the crystal changes. */
  useEffect(() => {
    const p = projects[active];
    if (!p) return undefined;
    const stops = [
      scramble(codeRef.current, `PROJECT_${pad(active + 1)}`, { duration: 500 }),
      scramble(titleRef.current, (p.title || '').toUpperCase(), { duration: 700, delay: 60 }),
      scramble(techRef.current, techLine(p), { duration: 700, delay: 120 }),
      scramble(idRef.current, `ID ${(p.slug || '').toUpperCase()}`, { duration: 600, delay: 80 }),
    ];
    return () => stops.forEach((stop) => stop());
  }, [active, projects]);

  useEffect(() => {
    const p = projects[active];
    if (!p) return undefined;
    return scramble(ctaRef.current, hovered ? 'CLICK TO EXPLORE' : teaser(p), { duration: 450 });
  }, [active, hovered, projects]);

  useEffect(() => {
    if (open === null) return undefined;
    const p = projects[open];
    return scramble(descRef.current, p?.description || p?.summary || '', { duration: 1100, delay: 380 });
  }, [open, projects]);

  const pages = count > 1 ? 1 + STEP * (count - 1) : 1;
  const d = shown !== null ? projects[shown] : null;
  const isOpen = open !== null;

  return (
    <>
      <CrystalStage projects={projects} shared={shared} />

      {hasProjects && (
        <div className="c-labels" ref={wrapRef} aria-hidden="true">
          <svg className="c-lines">
            <line ref={lineA} />
            <line ref={lineB} />
            <line ref={lineC} />
          </svg>
          <div className="c-label c-label--a" ref={labelA}>
            <div className="c-label-box">
              <span ref={codeRef} />
              <span ref={titleRef} />
            </div>
          </div>
          <div className="c-label c-label--b" ref={labelB}>
            <div className="c-label-box">
              <span className="c-label-row">
                <span>ROT</span>
                <span ref={rotRef} />
              </span>
              <span ref={techRef} />
            </div>
          </div>
          <div className="c-label c-label--c" ref={labelC}>
            <div className="c-label-box">
              <span ref={idRef} />
              <span ref={ctaRef} />
            </div>
          </div>
        </div>
      )}

      <div className={`c-hud${isOpen ? ' is-dim' : ''}`}>
        <header className="c-top">
          <div className="c-brand">
            <a className="c-back" href="/world">
              ← Igloo
            </a>
            <p className="c-mark">{site.profile?.name || 'Portfolio'}</p>
          </div>
          <p className="c-section">////// Work</p>
        </header>
        <footer className="c-bottom">
          <span className="c-count">
            {pad(hasProjects ? active + 1 : 0)} / {pad(count)}
          </span>
          {hasProjects && (
            <button
              ref={exploreRef}
              className="c-explore"
              type="button"
              onClick={() => openDetail(active)}
              tabIndex={isOpen ? -1 : 0}
            >
              [ Explore {projects[active]?.title} ]
            </button>
          )}
          <span className="c-hint">Scroll</span>
        </footer>
      </div>

      <div className={`c-fog${hasProjects ? ' is-clear' : ''}`} aria-hidden={hasProjects}>
        <p>{loading ? 'Loading' : hasProjects ? '' : 'No projects published yet'}</p>
      </div>

      <section
        className={`c-detail${isOpen ? ' is-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-hidden={!isOpen}
        aria-label={d?.title}
        data-lenis-prevent
      >
        <button
          ref={closeRef}
          className="c-close"
          type="button"
          onClick={() => closeDetail()}
          tabIndex={isOpen ? 0 : -1}
        >
          Close
        </button>
        {d && (
          <div className="c-detail-col">
            <p className="c-rule">////// PROJECT_{pad(shown + 1)}</p>
            <h2 className="c-detail-title">{d.title}</h2>
            <p className="c-rule">////// Summary</p>
            <p className="c-detail-body" ref={descRef} />
            {d.tech?.length > 0 && (
              <>
                <p className="c-rule">/// Stack</p>
                <ul className="c-tech">
                  {d.tech.map((t) => (
                    <li key={t}>[{t}]</li>
                  ))}
                </ul>
              </>
            )}
            {d.screenshot && (
              <img className="c-shot" src={mediaUrl(d.screenshot)} alt={`${d.title} screenshot`} loading="lazy" />
            )}
            {(d.liveUrl || d.repoUrl) && (
              <>
                <p className="c-rule">/// Visit</p>
                <p className="c-links">
                  {d.liveUrl && (
                    <a href={externalUrl(d.liveUrl)} target="_blank" rel="noreferrer noopener">
                      [live] ↗
                    </a>
                  )}
                  {d.repoUrl && (
                    <a href={externalUrl(d.repoUrl)} target="_blank" rel="noreferrer noopener">
                      [github] ↗
                    </a>
                  )}
                </p>
              </>
            )}
          </div>
        )}
      </section>

      <div className="c-spacer" style={{ height: `${pages * 100}vh` }} aria-hidden="true" />
    </>
  );
}
