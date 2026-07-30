import { Reveal, useRipple } from '../lib/motion.jsx';
import { mediaUrl } from '../lib/api.js';
import { ArrowIcon, GitHubIcon } from './Icons.jsx';
import PortraitOrb from './PortraitOrb.jsx';
import '../styles/hero.css';

// Bundled character render. `profile.avatarUrl` (set from the admin panel)
// wins when present, so the portrait is swappable without a deploy.
const DEFAULT_PORTRAIT = '/character.jpg';

export default function Hero({ profile, loading, children }) {
  const ripple = useRipple();
  const portrait = profile.avatarUrl ? mediaUrl(profile.avatarUrl) : DEFAULT_PORTRAIT;

  return (
    <section className="hero">
      <div className="container hero-inner">
        <div className="hero-content">
          <Reveal delay={0}>
            <span className="hero-badge pill">
              <span className="dot dot-pulse" data-state="operational" />
              {profile.role || 'Software Engineer'}
              {profile.location && <span className="hero-badge-sep">·</span>}
              {profile.location}
            </span>
          </Reveal>

          <Reveal delay={80}>
            {/* The headline is DB-driven; the fallback only ever shows if the
                API is unreachable on a cold load. */}
            <h1 className="display hero-title" data-loading={loading || undefined}>
              {profile.headline || 'Building scalable software and exceptional digital experiences.'}
            </h1>
          </Reveal>

          <Reveal delay={160}>
            <p className="lead hero-lead">{profile.description}</p>
          </Reveal>

          <Reveal delay={240}>
            <div className="hero-actions">
              <a href="#projects" className="btn btn-primary" onPointerDown={ripple}>
                {profile.ctaPrimary || 'View Projects'}
                <ArrowIcon />
              </a>

              <a
                href={profile.githubUser ? `https://github.com/${profile.githubUser}` : '#'}
                target="_blank"
                rel="noreferrer noopener"
                className="btn btn-secondary"
                onPointerDown={ripple}
              >
                <GitHubIcon />
                {profile.ctaSecondary || 'GitHub'}
              </a>
            </div>
          </Reveal>
        </div>

        <div className="hero-aside">
          {/* graded={false}: the bundled asset is an art-directed render now,
              not a raw studio photo, so it gets the light treatment. */}
          <Reveal delay={200} className="hero-orb-wrap">
            <PortraitOrb
              src={portrait}
              alt={profile.name || 'Portrait'}
              graded={false}
              cropped={Boolean(profile.avatarUrl)}
            />
          </Reveal>
          <Reveal delay={320}>{children}</Reveal>
        </div>
      </div>
    </section>
  );
}
