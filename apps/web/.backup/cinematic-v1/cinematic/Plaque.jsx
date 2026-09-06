import { useEntered } from './lib/scene.js';

/**
 * A caption plaque: a hard-bordered white card carrying two lines of small
 * uppercase text, pinned off-axis over the artwork.
 *
 * This is the single most characteristic element of the language, and the
 * reason the world underneath can stay fully visible. The first cut of this
 * design put body copy straight on the scene and then dropped a heavy scrim
 * behind it to keep it readable — which worked, and buried the figure behind a
 * sheet of flat colour for most of the sequence. A plaque carries its own
 * contrast in about four hundred square pixels, so the scrim can go back to
 * almost nothing and the scene stays on screen.
 *
 * Three rules, all of them taken from the reference and all of them load-
 * bearing:
 *
 *   NEVER CENTRED. Plaques hang off the left or right edge of the composition
 *   and overlap the subject. A centred caption reads as a subtitle track; an
 *   offset one reads as annotation on a plate.
 *
 *   HARD BORDER, NO RADIUS, NO SHADOW. The border is the whole device. Softening
 *   any of it turns a printed plaque into a UI tooltip.
 *
 *   SHORT. Two lines at this size is roughly a hundred characters. Anything
 *   longer stops being a caption and needs a different element.
 */
export default function Plaque({
  children,
  /** 'left' | 'right' — which edge it hangs from. */
  side = 'left',
  /** Vertical position within the stage, as a percentage. */
  top = '50%',
  /** Small deliberate tilt, in degrees. Keep under 1.5 or it reads as broken. */
  tilt = 0,
  delay = 0,
  className = '',
}) {
  const [ref, entered] = useEntered({ threshold: 0.35 });

  return (
    <figure
      ref={ref}
      className={`cx-plaque-card ${className}`.trim()}
      data-side={side}
      data-in={entered || undefined}
      style={{ '--top': top, '--tilt': `${tilt}deg`, '--delay': `${delay}ms` }}
    >
      <span>{children}</span>
    </figure>
  );
}

/**
 * The other half of the type system: a single line of display type set large
 * enough to be the image rather than a label on one.
 *
 * Used for the name, the act titles and the email address. Nothing in between
 * these two sizes exists anywhere in cinematic mode, and that absence is what
 * makes the hierarchy read instantly.
 */
export function Display({ children, as: Tag = 'h2', className = '', delay = 0 }) {
  const [ref, entered] = useEntered({ threshold: 0.3 });

  return (
    <Tag
      ref={ref}
      className={`cx-display ${className}`.trim()}
      data-in={entered || undefined}
      style={{ '--delay': `${delay}ms` }}
    >
      {/* The clipping wrapper does the masking and the inner span moves — a
          single element with overflow:hidden does not work, because an inline
          box does not clip. */}
      <span>
        <span>{children}</span>
      </span>
    </Tag>
  );
}
