import { copy, externalUrl } from '../lib/api.js';
import { SocialIcon } from '../components/Icons.jsx';

/**
 * The end of the sequence.
 *
 * A page that finishes on its contact section finishes mid-sentence — the
 * reader scrolls, hits the bottom of the last block and the story just stops.
 * This is the closing frame: the name set large, the way out, and the credits.
 *
 * It repeats the socials from the contact block deliberately. Those two are at
 * opposite ends of the longest section on the site, and a footer that omits the
 * links because they appeared once already is a footer that fails the one
 * person who scrolled straight to the bottom looking for them.
 *
 * Every string is either from the database or structural. The only literal here
 * is the year, and that is computed.
 */
export default function CinematicFooter({ profile = {}, socials = [], content = {}, acts = [] }) {
  return (
    <footer className="cx-footer" data-tone="ink">
      <div className="cx-wrap cx-footer-grid">
        <div className="cx-footer-mark">
          {profile.name && <p className="cx-footer-name">{profile.name}</p>}
          {profile.role && <p className="cx-footer-role">{profile.role}</p>}
          {profile.location && <p className="cx-footer-role">{profile.location}</p>}
        </div>

        {acts.length > 0 && (
          <nav className="cx-footer-nav" aria-label="Sequence">
            <span className="cx-footer-head">{copy(content, 'cine.footerActs', 'The sequence')}</span>
            <ul>
              {acts.map((act, i) => (
                <li key={act.id}>
                  <a href={`#${act.id}`}>
                    <span className="cx-footer-num">{String(i + 1).padStart(2, '0')}</span>
                    {act.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div className="cx-footer-reach">
          <span className="cx-footer-head">{copy(content, 'cine.footerReach', 'Elsewhere')}</span>

          {profile.email && (
            <a className="cx-footer-mail" href={`mailto:${profile.email}`}>
              {profile.email}
            </a>
          )}

          {socials.length > 0 && (
            <ul className="cx-footer-socials">
              {socials.map((social) => (
                <li key={social.id ?? social.url}>
                  <a
                    href={externalUrl(social.url)}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={social.label}
                  >
                    <SocialIcon icon={social.icon} />
                    <span>{social.label}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="cx-wrap cx-footer-base">
        <p>
          © {new Date().getFullYear()} {profile.name}
          {copy(content, 'footer.note', '') && ` · ${copy(content, 'footer.note', '')}`}
        </p>

        <a className="cx-footer-top" href="#top">
          {copy(content, 'cine.backToTop', 'Back to the beginning')}
        </a>
      </div>
    </footer>
  );
}
