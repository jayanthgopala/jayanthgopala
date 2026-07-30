import { useEffect, useRef } from 'react';
import '../styles/lightbox.css';

/**
 * Enlarged view of a project screenshot.
 *
 * Deliberately not a <dialog>: Safari only shipped `showModal` recently enough
 * that the fallback would be a blank overlay on older iOS, and the focus trap
 * here is small enough to own.
 */
export default function Lightbox({ src, alt, onClose }) {
  const closeRef = useRef(null);
  const restoreFocusTo = useRef(null);

  useEffect(() => {
    if (!src) return;

    restoreFocusTo.current = document.activeElement;
    closeRef.current?.focus();

    const onKey = (e) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // Two focusable elements, so trapping is just "keep it on the button".
      if (e.key === 'Tab') {
        e.preventDefault();
        closeRef.current?.focus();
      }
    };

    document.addEventListener('keydown', onKey);

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      // Send focus back where it came from, or the page jumps to the top.
      if (restoreFocusTo.current instanceof HTMLElement) restoreFocusTo.current.focus();
    };
  }, [src, onClose]);

  if (!src) return null;

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={alt || 'Enlarged image'}
      onClick={onClose}
    >
      <button ref={closeRef} type="button" className="lightbox-close" onClick={onClose}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
        <span className="sr-only">Close</span>
      </button>

      {/* Stop propagation so clicking the image itself doesn't dismiss. */}
      <img
        className="lightbox-img"
        src={src}
        alt={alt || ''}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
