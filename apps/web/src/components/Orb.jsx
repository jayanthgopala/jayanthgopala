import '../styles/orb.css';

/**
 * The abstract 3D object for the hero.
 *
 * Deliberately CSS + SVG rather than WebGL: a Three.js scene would add ~600KB
 * and a GPU context for what is, visually, a lit sphere behind three rotating
 * rings. This renders instantly, costs nothing on mobile, and degrades to a
 * static gradient under reduced-motion.
 */
export default function Orb() {
  return (
    <div className="orb" aria-hidden="true">
      <div className="orb-glow" />

      <div className="orb-rings">
        <span className="orb-ring orb-ring-1" />
        <span className="orb-ring orb-ring-2" />
        <span className="orb-ring orb-ring-3" />
      </div>

      <div className="orb-core">
        <div className="orb-core-sheen" />
        <div className="orb-core-shadow" />
      </div>

      {/* Orbiting particles — three, not thirty. */}
      <span className="orb-particle orb-particle-1" />
      <span className="orb-particle orb-particle-2" />
      <span className="orb-particle orb-particle-3" />
    </div>
  );
}
