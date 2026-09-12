import '../styles/backdrop.css';

// Ambient background with gradient mesh, drifting blobs, and grain overlay.
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
