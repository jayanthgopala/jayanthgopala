/**
 * R2 garbage collection.
 *
 * Uploads happen the moment a file is chosen, but the URL only reaches the
 * database when the form is saved. So R2 is *ahead* of the DB by design, and
 * deleting eagerly from the admin panel gets it wrong in both directions:
 * remove-then-cancel leaves the DB pointing at a file that is gone, and
 * replace-then-cancel deletes the image still in use.
 *
 * Reconciling instead of tracking sidesteps all of it. The database is the only
 * authority on what is referenced; anything in the bucket that nothing points
 * at is garbage, however it got that way.
 */

// Objects younger than this are never touched — they are almost certainly an
// upload sitting in a form that has not been saved yet.
const GRACE_MS = 2 * 60 * 60 * 1000;

/** Every R2 key the database currently points at, across all three columns. */
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

/**
 * Deletes every object no row points at. Safe to call after any write and from
 * cron; it converges on the same state either way.
 */
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
