import { useTilt } from '../lib/motion.jsx';
import '../styles/portrait-orb.css';

/** 3D character portrait object with parallax tilt and lighting layers. */
export default function PortraitOrb({ src, alt, graded = true, cropped = false }) {
  const tilt = useTilt({ max: 7 });

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
          {/* Lighting and grading layers */}
          <span className="portrait-duotone" aria-hidden="true" />
          <span className="portrait-vignette" aria-hidden="true" />
          <span className="portrait-rim" aria-hidden="true" />
        </div>

        {/* Orbiting particles */}
        <span className="portrait-particle portrait-particle-1" aria-hidden="true" />
        <span className="portrait-particle portrait-particle-2" aria-hidden="true" />
        <span className="portrait-particle portrait-particle-3" aria-hidden="true" />

        <div className="portrait-shadow" aria-hidden="true" />
      </div>
    </div>
  );
}
