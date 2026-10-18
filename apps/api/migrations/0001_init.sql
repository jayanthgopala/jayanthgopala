-- ---------------------------------------------------------------------------
-- 0001_init: the complete schema and starter content.
--
-- Run with `npm run db:migrate` (apps/api). Safe on an empty database and safe
-- to re-run on a populated one: every table and index is IF NOT EXISTS, and
-- every seed is INSERT OR IGNORE or guarded, so content you have edited is
-- never overwritten.
--
-- The incremental files that built this schema up are kept in
-- migrations-legacy/ for databases created before this baseline existed.
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- Portfolio platform :: D1 schema
-- Single source of truth for the website AND the GitHub profile README.
-- ---------------------------------------------------------------------------


-- Singleton row (id = 1). Hero section + identity.
CREATE TABLE IF NOT EXISTS profile (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  name          TEXT    NOT NULL DEFAULT '',
  role          TEXT    NOT NULL DEFAULT '',
  headline      TEXT    NOT NULL DEFAULT '',
  description   TEXT    NOT NULL DEFAULT '',
  location      TEXT    NOT NULL DEFAULT '',
  email         TEXT    NOT NULL DEFAULT '',
  -- Minimal mode: head-and-shoulders, cropped to a circle.
  avatar_url    TEXT    NOT NULL DEFAULT '',
  -- Cinematic mode: full-bleed chest-up render. Falls back to avatar_url.
  cinematic_avatar_url TEXT NOT NULL DEFAULT '',
  resume_url    TEXT    NOT NULL DEFAULT '',
  github_user   TEXT    NOT NULL DEFAULT '',
  cta_primary   TEXT    NOT NULL DEFAULT 'View Projects',
  cta_secondary TEXT    NOT NULL DEFAULT 'GitHub',
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  -- Browser-tab icon; empty falls back to the built-in favicon.
  favicon_url   TEXT    NOT NULL DEFAULT ''
);

-- Singleton row (id = 1). Powers the Live Status Card + the live SVG badges.
CREATE TABLE IF NOT EXISTS status (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  available           INTEGER NOT NULL DEFAULT 1,
  availability_note   TEXT    NOT NULL DEFAULT 'Available for collaborations',
  current_project     TEXT    NOT NULL DEFAULT '',
  current_project_url TEXT    NOT NULL DEFAULT '',
  current_progress    INTEGER NOT NULL DEFAULT 0,   -- 0..100
  deploy_label        TEXT    NOT NULL DEFAULT '',
  deploy_state        TEXT    NOT NULL DEFAULT 'ready',       -- ready|building|error
  deploy_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  github_state        TEXT    NOT NULL DEFAULT 'operational',
  health_state        TEXT    NOT NULL DEFAULT 'operational', -- operational|degraded|down
  health_uptime       REAL    NOT NULL DEFAULT 99.9,
  timezone            TEXT    NOT NULL DEFAULT 'Asia/Banglore',
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT    NOT NULL UNIQUE,
  title        TEXT    NOT NULL,
  summary      TEXT    NOT NULL DEFAULT '',
  description  TEXT    NOT NULL DEFAULT '',
  screenshot   TEXT    NOT NULL DEFAULT '',
  tech         TEXT    NOT NULL DEFAULT '[]',      -- JSON array of strings
  live_url     TEXT    NOT NULL DEFAULT '',
  repo_url     TEXT    NOT NULL DEFAULT '',
  accent       TEXT    NOT NULL DEFAULT 'iris',    -- iris|violet|mint|amber|rose
  shape        TEXT    NOT NULL DEFAULT '',        -- object shown on the world page
  featured     INTEGER NOT NULL DEFAULT 1,
  published    INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_projects_order ON projects (published, sort_order);

CREATE TABLE IF NOT EXISTS stack (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  category   TEXT    NOT NULL DEFAULT 'Other',
  level      INTEGER NOT NULL DEFAULT 80,          -- 0..100
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS socials (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  label          TEXT    NOT NULL,
  url            TEXT    NOT NULL,
  icon           TEXT    NOT NULL DEFAULT 'link',  -- github|linkedin|x|mail|globe|link
  show_in_readme INTEGER NOT NULL DEFAULT 1,
  sort_order     INTEGER NOT NULL DEFAULT 0
);

-- Every fixed string on the site: section headings, nav labels, footer, SEO.
-- Key/value rather than columns, because this list grows whenever the design
-- does and a schema migration per heading would be absurd.
--
-- `label` and `group_name` exist purely so the admin panel can render a usable
-- form instead of a wall of dotted keys.
CREATE TABLE IF NOT EXISTS content (
  key        TEXT PRIMARY KEY,
  value      TEXT    NOT NULL DEFAULT '',
  group_name TEXT    NOT NULL DEFAULT 'General',
  label      TEXT    NOT NULL DEFAULT '',
  hint       TEXT    NOT NULL DEFAULT '',
  multiline  INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- JSON array. When present the admin editor renders a dropdown instead of a
  -- text box, which is what you want for values that are really an enum.
  options    TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_content_group ON content (group_name, sort_order);

-- Audit trail for every GitHub README push. Surfaced in the admin panel.
CREATE TABLE IF NOT EXISTS sync_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger    TEXT    NOT NULL,                     -- manual|auto|cron
  ok         INTEGER NOT NULL,
  message    TEXT    NOT NULL DEFAULT '',
  commit_sha TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sync_log_time ON sync_log (created_at DESC);

-- ---------------------------------------------------------------------------
-- Starter content. Replace all of it from the admin panel.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO profile (id, name, role, headline, description, location, email, github_user)
VALUES (
  1,
  'Your Name',
  'Software Engineer',
  'Building scalable software and exceptional digital experiences.',
  'A short introduction about you. Edit this from the admin panel.',
  'Your location',
  'you@example.com',
  'your-github-username'
);

INSERT OR IGNORE INTO status (id, current_project, current_progress, deploy_label)
VALUES (1, 'Portfolio Platform', 72, 'production');

INSERT OR IGNORE INTO projects (slug, title, summary, tech, accent, sort_order) VALUES
  ('portfolio-platform', 'Portfolio Platform',
   'A dynamic portfolio with an admin panel that also publishes a GitHub profile README.',
   '["React","Cloudflare Workers","D1","R2"]', 'iris', 0),
  ('edge-analytics', 'Edge Analytics',
   'Privacy-first analytics running entirely at the edge with sub-10ms ingestion.',
   '["Workers","Durable Objects","ClickHouse"]', 'mint', 1),
  ('design-system', 'Design System',
   'A token-driven component library with automated visual regression testing.',
   '["React","Vite","Playwright"]', 'violet', 2);

INSERT INTO stack (name, category, level, sort_order)
SELECT column1, column2, column3, column4 FROM (VALUES
  ('JavaScript',          'Language',  92, 0),
  ('React',               'Frontend',  90, 1),
  ('Node.js',             'Backend',   85, 2),
  ('Cloudflare Workers',  'Platform',  84, 3),
  ('PostgreSQL',          'Data',      80, 4),
  ('Python',              'Language',  78, 5)
) WHERE NOT EXISTS (SELECT 1 FROM stack);

INSERT OR IGNORE INTO content (key, value, group_name, label, hint, multiline, sort_order) VALUES
  -- Navigation
  ('nav.projects',  'Projects', 'Navigation', 'Projects link', '', 0, 0),
  ('nav.stack',     'Stack',    'Navigation', 'Stack link',    '', 0, 1),
  ('nav.contact',   'Contact',  'Navigation', 'Contact link',  '', 0, 2),

  -- Projects section
  ('projects.eyebrow', 'Selected work',     'Projects section', 'Eyebrow', 'Small label above the heading', 0, 0),
  ('projects.title',   'Featured projects', 'Projects section', 'Heading', '', 0, 1),
  ('projects.lead',    'Systems I''ve designed, built and shipped end to end.',
                       'Projects section', 'Intro line', '', 1, 2),
  ('projects.empty',   'No projects published yet.', 'Projects section', 'Empty state', 'Shown when nothing is published', 0, 3),
  ('projects.featured','Featured', 'Projects section', 'Featured tag', 'Badge on featured cards', 0, 4),

  -- Stack section
  ('stack.eyebrow', 'Toolkit',                    'Stack section', 'Eyebrow', '', 0, 0),
  ('stack.title',   'Technologies I work with',   'Stack section', 'Heading', '', 0, 1),

  -- Contact section
  ('contact.eyebrow', 'Get in touch',                'Contact section', 'Eyebrow', '', 0, 0),
  ('contact.title',   'Have something worth building?', 'Contact section', 'Heading', '', 0, 1),
  ('contact.lead',    'I''m open to collaborations, contract work and interesting problems.',
                      'Contact section', 'Intro line', '', 1, 2),
  ('contact.resume',  'Résumé', 'Contact section', 'Résumé button', '', 0, 3),

  -- Status card row labels
  ('status.label.current',    'Current project',    'Status card', 'Current project label',    '', 0, 0),
  ('status.label.deployment', 'Latest deployment',  'Status card', 'Deployment label',         '', 0, 1),
  ('status.label.github',     'GitHub',             'Status card', 'GitHub label',             '', 0, 2),
  ('status.label.health',     'System health',      'Status card', 'System health label',      '', 0, 3),
  ('status.available',        'Available',          'Status card', 'Available fallback',       'Used if the availability note is blank', 0, 4),
  ('status.unavailable',      'At capacity',        'Status card', 'Unavailable text',         '', 0, 5),

  -- Footer
  ('footer.note', 'Built by Jayanth Gopala V', 'Footer', 'Footer note', 'The © and year are added automatically', 0, 0),

  -- SEO — injected into <head> at the edge, so link previews use these
  ('seo.title',       'Jayanth Gopala — Software Engineer', 'SEO', 'Page title', 'Browser tab and link previews', 0, 0),
  ('seo.description', 'Building scalable software and exceptional digital experiences.',
                      'SEO', 'Meta description', 'Search results and link previews', 1, 1),

  -- README headings
  ('readme.projects',  'Featured Projects', 'GitHub README', 'Projects heading',  '', 0, 0),
  ('readme.stack',     'Tech Stack',        'GitHub README', 'Stack heading',     '', 0, 1),
  ('readme.currently', 'Currently',         'GitHub README', 'Currently heading', '', 0, 2),
  ('readme.footnote',  'This README is generated from my portfolio''s admin panel and published automatically.',
                       'GitHub README', 'Footnote', '', 1, 3);

INSERT OR IGNORE INTO content (key, value, group_name, label, hint, multiline, sort_order, options) VALUES
  ('theme.default', 'minimal', 'Appearance', 'Default mode',
   'What new visitors see first. They can switch, and their choice is remembered.',
   0, 0, '["minimal","cinematic"]'),
  ('theme.minimalLabel',   'Minimal',   'Appearance', 'Minimal toggle label',   '', 0, 1, ''),
  ('theme.cinematicLabel', 'Cinematic', 'Appearance', 'Cinematic toggle label', '', 0, 2, ''),

  ('cine.greeting',     'Hello, I''m',          'Cinematic hero', 'Greeting (above name)',   '', 0, 0, ''),
  ('cine.subline',      'Driven by curiosity.', 'Cinematic hero', 'Line under the name',     '', 0, 1, ''),
  ('cine.rightEyebrow', 'Full-stack &',         'Cinematic hero', 'Right column, top line',  '', 0, 2, ''),
  ('cine.rightTitle',   'Engineering',          'Cinematic hero', 'Right column, big word',  '', 0, 3, ''),
  ('cine.rightSub',     'Enthusiast',           'Cinematic hero', 'Right column, last line', '', 0, 4, ''),
  ('cine.scroll',       'Scroll down',          'Cinematic hero', 'Scroll hint',             '', 0, 5, ''),

  ('preloader.title',    'Initializing experience', 'Preloader', 'Headline', '', 0, 0, ''),
  ('preloader.subtitle', 'Streaming visual frames…', 'Preloader', 'Sub-line', '', 0, 1, '');

INSERT INTO socials (label, url, icon, sort_order)
SELECT column1, column2, column3, column4 FROM (VALUES
  ('GitHub',   'https://github.com/your-github-username',     'github',   0),
  ('LinkedIn', 'https://www.linkedin.com/in/your-handle/', 'linkedin', 1),
  ('Email',    'mailto:you@example.com',      'mail',     2)
) WHERE NOT EXISTS (SELECT 1 FROM socials);

-- ---------------------------------------------------------------------------
-- Content keys added after the first release.
-- ---------------------------------------------------------------------------

-- from 001-add-content.sql
-- ---------------------------------------------------------------------------
-- Migration 001 — editable site copy
--
-- Non-destructive: safe to run on a database that already has content.
-- `schema.sql` is the first-run script and DROPs tables; use this instead once
-- you have real data.
--
--   wrangler d1 execute portfolio --remote --file=./migrations/001-add-content.sql
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS content (
  key        TEXT PRIMARY KEY,
  value      TEXT    NOT NULL DEFAULT '',
  group_name TEXT    NOT NULL DEFAULT 'General',
  label      TEXT    NOT NULL DEFAULT '',
  hint       TEXT    NOT NULL DEFAULT '',
  multiline  INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_content_group ON content (group_name, sort_order);

-- OR IGNORE so re-running never clobbers copy you have already edited.
INSERT OR IGNORE INTO content (key, value, group_name, label, hint, multiline, sort_order) VALUES
  ('nav.projects',  'Projects', 'Navigation', 'Projects link', '', 0, 0),
  ('nav.stack',     'Stack',    'Navigation', 'Stack link',    '', 0, 1),
  ('nav.contact',   'Contact',  'Navigation', 'Contact link',  '', 0, 2),

  ('projects.eyebrow', 'Selected work',     'Projects section', 'Eyebrow', 'Small label above the heading', 0, 0),
  ('projects.title',   'Featured projects', 'Projects section', 'Heading', '', 0, 1),
  ('projects.lead',    'Systems I''ve designed, built and shipped end to end.',
                       'Projects section', 'Intro line', '', 1, 2),
  ('projects.empty',   'No projects published yet.', 'Projects section', 'Empty state', 'Shown when nothing is published', 0, 3),
  ('projects.featured','Featured', 'Projects section', 'Featured tag', 'Badge on featured cards', 0, 4),

  ('stack.eyebrow', 'Toolkit',                  'Stack section', 'Eyebrow', '', 0, 0),
  ('stack.title',   'Technologies I work with', 'Stack section', 'Heading', '', 0, 1),

  ('contact.eyebrow', 'Get in touch',                   'Contact section', 'Eyebrow', '', 0, 0),
  ('contact.title',   'Have something worth building?', 'Contact section', 'Heading', '', 0, 1),
  ('contact.lead',    'I''m open to collaborations, contract work and interesting problems.',
                      'Contact section', 'Intro line', '', 1, 2),
  ('contact.resume',  'Résumé', 'Contact section', 'Résumé button', '', 0, 3),

  ('status.label.current',    'Current project',   'Status card', 'Current project label', '', 0, 0),
  ('status.label.deployment', 'Latest deployment', 'Status card', 'Deployment label',      '', 0, 1),
  ('status.label.github',     'GitHub',            'Status card', 'GitHub label',          '', 0, 2),
  ('status.label.health',     'System health',     'Status card', 'System health label',   '', 0, 3),
  ('status.available',        'Available',         'Status card', 'Available fallback',    'Used if the availability note is blank', 0, 4),
  ('status.unavailable',      'At capacity',       'Status card', 'Unavailable text',      '', 0, 5),

  ('footer.note', 'Built by Jayanth Gopala V', 'Footer', 'Footer note', 'The © and year are added automatically', 0, 0),

  ('seo.title',       'Jayanth Gopala — Software Engineer', 'SEO', 'Page title', 'Browser tab and link previews', 0, 0),
  ('seo.description', 'Building scalable software and exceptional digital experiences.',
                      'SEO', 'Meta description', 'Search results and link previews', 1, 1),

  ('readme.projects',  'Featured Projects', 'GitHub README', 'Projects heading',  '', 0, 0),
  ('readme.stack',     'Tech Stack',        'GitHub README', 'Stack heading',     '', 0, 1),
  ('readme.currently', 'Currently',         'GitHub README', 'Currently heading', '', 0, 2),
  ('readme.footnote',  'This README is generated from my portfolio''s admin panel and published automatically.',
                       'GitHub README', 'Footnote', '', 1, 3);

-- from 002-cinematic-mode.sql
-- ---------------------------------------------------------------------------
-- Migration 002 — cinematic mode
--
-- Adds the copy keys for the alternate hero treatment, plus an `options`
-- column so the admin Copy editor can render a dropdown instead of a free-text
-- box for values that are actually an enum (like the default theme).
--
-- Non-destructive; safe to re-run.
--   wrangler d1 execute portfolio --remote --file=./migrations/002-cinematic-mode.sql
-- ---------------------------------------------------------------------------

-- D1 has no `ADD COLUMN IF NOT EXISTS`. If this errors with "duplicate column
-- name", the migration has already been applied — that is safe to ignore.

INSERT OR IGNORE INTO content (key, value, group_name, label, hint, multiline, sort_order, options) VALUES
  ('theme.default', 'minimal', 'Appearance', 'Default mode',
   'What new visitors see first. They can switch, and their choice is remembered.',
   0, 0, '["minimal","cinematic"]'),

  -- Cinematic hero. The name comes from your profile; these are the lines
  -- around it.
  ('cine.greeting',     'Hello, I''m',          'Cinematic hero', 'Greeting (above name)',   '', 0, 0, ''),
  ('cine.subline',      'Driven by curiosity.', 'Cinematic hero', 'Line under the name',     '', 0, 1, ''),
  ('cine.rightEyebrow', 'Full-stack &',         'Cinematic hero', 'Right column, top line',  '', 0, 2, ''),
  ('cine.rightTitle',   'Engineering',          'Cinematic hero', 'Right column, big word',  '', 0, 3, ''),
  ('cine.rightSub',     'Enthusiast',           'Cinematic hero', 'Right column, last line', '', 0, 4, ''),
  ('cine.scroll',       'Scroll down',          'Cinematic hero', 'Scroll hint',             '', 0, 5, ''),

  ('preloader.title',    'Initializing experience', 'Preloader', 'Headline', '', 0, 0, ''),
  ('preloader.subtitle', 'Streaming visual frames…', 'Preloader', 'Sub-line', '', 0, 1, ''),

  ('theme.minimalLabel',   'Minimal',   'Appearance', 'Minimal toggle label',   '', 0, 1, ''),
  ('theme.cinematicLabel', 'Cinematic', 'Appearance', 'Cinematic toggle label', '', 0, 2, '');

-- from 003-banner.sql
-- ---------------------------------------------------------------------------
-- Migration 003 — profile banner copy
--
-- Everything the animated README banner renders that isn't already in
-- `profile`, `stack` or `socials`. Non-destructive; safe to re-run.
--   wrangler d1 execute portfolio --remote --file=./migrations/003-banner.sql
-- ---------------------------------------------------------------------------

INSERT OR IGNORE INTO content (key, value, group_name, label, hint, multiline, sort_order, options) VALUES
  ('banner.greeting', 'Hi', 'Profile banner', 'Greeting', '', 0, 0, ''),

  ('banner.roles',
   'Frontend Engineer|Full Stack Developer|Open Source Contributor|UI Engineer|AI Enthusiast',
   'Profile banner', 'Typing roles',
   'Separate with | — each is typed out character by character, then the next follows.',
   1, 1, ''),

  ('banner.education', 'B.E. Computer Science', 'Profile banner', 'Education', '', 0, 2, ''),
  ('banner.focus',     'Edge systems & design engineering', 'Profile banner', 'Current focus', '', 0, 3, ''),
  ('banner.portfolio', 'yourname.dev', 'Profile banner', 'Portfolio', 'Shown as text — no protocol needed', 0, 4, ''),

  ('banner.label.location',  'Location',  'Profile banner', 'Label: location',  '', 0, 10, ''),
  ('banner.label.education', 'Education', 'Profile banner', 'Label: education', '', 0, 11, ''),
  ('banner.label.focus',     'Focus',     'Profile banner', 'Label: focus',     '', 0, 12, ''),
  ('banner.label.portfolio', 'Portfolio', 'Profile banner', 'Label: portfolio', '', 0, 13, ''),
  ('banner.label.email',     'Email',     'Profile banner', 'Label: email',     '', 0, 14, ''),

  ('banner.skillsLabel', 'Stack', 'Profile banner', 'Skills heading', '', 0, 20, ''),
  ('banner.skillsMax',   '11',    'Profile banner', 'Max skill pills',
   'Pills are drawn from your Tech stack, in order. Beyond about 12 they overflow the panel.', 0, 21, '');

-- from 005-education-experience.sql
-- ---------------------------------------------------------------------------
-- Migration 005 — education, experience & achievements, and the copy for them
--
-- Non-destructive; safe to re-run.
--   wrangler d1 execute portfolio --remote --file=./migrations/005-education-experience.sql
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS education (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  institution TEXT    NOT NULL,
  qualification TEXT  NOT NULL DEFAULT '',   -- "B.E. Computer Science"
  field       TEXT    NOT NULL DEFAULT '',
  period      TEXT    NOT NULL DEFAULT '',   -- free text: "2021 — 2025"
  location    TEXT    NOT NULL DEFAULT '',
  grade       TEXT    NOT NULL DEFAULT '',   -- CGPA / percentage, as typed
  description TEXT    NOT NULL DEFAULT '',
  published   INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_education_order ON education (published, sort_order);

-- One table for both roles and achievements: they render as the same timeline
-- and differ only by `kind`, so splitting them would duplicate every query and
-- every admin screen for no gain.
CREATE TABLE IF NOT EXISTS experience (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT    NOT NULL DEFAULT 'work',   -- work | achievement
  title       TEXT    NOT NULL,                  -- role, or award name
  organisation TEXT   NOT NULL DEFAULT '',
  period      TEXT    NOT NULL DEFAULT '',
  location    TEXT    NOT NULL DEFAULT '',
  description TEXT    NOT NULL DEFAULT '',
  url         TEXT    NOT NULL DEFAULT '',       -- certificate, article, proof
  tech        TEXT    NOT NULL DEFAULT '[]',     -- JSON array
  published   INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_experience_order ON experience (published, sort_order);

INSERT OR IGNORE INTO content (key, value, group_name, label, hint, multiline, sort_order, options) VALUES
  ('nav.education',  'Education',  'Navigation', 'Education link',  '', 0, 3, ''),
  ('nav.experience', 'Experience', 'Navigation', 'Experience link', '', 0, 4, ''),

  ('education.eyebrow', 'Background',  'Education section', 'Eyebrow', '', 0, 0, ''),
  ('education.title',   'Education',   'Education section', 'Heading', '', 0, 1, ''),
  ('education.empty',   'Nothing added yet.', 'Education section', 'Empty state', '', 0, 2, ''),

  ('experience.eyebrow', 'Track record',              'Experience section', 'Eyebrow', '', 0, 0, ''),
  ('experience.title',   'Experience & Achievements', 'Experience section', 'Heading', '', 0, 1, ''),
  ('experience.empty',   'Nothing added yet.',        'Experience section', 'Empty state', '', 0, 2, ''),

  ('nav.resume', 'Résumé', 'Navigation', 'Résumé button', 'Only shown when a résumé URL is set on the Profile page', 0, 5, ''),

  ('github.starLabel', 'Star', 'GitHub buttons', 'Star button label', '', 0, 0, ''),
  ('github.forkLabel', 'Fork', 'GitHub buttons', 'Fork button label', '', 0, 1, ''),

  ('bot.title',       'Ask about me',                        'AI assistant', 'Widget title', '', 0, 0, ''),
  ('bot.placeholder', 'What has Jayanth built?',             'AI assistant', 'Input placeholder', '', 0, 1, ''),
  ('bot.greeting',    'Ask me anything about Jayanth''s work, stack or background.',
                      'AI assistant', 'Opening message', '', 1, 2, ''),
  ('bot.enabled',     'true', 'AI assistant', 'Enable the assistant', 'Turns the chat widget on or off site-wide', 0, 3, '["true","false"]');

-- from 006-project-details.sql
-- Labels for the project card's expandable description.
--
-- The card shows `summary`; `description` was written but never rendered. It
-- now sits behind a disclosure, and these are its two states.

INSERT OR IGNORE INTO content (key, value, group_name, label, hint, multiline, sort_order) VALUES
  ('projects.details', 'Details', 'Projects section', 'Expand details label', 'Shown when the longer project description is collapsed', 0, 5),
  ('projects.detailsLess', 'Hide details', 'Projects section', 'Collapse details label', 'Shown when the longer project description is open', 0, 6);

-- from 008-cinematic-acts.sql
-- Cinematic mode, rebuilt as a six-act sequence.
--
-- Purely additive: this seeds the copy the new acts read and touches no
-- existing row. Everything here already has a hardcoded fallback in the
-- components, so the site renders correctly before this runs — applying it
-- only moves the strings into the admin Copy editor.
--
-- INSERT OR IGNORE rather than INSERT: `key` is the primary key, so a re-run,
-- or a database where some of these were added by hand, is a no-op instead of
-- a constraint failure that aborts the whole file.

INSERT OR IGNORE INTO content (key, value, group_name, label, hint, multiline, sort_order) VALUES
  -- Act names. These label the shot counter and the progress rail, so they are
  -- read at 11px in tracked-out caps — one or two words each.
  ('cine.actTitle',   'Title',   'Cinematic', 'Act 1 name', 'Shown in the shot counter.', 0, 0),
  ('cine.actDossier', 'Dossier', 'Cinematic', 'Act 2 name', '', 0, 1),
  ('cine.actWork',    'The work','Cinematic', 'Act 3 name', '', 0, 2),
  ('cine.actSystem',  'System',  'Cinematic', 'Act 4 name', '', 0, 3),
  ('cine.actRecord',  'Record',  'Cinematic', 'Act 5 name', '', 0, 4),
  ('cine.actSignal',  'Signal',  'Cinematic', 'Act 6 name', '', 0, 5),

  -- Act II — Dossier
  ('cine.dossierEyebrow', 'Dossier',           'Cinematic', 'Dossier eyebrow', '', 0, 10),
  ('cine.currently',      'Currently building','Cinematic', 'Current-project label', '', 0, 11),
  ('cine.factBased',      'Based in',          'Cinematic', 'Fact: location',  '', 0, 12),
  ('cine.factStatus',     'Status',            'Cinematic', 'Fact: availability', '', 0, 13),
  ('cine.factShipped',    'Shipped',           'Cinematic', 'Fact: project count', '', 0, 14),
  ('cine.factStack',      'Toolkit',           'Cinematic', 'Fact: technology count', '', 0, 15),
  ('cine.factZone',       'Timezone',          'Cinematic', 'Fact: timezone', '', 0, 16),

  -- Act III — The work
  ('cine.live',   'Live',   'Cinematic', 'Live-demo link label', '', 0, 20),
  ('cine.source', 'Source', 'Cinematic', 'Repository link label', '', 0, 21),

  -- Act IV — System
  ('cine.sysOther', 'Other', 'Cinematic', 'Fallback stack category',
   'Used for technologies saved without a category.', 0, 25),

  -- Act V — Record
  ('cine.recordEyebrow', 'Record',                  'Cinematic', 'Record eyebrow', '', 0, 30),
  ('cine.recordTitle',   'Experience & education',  'Cinematic', 'Record heading', '', 0, 31),
  ('cine.achievement',   'Achievement',             'Cinematic', 'Achievement badge', '', 0, 32),
  ('cine.view',          'View',                    'Cinematic', 'Timeline link label', '', 0, 33);

-- The interactive hero clip.
--
-- Deliberately a content key rather than a profile column: it needs no schema
-- change to exist, and while it is empty the opening shot is the still portrait
-- — which is a complete experience, not a placeholder. Setting it turns that
-- still into the video's poster with no other change.
--
-- Accepts an uploaded media key (/media/…) or any absolute URL. See
-- docs/CINEMATIC-VIDEO.md for the clip this was built to receive: it must be
-- encoded for seeking, not for streaming, or scrubbing will stutter.
INSERT OR IGNORE INTO content (key, value, group_name, label, hint, multiline, sort_order) VALUES
  ('cine.videoUrl', '', 'Cinematic', 'Hero clip URL',
   'Optional. An MP4 encoded for frame-accurate seeking (see docs/CINEMATIC-VIDEO.md). Leave empty to use the still portrait.',
   0, 40);

-- from 009-water-jar.sql
-- The water letterform on the world's Selected Work page.
--
-- One string: the prompt telling the reader the water is the project index —
-- scroll moves between projects, a click opens one. Additive and safe to
-- re-run; the component ships the same text as a hardcoded fallback, so the
-- page reads correctly before this is applied and applying it only moves the
-- string into the admin Copy editor.

INSERT OR IGNORE INTO content (key, value, group_name, label, hint, multiline, sort_order) VALUES
  ('world.jarHint', 'Scroll to browse · Click to open', 'World', 'Water prompt',
   'Sits under the water letter on the Selected work page. Rendered in tracked-out caps, so keep it short.', 0, 0);

-- from 010-project-shape.sql
-- The object a project appears as on the world's Selected work page.
--
-- Stores the shape's id, not an index, so reordering the registry in the web
-- app cannot silently repoint every project at a different object.
--
-- Additive and safe to re-run. Existing rows get an empty string and the site
-- falls back to assigning one by position, so the page renders correctly before
-- anyone opens the admin.


-- Labels for the instrument readout around the object, and the revised prompt
-- now that dragging turns it. INSERT OR IGNORE, so re-running is a no-op.
INSERT OR IGNORE INTO content (key, value, group_name, label, hint, multiline, sort_order) VALUES
  ('world.jarGo', 'Click to explore', 'World', 'Object call to action',
   'Sits beside the object on the Selected work page, under the date.', 0, 1);

UPDATE content SET value = 'Scroll to browse · Drag to turn'
 WHERE key = 'world.jarHint' AND value = 'Scroll to browse · Click to open';

-- The written opening that now precedes the work on the world page.
INSERT OR IGNORE INTO content (key, value, group_name, label, hint, multiline, sort_order) VALUES
  ('world.aboutEyebrow', 'About', 'World', 'Opening section label',
   'Sits above your name on the first screen of the Selected work page.', 0, 2),
  ('world.aboutNext', 'Scroll for selected work', 'World', 'Opening scroll cue',
   'Sits under the introduction, telling the reader the work follows.', 0, 3);

