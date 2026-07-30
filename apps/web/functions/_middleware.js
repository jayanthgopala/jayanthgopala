/**
 * Cloudflare Pages middleware — injects live SEO metadata into the served HTML.
 *
 * Why this exists: the site is a client-rendered SPA, so `index.html` ships
 * whatever `<title>` and OG tags were baked in at build time. Google executes
 * JS and would eventually see the updated values, but the crawlers that matter
 * for link previews — LinkedIn, Slack, X, WhatsApp, Discord — read the raw
 * HTML response and never run a line of JavaScript. Setting these from React
 * therefore fixes search but not sharing.
 *
 * HTMLRewriter streams the rewrite at the edge, so this costs no measurable
 * latency and the document still starts flushing immediately.
 *
 * Configure `API_URL` in the Pages project's environment variables.
 */

const CACHE_TTL = 300; // seconds — SEO copy changes rarely

const esc = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

class AttributeSetter {
  constructor(attribute, value) {
    this.attribute = attribute;
    this.value = value;
  }
  element(el) {
    el.setAttribute(this.attribute, this.value);
  }
}

class TextSetter {
  constructor(value) {
    this.value = value;
  }
  element(el) {
    el.setInnerContent(this.value);
  }
}

export async function onRequest(context) {
  const { request, next, env } = context;
  const response = await next();

  // Only rewrite HTML documents — never assets, and never a 404.
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html') || !response.ok) return response;

  const apiUrl = String(env.API_URL || '').replace(/\/$/, '');
  if (!apiUrl) return response; // not configured — serve the static head

  let site;
  try {
    const res = await fetch(`${apiUrl}/api/public/site`, {
      cf: { cacheTtl: CACHE_TTL, cacheEverything: true },
    });
    if (!res.ok) return response;
    site = await res.json();
  } catch {
    // A metadata fetch must never take the page down with it.
    return response;
  }

  const content = site.content || {};
  const profile = site.profile || {};

  const title =
    content['seo.title'] ||
    [profile.name, profile.role].filter(Boolean).join(' — ') ||
    'Portfolio';

  const description = content['seo.description'] || profile.headline || '';
  const image = profile.avatarUrl ? esc(profile.avatarUrl) : '';
  const canonical = new URL(request.url).origin;

  let rewriter = new HTMLRewriter()
    .on('title', new TextSetter(title))
    .on('meta[name="description"]', new AttributeSetter('content', description))
    .on('meta[property="og:title"]', new AttributeSetter('content', title))
    .on('meta[property="og:description"]', new AttributeSetter('content', description))
    .on('meta[property="og:url"]', new AttributeSetter('content', canonical))
    .on('meta[name="twitter:title"]', new AttributeSetter('content', title))
    .on('meta[name="twitter:description"]', new AttributeSetter('content', description));

  if (image) {
    rewriter = rewriter
      .on('meta[property="og:image"]', new AttributeSetter('content', image))
      .on('meta[name="twitter:image"]', new AttributeSetter('content', image));
  }

  const rewritten = rewriter.transform(response);
  // Short shared cache so an edited title propagates without a redeploy.
  rewritten.headers.set('Cache-Control', `public, max-age=0, s-maxage=${CACHE_TTL}`);
  return rewritten;
}
