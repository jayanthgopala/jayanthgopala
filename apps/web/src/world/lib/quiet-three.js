// three r0.185 deprecates THREE.Clock, but @react-three/fiber 9.7 still creates
// one for every canvas, so each of the site's canvases logged the notice. This
// app never uses Clock itself; only that one notice is dropped, and everything
// else goes through untouched. Remove once fiber moves to THREE.Timer.

const NOTICE = 'THREE.Clock: This module has been deprecated';

if (typeof console !== 'undefined' && !globalThis.__quietThreeClock) {
  globalThis.__quietThreeClock = true;
  const warn = console.warn.bind(console);
  console.warn = (...args) => {
    if (typeof args[0] === 'string' && args[0].startsWith(NOTICE)) return;
    warn(...args);
  };
}
