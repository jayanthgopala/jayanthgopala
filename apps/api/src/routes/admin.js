import { Hono } from 'hono';
import {
  loadSite,
  getProfile,
  getStatus,
  getProjects,
  getStack,
  getSocials,
  getContentRows,
  getEducation,
  getExperience,
  rowToProject,
  contentHash,
} from '../lib/db.js';
import { bumpVersion, SYNC_HASH_KEY, SYNC_TIME_KEY } from '../lib/cache.js';
import { syncProfile, syncInBackground, recentSyncs } from '../lib/sync.js';
import { renderReadme } from '../lib/readme.js';
import { fetchGitHubUser } from '../lib/github.js';
import { reapOrphans } from '../lib/media.js';
import { visitorStats } from '../lib/visitors.js';

const app = new Hono();

/**
 * Every mutation funnels through here: invalidate the public cache, then push
 * to GitHub in the background. The operator's request returns immediately.
 */
async function afterWrite(c, { media = false } = {}) {
  await bumpVersion(c.env);
  syncInBackground(c, 'auto');
  // Writes that can leave an image unreferenced reconcile the bucket against
  // the database afterwards. Backgrounded — the panel must not wait on R2.
  if (media) {
    c.executionCtx.waitUntil(
      reapOrphans(c.env)
        .then((keys) => keys.length && console.log('reaped R2:', keys.join(', ')))
        .catch((e) => console.error('reap failed:', e.message))
    );
  }
}

/** Whitelist-based update builder — never interpolate client keys into SQL. */
function buildUpdate(table, allowed, body, where) {
  const sets = [];
  const values = [];
  for (const [column, transform] of Object.entries(allowed)) {
    if (body[column] === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(transform(body[column]));
  }
  if (!sets.length) return null;
  sets.push("updated_at = datetime('now')");
  return { sql: `UPDATE ${table} SET ${sets.join(', ')} WHERE ${where}`, values };
}

const str = (v) => String(v ?? '');
const int = (v) => Number.parseInt(v, 10) || 0;
const bool = (v) => (v ? 1 : 0);
const num = (v) => Number(v) || 0;
const json = (v) => JSON.stringify(Array.isArray(v) ? v : []);

// --- Overview -------------------------------------------------------------

app.get('/overview', async (c) => {
  const [site, syncs, lastSync, visitors] = await Promise.all([
    loadSite(c.env.DB, { includeDrafts: true }),
    recentSyncs(c.env, 8),
    c.env.CACHE.get(SYNC_TIME_KEY),
    visitorStats(c.env),
  ]);

  return c.json({
    counts: {
      projects: site.projects.length,
      published: site.projects.filter((p) => p.published).length,
      stack: site.stack.length,
      socials: site.socials.length,
    },
    status: site.status,
    lastSyncAt: lastSync,
    visitors,
    syncs,
  });
});

// --- Profile --------------------------------------------------------------

app.get('/profile', async (c) => c.json(await getProfile(c.env.DB)));

/** Image-bearing writes sweep R2 afterwards; see lib/media.js. */
app.put('/profile', async (c) => {
  const body = await c.req.json();
  const update = buildUpdate(
    'profile',
    {
      name: str, role: str, headline: str, description: str,
      location: str, email: str, avatar_url: str, cinematic_avatar_url: str,
      favicon_url: str,
      resume_url: str, github_user: str, cta_primary: str, cta_secondary: str,
    },
    body,
    'id = 1'
  );
  if (!update) return c.json({ error: 'no valid fields' }, 400);

  await c.env.DB.prepare(update.sql).bind(...update.values).run();
  await afterWrite(c, { media: true });
  return c.json(await getProfile(c.env.DB));
});

// --- Status ---------------------------------------------------------------

app.get('/status', async (c) => c.json(await getStatus(c.env.DB)));

app.put('/status', async (c) => {
  const body = await c.req.json();
  const update = buildUpdate(
    'status',
    {
      available: bool, availability_note: str,
      current_project: str, current_project_url: str, current_progress: int,
      deploy_label: str, deploy_state: str, deploy_at: str,
      github_state: str, health_state: str, health_uptime: num, timezone: str,
    },
    body,
    'id = 1'
  );
  if (!update) return c.json({ error: 'no valid fields' }, 400);

  await c.env.DB.prepare(update.sql).bind(...update.values).run();
  await afterWrite(c);
  return c.json(await getStatus(c.env.DB));
});

// --- Projects -------------------------------------------------------------

app.get('/projects', async (c) => c.json(await getProjects(c.env.DB, { includeDrafts: true })));

app.post('/projects', async (c) => {
  const b = await c.req.json();
  if (!b.title) return c.json({ error: 'title is required' }, 400);

  const slug =
    str(b.slug).trim() ||
    str(b.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const next = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM projects'
  ).first();

  try {
    const row = await c.env.DB.prepare(
      `INSERT INTO projects
        (slug, title, summary, description, screenshot, tech, live_url, repo_url,
         accent, featured, published, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    )
      .bind(
        slug, str(b.title), str(b.summary), str(b.description), str(b.screenshot),
        json(b.tech), str(b.liveUrl), str(b.repoUrl), str(b.accent) || 'iris',
        bool(b.featured ?? true), bool(b.published ?? true), next?.n ?? 0
      )
      .first();

    await afterWrite(c);
    return c.json(rowToProject(row), 201);
  } catch (err) {
    if (String(err).includes('UNIQUE')) {
      return c.json({ error: `slug "${slug}" already exists` }, 409);
    }
    throw err;
  }
});

app.patch('/projects/:id', async (c) => {
  const id = int(c.req.param('id'));
  const body = await c.req.json();

  // Map the API's camelCase onto column names before building the update.
  const mapped = {
    ...body,
    live_url: body.liveUrl,
    repo_url: body.repoUrl,
    sort_order: body.sortOrder,
  };

  const update = buildUpdate(
    'projects',
    {
      slug: str, title: str, summary: str, description: str, screenshot: str,
      tech: json, live_url: str, repo_url: str, accent: str,
      featured: bool, published: bool, sort_order: int,
    },
    mapped,
    'id = ?'
  );
  if (!update) return c.json({ error: 'no valid fields' }, 400);

  const row = await c.env.DB.prepare(`${update.sql} RETURNING *`)
    .bind(...update.values, id)
    .first();
  if (!row) return c.json({ error: 'not found' }, 404);

  await afterWrite(c, { media: true });
  return c.json(rowToProject(row));
});

app.delete('/projects/:id', async (c) => {
  const id = int(c.req.param('id'));
  const project = await c.env.DB.prepare('SELECT screenshot FROM projects WHERE id = ?')
    .bind(id)
    .first();

  await c.env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id).run();

  // Reclaim the R2 object so deleted projects don't leave orphaned uploads.
  // Immediate rather than left to the sweep: this one is unambiguous, and the
  // sweep's grace period would otherwise keep a just-uploaded screenshot.
  const key = String(project?.screenshot || '').split('/media/')[1];
  if (key) await c.env.MEDIA.delete(decodeURIComponent(key)).catch(() => {});

  await afterWrite(c, { media: true });
  return c.json({ ok: true });
});

/** Accepts the full ordered list of ids — simpler and race-free vs. deltas. */
app.post('/projects/reorder', async (c) => {
  const { ids } = await c.req.json();
  if (!Array.isArray(ids)) return c.json({ error: 'ids must be an array' }, 400);

  await c.env.DB.batch(
    ids.map((id, index) =>
      c.env.DB.prepare('UPDATE projects SET sort_order = ? WHERE id = ?').bind(index, int(id))
    )
  );

  await afterWrite(c);
  return c.json(await getProjects(c.env.DB, { includeDrafts: true }));
});

// --- Stack ----------------------------------------------------------------

app.get('/stack', async (c) => c.json(await getStack(c.env.DB)));

app.post('/stack', async (c) => {
  const b = await c.req.json();
  if (!b.name) return c.json({ error: 'name is required' }, 400);

  const next = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM stack'
  ).first();

  const row = await c.env.DB.prepare(
    'INSERT INTO stack (name, category, level, sort_order) VALUES (?, ?, ?, ?) RETURNING *'
  )
    .bind(str(b.name), str(b.category) || 'Other', int(b.level) || 80, next?.n ?? 0)
    .first();

  await afterWrite(c);
  return c.json(row, 201);
});

app.patch('/stack/:id', async (c) => {
  const update = buildUpdate(
    'stack',
    { name: str, category: str, level: int, sort_order: int },
    await c.req.json(),
    'id = ?'
  );
  if (!update) return c.json({ error: 'no valid fields' }, 400);

  // `stack` has no updated_at column; drop the trailing timestamp assignment.
  const sql = update.sql.replace(", updated_at = datetime('now')", '');
  const row = await c.env.DB.prepare(`${sql} RETURNING *`)
    .bind(...update.values, int(c.req.param('id')))
    .first();

  await afterWrite(c);
  return c.json(row);
});

app.delete('/stack/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM stack WHERE id = ?').bind(int(c.req.param('id'))).run();
  await afterWrite(c);
  return c.json({ ok: true });
});

// --- Socials --------------------------------------------------------------

app.get('/socials', async (c) => c.json(await getSocials(c.env.DB)));

app.post('/socials', async (c) => {
  const b = await c.req.json();
  if (!b.label || !b.url) return c.json({ error: 'label and url are required' }, 400);

  const next = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM socials'
  ).first();

  const row = await c.env.DB.prepare(
    `INSERT INTO socials (label, url, icon, show_in_readme, sort_order)
     VALUES (?, ?, ?, ?, ?) RETURNING *`
  )
    .bind(str(b.label), str(b.url), str(b.icon) || 'link', bool(b.showInReadme ?? true), next?.n ?? 0)
    .first();

  await afterWrite(c);
  return c.json(row, 201);
});

app.patch('/socials/:id', async (c) => {
  const body = await c.req.json();
  const update = buildUpdate(
    'socials',
    { label: str, url: str, icon: str, show_in_readme: bool, sort_order: int },
    { ...body, show_in_readme: body.showInReadme, sort_order: body.sortOrder },
    'id = ?'
  );
  if (!update) return c.json({ error: 'no valid fields' }, 400);

  const sql = update.sql.replace(", updated_at = datetime('now')", '');
  const row = await c.env.DB.prepare(`${sql} RETURNING *`)
    .bind(...update.values, int(c.req.param('id')))
    .first();

  await afterWrite(c);
  return c.json(row);
});

app.delete('/socials/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM socials WHERE id = ?').bind(int(c.req.param('id'))).run();
  await afterWrite(c);
  return c.json({ ok: true });
});

// --- Education & experience ------------------------------------------------
//
// Both are ordered lists with the same lifecycle, so one factory serves both
// rather than two near-identical blocks of CRUD.

function listRoutes({ path, table, read, columns, required }) {
  app.get(path, async (c) => c.json(await read(c.env.DB, { includeDrafts: true })));

  app.post(path, async (c) => {
    const body = await c.req.json();
    for (const field of required) {
      if (!body[field]) return c.json({ error: `${field} is required` }, 400);
    }

    const next = await c.env.DB.prepare(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM ${table}`
    ).first();

    const names = Object.keys(columns);
    const values = names.map((col) => columns[col](body[toCamel(col)] ?? body[col]));

    await c.env.DB.prepare(
      `INSERT INTO ${table} (${names.join(',')}, sort_order)
       VALUES (${names.map(() => '?').join(',')}, ?)`
    )
      .bind(...values, next?.n ?? 0)
      .run();

    await afterWrite(c);
    return c.json(await read(c.env.DB, { includeDrafts: true }), 201);
  });

  app.patch(`${path}/:id`, async (c) => {
    const body = await c.req.json();
    const mapped = {};
    for (const col of Object.keys(columns)) {
      const camel = toCamel(col);
      if (body[camel] !== undefined) mapped[col] = body[camel];
      else if (body[col] !== undefined) mapped[col] = body[col];
    }
    if (body.sortOrder !== undefined) mapped.sort_order = body.sortOrder;

    const update = buildUpdate(table, { ...columns, sort_order: int }, mapped, 'id = ?');
    if (!update) return c.json({ error: 'no valid fields' }, 400);

    // Neither table has updated_at.
    const sql = update.sql.replace(", updated_at = datetime('now')", '');
    await c.env.DB.prepare(sql).bind(...update.values, int(c.req.param('id'))).run();

    await afterWrite(c);
    return c.json(await read(c.env.DB, { includeDrafts: true }));
  });

  app.delete(`${path}/:id`, async (c) => {
    await c.env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`)
      .bind(int(c.req.param('id')))
      .run();
    await afterWrite(c);
    return c.json({ ok: true });
  });

  app.post(`${path}/reorder`, async (c) => {
    const { ids } = await c.req.json();
    if (!Array.isArray(ids)) return c.json({ error: 'ids must be an array' }, 400);

    await c.env.DB.batch(
      ids.map((id, i) =>
        c.env.DB.prepare(`UPDATE ${table} SET sort_order = ? WHERE id = ?`).bind(i, int(id))
      )
    );

    await afterWrite(c);
    return c.json(await read(c.env.DB, { includeDrafts: true }));
  });
}

const toCamel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

listRoutes({
  path: '/education',
  table: 'education',
  read: getEducation,
  required: ['institution'],
  columns: {
    institution: str, qualification: str, field: str, period: str,
    location: str, grade: str, description: str, published: bool,
  },
});

listRoutes({
  path: '/experience',
  table: 'experience',
  read: getExperience,
  required: ['title'],
  columns: {
    kind: str, title: str, organisation: str, period: str, location: str,
    description: str, url: str, tech: json, published: bool,
  },
});

// --- Site copy -------------------------------------------------------------

app.get('/content', async (c) => c.json(await getContentRows(c.env.DB)));

/**
 * Bulk update. The editor saves the whole form at once, and a single batch is
 * both faster and atomic — a half-applied set of headings is worse than none.
 * Unknown keys are ignored rather than inserted: the key list is defined by the
 * schema, not by whatever the client posts.
 */
app.put('/content', async (c) => {
  const body = await c.req.json();
  const entries = Object.entries(body || {}).filter(([, v]) => typeof v === 'string');

  if (!entries.length) return c.json({ error: 'no values supplied' }, 400);

  await c.env.DB.batch(
    entries.map(([key, value]) =>
      c.env.DB.prepare('UPDATE content SET value = ? WHERE key = ?').bind(value, key)
    )
  );

  await afterWrite(c);
  return c.json(await getContentRows(c.env.DB));
});

// --- Media ----------------------------------------------------------------

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif'];
const MAX_BYTES = 5 * 1024 * 1024;

app.post('/media', async (c) => {
  const form = await c.req.formData();
  const file = form.get('file');

  if (!file || typeof file === 'string') return c.json({ error: 'file is required' }, 400);
  if (!ALLOWED_TYPES.includes(file.type)) {
    return c.json({ error: `unsupported type: ${file.type}` }, 415);
  }
  if (file.size > MAX_BYTES) return c.json({ error: 'file exceeds 5MB' }, 413);

  const ext = (file.name.split('.').pop() || 'png').toLowerCase().slice(0, 5);
  const key = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

  await c.env.MEDIA.put(key, file.stream(), {
    httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' },
  });

  const base = String(c.env.PUBLIC_API_URL || '').replace(/\/$/, '');
  return c.json({ key, url: `${base}/media/${key}` }, 201);
});

app.delete('/media/:key', async (c) => {
  await c.env.MEDIA.delete(c.req.param('key'));
  return c.json({ ok: true });
});

// --- GitHub sync ----------------------------------------------------------

app.get('/readme/preview', async (c) => {
  const site = await loadSite(c.env.DB);
  return c.text(renderReadme(site, c.env));
});

/** Manual publish always forces, even when the hash is unchanged. */
app.post('/sync', async (c) => {
  try {
    const result = await syncProfile(c.env, { trigger: 'manual', force: true });
    return c.json({ ok: true, ...result });
  } catch (error) {
    return c.json({ ok: false, error: String(error.message || error) }, 502);
  }
});

app.get('/sync/log', async (c) => c.json(await recentSyncs(c.env, 50)));

/**
 * Compares the live content hash against the last successfully published one.
 * Drives the "unpublished changes" indicator, and makes the cron's skip
 * decision observable instead of something you infer from an absent commit.
 */
app.get('/sync/state', async (c) => {
  const site = await loadSite(c.env.DB);
  const current = await contentHash(site);
  const [published, lastAt] = await Promise.all([
    c.env.CACHE.get(SYNC_HASH_KEY),
    c.env.CACHE.get(SYNC_TIME_KEY),
  ]);

  return c.json({
    currentHash: current,
    publishedHash: published,
    hasUnpublishedChanges: published !== current,
    lastSyncAt: lastAt,
  });
});

/** Confirms the PAT works before the operator relies on it. */
app.get('/github/check', async (c) => {
  const user = await fetchGitHubUser(c.env);
  if (!user) return c.json({ ok: false, error: 'token invalid or user not found' }, 502);
  return c.json({ ok: true, user });
});

export default app;
