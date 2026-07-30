import { loadSite } from '../lib/db.js';

/**
 * Grounded Q&A about the site owner, running on Cloudflare Workers AI.
 *
 * The model is given the site's own content as context and told to answer only
 * from it. That matters more than model quality here: a portfolio bot that
 * invents a job you never had is worse than no bot, because visitors have no
 * way to tell the difference and it is your professional reputation.
 */

/**
 * Verified against `wrangler ai models` — there is no plain
 * `llama-3.1-8b-instruct` on Workers AI, only the fp8 build. A wrong id fails
 * at request time with a generic error, so the list is tried in order and the
 * fallback covers a model being retired without warning.
 */
const MODELS = ['@cf/meta/llama-3.1-8b-instruct-fp8', '@cf/meta/llama-3.2-3b-instruct'];
const MAX_QUESTION = 400;
const RATE_LIMIT = 12; // requests per window
const WINDOW_SECONDS = 60;

/** Compact the site payload into something worth spending context on. */
function buildContext(site) {
  const p = site.profile || {};
  const lines = [
    `Name: ${p.name}`,
    p.role && `Role: ${p.role}`,
    p.headline && `Headline: ${p.headline}`,
    p.description && `About: ${p.description}`,
    p.location && `Location: ${p.location}`,
    p.email && `Email: ${p.email}`,
  ].filter(Boolean);

  const projects = (site.projects || []).filter((x) => x.published);
  if (projects.length) {
    lines.push('', 'PROJECTS:');
    for (const x of projects) {
      lines.push(
        `- ${x.title}: ${x.summary || x.description || ''}` +
          (x.tech?.length ? ` [${x.tech.join(', ')}]` : '') +
          (x.liveUrl ? ` Live: ${x.liveUrl}` : '')
      );
    }
  }

  if (site.stack?.length) {
    const byCat = new Map();
    for (const s of site.stack) {
      if (!byCat.has(s.category)) byCat.set(s.category, []);
      byCat.get(s.category).push(s.name);
    }
    lines.push('', 'TECH STACK:');
    for (const [cat, names] of byCat) lines.push(`- ${cat}: ${names.join(', ')}`);
  }

  if (site.education?.length) {
    lines.push('', 'EDUCATION:');
    for (const e of site.education) {
      lines.push(
        `- ${e.qualification || ''} ${e.field ? `in ${e.field}` : ''} at ${e.institution}` +
          (e.period ? ` (${e.period})` : '') +
          (e.grade ? `, ${e.grade}` : '')
      );
    }
  }

  if (site.experience?.length) {
    lines.push('', 'EXPERIENCE & ACHIEVEMENTS:');
    for (const x of site.experience) {
      lines.push(
        `- [${x.kind}] ${x.title}` +
          (x.organisation ? ` at ${x.organisation}` : '') +
          (x.period ? ` (${x.period})` : '') +
          (x.description ? ` — ${x.description}` : '')
      );
    }
  }

  if (site.socials?.length) {
    lines.push('', 'LINKS:');
    for (const s of site.socials) lines.push(`- ${s.label}: ${s.url}`);
  }

  return lines.join('\n');
}

function systemPrompt(context, name) {
  return `You answer questions about ${name} for visitors to their portfolio site.

SCOPE: you answer ONLY questions about ${name} — their work, projects, skills,
education, background and how to reach them. For anything else (general
knowledge, coding help, opinions, current events, comparisons of tools, writing
tasks) reply with exactly one sentence saying you can only answer questions
about ${name}. Do not attempt the task, do not partially answer, do not explain
what you would say. A visitor asking you to write code or compare frameworks
gets the refusal, nothing more.

Use ONLY the information below. If a question is about ${name} but the answer is
not in it, say you do not have that detail and suggest they email ${name}
directly. Never guess, never invent employers, dates, qualifications or
projects — the person's professional reputation depends on this.

Answer in at most three sentences, in a warm, plain, professional register.
Refer to ${name} in the third person. Do not use markdown headings or bullet
lists; write prose.

--- INFORMATION ---
${context}
--- END ---`;
}

/**
 * Per-IP rate limit in KV. The endpoint is unauthenticated and every call costs
 * Workers AI quota, so without this a single script could burn the daily
 * allowance in a minute.
 */
async function rateLimited(env, ip) {
  const key = `ask:rate:${ip}`;
  const current = Number((await env.CACHE.get(key)) || 0);
  if (current >= RATE_LIMIT) return true;

  // expirationTtl has a 60s floor, which matches our window anyway.
  await env.CACHE.put(key, String(current + 1), { expirationTtl: WINDOW_SECONDS });
  return false;
}

/**
 * Registered directly on the root app rather than as a mounted sub-app: a Hono
 * sub-route at '/' does not reliably match the mount path itself, which showed
 * up here as a 404 on POST /api/ask.
 */
export async function askHandler(c) {
  if (!c.env.AI) {
    return c.json({ error: 'The assistant is not configured on this deployment.' }, 503);
  }

  const body = await c.req.json().catch(() => ({}));
  const question = String(body.question || '').trim().slice(0, MAX_QUESTION);
  if (!question) return c.json({ error: 'Ask a question first.' }, 400);

  const ip = c.req.header('CF-Connecting-IP') || 'unknown';
  if (await rateLimited(c.env, ip)) {
    return c.json({ error: 'Too many questions just now — try again in a minute.' }, 429);
  }

  const site = await loadSite(c.env.DB);
  const name = site.profile?.name || 'the site owner';

  const payload = {
    messages: [
      { role: 'system', content: systemPrompt(buildContext(site), name) },
      { role: 'user', content: question },
    ],
    max_tokens: 260,
    temperature: 0.3, // low: this is recall, not creative writing
  };

  let lastError = '';
  for (const model of MODELS) {
    try {
      const result = await c.env.AI.run(model, payload);
      const answer = String(result?.response || '').trim();
      if (answer) return c.json({ answer });
      lastError = 'empty response';
    } catch (err) {
      lastError = String(err?.message || err);
      console.error(`ask: ${model} failed — ${lastError}`);
    }
  }

  console.error(`ask: all models failed — ${lastError}`);
  return c.json(
    { error: `Couldn't answer that one. Email ${site.profile?.email || name} directly.` },
    502
  );
}
