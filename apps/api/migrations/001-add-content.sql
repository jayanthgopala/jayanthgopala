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

  ('footer.note', 'Built on Cloudflare Workers.', 'Footer', 'Footer note', 'The © and year are added automatically', 0, 0),

  ('seo.title',       'Jayanth Gopala — Software Engineer', 'SEO', 'Page title', 'Browser tab and link previews', 0, 0),
  ('seo.description', 'Building scalable software and exceptional digital experiences.',
                      'SEO', 'Meta description', 'Search results and link previews', 1, 1),

  ('readme.projects',  'Featured Projects', 'GitHub README', 'Projects heading',  '', 0, 0),
  ('readme.stack',     'Tech Stack',        'GitHub README', 'Stack heading',     '', 0, 1),
  ('readme.currently', 'Currently',         'GitHub README', 'Currently heading', '', 0, 2),
  ('readme.footnote',  'This README is generated from my portfolio''s admin panel and published automatically.',
                       'GitHub README', 'Footnote', '', 1, 3);
