import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requireAuth } from './lib/auth.js';
import { loadSite } from './lib/db.js';
import { statusCardSvg, metricsCardSvg, svgResponse } from './lib/svg.js';
import { bannerSvg } from './lib/banner.js';
import { bumpViews, viewsSvg, viewsResponse } from './lib/views.js';
import { syncProfile } from './lib/sync.js';
import { reapOrphans } from './lib/media.js';
import publicRoutes from './routes/public.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import { askHandler, TONES, DEFAULT_TONE } from './routes/ask.js';

const app = new Hono();

/**
 * Credentialed CORS cannot use a wildcard origin — the admin panel sends its
 * session cookie, so we echo back only origins on the allow-list.
 */
app.use('*', (c, next) =>
  cors({
    origin: (origin) => {
      const allowed = String(c.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
      return allowed.includes(origin) ? origin : null;
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })(c, next)
);

app.get('/', (c) =>
  c.json({
    name: 'portfolio-api',
    endpoints: {
      site: '/api/public/site',
      status: '/api/public/status',
      projects: '/api/public/projects',
      statusCard: '/svg/status.svg',
      metricsCard: '/svg/metrics.svg',
    },
  })
);

app.get('/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));

// --- Live SVG cards embedded in the GitHub README --------------------------
// Rendered per request, so the profile updates with no commit.

app.get('/svg/status.svg', async (c) => {
  const site = await loadSite(c.env.DB);
  return svgResponse(statusCardSvg(site));
});

app.get('/svg/metrics.svg', async (c) => {
  const site = await loadSite(c.env.DB);
  return svgResponse(metricsCardSvg(site));
});

/**
 * Animated profile banner, one endpoint per palette. The README embeds both in
 * a <picture> so GitHub picks the right one for the viewer's theme — the same
 * asset can't do both, because SVG served as an <img> has no access to the
 * host page's colour scheme.
 */
app.get('/svg/banner-dark.svg', async (c) => {
  const site = await loadSite(c.env.DB);
  return svgResponse(bannerSvg(site, 'dark'));
});

app.get('/svg/banner-light.svg', async (c) => {
  const site = await loadSite(c.env.DB);
  return svgResponse(bannerSvg(site, 'light'));
});

app.get('/svg/views.svg', async (c) => {
  const count = await bumpViews(c.env);
  const site = await loadSite(c.env.DB);
  const label = site.content?.['views.label'] || 'Profile views';
  return viewsResponse(viewsSvg(count, label));
});

/**
 * Star / fork counts for the site's GitHub buttons.
 *
 * Proxied rather than called from the browser so the numbers are cached at the
 * edge instead of spending each visitor's 60-req/hour unauthenticated GitHub
 * rate limit — a handful of visitors would otherwise exhaust it and the buttons
 * would show nothing.
 */
app.get('/api/public/repo-stats', async (c) => {
  const owner = c.env.GITHUB_USER;
  const repo = c.req.query('repo') || c.env.GITHUB_REPO;
  const cacheKey = `repo:${owner}/${repo}`;

  const hit = await c.env.CACHE.get(cacheKey, 'json');
  if (hit) return c.json(hit);

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'portfolio-worker',
        ...(c.env.GITHUB_TOKEN ? { Authorization: `Bearer ${c.env.GITHUB_TOKEN}` } : {}),
      },
    });
    if (!res.ok) return c.json({ stars: null, forks: null }, 200);

    const j = await res.json();
    const data = {
      stars: j.stargazers_count ?? null,
      forks: j.forks_count ?? null,
      url: j.html_url,
      owner,
      repo,
    };
    await c.env.CACHE.put(cacheKey, JSON.stringify(data), { expirationTtl: 900 });
    return c.json(data);
  } catch {
    // Buttons still render and still link to GitHub; they just lose the count.
    return c.json({ stars: null, forks: null }, 200);
  }
});

// --- R2 media --------------------------------------------------------------

app.get('/media/:key', async (c) => {
  const object = await c.env.MEDIA.get(c.req.param('key'));
  if (!object) return c.notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  return new Response(object.body, { headers });
});

// --- Routes ----------------------------------------------------------------

app.route('/api/public', publicRoutes);
app.route('/api/auth', authRoutes);
app.post('/api/ask', askHandler);

// Voice presets, so the widget renders whatever the Worker actually supports
// rather than a hardcoded list that can drift out of sync.
// Deliberately NOT /api/ask/tones — a GET under the same prefix as the POST
// route would not match and returned 404.
app.get('/api/tones', (c) =>
  c.json({
    default: DEFAULT_TONE,
    tones: Object.entries(TONES).map(([id, t]) => ({ id, label: t.label })),
  })
);
app.use('/api/admin/*', requireAuth());
app.route('/api/admin', adminRoutes);

app.notFound((c) => c.json({ error: 'not found' }, 404));

app.onError((err, c) => {
  console.error('unhandled error:', err);
  return c.json({ error: 'internal error', detail: String(err.message || err) }, 500);
});

export default {
  fetch: app.fetch,

  /**
   * Cron self-heal. Not forced: if the content hash matches the last successful
   * push this is a no-op, so an unchanged profile never produces a commit.
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      syncProfile(env, { trigger: 'cron' })
        .then((r) => console.log('cron sync:', JSON.stringify(r)))
        .catch((e) => console.error('cron sync failed:', e.message))
    );

    // Backstop for the per-write sweep: a request that ends early can lose its
    // waitUntil, so orphans get one more chance every half hour.
    ctx.waitUntil(
      reapOrphans(env)
        .then((keys) => keys.length && console.log('cron reaped R2:', keys.join(', ')))
        .catch((e) => console.error('cron reap failed:', e.message))
    );
  },
};
