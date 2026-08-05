/**
 * Admin API client.
 *
 * `credentials: 'include'` on every call — the session lives in an httpOnly
 * cookie, which is what keeps the token out of reach of any injected script.
 */
// Same fallback as the website — see apps/web/src/lib/api.js for why an unset
// VITE_API_URL fails so confusingly. Public endpoint, safe to default.

/** See apps/web/src/lib/api.js — a scheme-less base silently goes relative. */
function normaliseBase(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/*
 * No fallback to a hardcoded URL on purpose.
 *
 * A default here would point every fork at the original author's Worker: it
 * would work locally (the preview port is on their allow-list) and then fail in
 * production with an opaque CORS error, showing someone else's content in the
 * one case it did connect. The build refuses to produce that bundle — see the
 * guard in vite.config.js — so this is only ever unset in development, where
 * requests are relative and the dev server proxies them.
 */
const BASE = normaliseBase(import.meta.env.VITE_API_URL || '');

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

  getEducation: () => request('/api/admin/education'),
  createEducation: (body) => request('/api/admin/education', { method: 'POST', body }),
  updateEducation: (id, body) => request(`/api/admin/education/${id}`, { method: 'PATCH', body }),
  deleteEducation: (id) => request(`/api/admin/education/${id}`, { method: 'DELETE' }),
  reorderEducation: (ids) => request('/api/admin/education/reorder', { method: 'POST', body: { ids } }),

  getExperience: () => request('/api/admin/experience'),
  createExperience: (body) => request('/api/admin/experience', { method: 'POST', body }),
  updateExperience: (id, body) => request(`/api/admin/experience/${id}`, { method: 'PATCH', body }),
  deleteExperience: (id) => request(`/api/admin/experience/${id}`, { method: 'DELETE' }),
  reorderExperience: (ids) => request('/api/admin/experience/reorder', { method: 'POST', body: { ids } }),

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
