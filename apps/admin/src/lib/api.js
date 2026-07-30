/**
 * Admin API client.
 *
 * `credentials: 'include'` on every call — the session lives in an httpOnly
 * cookie, which is what keeps the token out of reach of any injected script.
 */
// Same fallback as the website — see apps/web/src/lib/api.js for why an unset
// VITE_API_URL fails so confusingly. Public endpoint, safe to default.
const PRODUCTION_API = 'https://portfolio-api.jayanthgopala21.workers.dev';

/** See apps/web/src/lib/api.js — a scheme-less base silently goes relative. */
function normaliseBase(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

const BASE = normaliseBase(
  import.meta.env.VITE_API_URL || (import.meta.env.DEV ? '' : PRODUCTION_API)
);

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, isForm = false } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: isForm ? undefined : { 'Content-Type': 'application/json' },
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    throw new ApiError(data?.error || data?.detail || `Request failed (${res.status})`, res.status);
  }
  return data ?? text;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const api = {
  // --- auth
  login: (password) => request('/api/auth/login', { method: 'POST', body: { password } }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request('/api/auth/me'),

  // --- content
  overview: () => request('/api/admin/overview'),

  getProfile: () => request('/api/admin/profile'),
  saveProfile: (body) => request('/api/admin/profile', { method: 'PUT', body }),

  getStatus: () => request('/api/admin/status'),
  saveStatus: (body) => request('/api/admin/status', { method: 'PUT', body }),

  getProjects: () => request('/api/admin/projects'),
  createProject: (body) => request('/api/admin/projects', { method: 'POST', body }),
  updateProject: (id, body) => request(`/api/admin/projects/${id}`, { method: 'PATCH', body }),
  deleteProject: (id) => request(`/api/admin/projects/${id}`, { method: 'DELETE' }),
  reorderProjects: (ids) =>
    request('/api/admin/projects/reorder', { method: 'POST', body: { ids } }),

  getStack: () => request('/api/admin/stack'),
  createStack: (body) => request('/api/admin/stack', { method: 'POST', body }),
  updateStack: (id, body) => request(`/api/admin/stack/${id}`, { method: 'PATCH', body }),
  deleteStack: (id) => request(`/api/admin/stack/${id}`, { method: 'DELETE' }),

  getContent: () => request('/api/admin/content'),
  saveContent: (values) => request('/api/admin/content', { method: 'PUT', body: values }),

  getSocials: () => request('/api/admin/socials'),
  createSocial: (body) => request('/api/admin/socials', { method: 'POST', body }),
  updateSocial: (id, body) => request(`/api/admin/socials/${id}`, { method: 'PATCH', body }),
  deleteSocial: (id) => request(`/api/admin/socials/${id}`, { method: 'DELETE' }),

  // --- media
  upload: (file) => {
    const form = new FormData();
    form.append('file', file);
    return request('/api/admin/media', { method: 'POST', body: form, isForm: true });
  },

  // --- github sync
  readmePreview: () => request('/api/admin/readme/preview'),
  sync: () => request('/api/admin/sync', { method: 'POST' }),
  syncLog: () => request('/api/admin/sync/log'),
  syncState: () => request('/api/admin/sync/state'),
  githubCheck: () => request('/api/admin/github/check'),
};
