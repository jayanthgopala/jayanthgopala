import { copy, externalUrl } from '../lib/api.js';
import { SocialIcon } from './Icons.jsx';
import '../styles/sections.css';

export default function Footer({ profile, socials = [], content = {} }) {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div className="footer-meta">
          <span className="footer-name">{profile.name}</span>
          <span className="footer-copy">
            {/* Year is computed, not stored — a hardcoded year is the one
                thing on a portfolio guaranteed to go stale. */}
            © {new Date().getFullYear()} — {copy(content, 'footer.note', 'Built by Jayanth Gopala V')}
          </span>
        </div>

        <ul className="footer-socials">
          {socials.map((social) => (
            <li key={social.id ?? social.url}>
              <a
                href={externalUrl(social.url)}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={social.label}
                className="footer-social"
              >
                <SocialIcon icon={social.icon} width={16} height={16} />
                <span>{social.label}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  );
}
