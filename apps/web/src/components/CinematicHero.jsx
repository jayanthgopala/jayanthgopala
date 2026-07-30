import { useRef } from 'react';
import { copy, mediaUrl } from '../lib/api.js';
import { useSceneProgress, phase } from '../lib/theme.jsx';
import '../styles/cinematic.css';

const DEFAULT_PORTRAIT = '/character.jpg';
const DEFAULT_PORTRAIT_SMALL = '/character-900.jpg';

/**
 * Cinematic-mode hero: a scroll-scrubbed shot that pushes into the subject's
 * eye, then reveals a statement.
 *
 * Built as a tall scene wrapping a `position: sticky` stage. Driving the zoom
 * off raw `window.scrollY` against a 100vh hero looked right for the first few
 * hundred pixels and then ran out of runway — the stage collided with the next
 * section mid-shot. A scene taller than the viewport gives the shot its own
 * scroll budget and holds the stage still while it plays.
 *
 * Beat sheet (p = 0..1 through the scene):
 *   0.00–0.28  flanking headline fades out
 *   0.00–0.80  camera pushes into the eye
 *   0.50–0.80  figure dissolves — also hides the resolution loss at high zoom
 *   0.58–0.86  statement fades up
 */
export default function CinematicHero({ profile, content = {} }) {
  const sceneRef = useRef(null);
  const p = useSceneProgress(sceneRef);

  // Cinematic gets its own image when one is set. The two modes frame the
  // subject completely differently — a circle crop versus a full-bleed plate —
  // so a single shared upload always compromises one of them. Falls back to
  // the minimal portrait, then the bundled render.
  const custom = profile.cinematicAvatarUrl || profile.avatarUrl || '';
  const portrait = custom ? mediaUrl(custom) : DEFAULT_PORTRAIT;

  // Push in hard. The origin is the subject's eye in image coordinates, so the
  // transform lives on the <img> itself — a percentage origin on the wrapper
  // would resolve against the wrapper box, which is a different aspect ratio.
  const zoom = 1 + phase(p, 0, 0.8) * 3.4;
  const headlineOpacity = 1 - phase(p, 0, 0.28);
  const figureOpacity = 1 - phase(p, 0.5, 0.82);
  const revealOpacity = phase(p, 0.58, 0.86);
  const revealShift = (1 - revealOpacity) * 26;

  return (
    <section className="cine-scene" ref={sceneRef}>
      <div className="cine-stage">
        <div className="cine-figure" style={{ opacity: figureOpacity }}>
          <img
            className="cine-render"
            src={portrait}
            srcSet={custom ? undefined : `${DEFAULT_PORTRAIT_SMALL} 599w, ${DEFAULT_PORTRAIT} 932w`}
            sizes="(max-width: 900px) 90vw, 62vh"
            alt={profile.name || 'Portrait'}
            fetchPriority="high"
            style={{ transform: `scale(${zoom.toFixed(3)})` }}
          />
          <span className="cine-vignette" aria-hidden="true" />
        </div>

        <div className="cine-copy" style={{ opacity: headlineOpacity }}>
          <div className="cine-side cine-left">
            <span className="cine-greeting">{copy(content, 'cine.greeting', "Hello, I'm")}</span>
            <h1 className="cine-name">{profile.name}</h1>
            <span className="cine-subline">
              {copy(content, 'cine.subline', 'Driven by curiosity.')}
            </span>
          </div>

          <div className="cine-side cine-right">
            <span className="cine-greeting">
              {copy(content, 'cine.rightEyebrow', 'Full-stack &')}
            </span>
            <span className="cine-name cine-name-right">
              {copy(content, 'cine.rightTitle', 'Engineering')}
            </span>
            <span className="cine-subline">{copy(content, 'cine.rightSub', 'Enthusiast')}</span>
          </div>
        </div>

        {/* The payoff of the push-in. Uses the profile description, so it stays
            dynamic without inventing another content key to keep in sync. */}
        <div
          className="cine-reveal"
          style={{
            opacity: revealOpacity,
            transform: `translateY(${revealShift.toFixed(1)}px)`,
            // Never intercept clicks while invisible.
            visibility: revealOpacity < 0.02 ? 'hidden' : 'visible',
          }}
        >
          <p className="cine-reveal-text">{profile.description}</p>
        </div>

        <div
          className="cine-scroll"
          style={{ opacity: headlineOpacity }}
          aria-hidden="true"
        >
          <span>{copy(content, 'cine.scroll', 'Scroll down')}</span>
          <span className="cine-scroll-dot" />
        </div>
      </div>
    </section>
  );
}
