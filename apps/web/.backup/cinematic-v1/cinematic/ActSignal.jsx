import { copy, externalUrl } from '../lib/api.js';
import { SocialIcon, ArrowUpRight } from '../components/Icons.jsx';
import GitHubButtons from '../components/GitHubButtons.jsx';
import { useSceneVar, useEntered } from './lib/scene.js';

/**
 * ACT VI — SIGNAL.
 *
 * The close, and the act where the figure walks out of frame.
 *
 * The email address is the largest piece of type here. After fifteen viewports
 * of scrolling, the one thing a visitor might actually want to do is get in
 * touch, and burying that behind a button labelled "Contact" would waste the
 * entire climb. It is content, not a label, so it gets the treatment the act
 * titles get.
 */
export default function ActSignal({ profile, socials = [], content = {}, id }) {
  // The scene var drives the figure's exit walk in the 3D engine, which reads
  // this act's scroll fraction the same way every other act's camera move is
  // read — so the walk is scrubbed, not triggered.
  const sceneRef = useSceneVar();
  const [ref, entered] = useEntered({ threshold: 0.25 });

  return (
    <section className="cx-act cx-signal" id={id} data-tone="ink" ref={sceneRef}>
      <div className="cx-signal-inner" ref={ref} data-in={entered || undefined}>
        <span className="cx-eyebrow">{copy(content, 'contact.eyebrow', 'Get in touch')}</span>

        <h2 className="cx-act-title cx-signal-title">
          {copy(content, 'contact.title', 'Have something worth building?')}
        </h2>

        <p className="cx-act-lead">
          {copy(
            content,
            'contact.lead',
            'I’m open to collaborations, contract work and interesting problems.'
          )}
        </p>

        {profile.email && (
          <a className="cx-signal-mail" href={`mailto:${profile.email}`}>
            <span>{profile.email}</span>
            <ArrowUpRight width={28} height={28} />
          </a>
        )}

        <div className="cx-signal-actions">
          {profile.resumeUrl && (
            <a
              className="cx-link cx-link-primary"
              href={externalUrl(profile.resumeUrl)}
              target="_blank"
              rel="noreferrer noopener"
            >
              {copy(content, 'contact.resume', 'Résumé')}
              <ArrowUpRight width={14} height={14} />
            </a>
          )}

          {/* Star and fork with live counts, reused verbatim — the counts come
              from our own Worker, so cinematic mode costs no extra GitHub rate
              limit. */}
          <GitHubButtons profile={profile} content={content} />
        </div>

        {socials.length > 0 && (
          <ul className="cx-signal-socials">
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

      <footer className="cx-signal-foot">
        <span>
          © {new Date().getFullYear()} {profile.name}
        </span>
        <span>{copy(content, 'footer.note', '')}</span>
      </footer>
    </section>
  );
}
