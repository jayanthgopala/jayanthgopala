import { Reveal, useRipple } from '../lib/motion.jsx';
import { copy, externalUrl } from '../lib/api.js';
import { SocialIcon, ArrowUpRight } from './Icons.jsx';
import GitHubButtons from './GitHubButtons.jsx';
import '../styles/sections.css';

export default function Contact({ profile, socials = [], content = {} }) {
  const ripple = useRipple();

  return (
    <section className="section" id="contact">
      <div className="container">
        <Reveal>
          <div className="contact card gradient-border" data-accent="iris">
            <div className="contact-inner">
              <span className="eyebrow">{copy(content, 'contact.eyebrow', 'Get in touch')}</span>

              <h2 className="h2 contact-title">
                {copy(content, 'contact.title', 'Have something worth building?')}
              </h2>

              <p className="lead contact-lead">
                {copy(
                  content,
                  'contact.lead',
                  'I’m open to collaborations, contract work and interesting problems.'
                )}
              </p>

              <div className="contact-actions">
                {profile.email && (
                  <a
                    className="btn btn-primary"
                    href={`mailto:${profile.email}`}
                    onPointerDown={ripple}
                  >
                    {profile.email}
                    <ArrowUpRight />
                  </a>
                )}

                {profile.resumeUrl && (
                  <a
                    className="btn btn-secondary"
                    href={externalUrl(profile.resumeUrl)}
                    target="_blank"
                    rel="noreferrer noopener"
                    onPointerDown={ripple}
                  >
                    {copy(content, 'contact.resume', 'Résumé')}
                  </a>
                )}
              </div>

              {/* Star / fork live down here rather than in the nav: they are a
                  call to action once someone has read the work, not a
                  navigation control competing with the mode toggle. */}
              <GitHubButtons profile={profile} content={content} />

              {socials.length > 0 && (
                <ul className="contact-socials">
                  {socials.map((social) => (
                    <li key={social.id ?? social.url}>
                      <a
                        className="contact-social"
                        href={externalUrl(social.url)}
                        target="_blank"
                        rel="noreferrer noopener"
                        aria-label={social.label}
                        title={social.label}
                      >
                        <SocialIcon icon={social.icon} />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
