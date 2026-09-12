// R2 bucket garbage collection for unreferenced media objects

// Grace period before unreferenced uploads can be pruned
const GRACE_MS = 2 * 60 * 60 * 1000;

// Set of all R2 keys referenced by database rows
async function referencedKeys(db) {
  const [profile, projects] = await Promise.all([
    db.prepare('SELECT avatar_url, cinematic_avatar_url, favicon_url FROM profile').all(),
    db.prepare('SELECT screenshot FROM projects').all(),
  ]);

  const keys = new Set();
  const add = (url) => {
    const key = String(url || '').split('/media/')[1];
    if (key) keys.add(decodeURIComponent(key));
  };

  for (const row of profile.results || []) {
    add(row.avatar_url);
    add(row.cinematic_avatar_url);
    add(row.favicon_url);
  }
  for (const row of projects.results || []) add(row.screenshot);

  return keys;
}

// Deletes orphaned R2 objects older than grace period
export async function reapOrphans(env) {
  const keep = await referencedKeys(env.DB);
  const cutoff = Date.now() - GRACE_MS;
  const deleted = [];

  let cursor;
  do {
    const page = await env.MEDIA.list({ cursor, limit: 500 });
    const stale = page.objects.filter(
      (o) => !keep.has(o.key) && new Date(o.uploaded).getTime() < cutoff
    );
    if (stale.length) {
      await env.MEDIA.delete(stale.map((o) => o.key));
      deleted.push(...stale.map((o) => o.key));
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return deleted;
}
