import { Hono } from 'hono';
import { loadSite, getProjects, getStatus } from '../lib/db.js';
import { cached } from '../lib/cache.js';

const app = new Hono();

/**
 * One payload for the entire website. A portfolio is small enough that a single
 * round trip beats five parallel ones, and it guarantees the page renders a
 * consistent snapshot rather than a mix of cache generations.
 */
app.get('/site', async (c) => {
  const { data, hit } = await cached(c.env, 'site', () => loadSite(c.env.DB));
  c.header('X-Cache', hit ? 'HIT' : 'MISS');
  c.header('Cache-Control', 'public, max-age=30');
  return c.json(data);
});

/** Polled every 60s by the live status card — cheapest possible endpoint. */
app.get('/status', async (c) => {
  const { data, hit } = await cached(c.env, 'status', () => getStatus(c.env.DB));
  c.header('X-Cache', hit ? 'HIT' : 'MISS');
  return c.json(data);
});

app.get('/projects', async (c) => {
  const { data, hit } = await cached(c.env, 'projects', () => getProjects(c.env.DB));
  c.header('X-Cache', hit ? 'HIT' : 'MISS');
  return c.json(data);
});

app.get('/projects/:slug', async (c) => {
  const slug = c.req.param('slug');
  const projects = await getProjects(c.env.DB);
  const project = projects.find((p) => p.slug === slug);
  if (!project) return c.json({ error: 'not found' }, 404);
  return c.json(project);
});

export default app;
