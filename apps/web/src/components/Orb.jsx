import '../styles/orb.css';

// Lightweight CSS/SVG hero orb with rings and particles
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

      {/* Orbiting particles */}
      <span className="orb-particle orb-particle-1" />
      <span className="orb-particle orb-particle-2" />
      <span className="orb-particle orb-particle-3" />
    </div>
  );
}
