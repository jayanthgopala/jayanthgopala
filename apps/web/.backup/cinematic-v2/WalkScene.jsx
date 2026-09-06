import { copy } from '../lib/api.js';
import { useProgress } from './lib/progress.js';
import { useReveal } from './lib/reveal.js';
import OrganicTransition from './OrganicTransition.jsx';
import WalkingFigure from './WalkingFigure.jsx';

/**
 * ACT II — THE WALK.
 *
 * The scene opens with the frame packed solid with cloud, handed straight down
 * from the hero: act one's bank descends as the hero leaves, and this one is
 * waiting at the top of the next screen, so the two reads as one continuous
 * mass of weather rather than two sections that both happen to have clouds in
 * them.
 *
 * Then the cloud parts — the upper bank lifts, the lower one settles — and the
 * figure is standing in the gap, already walking.
 *
 * WHY THE FIGURE IS DRAWN AND RIGGED RATHER THAN PLACED. An illustration pasted
 * into this scene is one fixed pose: the only thing you can do with it is slide
 * it around behind moving scenery, and the eye reads that instantly as a
 * cut-out on a background. WalkingFigure is a joint hierarchy, so what moves
 * here is the character — hips, knees, elbows, the lag in the head — against a
 * world that also moves. See WalkingFigure.jsx for the rig.
 *
 * EVERYTHING IS A FUNCTION OF `--t`. The scene is 260vh with a sticky stage
 * inside it, so it holds the screen while you scroll past, and its own scroll
 * fraction drives the parting, the gait, the traverse and the parallax. Nothing
 * here plays on a timer: stop scrolling and he stops mid-stride, scroll back
 * and he walks backwards. A looping cycle would be a GIF embedded in a page,
 * and would keep marching on the spot while you read the caption.
 *
 * Two derived values do the work, both declared in CSS on the section:
 *
 *   --reveal  0 → 1 over the first third. The parting.
 *   --march   0 → 1 over the rest. The walk.
 *
 * They overlap slightly on purpose, so he is already moving as he comes into
 * view rather than appearing and then starting.
 */

export default function WalkScene({ id, act, caption, content = {} }) {
  const sceneRef = useProgress({ mode: 'sticky', rest: 0.55 });
  const [captionRef, captionIn] = useReveal({ threshold: 0.35 });

  return (
    <section id={id} ref={sceneRef} className="cx-walkscene" data-act={act} data-tone="paper">
      <div className="cx-walk-stage">
        {/* --- The world ---------------------------------------------------
            Back to front: sky, far hills, the ground he is on. All three drift
            against his traverse at their own rate, which is what gives the
            frame depth — a single sliding backdrop reads as a treadmill. */}
        <div className="cx-walk-sky" aria-hidden="true" />

        <div className="cx-walk-hills" aria-hidden="true">
          <OrganicTransition direction="up" seed={17} fill="var(--cx-hill)" />
        </div>

        <div className="cx-walk-ground" aria-hidden="true">
          <OrganicTransition direction="up" seed={23} fill="var(--cx-earth)" />
        </div>

        {/* --- The figure ---------------------------------------------------
            Between the ground and the near cloud, so the cloud crosses in front
            of his feet as it settles and he is standing IN the weather rather
            than on top of a picture of it. */}
        <div className="cx-walk-figure">
          <WalkingFigure />
        </div>

        {/* --- The parting --------------------------------------------------
            Two banks that start overlapped, covering the frame completely, and
            separate. The lower one is in front of the figure; the upper one is
            in front of everything, so the reveal is a curtain rather than a
            fade. */}
        <div className="cx-walk-cloud cx-walk-cloud-under" aria-hidden="true">
          <OrganicTransition direction="up" seed={5} fill="var(--cx-cloud)" />
        </div>

        <div className="cx-walk-cloud cx-walk-cloud-over" aria-hidden="true">
          <OrganicTransition direction="down" seed={13} fill="var(--cx-cloud)" />
        </div>

        {caption && (
          <figcaption ref={captionRef} className="cx-walk-caption" data-in={captionIn || undefined}>
            {caption}
          </figcaption>
        )}

        <span className="cx-walk-hint" aria-hidden="true">
          {copy(content, 'cine.scroll', 'Keep scrolling')}
        </span>
      </div>
    </section>
  );
}
