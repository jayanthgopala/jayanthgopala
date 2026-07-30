import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './ui.jsx';
import '../styles/crop.css';

const OUTPUT = 800; // exported square, px

/**
 * Instagram-style crop: drag to reposition, scroll or pinch to zoom, circular
 * preview, exports the visible square.
 *
 * Position is kept as offsets in *display* pixels and converted to source
 * pixels only at export. Working in source coordinates while dragging means
 * every zoom change rescales the offsets and the image drifts under the cursor.
 */
export default function CropDialog({ file, onCancel, onCropped }) {
  const [img, setImg] = useState(null);
  const [scale, setScale] = useState(1);
  const [minScale, setMinScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);

  const frameRef = useRef(null);
  const drag = useRef(null);
  const pinch = useRef(null);

  // Load the chosen file into an Image we can measure and later draw.
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const frame = frameRef.current?.clientWidth || 320;
      // Smallest scale that still covers the frame — you can never zoom out
      // far enough to expose empty corners.
      const fit = Math.max(frame / image.width, frame / image.height);
      setImg(image);
      setMinScale(fit);
      setScale(fit);
      setOffset({ x: 0, y: 0 });
    };
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  /** Keeps the image covering the frame after any drag or zoom. */
  const clamp = useCallback(
    (next, s) => {
      const frame = frameRef.current?.clientWidth || 320;
      if (!img) return next;
      const w = img.width * s;
      const h = img.height * s;
      const maxX = Math.max(0, (w - frame) / 2);
      const maxY = Math.max(0, (h - frame) / 2);
      return {
        x: Math.min(maxX, Math.max(-maxX, next.x)),
        y: Math.min(maxY, Math.max(-maxY, next.y)),
      };
    },
    [img]
  );

  useEffect(() => setOffset((o) => clamp(o, scale)), [scale, clamp]);

  function onPointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX - offset.x, y: e.clientY - offset.y };
  }

  function onPointerMove(e) {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    setOffset(clamp({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }, scale));
  }

  function onPointerUp() {
    drag.current = null;
  }

  function onWheel(e) {
    // Not preventDefault'd via React (listener is passive) — the container has
    // overscroll-behavior: contain in CSS to stop the page scrolling instead.
    const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    setScale((s) => Math.min(minScale * 6, Math.max(minScale, s * factor)));
  }

  // Two-finger pinch on touch devices.
  function onTouchMove(e) {
    if (e.touches.length !== 2) return;
    const [a, b] = e.touches;
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (pinch.current) {
      const factor = dist / pinch.current;
      setScale((s) => Math.min(minScale * 6, Math.max(minScale, s * factor)));
    }
    pinch.current = dist;
  }

  async function apply() {
    if (!img) return;
    setBusy(true);
    try {
      const frame = frameRef.current.clientWidth;
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT;
      canvas.height = OUTPUT;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';

      // Display space -> source space.
      const ratio = OUTPUT / frame;
      const drawW = img.width * scale * ratio;
      const drawH = img.height * scale * ratio;
      const dx = (OUTPUT - drawW) / 2 + offset.x * ratio;
      const dy = (OUTPUT - drawH) / 2 + offset.y * ratio;

      ctx.drawImage(img, dx, dy, drawW, drawH);

      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
      // Square JPEG — the circular mask is applied in CSS on the site, so the
      // exported file stays useful anywhere a square avatar is wanted.
      onCropped(new File([blob], 'portrait.jpg', { type: 'image/jpeg' }));
    } finally {
      setBusy(false);
    }
  }

  if (!file) return null;

  return (
    <div className="crop-backdrop" role="dialog" aria-modal="true" aria-label="Adjust portrait">
      <div className="crop-dialog">
        <header className="crop-head">
          <div>
            <strong>Adjust portrait</strong>
            <span className="crop-hint">Drag to reposition · scroll or pinch to zoom</span>
          </div>
        </header>

        <div
          className="crop-frame"
          ref={frameRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          onTouchMove={onTouchMove}
          onTouchEnd={() => (pinch.current = null)}
        >
          {img && (
            <img
              className="crop-img"
              src={img.src}
              alt=""
              draggable="false"
              style={{
                width: img.width * scale,
                height: img.height * scale,
                transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
              }}
            />
          )}
          {/* Circle shows what the site will actually display; the square
              beyond it is what gets exported. */}
          <div className="crop-mask" aria-hidden="true" />
        </div>

        <div className="crop-zoom">
          <span className="label">Zoom</span>
          <input
            className="range"
            type="range"
            min={minScale}
            max={minScale * 6}
            step={minScale / 100}
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
          />
        </div>

        <footer className="crop-actions">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={apply} loading={busy}>Use this crop</Button>
        </footer>
      </div>
    </div>
  );
}
