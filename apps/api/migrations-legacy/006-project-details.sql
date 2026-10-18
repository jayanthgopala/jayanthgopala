-- Labels for the project card's expandable description.
--
-- The card shows `summary`; `description` was written but never rendered. It
-- now sits behind a disclosure, and these are its two states.

INSERT OR IGNORE INTO content (key, value, group_name, label, hint, multiline, sort_order) VALUES
  ('projects.details', 'Details', 'Projects section', 'Expand details label', 'Shown when the longer project description is collapsed', 0, 5),
  ('projects.detailsLess', 'Hide details', 'Projects section', 'Collapse details label', 'Shown when the longer project description is open', 0, 6);
