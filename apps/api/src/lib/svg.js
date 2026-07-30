/**
 * Server-rendered SVG cards embedded in the GitHub README.
 *
 * These re-render on every request, so the profile shows live status without a
 * commit. Colours mirror apps/web/src/styles/tokens.css so the README and the
 * website read as one product.
 */

const T = {
  bg: '#0D0D10',
  bgAlt: '#08080A',
  border: '#1E1E24',
  text: '#F5F5F7',
  muted: '#9A9AA5',
  dim: '#6E6E7A',
  iris: '#6E7BFF',
  violet: '#A78BFA',
  mint: '#63D2C3',
  amber: '#F5B45C',
  rose: '#E86A8A',
};

const STATE_COLOR = {
  operational: T.mint,
  ready: T.mint,
  building: T.amber,
  degraded: T.amber,
  error: T.rose,
  down: T.rose,
};

/** SVG is XML — unescaped user content from the admin panel would break it. */
const esc = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const clip = (s = '', max) => {
  const str = String(s);
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
};

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif";

function shell(width, height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
  <defs>
    <linearGradient id="surface" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${T.bg}"/>
      <stop offset="100%" stop-color="${T.bgAlt}"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${T.iris}"/>
      <stop offset="50%" stop-color="${T.violet}"/>
      <stop offset="100%" stop-color="${T.mint}"/>
    </linearGradient>
    <linearGradient id="glow" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${T.iris}" stop-opacity="0.16"/>
      <stop offset="60%" stop-color="${T.violet}" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="${T.iris}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" rx="24" fill="url(#surface)"/>
  <rect width="${width}" height="${height}" rx="24" fill="url(#glow)"/>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="23.5"
        fill="none" stroke="${T.border}"/>
  <rect x="24" y="0" width="${width - 48}" height="1" fill="url(#accent)" opacity="0.7"/>
  ${body}
</svg>`;
}

function label(x, y, text) {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="11" font-weight="600"
    letter-spacing="0.08em" fill="${T.dim}">${esc(text.toUpperCase())}</text>`;
}

function value(x, y, text, { size = 16, weight = 600, fill = T.text } = {}) {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}"
    font-weight="${weight}" fill="${fill}">${esc(text)}</text>`;
}

function dot(cx, cy, color, pulse = false) {
  const animation = pulse
    ? `<circle cx="${cx}" cy="${cy}" r="4" fill="${color}" opacity="0.35">
         <animate attributeName="r" values="4;9;4" dur="2.4s" repeatCount="indefinite"/>
         <animate attributeName="opacity" values="0.35;0;0.35" dur="2.4s" repeatCount="indefinite"/>
       </circle>`
    : '';
  return `${animation}<circle cx="${cx}" cy="${cy}" r="4" fill="${color}"/>`;
}

function relativeTime(iso) {
  const then = new Date(String(iso).replace(' ', 'T') + (String(iso).includes('Z') ? '' : 'Z'));
  const diff = Date.now() - then.getTime();
  if (Number.isNaN(diff)) return '—';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** The main live status card. */
export function statusCardSvg(site) {
  const s = site.status;
  const W = 820;
  const H = 260;
  const availColor = s.available ? T.mint : T.amber;
  const availText = s.available ? s.availabilityNote : 'Currently at capacity';

  // Links across the lower half, not system metrics. Deployment state and an
  // uptime percentage were seeded values that nothing measured; a status card
  // showing decorative numbers is worse than one showing none.
  const pretty = (url = '') =>
    String(url)
      .replace(/^mailto:/, '')
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/$/, '');

  const cols = (site.socials || [])
    .filter((l) => l.showInReadme)
    .slice(0, 3)
    .map((l, i) => ({
      x: 40 + i * 260,
      label: l.label,
      value: clip(pretty(l.url), 28),
      state: 'operational',
    }));

  const progress = Math.max(0, Math.min(100, Number(s.currentProgress) || 0));
  const barWidth = W - 80;

  const body = `
    ${dot(48, 44, availColor, !!s.available)}
    ${value(64, 49, availText, { size: 15, weight: 600 })}
    <text x="${W - 40}" y="49" text-anchor="end" font-family="${FONT}" font-size="12"
      fill="${T.dim}">${esc(relativeTime(s.updatedAt))}</text>

    ${label(40, 88, 'Current project')}
    ${value(40, 114, clip(s.currentProject || '—', 44), { size: 24, weight: 700 })}

    <rect x="40" y="132" width="${barWidth}" height="6" rx="3" fill="${T.border}"/>
    <rect x="40" y="132" width="${(barWidth * progress) / 100}" height="6" rx="3" fill="url(#accent)"/>
    <text x="${W - 40}" y="127" text-anchor="end" font-family="${FONT}" font-size="12"
      font-weight="600" fill="${T.muted}">${progress}%</text>

    <rect x="40" y="170" width="${W - 80}" height="1" fill="${T.border}"/>

    ${cols
      .map(
        (c) => `
      ${label(c.x, 200, c.label)}
      ${dot(c.x + 5, 222, STATE_COLOR[c.state] || T.dim)}
      ${value(c.x + 18, 227, c.value, { size: 14, weight: 500, fill: T.muted })}`
      )
      .join('')}
  `;

  return shell(W, H, body);
}

/** Secondary card: counts pulled from live content. */
export function metricsCardSvg(site) {
  const W = 820;
  const H = 130;
  const published = site.projects.filter((p) => p.published);
  const techs = new Set(published.flatMap((p) => p.tech || []));

  const items = [
    { label: 'Projects shipped', value: String(published.length) },
    { label: 'Technologies', value: String(techs.size) },
    { label: 'Stack depth', value: String(site.stack.length) },
    { label: 'Open to work', value: site.status.available ? 'Yes' : 'No' },
  ];

  const step = (W - 80) / items.length;
  const body = items
    .map((item, i) => {
      const x = 40 + step * i;
      const divider =
        i > 0
          ? `<rect x="${x - 24}" y="38" width="1" height="54" fill="${T.border}"/>`
          : '';
      return `${divider}
        ${value(x, 72, item.value, { size: 30, weight: 700 })}
        ${label(x, 94, item.label)}`;
    })
    .join('');

  return shell(W, H, body);
}

export function svgResponse(markup) {
  return new Response(markup, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      // GitHub's camo proxy caches anyway; 300s keeps it reasonably fresh.
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  });
}
