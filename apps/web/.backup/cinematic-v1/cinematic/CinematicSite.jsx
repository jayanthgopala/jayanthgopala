import { useCallback, useEffect, useMemo, useState } from 'react';
import { copy, mediaUrl } from '../lib/api.js';
import { useActTracker, useDocumentProgress } from './lib/scene.js';
import { ACTS, ACT_IDS } from './world/acts.js';
import { supportsWorld } from './world/support.js';
import World from './world/World.jsx';
import { ProgressRail, ShotCounter, SoundToggle } from './Chrome.jsx';
import ActTitle from './ActTitle.jsx';
import ActDossier from './ActDossier.jsx';
import ActWork from './ActWork.jsx';
import ActSystem from './ActSystem.jsx';
import ActRecord from './ActRecord.jsx';
import ActSignal from './ActSignal.jsx';
import '../styles/cinematic.css';

/**
 * Cinematic mode, end to end.
 *
 * A sequence of six acts over a single 3D world, rather than a page of
 * sections. Two structural ideas hold it together:
 *
 *   THE FIGURE IS REAL. A live, rim-lit figure stands in a colonnade behind
 *   every act. Scroll moves the camera through that space; the pointer orbits
 *   it and turns the figure's head. It is one WebGL canvas, fixed behind the
 *   whole document, and the acts float over it.
 *
 *   THE PALETTE INVERTS. Ink for the opening and the close, paper for the body
 *   of work. That cut is what a viewer remembers, and it costs almost nothing:
 *   the scene is lit exactly once and the post pass flips luminance, so one
 *   lighting rig produces both worlds.
 *
 * The act table lives in world/acts.js because the camera keyframes and the
 * DOM tones have to agree, and keeping them in one file is what stops them
 * drifting apart.
 *
 * Minimal mode does not import this file. This file imports nothing from
 * minimal mode except leaf primitives — the icon set, the lightbox, the API
 * client, the GitHub buttons — all read-only here.
 */
/** Resolves a project row to an absolute screenshot URL, or '' if it has none. */
const projectScreenshot = (project) =>
  project.screenshot ? mediaUrl(project.screenshot) : '';

export default function CinematicSite({ site, loading }) {
  const { profile, status, projects, stack, socials, education, experience, content } = site;

  const active = useActTracker(ACT_IDS);
  useDocumentProgress();

  /*
   * Which slab in the ring the pointer is over, and which one has been opened.
   * Both live here rather than inside the work act because the cursor
   * treatment is document-wide — the arrow has to appear over the canvas, not
   * only over a section.
   */
  const [hovered, setHovered] = useState(-1);
  const [opened, setOpened] = useState(-1);

  const onHover = useCallback((index) => setHovered(index), []);
  const onSelect = useCallback(
    (index) => setOpened((current) => (current === index ? -1 : index)),
    []
  );

  // The cursor is set on the root element rather than on the canvas, which is
  // pointer-events:none and therefore never the hit target.
  useEffect(() => {
    document.documentElement.dataset.picking = hovered >= 0 ? 'on' : '';
    return () => {
      delete document.documentElement.dataset.picking;
    };
  }, [hovered]);

  /*
   * Decided once, before first paint, and never re-evaluated. Act I lays out
   * completely differently depending on the answer — a live figure needs an
   * empty stage, the still portrait needs to fill it — so discovering this
   * asynchronously would mean showing one and then swapping to the other.
   */
  const hasWorld = useMemo(() => supportsWorld(), []);

  // Optional. Empty means the procedural silhouette, which is a finished look
  // rather than a placeholder — see world/figure.js.
  const avatar = copy(content, 'cine.avatarUrl', '');
  const avatarUrl = avatar ? mediaUrl(avatar) : '';

  // The exhibits in the hall. Only published rows, and memoised on the array
  // itself so the slabs are not torn down and rebuilt on every status poll.
  const published = useMemo(
    () => (projects || []).filter((p) => p.published !== false),
    [projects]
  );

  // Only the labels depend on content, so only the label consumers re-render
  // when the payload lands. The ids and tones are module constants precisely
  // because the world takes the id array as an effect dependency.
  const acts = useMemo(
    () => ACTS.map((act) => ({ ...act, label: copy(content, act.copyKey, act.copyFallback) })),
    [content]
  );

  // Mirror the active act's tone onto the root element for the fixed chrome —
  // nav, rail, counter and the ask button all float above whichever act is
  // behind them. Cleaned up on unmount so switching back to minimal mid-scroll
  // cannot leave the nav wearing paper colours over a dark page.
  useEffect(() => {
    document.documentElement.dataset.tone = ACTS[active]?.tone || 'ink';
    return () => {
      delete document.documentElement.dataset.tone;
    };
  }, [active]);

  return (
    <>
      {hasWorld && (
        <World
          actIds={ACT_IDS}
          avatarUrl={avatarUrl}
          projects={published}
          screenshotUrl={projectScreenshot}
          onHover={onHover}
          onSelect={onSelect}
        />
      )}

      <ProgressRail acts={acts} active={active} />
      <ShotCounter acts={acts} active={active} />
      <SoundToggle content={content} />

      <main id="top" className="cx">
        <ActTitle id={ACT_IDS[0]} profile={profile} content={content} hasWorld={hasWorld} />

        <ActDossier
          id={ACT_IDS[1]}
          profile={profile}
          status={status}
          projects={projects}
          stack={stack}
          content={content}
        />

        {/* The ids on these three are the shared anchor targets the nav links
            at — #projects, #stack, #contact — so one nav works in both modes
            without a mode-aware link list. */}
        <ActWork
          id={ACT_IDS[2]}
          projects={projects}
          loading={loading}
          content={content}
          hovered={hovered}
          opened={opened}
          onSelect={onSelect}
        />

        <ActSystem id={ACT_IDS[3]} stack={stack} content={content} />

        <ActRecord
          id={ACT_IDS[4]}
          experience={experience}
          education={education}
          content={content}
        />

        <ActSignal id={ACT_IDS[5]} profile={profile} socials={socials} content={content} />
      </main>
    </>
  );
}
