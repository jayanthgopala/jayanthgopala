import { apiUrl } from './api.js';

/**
 * Fires the visit beacon once per page load.
 *
 * The device id is a random value generated here and kept in localStorage. It
 * is not derived from anything about the visitor — no fingerprint, no IP, no
 * personal data — so it identifies "this browser on this machine" and nothing
 * else, and is useless anywhere but this site.
 *
 * That choice is what makes two colleagues on one office IP count as two people
 * while the same person reloading counts as one. The server does the de-duping;
 * this only supplies the id.
 */

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
    // Private mode or storage disabled. Returning null means this visit simply
    // is not counted, which is the right call: inventing an id per load would
    // inflate uniques rather than leave a gap.
    return null;
  }
}

export function recordVisit() {
  const id = deviceId();
  if (!id) return;

  const body = JSON.stringify({ id });
  const url = apiUrl('/api/public/view');

  // sendBeacon survives the page being closed mid-flight and never blocks
  // unload; fetch with keepalive is the fallback where it is missing.
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
