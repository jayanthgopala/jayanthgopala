import { apiUrl } from './api.js';

/** Fires anonymous visit beacon once per unique browser. */

const KEY = 'pf_device';

function deviceId() {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;

    const id =
      crypto.randomUUID?.() ||
      // Older Safari has getRandomValues but not randomUUID.
      Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

    localStorage.setItem(KEY, id);
    return id;
  } catch {
    return null;
  }
}

export function recordVisit() {
  const id = deviceId();
  if (!id) return;

  const body = JSON.stringify({ id });
  const url = apiUrl('/api/public/view');

  // Prefer sendBeacon for non-blocking unload, fallback to fetch keepalive
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      return;
    }
  } catch {
    // fall through
  }

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    // A missed count must never surface to the visitor.
  });
}
