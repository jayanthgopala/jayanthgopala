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
