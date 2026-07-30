import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Framer-Motion-style interactions without the dependency.
 *
 * The brief asks for fade-in, slide-up, hover lift, ripple, tilt and gradient
 * movement. Every one of those is a transform or an opacity change, which CSS
 * transitions already do on the compositor. All this module contributes is the
 * *trigger* — which is a few lines of IntersectionObserver and pointer maths,
 * against ~34KB gzipped for the library.
 */

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Reveal an element when it scrolls into view. Unobserves after the first
 * trigger — re-animating on every scroll-by is the single most common way
 * scroll animation turns distracting.
 */
export function useReveal({ threshold = 0.15, rootMargin = '0px 0px -10% 0px' } = {}) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(() => prefersReducedMotion());

  useEffect(() => {
    const node = ref.current;
    if (!node || prefersReducedMotion()) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.unobserve(entry.target);
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold, rootMargin]);

  return [ref, visible];
}

/** Convenience wrapper: <Reveal delay={80}>…</Reveal> */
export function Reveal({ children, delay = 0, className = '', as: Tag = 'div', ...rest }) {
  const [ref, visible] = useReveal();
  return (
    <Tag
      ref={ref}
      className={`reveal ${className}`.trim()}
      data-visible={visible}
      style={{ '--reveal-delay': `${delay}ms` }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/**
 * Very subtle card tilt. Capped at 4° — past roughly 6° it stops reading as
 * depth and starts reading as a gimmick.
 */
export function useTilt({ max = 4 } = {}) {
  const ref = useRef(null);
  const frame = useRef(0);

  const onPointerMove = useCallback(
    (event) => {
      const node = ref.current;
      if (!node || prefersReducedMotion()) return;

      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        const rect = node.getBoundingClientRect();
        const px = (event.clientX - rect.left) / rect.width - 0.5;
        const py = (event.clientY - rect.top) / rect.height - 0.5;

        node.style.setProperty('--tilt-x', `${(-py * max).toFixed(2)}deg`);
        node.style.setProperty('--tilt-y', `${(px * max).toFixed(2)}deg`);
        // Feeds the pointer-tracking sheen highlight.
        node.style.setProperty('--mx', `${((px + 0.5) * 100).toFixed(1)}%`);
        node.style.setProperty('--my', `${((py + 0.5) * 100).toFixed(1)}%`);
      });
    },
    [max]
  );

  const onPointerLeave = useCallback(() => {
    cancelAnimationFrame(frame.current);
    const node = ref.current;
    if (!node) return;
    node.style.setProperty('--tilt-x', '0deg');
    node.style.setProperty('--tilt-y', '0deg');
  }, []);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  return { ref, onPointerMove, onPointerLeave };
}

/** Material-style ripple originating at the pointer. Cleans up after itself. */
export function useRipple() {
  return useCallback((event) => {
    const button = event.currentTarget;
    if (prefersReducedMotion()) return;

    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const span = document.createElement('span');

    span.className = 'ripple';
    span.style.width = span.style.height = `${size}px`;
    span.style.left = `${event.clientX - rect.left - size / 2}px`;
    span.style.top = `${event.clientY - rect.top - size / 2}px`;

    button.appendChild(span);
    span.addEventListener('animationend', () => span.remove(), { once: true });
  }, []);
}

/** True once the user has scrolled past `offset` — drives the nav treatment. */
export function useScrolled(offset = 24) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        setScrolled(window.scrollY > offset);
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [offset]);

  return scrolled;
}
