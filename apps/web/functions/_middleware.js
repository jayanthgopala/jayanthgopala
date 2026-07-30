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

  // Runtime variable, not build-time — but defaulted for the same reason as the
  // client: without it the page silently serves placeholder link previews.
  // Same normalisation as the client: a scheme-less value would make the
  // fetch below relative to the Worker itself and quietly return HTML.
  const rawApi = String(env.API_URL || 'https://portfolio-api.jayanthgopala21.workers.dev')
    .trim()
    .replace(/\/+$/, '');
  const apiUrl = /^https?:\/\//i.test(rawApi) ? rawApi : `https://${rawApi}`;
  if (!rawApi) return response; // not configured — serve the static head

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

  /**
   * JSON-LD Person schema.
   *
   * This is the piece that lets a search engine treat "Jayanth Gopala V" as an
   * entity rather than a string of words on a page. `sameAs` is the important
   * field: it links this site to the profiles that already rank, which is how
   * a crawler learns they are the same person.
   *
   * Injected here rather than in index.html so it always reflects live content,
   * and so it is present in the raw HTML for crawlers that never run JS.
   */
  const personSchema = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: profile.name,
    url: canonical,
    image: `${canonical}/og-image.jpg`,
    jobTitle: profile.role || undefined,
    description: description || undefined,
    email: profile.email ? `mailto:${profile.email}` : undefined,
    address: profile.location
      ? { '@type': 'PostalAddress', addressLocality: profile.location }
      : undefined,
    sameAs: (site.socials || [])
      .map((s) => s.url)
      .filter((u) => /^https?:\/\//i.test(u)),
    knowsAbout: (site.stack || []).map((s) => s.name).slice(0, 20),
    alumniOf: (site.education || []).map((e) => ({
      '@type': 'EducationalOrganization',
      name: e.institution,
    })),
  };

  // Drop empty keys — Google's validator flags them and they add bytes.
  const cleanSchema = JSON.stringify(personSchema, (_, v) => {
    if (v === undefined || v === null || v === '') return undefined;
    if (Array.isArray(v) && v.length === 0) return undefined;
    return v;
  });

  class SchemaInjector {
    element(el) {
      // `</head>` is the safe anchor: scripts appended here never block paint.
      el.append(
        `<script type="application/ld+json">${cleanSchema.replace(/</g, '\\u003c')}</script>`,
        { html: true }
      );
    }
  }

  let rewriter = new HTMLRewriter()
    .on('head', new SchemaInjector())
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
