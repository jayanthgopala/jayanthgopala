/** Scrambles text into random glyphs that resolve left to right. */

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/<>[]_-+*#=';

const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function scramble(el, text = '', { duration = 650, delay = 0 } = {}) {
  if (!el) return () => {};
  el._scrambleStop?.();

  if (reduced()) {
    el.textContent = text;
    return () => {};
  }

  const start = performance.now() + delay;
  const len = Math.max(1, text.length);
  let frame = 0;

  const tick = (now) => {
    const t = (now - start) / duration;
    let out = '';
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      const at = 0.2 + 0.8 * (i / len);
      if (ch === ' ' || ch === '\n' || t >= at) out += ch;
      else out += GLYPHS[(Math.random() * GLYPHS.length) | 0];
    }
    el.textContent = out;
    if (t < 1) frame = requestAnimationFrame(tick);
    else el._scrambleStop = null;
  };

  frame = requestAnimationFrame(tick);
  const stop = () => {
    cancelAnimationFrame(frame);
    el._scrambleStop = null;
  };
  el._scrambleStop = stop;
  return stop;
}
