import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useWorldScroll } from './scroll/ScrollProvider.jsx';
import { scramble } from '../crystals/scramble.js';
import { copy, externalUrl, mediaUrl } from '../lib/api.js';
import WaterStage from './water/WaterStage.jsx';
import { shapeFor } from './water/shapes.js';

// The project index, shown as water in the shape of each project's initial.
// Scrolling moves between projects; clicking opens the one on screen.

const pad = (n) => String(n).padStart(2, '0');

/**
 * Viewports of scroll spent on the introduction before the first project.
 *
 * More than one because a single screen goes past in one flick — the reader
 * gets no chance to notice there was anything to read.
 */
const ABOUT_SPAN = 1.6;

/**
 * How hard the page pulls toward where the scroll actually is, per second.
 *
 * Lenis smooths the document's scroll, but the object's position was being read
 * straight off it, so a flick still stepped through several projects in a few
 * frames. Following the scroll rather than tracking it exactly is what makes
 * the objects glide, and it also means a fast flick has to travel through the
 * introduction instead of skipping over it.
 */
const FOLLOW = 4.2;

/**
 * Ceiling on how fast the page may travel, in projects per second.
 *
 * Damping alone does not solve a hard flick: an exponential follow moves
 * fastest exactly when the gap is largest, so a throw from the top of the page
 * crossed the introduction in about a tenth of a second — read as skipping it.
 * Capping the rate means a flick still arrives quickly but has to pass through
 * everything on the way, which is the only way the introduction can be sure of
 * being seen.
 */
const MAX_RATE = 1.6;

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

// Stands in when the API has nothing to give, so the opening is not an empty
// frame with a heading on it while the work is being looked at locally.
const DEMO_PROFILE = {
  name: 'Jayanth Gopala V',
  role: 'Software Engineer',
  location: 'Asia / Banglore',
  description:
    'I build systems that hold up when they are leaned on — schedulers that deliver exactly once, content that compiles to immutable bundles, search that answers while the slowest shard is still thinking. Mostly backend, mostly distributed, and increasingly the rendering that puts a face on it.',
};

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

  // One effect, and a layout one.
  //
  // Painting the finished text here and starting the scramble from a passive
  // effect meant the browser drew the real name first and only then began
  // garbling it — the effect played backwards. Running before paint means the
  // glyphs are what lands, and the name is what they resolve into.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (!arrival) {
      el.textContent = text;
      return undefined;
    }
    return scramble(el, text, { delay });
  }, [arrival, text, delay]);

  return <Tag ref={ref} className={className} aria-label={text} />;
}

const stamp = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
};

/**
 * The instrument labels around the object.
 *
 * Everything shown is the project's own data rather than invented telemetry —
 * the style is borrowed, the readings are not, which keeps it from reading as
 * decoration pretending to be information.
 */
function Readout({ project, number, total, hint, boxRef }) {
  const date = stamp(project.updatedAt || project.createdAt);
  const stack = project.tech?.length || 0;

  // Keyed on the index by its caller, so this remounts per project and the
  // decode runs once, on arrival.
  const arrival = 1;

  return (
    <div className="w-readout" ref={boxRef} aria-hidden="true">
      {/* pathLength normalises every path to 1, so one dash rule draws them all
          at the same rate regardless of how long each actually is. */}
      <svg className="w-readout-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path pathLength="1" d="M 46 34 L 38 21 L 26 21" />
        <path pathLength="1" d="M 62 39 L 74 39" />
        <path pathLength="1" d="M 60 62 L 72 70" />
      </svg>

      <p className="w-readout-code">
        <Decoded
          text={`PORTFOLIO_CO_${pad(number)}`}
          arrival={arrival}
          delay={80}
        />
        <Decoded
          as="span"
          className="w-readout-name"
          text={(project.title || 'Untitled').toUpperCase()}
          arrival={arrival}
          delay={140}
        />
      </p>

      <p className="w-readout-stat">
        <span>STACK</span> {pad(stack)}
        <br />
        <span>IDX</span> {pad(number)} / {pad(total)}
      </p>

      <p className="w-readout-cta">
        {date && <span className="w-readout-date">D {date}</span>}
        <span className="w-readout-go">{hint}</span>
      </p>
    </div>
  );
}

// Introductory about section displayed before project list
function About({ profile, content, boxRef, shown = true }) {
  const p = profile?.name ? profile : DEMO_PROFILE;
  const name = p.name || '';
  const role = p.role || '';
  const body = p.description || p.headline || '';

  return (
    <section className={`w-about${shown ? ' is-in' : ''}`} ref={boxRef} aria-label="About">
      <p className="w-about-rule">////// {copy(content, 'world.aboutEyebrow', 'About')}</p>
      {name && <h2 className="w-about-name">{name}</h2>}
      {role && <p className="w-about-role">{role}</p>}
      {body && <p className="w-about-body">{body}</p>}

      <p className="w-about-meta">
        {p.location && <span>{p.location}</span>}
        <span>{copy(content, 'world.aboutNext', 'Scroll for selected work')}</span>
      </p>
    </section>
  );
}

// Everything a project has to say, revealed only on request.
function Detail({ project, number, onClose }) {
  // Mounted fresh each time a project is opened, so the decode runs once from
  // the first paint rather than being triggered after one.
  const arrival = 1;
  const closeRef = useRef(null);

  useEffect(() => {
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

export default function WorkPage({ projects = [], content = {}, profile = {} }) {
  const { cut, page, setPageHeight, lenis } = useWorldScroll();
  const layerRef = useRef(null);
  const [live, setLive] = useState(false);
  const [mounted, setMounted] = useState(false);
  // The introduction waits for the cut to finish rather than riding in on it.
  // Mounting it earlier started its arrival while the page was still opening,
  // so on a slow cut the text was already there before the page was.
  const [opened, setOpened] = useState(false);
  const [index, setIndex] = useState(0);
  // Which project has actually come to rest under the camera, or null while one
  // is still travelling. The labels exist only for the former, so they are
  // drawn on arrival rather than dragged along for the ride.
  const [arrived, setArrived] = useState(null);
  const [open, setOpen] = useState(null);

  // Pause world scroll when project detail is open
  useEffect(() => {
    if (!open) return undefined;
    lenis.current?.stop();
    return () => {
      lenis.current?.start();
    };
  }, [open, lenis]);
  // Continuous scroll position through the list. The integer part selects which
  // two objects exist; the fraction drives the slide, read every frame by the
  // stage so the motion tracks the wheel instead of replaying a fixed tween.
  const position = useRef(0);
  // Where the object sits on screen, in 0..1, written by the stage each frame
  // and read back here to place the labels on it.
  const anchor = useRef({ x: 0.5, y: 0.5, whole: true });
  const readoutRef = useRef(null);
  const aboutRef = useRef(null);
  const reduced = useReducedMotion();

  const list = useMemo(() => {
    const real = projects.filter((p) => p.published !== false);
    // In development an empty list means the API is not running or the database
    // is bare, and an empty page teaches nothing about how this looks. Standing
    // in automatically is more useful than an instruction to add ?demo.
    if (DEV && (FORCE_DEMO || real.length === 0)) return DEMO_PROJECTS;
    return real;
  }, [projects]);

  // Each project's object, falling back by position so one that has not been
  // given a shape in the admin still renders as something.
  const shapes = useMemo(() => list.map((p, i) => shapeFor(p, i)), [list]);

  // One viewport of scroll per project, so the objects change at a readable
  // rate rather than flicking past.
  useEffect(() => {
    const apply = () =>
      setPageHeight((Math.max(1, list.length) + ABOUT_SPAN) * window.innerHeight);
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
    let hasOpened = false;
    let shown = 0;
    let settledAt = null;
    let eased = null; // Damped follower of the raw scroll position.
    let last = performance.now();

    const tick = (now) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;

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

      const nextStage = c >= 0.04;
      if (nextStage !== hasStage) {
        hasStage = nextStage;
        setMounted(nextStage);
      }

      const nextOpened = c >= 0.65;
      if (nextOpened !== hasOpened) {
        hasOpened = nextOpened;
        setOpened(nextOpened);
      }

      const step = Math.max(1, window.innerHeight);
      // Keep scroll anchored at introduction until cut has finished opening
      const scrolled = nextOpened
        ? Math.min(Math.max(list.length - 1, 0), page.current / step - ABOUT_SPAN)
        : -ABOUT_SPAN;
      const target = scrolled;

      // Exponential follow, framed in dt so the glide is the same length at any
      // refresh rate. It always starts at the introduction rather than at
      // wherever the scroll has already reached: the first objects take a moment
      // to build, and anything scrolled during that wait would otherwise land
      // the reader straight on the last project.
      if (eased === null) eased = -ABOUT_SPAN;
      const pull = (target - eased) * (1 - Math.exp(-FOLLOW * dt));
      const limit = MAX_RATE * dt;
      eased += Math.max(-limit, Math.min(limit, pull));
      const raw = eased;
      position.current = raw;

      // Reveal introduction promptly once the page finishes opening
      const about = aboutRef.current;
      if (about) {
        const gone = smoothstep(-ABOUT_SPAN + 0.1, -0.15, raw);
        const arriving = smoothstep(0.55, 0.72, c);
        about.style.opacity = ((1 - gone) * arriving).toFixed(3);
        about.style.transform =
          `translate(-50%, -50%) translateY(${(-gone * 12).toFixed(2)}vh)`;
        about.style.visibility = gone >= 1 || arriving <= 0 ? 'hidden' : 'visible';
      }

      // Labels ride the object rather than the viewport.
      const labels = readoutRef.current;
      if (labels) {
        const { x, y } = anchor.current;
        labels.style.setProperty('--ax', `${(x * 100).toFixed(2)}%`);
        labels.style.setProperty('--ay', `${(y * 100).toFixed(2)}%`);
      }

      // Display instrument readout when an object is in view and past intro
      const nearest = Math.round(raw);
      const isAtProject = raw > -0.45 && (anchor.current?.whole || Math.abs(raw - nearest) < 0.45);
      const nextSettled = isAtProject ? Math.min(Math.max(nearest, 0), Math.max(list.length - 1, 0)) : null;
      if (nextSettled !== settledAt) {
        settledAt = nextSettled;
        setArrived(nextSettled);
      }

      const whole = Math.max(0, Math.floor(raw));
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
          shapes={shapes}
          index={index}
          position={position}
          anchor={anchor}
          onOpen={onOpen}
        />
      )}

      {mounted && (
        <About
          profile={profile}
          content={content}
          boxRef={aboutRef}
          shown={opened}
        />
      )}

      {list.length === 0 && <p className="w-work-empty">No projects published yet.</p>}

      {list.length > 0 && !open && (
        <>
          {arrived !== null && list[arrived] && (
            <Readout
              boxRef={readoutRef}
              key={arrived}
              project={list[arrived]}
              number={arrived + 1}
              total={list.length}
              hint={copy(content, 'world.jarGo', 'Click to explore')}
            />
          )}
          <p className="w-water-hint" aria-hidden="true">
            {copy(content, 'world.jarHint', 'Scroll to browse · Drag to turn')}
          </p>
        </>
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
