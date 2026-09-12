// Cloudflare Pages middleware — injects live SEO metadata into served HTML.
const CACHE_TTL = 300; // seconds

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

// Repoints an icon <link> at the uploaded favicon
class IconSetter {
  constructor(href) {
    this.href = href;
  }
  element(el) {
    el.setAttribute('href', this.href);
    el.removeAttribute('type');
    el.removeAttribute('sizes');
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
  const url = new URL(request.url);
  const response = await next();

  const type = response.headers.get('content-type') || '';

  // Return 404 for missing hashed assets rather than index.html fallback
  if (url.pathname.startsWith('/assets/') && type.includes('text/html')) {
    return new Response('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  // Only rewrite HTML documents — never assets, and never a 404.
  if (!type.includes('text/html') || !response.ok) return response;

  // Resolve API URL
  const rawApi = String(env.API_URL || 'https://portfolio-api.jayanthgopala21.workers.dev')
    .trim()
    .replace(/\/+$/, '');
  const apiUrl = /^https?:\/\//i.test(rawApi) ? rawApi : `https://${rawApi}`;
  if (!rawApi) return response;

  let site;
  try {
    const res = await fetch(`${apiUrl}/api/public/site`, {
      cf: { cacheTtl: CACHE_TTL, cacheEverything: true },
    });
    if (!res.ok) return response;
    site = await res.json();
  } catch {
    return response;
  }

  const content = site.content || {};
  const profile = site.profile || {};

  const title =
    content['seo.title'] ||
    [profile.name, profile.role].filter(Boolean).join(' — ') ||
    'Portfolio';

  const description = content['seo.description'] || profile.headline || '';
  const favicon = profile.faviconUrl ? esc(profile.faviconUrl) : '';
  const image = profile.avatarUrl ? esc(profile.avatarUrl) : '';
  const canonical = new URL(request.url).origin;

  // JSON-LD Person schema for search engines
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

  if (favicon) {
    rewriter = rewriter
      .on('link[rel="icon"]', new IconSetter(favicon))
      .on('link[rel="apple-touch-icon"]', new IconSetter(favicon));
  }

  if (image) {
    rewriter = rewriter
      .on('meta[property="og:image"]', new AttributeSetter('content', image))
      .on('meta[name="twitter:image"]', new AttributeSetter('content', image));
  }

  const rewritten = rewriter.transform(response);
  // Keep HTML responses un-cached at the edge to ensure fresh asset references
  rewritten.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  return rewritten;
}
