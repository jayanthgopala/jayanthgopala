import { useScrolled } from '../lib/motion.jsx';
import { copy, externalUrl } from '../lib/api.js';
import { SocialIcon } from './Icons.jsx';
import ModeToggle from './ModeToggle.jsx';
import '../styles/nav.css';

export default function Nav({ profile, socials = [], content = {}, mode, onChooseMode }) {
  const scrolled = useScrolled(24);
  const github = socials.find((s) => s.icon === 'github');

  // Targets are structural (they must match section ids); only the labels are
  // editable, which is the part that ever needs changing.
  const links = [
    { href: '#projects', label: copy(content, 'nav.projects', 'Projects') },
    { href: '#stack', label: copy(content, 'nav.stack', 'Stack') },
    { href: '#contact', label: copy(content, 'nav.contact', 'Contact') },
  ];

  // Derive initials rather than storing them — one less field to keep in sync.
  const initials =
    (profile.name || '')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || '—';

  return (
    <header className={`nav ${scrolled ? 'nav-scrolled glass' : ''}`}>
      <div className="nav-inner container">
        <a href="#top" className="nav-brand" aria-label="Back to top">
          <span className="nav-mark">{initials}</span>
          <span className="nav-name">{profile.name}</span>
        </a>

        <nav className="nav-links" aria-label="Primary">
          {links.map((link) => (
            <a key={link.href} href={link.href} className="nav-link">
              {link.label}
            </a>
          ))}
        </nav>

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
