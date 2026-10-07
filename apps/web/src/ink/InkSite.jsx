import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Reveal } from '../lib/motion.jsx';
import { copy, externalUrl, mediaUrl } from '../lib/api.js';
import Lightbox from '../components/Lightbox.jsx';
import '../styles/ink.css';

/**
 * The minimal site: an ink-on-paper editorial page. Everything the admin
 * manages comes from the API; where a section has no entries yet, it falls
 * back to the defaults below, or leaves the section out.
 */

// Shown until experience entries are added in the admin.
const DEFAULT_EXPERIENCE = [
  {
    id: 'arventiq',
    title: 'Software Engineer',
    organisation: 'ArventiqLabs',
    period: 'Present',
    description:
      'Building production-level examination and assessment platforms — scalable systems across frontend, backend, databases, and cloud infrastructure.',
  },
  {
    id: 'independent',
    title: 'Web Developer',
    organisation: 'Independent',
    period: '',
    description: 'Designed and delivered the Shree Vani PU College website — a responsive institutional site.',
  },
];

const pad = (n) => String(n).padStart(2, '0');

// Thin red reading-progress bar along the top edge.
function Progress() {
  const bar = useRef(null);
  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - window.innerHeight || 1;
      const p = Math.min(1, Math.max(0, window.scrollY / max));
      if (bar.current) bar.current.style.transform = `scaleX(${p})`;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return <div ref={bar} className="ink-progress" aria-hidden="true" />;
}

function Eyebrow({ n, children }) {
  return (
    <div className="ink-eyebrow">
      {pad(n)} — {children}
    </div>
  );
}

function Header({ name, content }) {
  const [first, ...rest] = name.split(' ');
  return (
    <header className="ink-header">
      <a href="#home" className="ink-brand">
        <span className="ink-monogram">{first?.[0] || 'J'}</span>
        <span className="ink-brand-name">
          {first}
          <br />
          <span>{rest.join(' ')}</span>
        </span>
      </a>
      <nav className="ink-header-links">
        <a href="/world" className="ink-btn ink-btn-ghost">
          {copy(content, 'nav.immersive', 'Immersive').toUpperCase()}
        </a>
        <a href="#contact" className="ink-btn">
          {copy(content, 'nav.contact', 'Contact').toUpperCase()}
        </a>
      </nav>
    </header>
  );
}

// "Scroll to begin" rides along at the foot of the screen and fades out over
// the first part of the scroll, drifting down a little as it goes.
function ScrollCue() {
  const cue = useRef(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const t = Math.min(1, window.scrollY / (window.innerHeight * 0.45));
      const node = cue.current;
      if (!node) return;
      node.style.opacity = String(1 - t);
      node.style.transform = `translateY(${t * 24}px)`;
      node.style.visibility = t >= 1 ? 'hidden' : 'visible';
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <div ref={cue} className="ink-scroll" aria-hidden="true">
      <div className="ink-scroll-float">
        <span>SCROLL TO BEGIN</span>
        <span className="ink-scroll-line" />
      </div>
    </div>
  );
}

function Hero({ profile }) {
  const name = (profile.name || 'Jayanth Gopala V').toUpperCase();
  return (
    <section id="home" className="ink-hero">
      <svg className="ink-stroke ink-stroke-a" viewBox="0 0 200 60" aria-hidden="true">
        <path d="M2 40 Q60 8 120 34 T198 20" strokeWidth="2" />
        <path d="M10 52 Q70 30 140 48" strokeWidth="1.4" />
      </svg>
      <svg className="ink-stroke ink-stroke-b" viewBox="0 0 200 60" aria-hidden="true">
        <path d="M2 30 Q70 54 130 24 T198 40" strokeWidth="2" />
      </svg>

      <Reveal className="ink-kicker">
        <span className="ink-rule" />
        {profile.role || 'Software Engineer'} — Design + Engineering
        <span className="ink-rule" />
      </Reveal>
      <Reveal as="h1" delay={80} className="ink-title">
        <span className="ink-title-the">
          <span className="ink-title-dash" />
          The
          <span className="ink-title-dash" />
        </span>
        <span className="ink-title-name">{name}</span>
        <em className="ink-title-tail">Experience</em>
      </Reveal>
      <Reveal as="p" delay={160} className="ink-lede">
        {profile.headline}
      </Reveal>
      <ScrollCue />
    </section>
  );
}

function About({ profile, content }) {
  const portrait = mediaUrl(profile.cinematicAvatarUrl || profile.avatarUrl);
  return (
    <section id="about" className="ink-about">
      <div className="ink-about-grid">
        <Reveal className="ink-card ink-about-note ink-about-note-a">
          <Eyebrow n={1}>ABOUT</Eyebrow>
          <p>{profile.description}</p>
        </Reveal>
        <Reveal delay={100} className="ink-portrait">
          {portrait ? (
            <img src={portrait} alt={profile.name} loading="lazy" decoding="async" />
          ) : (
            <span className="ink-portrait-empty">{profile.name?.[0]}</span>
          )}
        </Reveal>
        <Reveal delay={200} className="ink-card ink-about-note ink-about-note-b">
          <p>
            {copy(
              content,
              'about.more',
              'I build and deploy real-world software used by organizations and students — across frontend, backend, databases, cloud, APIs, security, and architecture.'
            )}
          </p>
        </Reveal>
      </div>
    </section>
  );
}

function Rows({ items, heading }) {
  return (
    <div className="ink-rows">
      {items.map((x, i) => (
        <Reveal key={x.id ?? i} delay={60 + i * 80} className="ink-row">
          <div className="ink-row-period">{(x.period || '').toUpperCase()}</div>
          <div>
            <h3>{heading(x)}</h3>
            {x.description && <p>{x.description}</p>}
          </div>
        </Reveal>
      ))}
    </div>
  );
}

function Work({ experience }) {
  const jobs = experience.filter((x) => x.kind !== 'achievement');
  const items = jobs.length > 0 ? jobs : DEFAULT_EXPERIENCE;
  return (
    <section id="work" className="ink-section">
      <Reveal className="ink-chapter">
        Chapter II — <em>The Work</em>
      </Reveal>
      <Rows items={items} heading={(x) => [x.title, x.organisation].filter(Boolean).join(' · ')} />
    </section>
  );
}

// A project's summary, clamped to a few lines. When there is more to read
// (a longer description, or a summary the clamp cuts off), "Read more" opens
// the project's dossier.
function Description({ short, full, onOpen }) {
  const [clipped, setClipped] = useState(false);
  const text = useRef(null);
  const longer = Boolean(full) && full !== short;

  useLayoutEffect(() => {
    const p = text.current;
    if (p) setClipped(p.scrollHeight > p.clientHeight + 1);
  }, [short]);

  const more = longer || clipped;
  return (
    <div className="ink-desc">
      <p ref={text} className="is-clamped">
        {short}
      </p>
      {more && (
        <button type="button" className="ink-desc-more" onClick={onOpen}>
          READ MORE
          <span className="ink-desc-sign" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

const DOSSIER_OUT_MS = 260;

// The full project, on a paper card over a pale wash: rises in, sinks out.
function Dossier({ project, index, n, onClose }) {
  const [leaving, setLeaving] = useState(false);
  const closeRef = useRef(null);
  const timer = useRef(0);

  const close = () => {
    if (leaving) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      onClose();
      return;
    }
    setLeaving(true);
    timer.current = window.setTimeout(onClose, DOSSIER_OUT_MS);
  };

  useEffect(() => {
    const back = document.activeElement;
    closeRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      window.clearTimeout(timer.current);
      if (back instanceof HTMLElement) back.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const p = project;
  const body = (p.description || p.summary || '').split(/\n\s*\n/).filter(Boolean);
  const live = externalUrl(p.liveUrl || '');
  const repo = externalUrl(p.repoUrl || '');

  return (
    <div
      className={`ink-dossier${leaving ? ' is-leaving' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ink-dossier-title"
      onClick={close}
    >
      {/* The frame holds the close button still while the card scrolls. */}
      <div className="ink-dossier-frame" onClick={(e) => e.stopPropagation()}>
      <button ref={closeRef} type="button" className="ink-dossier-close" onClick={close} aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <article className="ink-dossier-card">

        <div className="ink-eyebrow">
          {pad(n)} — ARTIFACT · {pad(index + 1)}
        </div>
        <h3 id="ink-dossier-title" className="ink-dossier-title">
          {p.title}
        </h3>
        <span className="ink-dossier-rule" aria-hidden="true" />

        <div className="ink-dossier-body">
          {body.map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>

        {p.tech?.length > 0 && (
          <ul className="ink-chips ink-dossier-tech">
            {p.tech.map((t) => (
              <li key={t} className="ink-chip">
                {t}
              </li>
            ))}
          </ul>
        )}

        {(live || repo) && (
          <div className="ink-dossier-links">
            {live && (
              <a className="ink-btn" href={live} target="_blank" rel="noreferrer noopener">
                VISIT LIVE ↗
              </a>
            )}
            {repo && (
              <a className="ink-btn ink-btn-ghost" href={repo} target="_blank" rel="noreferrer noopener">
                SOURCE ↗
              </a>
            )}
          </div>
        )}
      </article>
      </div>
    </div>
  );
}

function Artifacts({ projects, loading, n }) {
  const shown = projects.filter((p) => p.published !== false);
  const [enlarged, setEnlarged] = useState(null);
  const [reading, setReading] = useState(null);
  return (
    <section id="projects" className="ink-section">
      <Reveal className="ink-head">
        <Eyebrow n={n}>SELECTED PROJECTS</Eyebrow>
        <h2>The Artifacts</h2>
      </Reveal>
      <div className="ink-artifacts">
        {loading
          ? [0, 1, 2].map((i) => <div key={i} className="ink-frame ink-skeleton" />)
          : shown.map((p, i) => {
              const link = externalUrl(p.liveUrl || p.repoUrl || '');
              return (
                <Reveal key={p.id ?? p.slug} delay={50 + i * 80} className="ink-artifact">
                  <div className="ink-frame">
                    {p.screenshot ? (
                      <button
                        type="button"
                        className="ink-frame-btn"
                        onClick={() => setEnlarged({ src: mediaUrl(p.screenshot), alt: `${p.title} screenshot` })}
                        aria-label={`Open ${p.title} screenshot`}
                      >
                        <img src={mediaUrl(p.screenshot)} alt={`${p.title} screenshot`} loading="lazy" decoding="async" />
                      </button>
                    ) : (
                      <span className="ink-frame-empty">{p.title?.[0]}</span>
                    )}
                  </div>
                  <h3>
                    {link ? (
                      <a href={link} target="_blank" rel="noreferrer noopener">
                        {p.title} ↗
                      </a>
                    ) : (
                      p.title
                    )}
                  </h3>
                  <Description short={p.summary || p.description} full={p.description} onOpen={() => setReading(i)} />
                  {p.tech?.length > 0 && <div className="ink-tech">{p.tech.slice(0, 6).join(' · ').toUpperCase()}</div>}
                </Reveal>
              );
            })}
      </div>
      <Lightbox src={enlarged?.src} alt={enlarged?.alt} onClose={() => setEnlarged(null)} />
      {reading !== null && shown[reading] && (
        <Dossier project={shown[reading]} index={reading} n={n} onClose={() => setReading(null)} />
      )}
    </section>
  );
}

function Skills({ stack, n }) {
  if (stack.length === 0) return null;
  const grouped = stack.reduce((acc, item) => {
    (acc[item.category || 'Other'] ||= []).push(item);
    return acc;
  }, {});
  return (
    <section id="skills" className="ink-section">
      <Reveal className="ink-head">
        <Eyebrow n={n}>SKILLS</Eyebrow>
        <h2>The Tools of the Trade</h2>
      </Reveal>
      <div className="ink-skills">
        {Object.entries(grouped).map(([category, items], i) => (
          <Reveal key={category} delay={(i % 4) * 80}>
            <div className="ink-skill-label">{category.toUpperCase()}</div>
            <ul className="ink-chips">
              {items.map((item) => (
                <li key={item.id ?? item.name} className="ink-chip">
                  {item.name}
                </li>
              ))}
            </ul>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Achievements({ experience, n }) {
  const marks = experience.filter((x) => x.kind === 'achievement');
  if (marks.length === 0) return null;
  return (
    <section id="achievements" className="ink-section">
      <Reveal className="ink-head">
        <Eyebrow n={n}>ACHIEVEMENTS</Eyebrow>
        <h2>Marks Along the Way</h2>
      </Reveal>
      <div className="ink-marks">
        {marks.map((m, i) => (
          <Reveal key={m.id ?? i} delay={i * 100} className="ink-mark">
            <div className="ink-mark-tag">◆ {(m.period || m.organisation || 'ACHIEVEMENT').toUpperCase()}</div>
            <h4>{m.title}</h4>
            {m.description && <p>{m.description}</p>}
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// Only shown once education entries exist in the admin panel.
function Origins({ education, n }) {
  if (education.length === 0) return null;
  return (
    <section id="education" className="ink-section">
      <Reveal className="ink-head">
        <Eyebrow n={n}>EDUCATION</Eyebrow>
        <h2>Origins</h2>
      </Reveal>
      <Rows
        items={education}
        heading={(e) => [[e.qualification, e.field].filter(Boolean).join(' '), e.institution].filter(Boolean).join(' · ')}
      />
    </section>
  );
}

function Contact({ profile, socials, n }) {
  // The email gets its own button, so drop any email entry among the socials.
  const links = socials.filter((s) => s.url && !/^mailto:/i.test(s.url) && !/mail/i.test(s.icon || ''));
  return (
    <section id="contact" className="ink-contact">
      <Reveal className="ink-eyebrow">{pad(n)} — CONTACT · THE END, OR THE BEGINNING</Reveal>
      <Reveal as="h2" delay={80} className="ink-sign">
        Let&rsquo;s build
        <br />
        <em>something.</em>
      </Reveal>
      <div className="ink-contact-links">
        {profile.email && (
          <Reveal as="a" delay={100} href={`mailto:${profile.email}`} className="ink-btn ink-btn-lg">
            {profile.email}
          </Reveal>
        )}
        {links.map((s, i) => (
          <Reveal
            as="a"
            key={s.id ?? s.url}
            delay={160 + i * 60}
            href={externalUrl(s.url)}
            target="_blank"
            rel="noreferrer noopener"
            className="ink-btn ink-btn-ghost ink-btn-lg"
          >
            {s.label} ↗
          </Reveal>
        ))}
      </div>
      <div className="ink-colophon">
        © {new Date().getFullYear()} {(profile.name || '').toUpperCase()} — {(profile.role || '').toUpperCase()}
      </div>
    </section>
  );
}

export default function InkSite({ site, loading }) {
  const { profile, projects = [], stack = [], socials = [], education = [], experience = [], content = {} } = site;

  // Section numbers run on past the projects (03), skipping hidden sections.
  let count = 3;
  const next = (shown) => (shown ? ++count : count);

  // The page is paper, not the dark theme the shared base styles assume.
  useEffect(() => {
    document.documentElement.dataset.route = 'ink';
    return () => {
      delete document.documentElement.dataset.route;
    };
  }, []);

  return (
    <div className="ink">
      <Progress />
      <Header name={profile.name || 'Jayanth Gopala'} content={content} />
      <main>
        <Hero profile={profile} />
        <About profile={profile} content={content} />
        <Work experience={experience} />
        <Artifacts projects={projects} loading={loading} n={3} />
        <Skills stack={stack} n={next(stack.length > 0)} />
        <Achievements experience={experience} n={next(experience.some((x) => x.kind === 'achievement'))} />
        <Origins education={education} n={next(education.length > 0)} />
        <Contact profile={profile} socials={socials} n={next(true)} />
      </main>
    </div>
  );
}
