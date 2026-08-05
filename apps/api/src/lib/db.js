/**
 * Data-access layer over D1.
 *
 * Every public read goes through `loadSite`, and the README generator uses
 * exactly the same function. That is what keeps the website and the GitHub
 * profile from ever drifting apart.
 */

const parseJson = (value, fallback) => {
  try {
    return JSON.parse(value) ?? fallback;
  } catch {
    return fallback;
  }
};

export function rowToProject(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    description: row.description,
    screenshot: row.screenshot,
    tech: parseJson(row.tech, []),
    liveUrl: row.live_url,
    repoUrl: row.repo_url,
    accent: row.accent,
    featured: !!row.featured,
    published: !!row.published,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
  };
}

export function rowToStatus(row) {
  return {
    available: !!row.available,
    availabilityNote: row.availability_note,
    currentProject: row.current_project,
    currentProjectUrl: row.current_project_url,
    currentProgress: row.current_progress,
    deployLabel: row.deploy_label,
    deployState: row.deploy_state,
    deployAt: row.deploy_at,
    githubState: row.github_state,
    healthState: row.health_state,
    healthUptime: row.health_uptime,
    timezone: row.timezone,
    updatedAt: row.updated_at,
  };
}

export function rowToProfile(row) {
  return {
    name: row.name,
    role: row.role,
    headline: row.headline,
    description: row.description,
    location: row.location,
    email: row.email,
    avatarUrl: row.avatar_url,
    cinematicAvatarUrl: row.cinematic_avatar_url || '',
    faviconUrl: row.favicon_url || '',
    resumeUrl: row.resume_url,
    githubUser: row.github_user,
    ctaPrimary: row.cta_primary,
    ctaSecondary: row.cta_secondary,
    updatedAt: row.updated_at,
  };
}

export async function getProfile(db) {
  const row = await db.prepare('SELECT * FROM profile WHERE id = 1').first();
  return row ? rowToProfile(row) : null;
}

export async function getStatus(db) {
  const row = await db.prepare('SELECT * FROM status WHERE id = 1').first();
  return row ? rowToStatus(row) : null;
}

export async function getProjects(db, { includeDrafts = false } = {}) {
  const sql = includeDrafts
    ? 'SELECT * FROM projects ORDER BY sort_order ASC, id ASC'
    : 'SELECT * FROM projects WHERE published = 1 ORDER BY sort_order ASC, id ASC';

  const { results } = await db.prepare(sql).all();
  return (results || []).map(rowToProject);
}

export async function getStack(db) {
  const { results } = await db
    .prepare('SELECT * FROM stack ORDER BY sort_order ASC, id ASC')
    .all();
  return results || [];
}

export async function getSocials(db) {
  const { results } = await db
    .prepare('SELECT * FROM socials ORDER BY sort_order ASC, id ASC')
    .all();

  return (results || []).map((r) => ({
    id: r.id,
    label: r.label,
    url: r.url,
    icon: r.icon,
    showInReadme: !!r.show_in_readme,
    sortOrder: r.sort_order,
  }));
}

/**
 * Editable copy as a flat `{ key: value }` map — the shape consumers actually
 * want. The presentation metadata (label, group, hint) is only needed by the
 * admin form, which reads it via `getContentRows`.
 */
export async function getContent(db) {
  const { results } = await db.prepare('SELECT key, value FROM content').all();
  return Object.fromEntries((results || []).map((r) => [r.key, r.value]));
}

/** Full rows, grouped and ordered, for the admin Copy editor. */
export async function getContentRows(db) {
  const { results } = await db
    .prepare('SELECT * FROM content ORDER BY group_name ASC, sort_order ASC, key ASC')
    .all();

  return (results || []).map((r) => ({
    key: r.key,
    value: r.value,
    group: r.group_name,
    label: r.label || r.key,
    hint: r.hint,
    multiline: !!r.multiline,
    // Present => the editor renders a dropdown rather than a text box.
    options: parseJson(r.options, []),
    sortOrder: r.sort_order,
  }));
}

export async function getEducation(db, { includeDrafts = false } = {}) {
  const sql = includeDrafts
    ? 'SELECT * FROM education ORDER BY sort_order ASC, id ASC'
    : 'SELECT * FROM education WHERE published = 1 ORDER BY sort_order ASC, id ASC';
  const { results } = await db.prepare(sql).all();

  return (results || []).map((r) => ({
    id: r.id,
    institution: r.institution,
    qualification: r.qualification,
    field: r.field,
    period: r.period,
    location: r.location,
    grade: r.grade,
    description: r.description,
    published: !!r.published,
    sortOrder: r.sort_order,
  }));
}

export async function getExperience(db, { includeDrafts = false } = {}) {
  const sql = includeDrafts
    ? 'SELECT * FROM experience ORDER BY sort_order ASC, id ASC'
    : 'SELECT * FROM experience WHERE published = 1 ORDER BY sort_order ASC, id ASC';
  const { results } = await db.prepare(sql).all();

  return (results || []).map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    organisation: r.organisation,
    period: r.period,
    location: r.location,
    description: r.description,
    url: r.url,
    tech: parseJson(r.tech, []),
    published: !!r.published,
    sortOrder: r.sort_order,
  }));
}

/** The single payload the website hydrates from, and the README renders from. */
export async function loadSite(db, opts = {}) {
  const [profile, status, projects, stack, socials, content, education, experience] =
    await Promise.all([
      getProfile(db),
      getStatus(db),
      getProjects(db, opts),
      getStack(db),
      getSocials(db),
      getContent(db),
      // These tables arrived in migration 005. A database that predates it
      // would throw and take the whole payload down, so degrade to empty
      // instead — the sections simply don't render.
      getEducation(db, opts).catch(() => []),
      getExperience(db, opts).catch(() => []),
    ]);

  return {
    profile,
    status,
    projects,
    stack,
    socials,
    content,
    education,
    experience,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Stable fingerprint of everything that appears in the README.
 *
 * `updatedAt` is excluded deliberately: it changes on every write, so leaving
 * it in would make the hash differ even when nothing visible changed, and the
 * cron job would commit on every run.
 */
export async function contentHash(site) {
  const material = JSON.stringify({
    profile: { ...site.profile, updatedAt: undefined },
    status: { ...site.status, updatedAt: undefined },
    projects: site.projects.map((p) => ({ ...p, updatedAt: undefined })),
    stack: site.stack,
    socials: site.socials,
    content: site.content,
  });

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
