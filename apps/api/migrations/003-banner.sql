-- ---------------------------------------------------------------------------
-- Migration 003 — profile banner copy
--
-- Everything the animated README banner renders that isn't already in
-- `profile`, `stack` or `socials`. Non-destructive; safe to re-run.
--   wrangler d1 execute portfolio --remote --file=./migrations/003-banner.sql
-- ---------------------------------------------------------------------------

INSERT OR IGNORE INTO content (key, value, group_name, label, hint, multiline, sort_order, options) VALUES
  ('banner.greeting', 'Hi 👋', 'Profile banner', 'Greeting', '', 0, 0, ''),

  ('banner.roles',
   'Frontend Engineer|Full Stack Developer|Open Source Contributor|UI Engineer|AI Enthusiast',
   'Profile banner', 'Typing roles',
   'Separate with | — each is typed out character by character, then the next follows.',
   1, 1, ''),

  ('banner.education', 'B.E. Computer Science', 'Profile banner', 'Education', '', 0, 2, ''),
  ('banner.focus',     'Edge systems & design engineering', 'Profile banner', 'Current focus', '', 0, 3, ''),
  ('banner.portfolio', 'jayanthgopala.dev', 'Profile banner', 'Portfolio', 'Shown as text — no protocol needed', 0, 4, ''),

  ('banner.label.location',  'Location',  'Profile banner', 'Label: location',  '', 0, 10, ''),
  ('banner.label.education', 'Education', 'Profile banner', 'Label: education', '', 0, 11, ''),
  ('banner.label.focus',     'Focus',     'Profile banner', 'Label: focus',     '', 0, 12, ''),
  ('banner.label.portfolio', 'Portfolio', 'Profile banner', 'Label: portfolio', '', 0, 13, ''),
  ('banner.label.email',     'Email',     'Profile banner', 'Label: email',     '', 0, 14, ''),

  ('banner.skillsLabel', 'Stack', 'Profile banner', 'Skills heading', '', 0, 20, ''),
  ('banner.skillsMax',   '11',    'Profile banner', 'Max skill pills',
   'Pills are drawn from your Tech stack, in order. Beyond about 12 they overflow the panel.', 0, 21, '');
