import { useEffect, useRef } from 'react';
import '../styles/lightbox.css';

// Modal lightbox for enlarged project screenshots
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
      // Trap focus on close button
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
      // Restore focus on close
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
