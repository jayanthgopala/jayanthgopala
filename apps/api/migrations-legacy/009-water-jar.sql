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
