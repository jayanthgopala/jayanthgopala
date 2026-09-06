import { useEffect, useRef, useState } from 'react';

/**
 * Reveal on first entry, and only once.
 *
 * IntersectionObserver rather than a scroll listener: the browser does the
 * intersection maths off the main thread, and there is no rAF loop running
 * while the page is still — which the brief asks for explicitly.
 *
 * Unobserves after the first trigger. Re-animating every time an element
 * scrolls back into view is the single most common way scroll animation turns
 * from atmosphere into nagging.
 */
export function useReveal({ threshold = 0.18, rootMargin = '0px 0px -12% 0px' } = {}) {
  const ref = useRef(null);
  const [shown, setShown] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  useEffect(() => {
    const node = ref.current;
    if (!node || shown) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShown(true);
        observer.disconnect();
      },
      { threshold, rootMargin }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold, rootMargin, shown]);

  return [ref, shown];
}

/**
 * Publishes the document's scroll position on the root element, throttled to
 * one write per frame:
 *
 *   --scroll  offset in pixels, for layers that drift by a fixed distance
 *   --page    progress 0..1 through the whole document, for the act rail
 *
 * Both from one listener. The rail needs a fraction and the brush layers need
 * pixels, and deriving either from the other in CSS would mean hard-coding the
 * document height in a stylesheet.
 *
 * Used by the brush layers to drift as the page moves. A single shared value
 * costs one listener and one custom-property write for the whole page, where a
 * per-element observer would cost one of each per layer.
 *
 * Deliberately NOT a continuous loop: the listener only schedules a frame when
 * the page actually scrolls, so a still page does no work at all.
 */
export function useScrollVar() {
  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;

    const measure = () => {
      frame = 0;
      const y = window.scrollY;
      root.style.setProperty('--scroll', String(Math.round(y)));

      /* Guarded: a document shorter than the viewport has nothing to divide by,
         and on this page that is the state during the first paint, before the
         payload lands and the sections grow. */
      const travel = document.documentElement.scrollHeight - window.innerHeight;
      root.style.setProperty('--page', travel > 0 ? Math.min(1, y / travel).toFixed(4) : '0');
    };

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    measure();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      root.style.removeProperty('--scroll');
      root.style.removeProperty('--page');
    };
  }, []);
}
