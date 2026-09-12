// Renders the GitHub profile README from the site payload.

/** Pipes break Markdown tables; newlines break table rows. */
const esc = (s = '') => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();

// Normalize link URL with default https scheme if omitted.
const href = (url = '') => {
  const raw = String(url).trim();
  if (!raw) return '';
  return /^(https?:|mailto:|tel:|#)/i.test(raw) ? raw : `https://${raw}`;
};

const ICON_BADGE = {
  github: 'GitHub-141414?style=for-the-badge&logo=github&logoColor=white',
  linkedin: 'LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white',
  x: 'X-000000?style=for-the-badge&logo=x&logoColor=white',
  mail: 'Email-1a1a1a?style=for-the-badge&logo=gmail&logoColor=white',
  globe: 'Website-1a1a1a?style=for-the-badge&logo=vercel&logoColor=white',
  link: 'Link-1a1a1a?style=for-the-badge&logo=hyperlink&logoColor=white',
};

const techList = (tech = []) => tech.map((t) => `\`${esc(t)}\``).join(' · ');

function projectRow(p) {
  const links = [];
  if (p.liveUrl) links.push(`[Live Demo](${href(p.liveUrl)})`);
  if (p.repoUrl) links.push(`[Source](${href(p.repoUrl)})`);

  return `| **${esc(p.title)}** | ${esc(p.summary)} | ${techList(p.tech)} | ${
    links.join(' • ') || '—'
  } |`;
}

function stackByCategory(stack = []) {
  const groups = new Map();
  for (const item of stack) {
    if (!groups.has(item.category)) groups.set(item.category, []);
    groups.get(item.category).push(item.name);
  }

  return [...groups.entries()]
    .map(
      ([category, names]) =>
        `- **${esc(category)}** — ${names.map((n) => `\`${esc(n)}\``).join(' ')}`
    )
    .join('\n');
}

// Renders GitHub profile README with embedded live SVG endpoints.
export function renderReadme(site, env) {
  const { profile, status, projects, stack, socials, content = {} } = site;
  const api = String(env.PUBLIC_API_URL || '').replace(/\/$/, '');
  const featured = projects.filter((p) => p.published && p.featured);

  // Fallbacks keep the README renderable even if content keys are missing.
  const t = (key, fallback) => esc(content[key] || fallback);

  const socialBadges = socials
    .filter((s) => s.showInReadme)
    .map((s) => {
      const badge = ICON_BADGE[s.icon] || ICON_BADGE.link;
      return `[![${esc(s.label)}](https://img.shields.io/badge/${badge})](${href(s.url)})`;
    })
    .join('&nbsp;');

  const projectTable = featured.length
    ? [
        '| Project | What it does | Stack | Links |',
        '| :------ | :----------- | :---- | :---- |',
        ...featured.map(projectRow),
      ].join('\n')
    : '_No featured projects yet._';

  return `<div align="center">

<!-- Live dynamic SVG banner -->
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="${api}/svg/banner-dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="${api}/svg/banner-light.svg" />
  <img src="${api}/svg/banner-dark.svg" alt="${esc(profile.name)} — ${esc(profile.role)}" width="100%" />
</picture>

</div>

<br />

<div align="center">

### ${esc(profile.headline)}

${esc(profile.description)}

${socialBadges}

</div>

<br />

<div align="center">
  <img src="${api}/svg/status.svg" alt="Live status" width="820" />
</div>

<!-- Fallback clickable links row -->
<div align="center">

${socials
  .filter((s) => s.showInReadme)
  .map((s) => `[${esc(s.label)}](${href(s.url)})`)
  .join(' &nbsp;·&nbsp; ')}

</div>

<br />

## ${t('readme.stack', 'Tech Stack')}

${stackByCategory(stack)}

<div align="center">
  <br />
  <img src="${api}/svg/metrics.svg" alt="Live metrics" width="820" />
</div>

## ${t('readme.currently', 'Currently')}

${[
  profile.location && `- 📍  Based in ${esc(profile.location)}`,
  profile.email && `- 📬  Reach me at [${esc(profile.email)}](mailto:${esc(profile.email)})`,
]
  .filter(Boolean)
  .join('\n')}

<div align="center">
  <sub>${t(
    'readme.footnote',
    "This README is generated from my portfolio's admin panel and published automatically."
  )}<br />
  The status and metrics cards above are live SVGs — they update without a commit.</sub>
</div>
`;
}

/** Marker in the commit message so sync commits are identifiable in history. */
export const COMMIT_PREFIX = 'chore(profile): sync from admin panel';
