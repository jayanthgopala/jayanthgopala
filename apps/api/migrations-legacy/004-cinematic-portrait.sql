-- ---------------------------------------------------------------------------
-- Migration 004 — separate portrait per presentation mode
--
-- The two modes want genuinely different source images:
--   minimal    a head-and-shoulders portrait, cropped to a circle
--   cinematic  a full-bleed, chest-up render that fills the frame
--
-- One shared image always compromises one of them, so cinematic gets its own
-- field. It falls back to the minimal portrait when left empty, so nothing
-- breaks if only one is uploaded.
--
-- D1 has no `ADD COLUMN IF NOT EXISTS`; a "duplicate column name" error here
-- means this has already been applied and is safe to ignore.
--   wrangler d1 execute portfolio --remote --file=./migrations/004-cinematic-portrait.sql
-- ---------------------------------------------------------------------------

ALTER TABLE profile ADD COLUMN cinematic_avatar_url TEXT NOT NULL DEFAULT '';
