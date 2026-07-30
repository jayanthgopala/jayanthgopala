/**
 * API client for the public site.
 *
 * Dev resolves to '' so Vite's proxy handles /api and the browser sees a
 * same-origin request. Production falls back to the deployed Worker.
 *
 * The fallback exists because a missing VITE_API_URL fails in a genuinely
 * confusing way: Vite inlines the variable at BUILD time, so an unset one
 * leaves BASE empty, the app requests /api/public/site from its own origin,
 * Pages' SPA fallback answers with index.html, and JSON.parse reports
 * `Unexpected token '<'`. Nothing in that message points at a missing env var.
 * This URL is a public endpoint, not a secret, so defaulting to it is safe.
 */
const PRODUCTION_API = 'https://portfolio-api.jayanthgopala21.workers.dev';
const BASE = (
  import.meta.env.VITE_API_URL || (import.meta.env.DEV ? '' : PRODUCTION_API)
).replace(/\/$/, '');

export const mediaUrl = (path) => {
  if (!path) return '';
  return /^https?:\/\//.test(path) ? path : `${BASE}${path}`;
};

async function get(path, { signal } = {}) {
  const res = await fetch(`${BASE}${path}`, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

export const fetchSite = (opts) => get('/api/public/site', opts);
export const fetchStatus = (opts) => get('/api/public/status', opts);
export const fetchProjects = (opts) => get('/api/public/projects', opts);

/**
 * Rendered while the network request is in flight. Keeping the shape identical
 * to the real payload means components never branch on "is it loaded yet" —
 * they just render, and the skeleton state comes from `loading`.
 */
export const EMPTY_SITE = {
  profile: {
    name: '', role: '', headline: '', description: '', location: '', email: '',
    avatarUrl: '', resumeUrl: '', githubUser: '',
    ctaPrimary: 'View Projects', ctaSecondary: 'GitHub',
  },
  status: {
    available: false, availabilityNote: '', currentProject: '', currentProjectUrl: '',
    currentProgress: 0, deployLabel: '', deployState: 'ready', deployAt: '',
    githubState: 'operational', healthState: 'operational', healthUptime: 0, timezone: 'UTC',
  },
  projects: [],
  stack: [],
  socials: [],
  content: {},
};

/**
 * Copy lookup with a fallback.
 *
 * Every fixed string on the site goes through this. The fallback is not
 * decoration — it is what renders during the first paint (before the payload
 * lands) and on a database that predates a newly added key, so the page never
 * flashes blank labels.
 */
export const copy = (content, key, fallback = '') => content?.[key] || fallback;
