import { useEffect, useState } from 'react';
import { copy } from '../lib/api.js';
import '../styles/github-buttons.css';

const StarIcon = (props) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M12 2.6l2.9 5.9 6.5.95-4.7 4.6 1.1 6.45L12 17.45 6.2 20.5l1.1-6.45-4.7-4.6 6.5-.95L12 2.6z" />
  </svg>
);

const ForkIcon = (props) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" aria-hidden="true" {...props}>
    <circle cx="6" cy="5" r="2.4" /><circle cx="18" cy="5" r="2.4" /><circle cx="12" cy="19" r="2.4" />
    <path d="M6 7.4v2.1a2.5 2.5 0 0 0 2.5 2.5h7A2.5 2.5 0 0 0 18 9.5V7.4M12 12v4.6" />
  </svg>
);

/**
 * Star and Fork, with live counts.
 *
 * These deep-link to GitHub rather than acting directly: there is no URL that
 * stars a repo, and GitHub blocks it deliberately — a one-click star from any
 * third-party page would be trivially abusable. So the buttons land you on the
 * repo (fork lands on the fork dialog) where one more click does it.
 *
 * Counts come from our Worker, not api.github.com, so visitors don't each spend
 * against the unauthenticated 60-requests-per-hour limit.
 */
export default function GitHubButtons({ profile, content = {} }) {
  const [stats, setStats] = useState({ stars: null, forks: null, url: '' });

  useEffect(() => {
    const controller = new AbortController();
    import('../lib/api.js').then(({ fetchRepoStats }) =>
      fetchRepoStats({ signal: controller.signal })
        .then(setStats)
        .catch(() => {
          /* buttons still work without counts */
        })
    );
    return () => controller.abort();
  }, []);

  const repoUrl =
    stats.url ||
    (profile.githubUser ? `https://github.com/${profile.githubUser}/${profile.githubUser}` : '');
  if (!repoUrl) return null;

  const fmt = (n) => (n === null || n === undefined ? null : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

  return (
    <div className="gh-buttons">
      <a
        className="gh-btn"
        href={repoUrl}
        target="_blank"
        rel="noreferrer noopener"
        title="Opens the repo on GitHub — click the Star button there"
      >
        <StarIcon />
        <span>{copy(content, 'github.starLabel', 'Star')}</span>
        {fmt(stats.stars) !== null && <span className="gh-count">{fmt(stats.stars)}</span>}
      </a>

      <a
        className="gh-btn"
        href={`${repoUrl}/fork`}
        target="_blank"
        rel="noreferrer noopener"
        title="Opens the fork dialog on GitHub"
      >
        <ForkIcon />
        <span>{copy(content, 'github.forkLabel', 'Fork')}</span>
        {fmt(stats.forks) !== null && <span className="gh-count">{fmt(stats.forks)}</span>}
      </a>
    </div>
  );
}
