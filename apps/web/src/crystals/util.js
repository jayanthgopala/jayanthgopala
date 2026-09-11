/** Small shared helpers for the crystal page. */

/** FNV-1a. A project's slug always hashes to the same seed, so its crystal is stable. */
export function hashString(str = '') {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32 — same generator noise.js uses to shuffle its permutation table. */
export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Framerate-independent damping with a deadband, as in CameraRig. */
export const damp = (current, target, lambda, dt) => {
  if (Math.abs(target - current) < 0.0005) return target;
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
};

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export const easeOutCubic = (t) => 1 - (1 - t) ** 3;
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
