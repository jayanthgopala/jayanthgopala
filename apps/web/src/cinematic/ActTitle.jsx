import { copy, mediaUrl } from '../lib/api.js';
import { useSceneVar, usePointerVar } from './lib/scene.js';
import ScrubMedia from './ScrubMedia.jsx';
import { ScrollHint } from './Chrome.jsx';

const DEFAULT_PORTRAIT = '/character.jpg';
const DEFAULT_PORTRAIT_SMALL = '/character-900.jpg';

/**
 * ACT I — TITLE.
 *
 * The opening shot, and the only place two input devices drive two different
 * things at once:
 *
 *   pointer X  →  the camera orbits the subject      (you control the scene)
 *   scroll     →  the camera pushes in, then cuts    (the story advances)
 *
 * Splitting them this way was the point. Wiring both to one timeline — the
 * obvious first attempt — means the shot fights itself: you nudge the mouse
 * while scrolling and the push-in jumps backwards. Giving each input its own
 * axis makes the frame feel *inhabited* rather than merely animated, and it
 * degrades cleanly: a phone has no pointer, so it simply gets the scroll half.
 *
 * Beat sheet (p = scroll progress through the scene):
 *   0.00–0.30  the name holds, then lifts away
 *   0.00–0.78  push in toward the subject
 *   0.46–0.80  the figure dissolves — which also covers the resolution loss
 *              at the far end of the zoom
 *   0.55–0.88  the statement resolves
 */
export default function ActTitle({ profile, content = {}, id }) {
  const sceneRef = useSceneVar();
  const pointerRef = usePointerVar({ ease: 0.06 });

  // Each mode falls back to its own bundled default, never to the other's
  // upload: minimal frames a circular crop, this frames a full-bleed plate, and
  // borrowing across produced a head floating mid-frame rather than a shot.
  const custom = profile.cinematicAvatarUrl || '';
  const portrait = custom ? mediaUrl(custom) : DEFAULT_PORTRAIT;

  // Set this on the profile once a clip exists and the still becomes a poster
  // without any other change. See docs/CINEMATIC-VIDEO.md.
  const clip = profile.cinematicVideoUrl ? mediaUrl(profile.cinematicVideoUrl) : '';

  const name = profile.name || '';
  const role = profile.role || copy(content, 'cine.rightTitle', 'Engineering');

  return (
    <section className="cx-act cx-title" id={id} data-tone="ink" ref={sceneRef}>
      <div className="cx-title-stage" ref={pointerRef}>
        {/* The orbit layer. Pointer drives it; scroll drives the push-in on the
            wrapper, so the two transforms compose instead of overwriting. */}
        <div className="cx-title-camera">
          <ScrubMedia
            className="cx-title-media"
            src={clip}
            poster={portrait}
            // Only the bundled default ships a small variant; an uploaded
            // portrait is served at one size, so advertising a srcset for it
            // would ask the browser for a URL that does not exist.
            posterSrcSet={custom ? '' : `${DEFAULT_PORTRAIT_SMALL} 599w, ${DEFAULT_PORTRAIT} 932w`}
            posterSizes="(max-width: 900px) 96vw, 78vh"
            alt={name ? `${name} — portrait` : 'Portrait'}
            driver="pointer"
            ease={0.065}
          >
            <span className="cx-title-vignette" aria-hidden="true" />
          </ScrubMedia>
        </div>

        <div className="cx-title-copy">
          <span className="cx-eyebrow cx-title-eyebrow">
            {copy(content, 'cine.greeting', "Hello, I'm")}
          </span>

          {/* The name is the largest thing on the site and the only element
              allowed to break the grid. */}
          <h1 className="cx-title-name">{name}</h1>

          <p className="cx-title-role">
            <span>{role}</span>
            <span className="cx-title-rule" aria-hidden="true" />
            <span>{copy(content, 'cine.subline', 'Driven by curiosity.')}</span>
          </p>
        </div>

        {/* The payoff of the push-in. Uses the profile description, so it stays
            dynamic without another content key to keep in sync. */}
        <div className="cx-title-statement">
          <p>{profile.description}</p>
        </div>

        <ScrollHint content={content} />
      </div>
    </section>
  );
}
