/**
 * API client for the public site.
 *
 * In dev, VITE_API_URL is empty and Vite proxies /api to the Worker, so the
 * browser sees a same-origin request. In production it points at the deployed
 * Worker.
 */
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

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
