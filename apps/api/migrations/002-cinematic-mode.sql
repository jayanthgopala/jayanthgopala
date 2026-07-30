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
ALTER TABLE content ADD COLUMN options TEXT NOT NULL DEFAULT '';

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
