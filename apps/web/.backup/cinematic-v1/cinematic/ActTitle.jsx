import { copy, mediaUrl } from '../lib/api.js';
import { useSceneVar, usePointerVar } from './lib/scene.js';
import { ScrollHint } from './Chrome.jsx';
import Plaque from './Plaque.jsx';

const DEFAULT_PORTRAIT = '/character.jpg';
const DEFAULT_PORTRAIT_SMALL = '/character-900.jpg';

/**
 * ACT I — ORIGIN.
 *
 * The opening shot: the figure seen from behind, walking away down the hall
 * toward a lit aperture. The camera sits just behind their shoulder and pushes
 * in as you scroll.
 *
 * Everything visual here belongs to the 3D engine. What this component owns is
 * the type, the scene's scroll budget, and the fallback for machines that
 * cannot run the world.
 *
 * The narrative copy is all content keys with fallbacks, so the storyline is
 * editable in the admin panel rather than welded into JSX. It is framing, not
 * fact — nothing here asserts anything about the person that the database does
 * not already say.
 */
export default function ActTitle({ profile, content = {}, id, hasWorld = false }) {
  const sceneRef = useSceneVar();
  const pointerRef = usePointerVar({ ease: 0.06 });

  // Each mode falls back to its own bundled default, never to the other's
  // upload: minimal frames a circular crop, this frames a full-bleed plate, and
  // borrowing across produced a head floating mid-frame rather than a shot.
  const custom = profile.cinematicAvatarUrl || '';
  const portrait = custom ? mediaUrl(custom) : DEFAULT_PORTRAIT;

  const name = profile.name || '';
  const role = profile.role || copy(content, 'cine.rightTitle', 'Engineering');

  return (
    <section
      className="cx-act cx-title"
      id={id}
      data-tone="ink"
      data-world={hasWorld || undefined}
      ref={sceneRef}
    >
      <div className="cx-title-stage" ref={pointerRef}>
        {/*
          With the world live the figure in this shot is the 3D one on the
          canvas behind every act, so there is nothing to put here — a
          photograph would sit a still of the subject in front of a moving model
          of the same subject. Without WebGL the shot falls back to the
          portrait, pointer-parallaxed and pushed in by scroll.
        */}
        {!hasWorld && (
          <div className="cx-title-camera">
            <img
              className="cx-title-plate"
              src={portrait}
              // Only the bundled default ships a small variant; an uploaded
              // portrait is served at one size, so advertising a srcset for it
              // would ask the browser for a URL that does not exist.
              srcSet={
                custom ? undefined : `${DEFAULT_PORTRAIT_SMALL} 599w, ${DEFAULT_PORTRAIT} 932w`
              }
              sizes="(max-width: 900px) 96vw, 78vh"
              alt={name ? `${name} — portrait` : 'Portrait'}
              fetchPriority="high"
              decoding="async"
              draggable="false"
            />
            <span className="cx-title-vignette" aria-hidden="true" />
          </div>
        )}

        <div className="cx-title-copy">
          <span className="cx-eyebrow cx-title-eyebrow">
            {copy(content, 'cine.greeting', "Hello, I'm")}
          </span>

          {/* The largest thing on the site, and the only element allowed to
              break the grid. */}
          <h1 className="cx-title-name">{name}</h1>

          <p className="cx-title-role">
            <span>{role}</span>
            <span className="cx-title-rule" aria-hidden="true" />
            <span>{copy(content, 'cine.subline', 'Driven by curiosity.')}</span>
          </p>
        </div>

        {/* Two plaques, hung off opposite edges at different heights. Symmetry
            here would read as a subtitle track rather than as annotation. */}
        <Plaque side="left" top="24%" tilt={-0.4}>
          {copy(content, 'cine.plaque1', 'Every system starts as a question nobody has answered yet.')}
        </Plaque>

        <Plaque side="right" top="68%" tilt={0.3} delay={220}>
          {copy(content, 'cine.plaque2', 'This one walks toward the light at the end of the hall.')}
        </Plaque>

        <ScrollHint content={content} />
      </div>
    </section>
  );
}
