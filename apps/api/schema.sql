-- ---------------------------------------------------------------------------
-- Portfolio platform :: D1 schema
-- Single source of truth for the website AND the GitHub profile README.
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS profile;
DROP TABLE IF EXISTS status;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS stack;
DROP TABLE IF EXISTS socials;
DROP TABLE IF EXISTS content;
DROP TABLE IF EXISTS sync_log;

-- Singleton row (id = 1). Hero section + identity.
CREATE TABLE profile (
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
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Singleton row (id = 1). Powers the Live Status Card + the live SVG badges.
CREATE TABLE status (
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
  timezone            TEXT    NOT NULL DEFAULT 'Asia/Kolkata',
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE projects (
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
  featured     INTEGER NOT NULL DEFAULT 1,
  published    INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_projects_order ON projects (published, sort_order);

CREATE TABLE stack (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  category   TEXT    NOT NULL DEFAULT 'Other',
  level      INTEGER NOT NULL DEFAULT 80,          -- 0..100
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE socials (
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
CREATE TABLE content (
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
CREATE INDEX idx_content_group ON content (group_name, sort_order);

-- Audit trail for every GitHub README push. Surfaced in the admin panel.
CREATE TABLE sync_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger    TEXT    NOT NULL,                     -- manual|auto|cron
  ok         INTEGER NOT NULL,
  message    TEXT    NOT NULL DEFAULT '',
  commit_sha TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sync_log_time ON sync_log (created_at DESC);

-- ---------------------------------------------------------------------------
-- Seed
-- ---------------------------------------------------------------------------
INSERT INTO profile (id, name, role, headline, description, location, email, github_user)
VALUES (
  1,
  'Jayanth Gopala',
  'Software Engineer',
  'Building scalable software and exceptional digital experiences.',
  'I design and ship production systems end to end — from edge APIs and data models to interfaces that feel considered.',
  'India',
  'jayanthgopala21@gmail.com',
  'jayanthgopala'
);

INSERT INTO status (id, current_project, current_progress, deploy_label)
VALUES (1, 'Portfolio Platform', 72, 'portfolio-web · production');

INSERT INTO projects (slug, title, summary, tech, accent, sort_order) VALUES
  ('portfolio-platform', 'Portfolio Platform',
   'A dynamic portfolio with an admin panel that also publishes my GitHub profile README.',
   '["React","Cloudflare Workers","D1","R2"]', 'iris', 0),
  ('edge-analytics', 'Edge Analytics',
   'Privacy-first analytics running entirely at the edge with sub-10ms ingestion.',
   '["Workers","Durable Objects","ClickHouse"]', 'mint', 1),
  ('design-system', 'Design System',
   'A token-driven component library with automated visual regression testing.',
   '["React","Vite","Playwright"]', 'violet', 2);

INSERT INTO stack (name, category, level, sort_order) VALUES
  ('JavaScript',          'Language',  92, 0),
  ('React',               'Frontend',  90, 1),
  ('Node.js',             'Backend',   85, 2),
  ('Cloudflare Workers',  'Platform',  84, 3),
  ('PostgreSQL',          'Data',      80, 4),
  ('Python',              'Language',  78, 5);

INSERT INTO content (key, value, group_name, label, hint, multiline, sort_order) VALUES
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

INSERT INTO content (key, value, group_name, label, hint, multiline, sort_order, options) VALUES
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

INSERT INTO socials (label, url, icon, sort_order) VALUES
  ('GitHub',   'https://github.com/jayanthgopala',     'github',   0),
  ('LinkedIn', 'https://www.linkedin.com/in/jayanth-gopala-v/', 'linkedin', 1),
  ('Email',    'mailto:jayanthgopala21@gmail.com',      'mail',     2);
