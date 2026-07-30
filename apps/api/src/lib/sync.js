import { loadSite, contentHash } from './db.js';
import { renderReadme, COMMIT_PREFIX } from './readme.js';
import { pushReadme } from './github.js';
import { SYNC_HASH_KEY, SYNC_TIME_KEY } from './cache.js';

/**
 * Renders and publishes the GitHub profile README.
 *
 * `force: false` (the default for automatic triggers) short-circuits when the
 * content hash matches the last successful push — that is what keeps the
 * contribution graph free of empty commits.
 */
export async function syncProfile(env, { trigger = 'manual', force = false } = {}) {
  const site = await loadSite(env.DB);
  const hash = await contentHash(site);

  if (!force) {
    const lastHash = await env.CACHE.get(SYNC_HASH_KEY);
    if (lastHash === hash) {
      return { skipped: true, reason: 'no content change', hash };
    }
  }

  const markdown = renderReadme(site, env);
  const message = `${COMMIT_PREFIX} (${trigger})`;

  try {
    const { commitSha, commitUrl } = await pushReadme(env, markdown, message);

    await env.CACHE.put(SYNC_HASH_KEY, hash);
    await env.CACHE.put(SYNC_TIME_KEY, new Date().toISOString());
    await logSync(env, { trigger, ok: true, message: 'README published', commitSha });

    return { skipped: false, commitSha, commitUrl, hash };
  } catch (error) {
    // Deliberately do NOT store the hash on failure — the cron job will retry.
    await logSync(env, { trigger, ok: false, message: String(error.message || error) });
    throw error;
  }
}

export async function logSync(env, { trigger, ok, message, commitSha = '' }) {
  await env.DB.prepare(
    'INSERT INTO sync_log (trigger, ok, message, commit_sha) VALUES (?, ?, ?, ?)'
  )
    .bind(trigger, ok ? 1 : 0, String(message).slice(0, 500), commitSha)
    .run();
}

export async function recentSyncs(env, limit = 20) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM sync_log ORDER BY created_at DESC, id DESC LIMIT ?'
  )
    .bind(limit)
    .all();

  return (results || []).map((r) => ({
    id: r.id,
    trigger: r.trigger,
    ok: !!r.ok,
    message: r.message,
    commitSha: r.commit_sha,
    createdAt: r.created_at,
  }));
}

/**
 * Fire-and-forget sync used after admin writes. Never rejects — a GitHub
 * outage must not turn a successful content save into a 500 for the operator.
 */
export function syncInBackground(c, trigger = 'auto') {
  c.executionCtx.waitUntil(
    syncProfile(c.env, { trigger }).catch((err) => {
      console.error('background sync failed:', err.message);
    })
  );
}
