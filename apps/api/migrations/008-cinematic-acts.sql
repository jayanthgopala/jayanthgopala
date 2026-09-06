-- Cinematic mode, rebuilt as a six-act sequence.
--
-- Purely additive: this seeds the copy the new acts read and touches no
-- existing row. Everything here already has a hardcoded fallback in the
-- components, so the site renders correctly before this runs — applying it
-- only moves the strings into the admin Copy editor.
--
-- INSERT OR IGNORE rather than INSERT: `key` is the primary key, so a re-run,
-- or a database where some of these were added by hand, is a no-op instead of
-- a constraint failure that aborts the whole file.

INSERT OR IGNORE INTO content (key, value, group_name, label, hint, multiline, sort_order) VALUES
  -- Act names. These label the shot counter and the progress rail, so they are
  -- read at 11px in tracked-out caps — one or two words each.
  ('cine.actTitle',   'Title',   'Cinematic', 'Act 1 name', 'Shown in the shot counter.', 0, 0),
  ('cine.actDossier', 'Dossier', 'Cinematic', 'Act 2 name', '', 0, 1),
  ('cine.actWork',    'The work','Cinematic', 'Act 3 name', '', 0, 2),
  ('cine.actSystem',  'System',  'Cinematic', 'Act 4 name', '', 0, 3),
  ('cine.actRecord',  'Record',  'Cinematic', 'Act 5 name', '', 0, 4),
  ('cine.actSignal',  'Signal',  'Cinematic', 'Act 6 name', '', 0, 5),

  -- Act II — Dossier
  ('cine.dossierEyebrow', 'Dossier',           'Cinematic', 'Dossier eyebrow', '', 0, 10),
  ('cine.currently',      'Currently building','Cinematic', 'Current-project label', '', 0, 11),
  ('cine.factBased',      'Based in',          'Cinematic', 'Fact: location',  '', 0, 12),
  ('cine.factStatus',     'Status',            'Cinematic', 'Fact: availability', '', 0, 13),
  ('cine.factShipped',    'Shipped',           'Cinematic', 'Fact: project count', '', 0, 14),
  ('cine.factStack',      'Toolkit',           'Cinematic', 'Fact: technology count', '', 0, 15),
  ('cine.factZone',       'Timezone',          'Cinematic', 'Fact: timezone', '', 0, 16),

  -- Act III — The work
  ('cine.live',   'Live',   'Cinematic', 'Live-demo link label', '', 0, 20),
  ('cine.source', 'Source', 'Cinematic', 'Repository link label', '', 0, 21),

  -- Act IV — System
  ('cine.sysOther', 'Other', 'Cinematic', 'Fallback stack category',
   'Used for technologies saved without a category.', 0, 25),

  -- Act V — Record
  ('cine.recordEyebrow', 'Record',                  'Cinematic', 'Record eyebrow', '', 0, 30),
  ('cine.recordTitle',   'Experience & education',  'Cinematic', 'Record heading', '', 0, 31),
  ('cine.achievement',   'Achievement',             'Cinematic', 'Achievement badge', '', 0, 32),
  ('cine.view',          'View',                    'Cinematic', 'Timeline link label', '', 0, 33);

-- The interactive hero clip.
--
-- Deliberately a content key rather than a profile column: it needs no schema
-- change to exist, and while it is empty the opening shot is the still portrait
-- — which is a complete experience, not a placeholder. Setting it turns that
-- still into the video's poster with no other change.
--
-- Accepts an uploaded media key (/media/…) or any absolute URL. See
-- docs/CINEMATIC-VIDEO.md for the clip this was built to receive: it must be
-- encoded for seeking, not for streaming, or scrubbing will stutter.
INSERT OR IGNORE INTO content (key, value, group_name, label, hint, multiline, sort_order) VALUES
  ('cine.videoUrl', '', 'Cinematic', 'Hero clip URL',
   'Optional. An MP4 encoded for frame-accurate seeking (see docs/CINEMATIC-VIDEO.md). Leave empty to use the still portrait.',
   0, 40);
