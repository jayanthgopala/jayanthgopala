/**
 * Renders the GitHub profile README from the same site payload the website
 * consumes. Nothing here touches the database directly — that is what
 * guarantees the profile can never drift from what visitors see.
 */

/** Pipes break Markdown tables; newlines break table rows. */
const esc = (s = '') => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();

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
  if (p.liveUrl) links.push(`[Live Demo](${p.liveUrl})`);
  if (p.repoUrl) links.push(`[Source](${p.repoUrl})`);

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

/**
 * The README embeds live SVG endpoints served by this same Worker. GitHub's
 * camo proxy re-fetches them, so the status card stays current between
 * commits rather than freezing at whatever was true at push time.
 */
export function renderReadme(site, env) {
  const { profile, status, projects, stack, socials, content = {} } = site;
  const api = String(env.PUBLIC_API_URL || '').replace(/\/$/, '');
  const featured = projects.filter((p) => p.published && p.featured);

  // Headings are editable too; the fallbacks keep the README renderable even
  // against a database that predates the content table.
  const t = (key, fallback) => esc(content[key] || fallback);

  const socialBadges = socials
    .filter((s) => s.showInReadme)
    .map((s) => {
      const badge = ICON_BADGE[s.icon] || ICON_BADGE.link;
      return `[![${esc(s.label)}](https://img.shields.io/badge/${badge})](${s.url})`;
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

# ${esc(profile.name)}

### ${esc(profile.headline)}

${esc(profile.description)}

${socialBadges}

</div>

<br />

<div align="center">
  <img src="${api}/svg/status.svg" alt="Live status" width="820" />
</div>

<br />

## ${t('readme.projects', 'Featured Projects')}

${projectTable}

## ${t('readme.stack', 'Tech Stack')}

${stackByCategory(stack)}

<div align="center">
  <br />
  <img src="${api}/svg/metrics.svg" alt="Live metrics" width="820" />
</div>

## ${t('readme.currently', 'Currently')}

- 🛠️  Building **${esc(status.currentProject) || '—'}**${
    status.currentProjectUrl ? ` — [see it](${status.currentProjectUrl})` : ''
  }
- 🚀  Latest deployment: **${esc(status.deployLabel) || '—'}** (\`${esc(status.deployState)}\`)
- 📍  Based in ${esc(profile.location) || '—'}
- 📬  Reach me at [${esc(profile.email)}](mailto:${esc(profile.email)})

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
