import { useEffect, useRef } from 'react';
import { useRipple, useScrolled } from '../lib/motion.jsx';
import { copy, externalUrl } from '../lib/api.js';
import { SocialIcon } from './Icons.jsx';
import '../styles/nav.css';

export default function Nav({
  profile,
  socials = [],
  content = {},
  hasEducation = false,
  hasExperience = false,
}) {
  const scrolled = useScrolled(24);
  const github = socials.find((s) => s.icon === 'github');

  const ripple = useRipple();
  const immersiveRef = useRef(null);
  const launching = useRef(false);

  /*
   * The click into the immersive version PLAYS before it leaves.
   *
   * A full navigation tears the page down on the next frame, so a click
   * animation on a plain link is never seen. The ripple and the flash get
   * 420ms, then the browser goes. Modified clicks (new tab, new window) are left
   * entirely to the browser — this page is not going anywhere in those cases,
   * so there is nothing to wait for. Reduced motion skips the wait.
   */
  const launchImmersive = (event) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    ripple(event);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    event.preventDefault();
    if (launching.current) return;
    launching.current = true;
    const link = event.currentTarget;
    link.classList.add('is-launching');
    setTimeout(() => window.location.assign(link.href), 420);
  };

  /* Coming Back restores this page from the back-forward cache exactly as it
     was left — mid-launch. Reset, or the link would stay lit and ignore the
     next click. */
  useEffect(() => {
    const onShow = (event) => {
      if (!event.persisted) return;
      launching.current = false;
      immersiveRef.current?.classList.remove('is-launching');
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

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
          {/* The way into the immersive igloo version, styled as one more nav
              link. A plain href, not a client route: the app reads the path
              once at load, so a full navigation is what switches it over. */}
          <a
            ref={immersiveRef}
            href="/world"
            className="nav-link nav-immersive"
            onClick={launchImmersive}
          >
            <span className="nav-immersive-label">
              {copy(content, 'nav.immersive', 'Immersive')}
            </span>
            {/* A cursor that taps now and then — the invitation to click. */}
            <span className="nav-immersive-tap" aria-hidden="true">
              <svg viewBox="0 0 16 16" width="13" height="13">
                <path d="M3 1.5v11.2l2.9-2.7 2.1 4.4 1.8-.9-2.1-4.3 3.9-.3z" />
              </svg>
            </span>
          </a>
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
