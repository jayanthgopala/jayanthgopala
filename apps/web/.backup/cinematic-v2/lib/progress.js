import { useCallback, useEffect, useState } from 'react';

/**
 * An element's own scroll progress, published as a custom property on it.
 *
 * This is the spine of the cinematic sequence. Every act is a scene whose
 * contents are a function of one number: how far through that scene you have
 * scrolled. The number is written to the element as `--t` and read from there
 * by CSS, so an act can choreograph a dozen layers without a single React
 * render and without any of them subscribing to anything.
 *
 * MEASURED FROM THE ELEMENT'S RECT, NEVER FROM window.scrollY. Offsets computed
 * against the document break the moment anything above the element changes
 * height — which on this site happens every time the API payload lands and the
 * project list stops being a skeleton. getBoundingClientRect is always correct
 * because it is always current.
 *
 * Two modes, because scenes come in two shapes:
 *
 *   'sticky'  The element is taller than the viewport and pins a stage inside
 *             itself. Progress runs 0 when its top reaches the top of the
 *             viewport to 1 when its bottom does — i.e. across the extra height
 *             the stage is being held for.
 *
 *   'exit'    The element is roughly viewport-sized and has no spare travel.
 *             Progress runs 0 when it fills the viewport to 1 when it has
 *             scrolled entirely past. Used for the hero, where the whole point
 *             is what happens as it leaves.
 *
 * There is no rAF loop. A frame is scheduled only when a scroll event fires, and
 * writes are skipped when the value has not meaningfully moved, so a still page
 * costs nothing at all.
 *
 * IT RETURNS A CALLBACK REF, NOT A REF OBJECT, and that is load-bearing rather
 * than a style choice. A scene whose content arrives with the API payload —
 * the statement, which renders nothing until there is a sentence to render —
 * has no element on the first pass. An effect keyed on the options alone runs
 * once against a null ref, does nothing, and then never runs again, because
 * nothing in its dependency list changed when the element finally appeared.
 * That scene is silently frozen at whatever its CSS default is, with no error
 * anywhere. Holding the node in state makes its arrival the thing the effect
 * depends on.
 */
export function useProgress({ prop = '--t', mode = 'sticky', rest = 0.5 } = {}) {
  const [node, setNode] = useState(null);

  useEffect(() => {
    if (!node) return;

    /* Under reduced motion the scene is held at a composed resting frame rather
       than at zero — act one at t=0 is a screen full of cloud with nothing
       behind it, which is not a still anyone would choose to look at. */
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      node.style.setProperty(prop, String(rest));
      return;
    }

    let frame = 0;
    let last = -1;

    const measure = () => {
      frame = 0;
      const rect = node.getBoundingClientRect();

      let t;
      if (mode === 'exit') {
        t = rect.height <= 0 ? 0 : -rect.top / rect.height;
      } else {
        const travel = rect.height - window.innerHeight;
        t = travel <= 0 ? 0 : -rect.top / travel;
      }

      t = Math.min(1, Math.max(0, t));
      if (Math.abs(t - last) < 0.0008) return;
      last = t;
      node.style.setProperty(prop, t.toFixed(4));
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
    };
  }, [node, prop, mode, rest]);

  /* Stable across renders, so React does not detach and re-attach the ref —
     and with it tear down and rebuild the listener — on every parent update. */
  return useCallback((el) => setNode(el), []);
}
