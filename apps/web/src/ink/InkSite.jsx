import { useEffect, useRef } from 'react';
import { Reveal } from '../lib/motion.jsx';
import { copy, externalUrl, mediaUrl } from '../lib/api.js';
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

const ENGINEERING = [
  ['Frontend', 'Responsive, accessible interfaces in modern frameworks.'],
  ['Backend', 'Robust services and business logic at scale.'],
  ['Databases', 'Modeling, querying, and tuning relational & NoSQL stores.'],
  ['Cloud', 'Deployment and infrastructure for real traffic.'],
  ['APIs', 'Clean, versioned interfaces between systems.'],
  ['Security', 'Auth, access control, and safe data handling.'],
  ['Architecture', 'System design that stays maintainable as it grows.'],
  ['Automation', 'Tooling and pipelines that remove manual work.'],
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
          {copy(content, 'nav.immersive', 'Immersive')}
        </a>
        <a href="#contact" className="ink-btn">
          {copy(content, 'nav.contact', 'Contact').toUpperCase()}
        </a>
      </nav>
    </header>
  );
}

function Hero({ profile }) {
  const first = (profile.name || 'Jayanth').split(' ')[0].toUpperCase();
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
        THE {first}
        <br />
        <em>EXPERIENCE</em>
      </Reveal>
      <Reveal as="p" delay={160} className="ink-lede">
        {profile.headline}
      </Reveal>
      <div className="ink-scroll">
        <span>SCROLL TO BEGIN</span>
        <span className="ink-scroll-line" />
      </div>
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

function Artifacts({ projects, loading }) {
  const shown = projects.filter((p) => p.published !== false);
  return (
    <section id="projects" className="ink-section">
      <Reveal className="ink-head">
        <Eyebrow n={3}>SELECTED PROJECTS</Eyebrow>
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
                      <img src={mediaUrl(p.screenshot)} alt={`${p.title} screenshot`} loading="lazy" decoding="async" />
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
                  <p>{p.summary || p.description}</p>
                  {p.tech?.length > 0 && <div className="ink-tech">{p.tech.join(' · ').toUpperCase()}</div>}
                </Reveal>
              );
            })}
      </div>
    </section>
  );
}

function Engineering() {
  return (
    <section id="engineering" className="ink-section">
      <Reveal className="ink-head ink-head-tight">
        <Eyebrow n={4}>ENGINEERING</Eyebrow>
      </Reveal>
      <Reveal as="p" delay={80} className="ink-statement">
        End to end, from interface to infrastructure.
      </Reveal>
      <div className="ink-disciplines">
        {ENGINEERING.map(([title, text], i) => (
          <Reveal key={title} delay={(i % 4) * 50} className="ink-card ink-discipline">
            <div className="ink-num">{pad(i + 1)}</div>
            <h4>{title}</h4>
            <p>{text}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Skills({ stack }) {
  if (stack.length === 0) return null;
  const grouped = stack.reduce((acc, item) => {
    (acc[item.category || 'Other'] ||= []).push(item);
    return acc;
  }, {});
  return (
    <section id="skills" className="ink-section">
      <Reveal className="ink-head">
        <Eyebrow n={5}>SKILLS</Eyebrow>
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

function Achievements({ experience }) {
  const marks = experience.filter((x) => x.kind === 'achievement');
  if (marks.length === 0) return null;
  return (
    <section id="achievements" className="ink-section">
      <Reveal className="ink-head">
        <Eyebrow n={6}>ACHIEVEMENTS</Eyebrow>
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

function Origins({ education, content }) {
  const items =
    education.length > 0
      ? education
      : content['banner.education']
        ? [{ id: 'edu', qualification: content['banner.education'], description: '' }]
        : [];
  if (items.length === 0) return null;
  return (
    <section id="education" className="ink-section">
      <Reveal className="ink-head">
        <Eyebrow n={7}>EDUCATION</Eyebrow>
        <h2>Origins</h2>
      </Reveal>
      <Rows
        items={items}
        heading={(e) => [[e.qualification, e.field].filter(Boolean).join(' '), e.institution].filter(Boolean).join(' · ')}
      />
    </section>
  );
}

function Contact({ profile, socials }) {
  const links = socials.filter((s) => s.url);
  return (
    <section id="contact" className="ink-contact">
      <Reveal className="ink-eyebrow">08 — CONTACT · THE END, OR THE BEGINNING</Reveal>
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
        <Artifacts projects={projects} loading={loading} />
        <Engineering />
        <Skills stack={stack} />
        <Achievements experience={experience} />
        <Origins education={education} content={content} />
        <Contact profile={profile} socials={socials} />
      </main>
    </div>
  );
}
