/**
 * Profile view counter for the README.
 *
 * Counts are approximate by design. GitHub proxies README images through camo,
 * which caches aggressively, so a share of views never reach this Worker no
 * matter what headers we send. `no-store` gets most of them through; treating
 * the number as a rough signal rather than analytics is the honest framing.
 */

const KEY = 'views:total';

const T = {
  bg: '#0D0D10',
  border: '#1E1E24',
  text: '#F5F5F7',
  dim: '#6E6E7A',
  accent: '#63D2C3',
};

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif";

/**
 * KV is eventually consistent and has no atomic increment, so two views landing
 * together can read the same value and write the same result. For a vanity
 * counter that's an acceptable trade against the cost of a Durable Object.
 */
export async function bumpViews(env) {
  const current = Number((await env.CACHE.get(KEY)) || 0);
  const next = current + 1;
  await env.CACHE.put(KEY, String(next));
  return next;
}

export function viewsSvg(count, label = 'Profile views') {
  const digits = String(count);
  const labelW = label.length * 6.4 + 22;
  const countW = digits.length * 8.5 + 22;
  const W = Math.round(labelW + countW);
  const H = 28;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}: ${count}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#6E7BFF"/>
      <stop offset="100%" stop-color="${T.accent}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="14" fill="${T.bg}"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="13.5" fill="none" stroke="${T.border}"/>
  <rect x="${Math.round(labelW)}" y="1" width="${W - Math.round(labelW) - 1}" height="${H - 2}" rx="13" fill="url(#g)" opacity="0.14"/>
  <circle cx="15" cy="14" r="3.2" fill="${T.accent}">
    <animate attributeName="opacity" values="1;0.35;1" dur="2.6s" repeatCount="indefinite"/>
  </circle>
  <text x="25" y="18" font-family="${FONT}" font-size="11.5" fill="${T.dim}">${label}</text>
  <text x="${Math.round(labelW + countW / 2)}" y="18" text-anchor="middle"
    font-family="${FONT}" font-size="12.5" font-weight="700" fill="${T.text}">${digits}</text>
</svg>`;
}

export function viewsResponse(markup) {
  return new Response(markup, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      // The whole point is to be counted, so refuse every layer of caching we
      // can reach. Camo still caches some — see the note at the top.
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
}
