import { useEffect, useRef } from 'react';

/**
 * Dev only: a live health readout, on screen.
 *
 * The ground has been seen missing — together with a laggy opening — on a
 * visitor's normal loads, and neither could be reproduced in automation, where
 * the tab runs throttled in the background. A console line is easy to miss, so
 * this puts the numbers in the corner of the page, where any screenshot of the
 * problem carries its own diagnosis:
 *
 *   fps / worst   page frame rate, and the longest frame since load (the lag)
 *   gl            render calls per second — 0 while the page runs means the
 *                 3D loop has stopped
 *   intro         the opening's clock (seconds, 4.2 when finished)
 *   reveal        the reveal the terrain wrote
 *   prog / same   the reveal the terrain's compiled program actually holds,
 *                 and whether it is the same object
 *   terrain       whether its program compiled
 *   lost          WebGL context losses — a GPU reset after a long stall
 *
 * WorldSite only mounts this in development.
 */
export default function WorldDiag() {
  const ref = useRef(null);

  useEffect(() => {
    const stats = { frames: 0, fps: 0, worst: 0, last: performance.now(), start: performance.now(), lost: 0, glLast: 0 };
    let bound = null;
    const onLost = () => {
      stats.lost += 1;
    };

    let frame = 0;
    const tick = (now) => {
      const dt = now - stats.last;
      stats.last = now;
      /* The first half-second is the page itself arriving; not the lag. */
      if (now - stats.start > 500 && dt > stats.worst) stats.worst = dt;
      stats.frames += 1;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    const f2 = (v) => (typeof v === 'number' ? v.toFixed(2) : '—');

    const id = setInterval(() => {
      const gl = window.__worldGl;
      if (gl && !bound) {
        bound = gl.domElement;
        bound.addEventListener('webglcontextlost', onLost);
      }
      const mesh = window.__terrainMesh?.current;
      const props = gl && mesh ? gl.properties.get(mesh.material) : null;
      const program = props?.currentProgram;
      const glFrames = gl ? gl.info.render.frame : 0;
      const glRate = (glFrames - stats.glLast) * 4;
      stats.glLast = glFrames;
      stats.fps = stats.frames * 4;
      stats.frames = 0;

      const reveal = window.__terrainReveal;
      const programReveal = props?.uniforms?.uReveal;
      const parts = [
        `fps ${stats.fps}`,
        `worst ${Math.round(stats.worst)}ms`,
        `gl ${glRate}/s`,
        `intro ${f2(window.__introClock?.current)}`,
        `reveal ${f2(reveal?.value)}`,
        `prog ${f2(programReveal?.value)}`,
        `same ${programReveal ? (programReveal === reveal ? 'yes' : 'NO') : '—'}`,
        `terrain ${program ? (program.diagnostics && !program.diagnostics.runnable ? 'FAILED' : 'ok') : mesh ? 'no-program' : 'no-mesh'}`,
        `lost ${stats.lost}`,
        document.visibilityState,
      ];
      if (ref.current) ref.current.textContent = parts.join('  ·  ');
    }, 250);

    return () => {
      cancelAnimationFrame(frame);
      clearInterval(id);
      bound?.removeEventListener('webglcontextlost', onLost);
    };
  }, []);

  return <div ref={ref} className="w-diag" aria-hidden="true" />;
}
