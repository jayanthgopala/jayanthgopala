import { useTilt } from '../lib/motion.jsx';
import '../styles/portrait-orb.css';

/**
 * The hero's 3D character object.
 *
 * This is a real 3D scene, not a skewed image: the container is
 * `transform-style: preserve-3d`, and each layer sits at its own `translateZ`.
 * Tilting therefore produces genuine parallax — the rings and particles shift
 * against the portrait rather than moving with it — which is what reads as
 * depth. A flat image with a rotate transform never does.
 *
 * `src` is DB-driven (profile.avatarUrl) and falls back to the bundled photo,
 * so swapping the portrait from the admin panel needs no code change.
 *
 * `graded` controls how hard the source is treated. The bundled fallback is a
 * raw studio photo that needs heavy desaturation and vignetting to sit on a
 * near-black page. Anything uploaded deliberately — a stylized render, a
 * proper portrait — is already art-directed, so it gets a light touch instead
 * of being muddied.
 */
export default function PortraitOrb({ src, alt, graded = true, cropped = false }) {
  // A touch more than the project cards: this is the focal object, and the
  // parallax needs a little more travel to be legible.
  const tilt = useTilt({ max: 7 });

  // `cropped` marks an image that already came out of the crop tool. The orb's
  // own framing zoom must not be applied on top of it — that is what made the
  // site disagree with the crop preview. See portrait-orb.css.
  return (
    <div
      ref={tilt.ref}
      onPointerMove={tilt.onPointerMove}
      onPointerLeave={tilt.onPointerLeave}
      className="portrait"
      data-graded={graded ? 'heavy' : 'light'}
      data-cropped={cropped || undefined}
    >
      <div className="portrait-scene">
        <div className="portrait-glow" aria-hidden="true" />

        <div className="portrait-disc">
          <img
            className="portrait-img"
            src={src}
            alt={alt}
            width="986"
            height="1280"
            decoding="async"
            fetchPriority="high"
          />
          {/* Grading + lighting passes, kept as separate layers so the source
              photo is never destructively edited. */}
          <span className="portrait-duotone" aria-hidden="true" />
          <span className="portrait-vignette" aria-hidden="true" />
          <span className="portrait-rim" aria-hidden="true" />
        </div>

        {/* No orbiting rings here. They read as lines sweeping across the face,
            which fights the portrait instead of framing it — and "minimal" is
            the whole point of this mode. Depth comes from the translateZ layers
            and the contact shadow. */}
        <span className="portrait-particle portrait-particle-1" aria-hidden="true" />
        <span className="portrait-particle portrait-particle-2" aria-hidden="true" />
        <span className="portrait-particle portrait-particle-3" aria-hidden="true" />

        <div className="portrait-shadow" aria-hidden="true" />
      </div>
    </div>
  );
}
