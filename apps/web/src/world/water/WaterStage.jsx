// The water letterform stage.
//
// Sits on the Selected Work page in place of a project list: the liquid takes
// the shape of the current project's initial, scrolling moves between projects,
// and a click opens that project. Only runs once the cut has committed, by
// which point CutFrameGate has dropped the world canvas to `demand`, so the two
// contexts never animate against each other.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { NoToneMapping, Vector2, Vector3 } from 'three';
import Backdrop from './Backdrop.jsx';
import GlyphWater, { PLANE } from './GlyphWater.jsx';
import Droplets from './Droplets.jsx';
import Bubbles from './Bubbles.jsx';
import { RippleSim } from './ripples.js';
import { glyphSdf } from './glyph.js';

const SIM_SIZE = { desktop: 256, mobile: 128 };

/** How far a letter travels to leave the frame, in world units. */
const SLIDE = PLANE * 1.4;

/**
 * Where the ray crosses the plane the letter is drawn on, as a UV.
 * The letter has depth, but picking against its front face would make the
 * hit point jump around as the surface moves; the flat plane is steadier.
 */
function planeUv(origin, direction, offsetY, out) {
  if (Math.abs(direction.z) < 1e-6) return false;
  const t = -origin.z / direction.z;
  if (t <= 0) return false;

  const x = origin.x + direction.x * t;
  // Into the letter's own frame: it may be part way through sliding past.
  const y = origin.y + direction.y * t - offsetY;
  out.set(x / PLANE + 0.5, y / PLANE + 0.5);
  return out.x >= 0 && out.x <= 1 && out.y >= 0 && out.y <= 1;
}

function Scene({ pointer, calm, burstApi, letters, index, slide }) {
  const { gl, camera, size } = useThree();

  const sim = useMemo(() => {
    const s = new RippleSim(size.width < 760 ? SIM_SIZE.mobile : SIM_SIZE.desktop);
    s.setAspect(1); // The glyph field is square.
    return s;
  }, []);

  useEffect(() => () => sim.dispose(), [sim]);

  // The letter under the camera and the one queued behind it. Only these two
  // are ever built, however long the project list is.
  const here = useMemo(() => glyphSdf(letters[index] ?? '·'), [letters, index]);
  const next = useMemo(
    () => (letters[index + 1] != null ? glyphSdf(letters[index + 1]) : null),
    [letters, index]
  );

  // Driven straight from scroll every frame, so the slide tracks the wheel
  // rather than playing a fixed animation once a threshold is crossed.
  const hereGroup = useRef(null);
  const nextGroup = useRef(null);
  const hereFocus = useRef(1);
  const nextFocus = useRef(0);

  const ray = useRef({
    origin: new Vector3(),
    direction: new Vector3(),
    uv: new Vector2(),
    last: new Vector2(),
    hasLast: false,
  });

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const state = pointer.current;
    const r = ray.current;

    // Scroll position within the current letter, 0 at rest, 1 at the next.
    const t = Math.min(1, Math.max(0, slide.current));
    if (hereGroup.current) hereGroup.current.position.y = t * SLIDE;
    if (nextGroup.current) nextGroup.current.position.y = (t - 1) * SLIDE;
    hereFocus.current = 1 - t;
    nextFocus.current = t;

    if (state.inside && !calm) {
      r.origin.setFromMatrixPosition(camera.matrixWorld);
      r.direction
        .set(state.ndc.x, state.ndc.y, 0.5)
        .unproject(camera)
        .sub(r.origin)
        .normalize();

      // Whichever letter is nearer the centre owns the pointer.
      const focused = t < 0.5 ? t * SLIDE : (t - 1) * SLIDE;
      if (planeUv(r.origin, r.direction, focused, r.uv)) {
        if (state.press) {
          state.press = false;
          sim.impulse(r.uv.x, r.uv.y, 0.9, 0.085);
          if (burstApi.current) {
            burstApi.current(
              new Vector3(
                (r.uv.x - 0.5) * PLANE,
                (r.uv.y - 0.5) * PLANE + focused,
                0.1
              ),
              new Vector3(0, 0, 1),
              1
            );
          }
        } else if (r.hasLast) {
          const speed = Math.hypot(r.uv.x - r.last.x, r.uv.y - r.last.y);
          if (speed > 0.0006) {
            sim.impulse(r.uv.x, r.uv.y, Math.min(0.32, speed * 8), 0.05);
          }
        }

        r.last.copy(r.uv);
        r.hasLast = true;
      } else {
        r.hasLast = false;
      }
    } else {
      r.hasLast = false;
      state.press = false;
    }

    sim.update(gl, dt);
  });

  return (
    <>
      <Backdrop />

      {/* Studio glass lighting: bright narrow strips against a darker surround.
          The contrast is the point — an evenly lit environment reflects as a
          flat sheen and the letter loses its edges, which is exactly how it was
          reading before. */}
      <Environment resolution={512} frames={1}>
        <color attach="background" args={['#8ea2b8']} />

        {/* The two key strips, running the height of the letter. These are what
            draw the long vertical highlights down its edges. */}
        <Lightformer
          form="rect"
          intensity={7.5}
          color="#ffffff"
          scale={[0.42, 14, 1]}
          position={[-3.1, 0, 2.8]}
          rotation-y={Math.PI / 2}
        />
        <Lightformer
          form="rect"
          intensity={5.2}
          color="#eaf4ff"
          scale={[0.32, 14, 1]}
          position={[3.1, 0.4, 2.2]}
          rotation-y={-Math.PI / 2}
        />

        {/* A narrow second pair, offset, so curved sections catch more than one
            line and read as round rather than as a flat bevel. */}
        <Lightformer
          form="rect"
          intensity={3.4}
          color="#ffffff"
          scale={[0.18, 9, 1]}
          position={[-1.5, -0.6, 3.4]}
          rotation-y={Math.PI / 2}
        />
        <Lightformer
          form="rect"
          intensity={2.8}
          color="#f2f8ff"
          scale={[0.16, 9, 1]}
          position={[1.9, 0.8, 3.2]}
          rotation-y={-Math.PI / 2}
        />

        {/* Overhead sheet for the top surfaces. */}
        <Lightformer
          form="rect"
          intensity={3.2}
          color="#ffffff"
          scale={[9, 3.5, 1]}
          position={[0, 4.5, 1.5]}
          rotation-x={Math.PI / 2}
        />

        {/* Cool fill from behind, so the back wall of the body is not black. */}
        <Lightformer form="ring" intensity={1.6} color="#cfe0f2" scale={7} position={[0, -1.5, -6]} />
      </Environment>

      <group ref={hereGroup}>
        <GlyphWater sim={sim} glyph={here} focus={hereFocus} calm={calm} />
      </group>

      {next && (
        <group ref={nextGroup} position={[0, -SLIDE, 0]}>
          <GlyphWater sim={sim} glyph={next} focus={nextFocus} calm={calm} />
        </group>
      )}
      <Bubbles calm={calm} />
      {!calm && <Droplets api={burstApi} />}
    </>
  );
}

export default function WaterStage({ active, calm = false, letters, index, slide, onOpen }) {
  const wrap = useRef(null);
  const burstApi = useRef(null);
  const pointer = useRef({ ndc: { x: 0, y: 0 }, inside: false, press: false });
  const [ring, setRing] = useState({ x: 0, y: 0, on: false });

  // A click that followed a drag is a scrub, not a choice.
  const down = useRef({ x: 0, y: 0, at: 0 });

  const track = useCallback((event) => {
    const node = wrap.current;
    if (!node) return;
    const box = node.getBoundingClientRect();
    pointer.current.ndc.x = ((event.clientX - box.left) / box.width) * 2 - 1;
    pointer.current.ndc.y = -((event.clientY - box.top) / box.height) * 2 + 1;
    pointer.current.inside = true;
    setRing({ x: event.clientX - box.left, y: event.clientY - box.top, on: true });
  }, []);

  const leave = useCallback(() => {
    pointer.current.inside = false;
    setRing((r) => (r.on ? { ...r, on: false } : r));
  }, []);

  const press = useCallback(
    (event) => {
      track(event);
      pointer.current.press = true;
      down.current = { x: event.clientX, y: event.clientY, at: performance.now() };
    },
    [track]
  );

  const release = useCallback(
    (event) => {
      const moved = Math.hypot(event.clientX - down.current.x, event.clientY - down.current.y);
      const held = performance.now() - down.current.at;
      if (moved < 8 && held < 600) onOpen?.();
    },
    [onOpen]
  );

  return (
    <div
      ref={wrap}
      className="w-water"
      onPointerMove={track}
      onPointerDown={press}
      onPointerUp={release}
      onPointerLeave={leave}
      onPointerCancel={leave}
    >
      <Canvas
        frameloop={active ? 'always' : 'never'}
        dpr={[1, 1.75]}
        camera={{ fov: 32, position: [0, 0, 7.2], near: 0.1, far: 40 }}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
          toneMapping: NoToneMapping,
        }}
      >
        <Scene
          pointer={pointer}
          calm={calm}
          burstApi={burstApi}
          letters={letters}
          index={index}
          slide={slide}
        />
      </Canvas>

      <span
        className="w-water-ring"
        data-on={ring.on || undefined}
        style={{ transform: `translate3d(${ring.x}px, ${ring.y}px, 0)` }}
        aria-hidden="true"
      />
    </div>
  );
}
