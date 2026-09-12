// API client for the public site

// Normalizes API base URL ensuring protocol scheme is present
function normaliseBase(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

const BASE = normaliseBase(import.meta.env.VITE_API_URL || '');

export const mediaUrl = (path) => {
  if (!path) return '';
  return /^https?:\/\//.test(path) ? path : `${BASE}${path}`;
};

export const apiUrl = (path) => `${BASE}${path}`;

async function get(path, { signal } = {}) {
  const res = await fetch(`${BASE}${path}`, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

export const fetchSite = (opts) => get('/api/public/site', opts);
export const fetchStatus = (opts) => get('/api/public/status', opts);
export const fetchProjects = (opts) => get('/api/public/projects', opts);
export const fetchRepoStats = (opts) => get('/api/public/repo-stats', opts);

// Grounded Q&A API request with conversation history
export async function askQuestion(question, history = []) {
  const res = await fetch(`${BASE}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, history }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Initial placeholder schema rendered while network request is in flight
export const EMPTY_SITE = {
  profile: {
    name: '', role: '', headline: '', description: '', location: '', email: '',
    avatarUrl: '', cinematicAvatarUrl: '', resumeUrl: '', githubUser: '',
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
  education: [],
  experience: [],
  content: {},
};

// Copy lookup with fallback value
export const copy = (content, key, fallback = '') => content?.[key] || fallback;

// Ensures external URLs have https scheme if omitted
export function externalUrl(url = '') {
  const raw = String(url).trim();
  if (!raw) return '';
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(raw)) return raw;
  return `https://${raw}`;
}
