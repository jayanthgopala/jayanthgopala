# Cinematic mode — removed from the app, kept here

Taken out of `apps/web` on request. Nothing about it was broken beyond repair;
it was removed because the direction changed, so this is a working copy rather
than a graveyard.

## What this is

The second cinematic build: a seven-act scroll sequence on a painted editorial
canvas, with a scroll-rigged SVG character. Superseded `cinematic-v1/`, which is
the earlier Three.js world and is still in the sibling folder.

## Restoring it

1. `cp -r .backup/cinematic-v2/*.jsx .backup/cinematic-v2/lib src/cinematic/`
   (everything except `ModeToggle.jsx` and `App.with-cinematic.jsx`, which are
   not part of that directory)
2. `cp .backup/cinematic-v2/styles/cinematic.css src/styles/`
3. `cp .backup/cinematic-v2/ModeToggle.jsx src/components/`
4. `App.with-cinematic.jsx` is the App as it was, with both branches — diff it
   against the current `src/App.jsx` rather than copying it over, since minimal
   mode has moved on since.
5. Put `'cinematic'` back in `MODES` in `src/lib/theme.jsx`, and `<ModeToggle>`
   back in `src/components/Nav.jsx`.
6. Re-add the Bodoni Moda `<link>` in `index.html` — the display face the acts
   are set in. Minimal mode never used it.
7. `.mode-toggle` / `.mode-option` rules were removed from `src/styles/nav.css`;
   they are in this folder's `styles/cinematic.css` history if needed, or write
   them fresh.

## Known state when it was pulled

Working: the seven-act assembly, the act rail, the hero cloud descent, the
cloud-parting reveal, the word-by-word statement sweep, the stats band, the
footer.

Not working: the figure's face renders black — the skin ellipse is present in
the DOM at the right coordinates, but something inside `.cx-head` is covering
it. That is the one open defect.

Never done: the per-chapter video prompts, the `cine.*` content-key migration,
and a mobile pass on the walk scene.

## Left alone deliberately

The API and database still carry cinematic content: the `cinematic_avatar_url`
column on `profile`, the `cine.*` rows in `content`, and the `theme.default`
key. None of it is read by the site now, none of it costs anything, and dropping
columns is a migration that would have to be reversed to bring this back.
