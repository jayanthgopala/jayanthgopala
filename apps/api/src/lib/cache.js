/**
 * KV-backed read cache for the public endpoints.
 *
 * Admin writes bump a version counter rather than deleting individual keys:
 * invalidation becomes a single atomic write regardless of how many cached
 * entries exist, and stale entries fall off on their own TTL.
 */

const VERSION_KEY = 'cache:version';

async function currentVersion(env) {
  return (await env.CACHE.get(VERSION_KEY)) || '1';
}

export async function bumpVersion(env) {
  const next = String(Number(await currentVersion(env)) + 1);
  await env.CACHE.put(VERSION_KEY, next);
  return next;
}

export async function cached(env, key, producer) {
  const ttl = Number(env.CACHE_TTL || 60);
  const version = await currentVersion(env);
  const fullKey = `v${version}:${key}`;

  const hit = await env.CACHE.get(fullKey, 'json');
  if (hit) return { data: hit, hit: true };

  const data = await producer();

  // KV enforces a 60s floor on expirationTtl.
  await env.CACHE.put(fullKey, JSON.stringify(data), {
    expirationTtl: Math.max(60, ttl),
  });

  return { data, hit: false };
}

export const SYNC_HASH_KEY = 'sync:last-hash';
export const SYNC_TIME_KEY = 'sync:last-time';
