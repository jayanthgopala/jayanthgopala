import { useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';

/**
 * Publishes what the renderer is actually doing onto a DOM attribute.
 *
 * WHY THE DOM AND NOT A GLOBAL. Browser automation and extension consoles run
 * their JavaScript in an isolated world: they share the document, but not the
 * page's `window`. Anything hung off `window` for debugging is invisible to
 * them, which makes the obvious approach — stash the R3F state on a global and
 * read it back — silently return nothing and look exactly like the renderer
 * having failed to start. The document is the one channel both sides can see.
 *
 * IT ALSO MEASURES FLICKER, which is the point of the pixel sampling below.
 *
 * A still screenshot cannot show a flicker: by definition the artefact is that
 * consecutive frames differ when nothing in the scene has moved. Chasing it by
 * eye means guessing at causes and declaring victory on a single frame that
 * happened to look fine — which is exactly how several plausible-but-wrong
 * fixes got made here.
 *
 * So this reads the framebuffer directly. Three small patches are sampled every
 * frame and checksummed; when the camera and the cursor are both still, any
 * frame whose checksum differs from the last is a frame that flickered. The
 * patches are placed in different parts of the image so the readout says WHERE
 * it is unstable, not merely that it is.
 *
 * DEV only — Stage does not mount it in a production build, and the
 * preserveDrawingBuffer that makes readPixels reliable is dev-only too.
 */

/*
 * RUN AFTER THE COMPOSER, or the numbers are fiction.
 *
 * A plain useFrame has priority 0 and runs BEFORE EffectComposer's render pass,
 * which takes priority 1. readPixels at priority 0 therefore samples whatever
 * was in the drawing buffer from the previous frame — and with a composer
 * ping-ponging between two render targets, that alternates. The result reads as
 * a rock-steady sky (pure background, identical in both buffers) next to
 * geometry regions flickering at close to 50%, which is exactly the pattern
 * that sent this investigation chasing a shimmer that was not on screen.
 *
 * A higher priority runs later, so the sample is taken from the finished frame.
 */
const RENDER_LAST = 2;

const PATCH = 12;

/** Where to sample, in fractions of the viewport. */
const REGIONS = [
  { name: 'sky', x: 0.5, y: 0.12 },
  { name: 'horizon', x: 0.28, y: 0.36 },
  { name: 'igloo', x: 0.5, y: 0.52 },
  { name: 'ground', x: 0.5, y: 0.85 },
];

export default function Diagnostics() {
  const { gl, scene } = useThree();
  const tick = useRef(0);
  const previous = useRef(REGIONS.map(() => -1));
  const changed = useRef(REGIONS.map(() => 0));
  const sampled = useRef(0);
  const buffer = useRef(new Uint8Array(PATCH * PATCH * 4));

  useFrame(() => {
    tick.current += 1;

    /* --- Flicker sampling ------------------------------------------------
       readPixels is a SYNCHRONOUS GPU READBACK: it forces the driver to finish
       every queued command before it can return, so it does not merely cost its
       own time, it drains the pipeline. Now that this runs after the composer
       (see RENDER_LAST) the stall lands at the worst possible moment, and every
       third frame took the scene from 80fps to 6. Every fifteenth costs almost
       nothing and still catches an artefact that repeats several times a
       second. */
    if (tick.current % 15 === 0) {
      const context = gl.getContext();
      const w = gl.domElement.width;
      const h = gl.domElement.height;
      sampled.current += 1;

      REGIONS.forEach((region, i) => {
        const px = Math.round(region.x * w) - PATCH / 2;
        /* readPixels counts from the bottom, the DOM counts from the top. */
        const py = Math.round((1 - region.y) * h) - PATCH / 2;
        if (px < 0 || py < 0 || px + PATCH > w || py + PATCH > h) return;

        context.readPixels(
          px, py, PATCH, PATCH,
          context.RGBA, context.UNSIGNED_BYTE,
          buffer.current
        );

        let sum = 0;
        for (let n = 0; n < buffer.current.length; n += 4) {
          sum = (sum * 31 + buffer.current[n] + buffer.current[n + 1] * 3) % 2147483647;
        }

        if (previous.current[i] !== -1 && sum !== previous.current[i]) {
          changed.current[i] += 1;
        }
        previous.current[i] = sum;
      });
    }

    if (tick.current % 30 !== 0) return;

    let meshes = 0;
    let lights = 0;
    scene.traverse((o) => {
      if (o.isMesh || o.isPoints) meshes += 1;
      else if (o.isLight) lights += 1;
    });

    const { render } = gl.info;
    const unstable = REGIONS.map(
      (r, i) =>
        `${r.name}=${sampled.current ? Math.round((changed.current[i] / sampled.current) * 100) : 0}%`
    ).join(' ');

    document.documentElement.dataset.worldStats = [
      `calls=${render.calls}`,
      `meshes=${meshes}`,
      `lights=${lights}`,
      `frames=${tick.current}`,
    ].join(' ');

    /* Percentage of sampled frames in which each patch changed. With the scene
       at rest anything above a few percent is a flicker. */
    document.documentElement.dataset.worldFlicker = unstable;
  }, RENDER_LAST);

  return null;
}
