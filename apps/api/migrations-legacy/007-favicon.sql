-- Editable favicon.
--
-- Empty means "use the icons bundled in apps/web/public", so an untouched
-- install keeps the shipped mark and only a deliberate upload replaces it.

ALTER TABLE profile ADD COLUMN favicon_url TEXT NOT NULL DEFAULT '';
