import { copy, externalUrl } from '../lib/api.js';
import { GitHubIcon } from '../components/Icons.jsx';

/**
 * The cinematic navigation: a printed label sitting on the artwork.
 *
 * A dedicated component rather than a restyling of the shared Nav. The two want
 * genuinely different markup — this one groups its links inside a solid plaque
 * and keeps the repository link outside it as a separate outlined button, which
 * cannot be reached by CSS alone from a flat list of siblings. It also means
 * minimal mode's nav is left completely untouched, which is worth more than the
 * handful of lines saved by sharing.
 *
 * Anchors are structural — they have to match the section ids — so only the
 * labels come from the database, which is the part that ever needs changing.
 */
export default function CinematicNav({
  profile,
  socials = [],
  content = {},
  mode,
  onChooseMode,
  hasExperience = false,
}) {
  const github = socials.find((s) => s.icon === 'github');

  const links = [
    { href: '#work', label: copy(content, 'nav.projects', 'Work') },
    hasExperience && { href: '#experience', label: copy(content, 'nav.experience', 'Path') },
    { href: '#stack', label: copy(content, 'nav.stack', 'Stack') },
    { href: '#contact', label: copy(content, 'nav.contact', 'Contact') },
  ].filter(Boolean);

  return (
    <header className="cx-nav">
      {/* Small, and given room. The monogram is identity, not a headline — it
          must not compete with the type in the hero. */}
      <a className="cx-mark" href="#top" aria-label="Back to top">
        <img src="/logo-mark.png" alt="" width="30" height="21" />
      </a>

      <nav className="cx-nav-right" aria-label="Primary">
        <div className="cx-plaque">
          {links.map((link) => (
            <a key={link.href} className="cx-plaque-link" href={link.href}>
              {link.label}
            </a>
          ))}
        </div>

        <div className="cx-switch" role="group" aria-label="Presentation mode">
          {[
            { id: 'minimal', label: copy(content, 'theme.minimalLabel', 'Minimal') },
            { id: 'cinematic', label: copy(content, 'theme.cinematicLabel', 'Cinematic') },
          ].map((option) => (
            <button
              key={option.id}
              type="button"
              className="cx-switch-option"
              aria-pressed={mode === option.id}
              onClick={() => onChooseMode(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Only renders when a URL is actually set. An outlined button that goes
            nowhere is worse than no button. */}
        {github && (
          <a
            className="cx-ghost"
            href={externalUrl(github.url)}
            target="_blank"
            rel="noreferrer noopener"
          >
            <GitHubIcon width={14} height={14} />
            <span>{github.label}</span>
          </a>
        )}

        {profile.resumeUrl && (
          <a
            className="cx-ghost"
            href={externalUrl(profile.resumeUrl)}
            target="_blank"
            rel="noreferrer noopener"
          >
            {copy(content, 'nav.resume', 'Résumé')}
          </a>
        )}
      </nav>
    </header>
  );
}
