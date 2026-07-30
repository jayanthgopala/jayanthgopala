import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './ui.jsx';
import '../styles/crop.css';

const NUDGE = 12; // px per arrow press, in display space

/**
 * Crop tool: drag to reposition, scroll or pinch to zoom, arrows to nudge.
 *
 * `shape` picks the frame:
 *   circle   1:1, circular mask — the minimal-mode portrait
 *   portrait 3:4, rectangular   — the cinematic full-bleed plate
 *
 * Position is held in *display* pixels and converted to source pixels only at
 * export. Tracking it in source space means every zoom rescales the offsets and
 * the image slides out from under the cursor.
 */
export default function CropDialog({ file, shape = 'circle', onCancel, onCropped }) {
  const isCircle = shape === 'circle';
  const aspect = isCircle ? 1 : 3 / 4; // width / height
  const outW = isCircle ? 800 : 900;
  const outH = isCircle ? 800 : 1200;

  const [img, setImg] = useState(null);
  const [scale, setScale] = useState(1);
  const [minScale, setMinScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);

  const frameRef = useRef(null);
  const drag = useRef(null);
  const pinch = useRef(null);

  const frameSize = useCallback(() => {
    const w = frameRef.current?.clientWidth || 320;
    return { w, h: w / aspect };
  }, [aspect]);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const { w, h } = frameSize();
      // Smallest scale that still covers the frame, so the corners can never
      // be dragged empty.
      const fit = Math.max(w / image.width, h / image.height);
      setImg(image);
      setMinScale(fit);
      setScale(fit);
      setOffset({ x: 0, y: 0 });
    };
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file, frameSize]);

  const clamp = useCallback(
    (next, s) => {
      if (!img) return next;
      const { w: fw, h: fh } = frameSize();
      const maxX = Math.max(0, (img.width * s - fw) / 2);
      const maxY = Math.max(0, (img.height * s - fh) / 2);
      return {
        x: Math.min(maxX, Math.max(-maxX, next.x)),
        y: Math.min(maxY, Math.max(-maxY, next.y)),
      };
    },
    [img, frameSize]
  );

  useEffect(() => setOffset((o) => clamp(o, scale)), [scale, clamp]);

  const nudge = (dx, dy) => setOffset((o) => clamp({ x: o.x + dx, y: o.y + dy }, scale));

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
    const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    setScale((s) => Math.min(minScale * 6, Math.max(minScale, s * factor)));
  }
  function onTouchMove(e) {
    if (e.touches.length !== 2) return;
    const [a, b] = e.touches;
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (pinch.current) {
      const f = dist / pinch.current;
      setScale((s) => Math.min(minScale * 6, Math.max(minScale, s * f)));
    }
    pinch.current = dist;
  }

  // Arrow keys move the image too — a drag target alone is unusable by keyboard.
  useEffect(() => {
    const onKey = (e) => {
      const step = e.shiftKey ? NUDGE * 3 : NUDGE;
      if (e.key === 'ArrowUp') { e.preventDefault(); nudge(0, step); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(0, -step); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(step, 0); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(-step, 0); }
      else if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  async function apply() {
    if (!img) return;
    setBusy(true);
    try {
      const { w: fw } = frameSize();
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';

      // Display space -> output space.
      const ratio = outW / fw;
      const drawW = img.width * scale * ratio;
      const drawH = img.height * scale * ratio;
      const dx = (outW - drawW) / 2 + offset.x * ratio;
      const dy = (outH - drawH) / 2 + offset.y * ratio;

      ctx.drawImage(img, dx, dy, drawW, drawH);

      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
      onCropped(new File([blob], 'portrait.jpg', { type: 'image/jpeg' }));
    } finally {
      setBusy(false);
    }
  }

  if (!file) return null;

  return (
    <div className="crop-backdrop" role="dialog" aria-modal="true" aria-label="Adjust portrait">
      <div className="crop-dialog" data-shape={shape}>
        <header className="crop-head">
          <div>
            <strong>Adjust portrait</strong>
            <span className="crop-hint">
              Drag or use the arrows · scroll to zoom
              {isCircle ? ' · circle is what the site shows' : ' · this is the full frame'}
            </span>
          </div>
        </header>

        <div className="crop-stage">
          <div
            className="crop-frame"
            ref={frameRef}
            style={{ aspectRatio: String(aspect) }}
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
            {isCircle && <div className="crop-mask" aria-hidden="true" />}
          </div>

          {/* Nudge pad. Dragging is fine for coarse framing but hopeless for the
              last few pixels, and impossible without a pointer. */}
          <div className="crop-pad" role="group" aria-label="Nudge position">
            <button type="button" className="crop-nudge crop-up" onClick={() => nudge(0, NUDGE)} aria-label="Move image down">↑</button>
            <button type="button" className="crop-nudge crop-left" onClick={() => nudge(NUDGE, 0)} aria-label="Move image right">←</button>
            <button type="button" className="crop-nudge crop-right" onClick={() => nudge(-NUDGE, 0)} aria-label="Move image left">→</button>
            <button type="button" className="crop-nudge crop-down" onClick={() => nudge(0, -NUDGE)} aria-label="Move image up">↓</button>
            <button
              type="button"
              className="crop-nudge crop-reset"
              onClick={() => { setScale(minScale); setOffset({ x: 0, y: 0 }); }}
              aria-label="Reset"
              title="Reset"
            >
              ⟲
            </button>
          </div>
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
