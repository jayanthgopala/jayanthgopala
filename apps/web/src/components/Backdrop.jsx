import '../styles/backdrop.css';

/**
 * Ambient background: a slow gradient mesh, three drifting blobs, and a fine
 * grain overlay.
 *
 * Fixed-position and `pointer-events: none`, so it never participates in
 * layout or hit-testing. The blobs animate transform only — no repaints.
 */
export default function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="backdrop-mesh" />
      <div className="blob blob-1" />
      <div className="blob blob-2" />
      <div className="blob blob-3" />
      <div className="backdrop-grain" />
    </div>
  );
}
