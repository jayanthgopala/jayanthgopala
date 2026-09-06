/**
 * Can this device run the world?
 *
 * Deliberately a module that imports nothing. The answer is needed during the
 * first render — Act I lays out completely differently for a live figure than
 * for a still portrait — and keeping the probe out of engine.js is what lets
 * that answer be synchronous while three.js stays behind a dynamic import.
 *
 * The expensive mistake here is optimism. A machine that reports WebGL2 and
 * then renders through a software rasteriser produces about four frames a
 * second and a hot laptop, which is far worse than the still it would
 * otherwise have shown.
 */

let cached = null;

export function supportsWorld() {
  if (cached !== null) return cached;
  if (typeof window === 'undefined') return false;

  try {
    const canvas = document.createElement('canvas');
    // failIfMajorPerformanceCaveat rejects most software paths outright; the
    // renderer-name check below catches the ones that lie about it.
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    if (!gl) {
      cached = false;
      return cached;
    }

    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';

    // Release the probe context immediately. Browsers cap live WebGL contexts
    // per page at around sixteen, and leaking one here would count against the
    // real renderer for the rest of the session.
    gl.getExtension('WEBGL_lose_context')?.loseContext();

    cached = !/swiftshader|llvmpipe|software|basic render/i.test(name);
    return cached;
  } catch {
    cached = false;
    return cached;
  }
}
