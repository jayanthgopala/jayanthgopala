import { useScrolled } from '../lib/motion.jsx';
import { copy, externalUrl } from '../lib/api.js';
import { SocialIcon } from './Icons.jsx';
import ModeToggle from './ModeToggle.jsx';
import '../styles/nav.css';

export default function Nav({
  profile,
  socials = [],
  content = {},
  mode,
  onChooseMode,
  hasEducation = false,
  hasExperience = false,
}) {
  const scrolled = useScrolled(24);
  const github = socials.find((s) => s.icon === 'github');

  // Targets are structural (they must match section ids); only the labels are
  // editable, which is the part that ever needs changing.
  // Anchors only appear when the section they point at has content, so the nav
  // never offers a link that scrolls to nothing.
  const links = [
    { href: '#projects', label: copy(content, 'nav.projects', 'Projects'), show: true },
    {
      href: '#experience',
      label: copy(content, 'nav.experience', 'Experience'),
      show: hasExperience,
    },
    { href: '#education', label: copy(content, 'nav.education', 'Education'), show: hasEducation },
    { href: '#stack', label: copy(content, 'nav.stack', 'Stack'), show: true },
    { href: '#contact', label: copy(content, 'nav.contact', 'Contact'), show: true },
  ].filter((l) => l.show);

  return (
    <header className={`nav ${scrolled ? 'nav-scrolled glass' : ''}`}>
      <div className="nav-inner container">
        <a href="#top" className="nav-brand" aria-label="Back to top">
          <img className="nav-mark" src="/logo-mark.png" alt="" width="34" height="24" />
          <span className="nav-name">{profile.name}</span>
        </a>

        <nav className="nav-links" aria-label="Primary">
          {links.map((link) => (
            <a key={link.href} href={link.href} className="nav-link">
              {link.label}
            </a>
          ))}
        </nav>

        {/* Résumé only renders when a URL is actually set — an empty button
            that goes nowhere is worse than no button. */}
        {profile.resumeUrl && (
          <a
            className="btn btn-secondary nav-cta nav-resume"
            href={externalUrl(profile.resumeUrl)}
            target="_blank"
            rel="noreferrer noopener"
          >
            {copy(content, 'nav.resume', 'Résumé')}
          </a>
        )}

        <ModeToggle mode={mode} onChoose={onChooseMode} content={content} />

        {github && (
          <a
            className="btn btn-secondary nav-cta"
            href={externalUrl(github.url)}
            target="_blank"
            rel="noreferrer noopener"
          >
            <SocialIcon icon="github" />
            {/* The link's own label from the Links editor — no separate key. */}
            <span>{github.label}</span>
          </a>
        )}
      </div>
    </header>
  );
}
