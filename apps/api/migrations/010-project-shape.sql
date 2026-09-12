-- The object a project appears as on the world's Selected work page.
--
-- Stores the shape's id, not an index, so reordering the registry in the web
-- app cannot silently repoint every project at a different object.
--
-- Additive and safe to re-run. Existing rows get an empty string and the site
-- falls back to assigning one by position, so the page renders correctly before
-- anyone opens the admin.

ALTER TABLE projects ADD COLUMN shape TEXT NOT NULL DEFAULT '';

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
