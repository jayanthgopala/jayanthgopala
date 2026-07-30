import { useCallback, useEffect, useState } from 'react';

/**
 * Two presentation modes over one set of content.
 *
 *   minimal   — the default premium-dark layout
 *   cinematic — full-bleed character hero, pill nav, preloader
 *
 * Resolution order is deliberate: a visitor's own choice always wins over the
 * admin default. The default decides the *first* impression, not every one.
 */

export const MODES = ['minimal', 'cinematic'];
const STORAGE_KEY = 'pf_mode';

const isValid = (m) => MODES.includes(m);

function storedMode() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isValid(value) ? value : null;
    // Private-mode Safari throws on localStorage access rather than returning
    // null, so this has to be guarded.
  } catch {
    return null;
  }
}

export function useThemeMode(content) {
  const adminDefault = content?.['theme.default'];

  const [mode, setMode] = useState(() => storedMode() || 'minimal');
  // Tracks whether the visitor has expressed a preference, so a late-arriving
  // admin default doesn't stomp on a choice they already made.
  const [explicit, setExplicit] = useState(() => storedMode() !== null);

  // Content arrives after first paint; adopt the admin default only if the
  // visitor has not chosen for themselves.
  useEffect(() => {
    if (explicit || !isValid(adminDefault)) return;
    setMode(adminDefault);
  }, [adminDefault, explicit]);

  // Drive CSS from a single attribute on <html>.
  useEffect(() => {
    document.documentElement.dataset.mode = mode;
  }, [mode]);

  const choose = useCallback((next) => {
    if (!isValid(next)) return;
    setMode(next);
    setExplicit(true);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable — the choice still applies for this session */
    }
  }, []);

  const toggle = useCallback(() => {
    choose(mode === 'minimal' ? 'cinematic' : 'minimal');
  }, [mode, choose]);

  return { mode, choose, toggle, isCinematic: mode === 'cinematic' };
}

/**
 * Progress through a tall "scene" element, as 0..1.
 *
 * The scene is taller than the viewport and holds a `position: sticky` stage;
 * progress is how far the scene has travelled past the top of the viewport.
 * That is what gives a scroll-scrubbed shot a fixed budget of scroll distance
 * without the stage colliding with whatever follows it.
 *
 * Measured from the element's own rect rather than `window.scrollY`, so it
 * stays correct regardless of what sits above it on the page.
 */
export function useSceneProgress(ref) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let ticking = false;
    const update = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const rect = node.getBoundingClientRect();
        const travel = rect.height - window.innerHeight;
        setProgress(travel <= 0 ? 0 : Math.min(1, Math.max(0, -rect.top / travel)));
        ticking = false;
      });
    };

    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [ref]);

  return progress;
}

/** Maps `value` from the range [a,b] onto 0..1, clamped. */
export const phase = (value, a, b) =>
  Math.min(1, Math.max(0, (value - a) / (b - a)));
