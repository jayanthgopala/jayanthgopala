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

/** Seconds a letter takes to melt into the next one. */
const MORPH_SECONDS = 0.55;

/**
 * Where the ray crosses the plane the letter is drawn on, as a UV.
 * The letter has depth, but picking against its front face would make the
 * hit point jump around as the surface moves; the flat plane is steadier.
 */
function planeUv(origin, direction, out) {
  if (Math.abs(direction.z) < 1e-6) return false;
  const t = -origin.z / direction.z;
  if (t <= 0) return false;

  const x = origin.x + direction.x * t;
  const y = origin.y + direction.y * t;
  out.set(x / PLANE + 0.5, y / PLANE + 0.5);
  return out.x >= 0 && out.x <= 1 && out.y >= 0 && out.y <= 1;
}

function Scene({ pointer, calm, burstApi, letters, index }) {
  const { gl, camera, size } = useThree();

  const sim = useMemo(() => {
    const s = new RippleSim(size.width < 760 ? SIM_SIZE.mobile : SIM_SIZE.desktop);
    s.setAspect(1); // The glyph field is square.
    return s;
  }, []);

  useEffect(() => () => sim.dispose(), [sim]);

  // Two glyphs and a blend, so changing project melts one letter into the next
  // rather than cutting.
  const morph = useRef(1);
  const [pair, setPair] = useState(() => ({
    a: glyphSdf(letters[0] ?? '·'),
    b: glyphSdf(letters[0] ?? '·'),
  }));
  const shown = useRef(0);

  useEffect(() => {
    if (index === shown.current) return;
    const next = letters[index] ?? '·';
    setPair((prev) => ({ a: prev.b, b: glyphSdf(next) }));
    morph.current = 0;
    shown.current = index;

    // A change of letter is a disturbance, so the surface should react to it.
    for (let i = 0; i < 5; i += 1) {
      sim.impulse(0.2 + Math.random() * 0.6, 0.2 + Math.random() * 0.6, 0.5, 0.11);
    }
  }, [index, letters, sim]);

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

    // Parks at 1, meaning "showing b". The next change re-seeds a from it.
    if (morph.current < 1) {
      morph.current = Math.min(1, morph.current + dt / MORPH_SECONDS);
    }

    if (state.inside && !calm) {
      r.origin.setFromMatrixPosition(camera.matrixWorld);
      r.direction
        .set(state.ndc.x, state.ndc.y, 0.5)
        .unproject(camera)
        .sub(r.origin)
        .normalize();

      if (planeUv(r.origin, r.direction, r.uv)) {
        if (state.press) {
          state.press = false;
          sim.impulse(r.uv.x, r.uv.y, 0.9, 0.085);
          if (burstApi.current) {
            burstApi.current(
              new Vector3((r.uv.x - 0.5) * PLANE, (r.uv.y - 0.5) * PLANE, 0.1),
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

      {/* Broad soft panels rather than point lights: water needs something with
          area to reflect or its rim reads as plastic. */}
      <Environment resolution={256} frames={1}>
        <color attach="background" args={['#b9c6d6']} />
        <Lightformer
          form="rect"
          intensity={4.2}
          color="#ffffff"
          scale={[0.7, 12, 1]}
          position={[-3.4, 0, 2.6]}
          rotation-y={Math.PI / 2}
        />
        <Lightformer
          form="rect"
          intensity={3.1}
          color="#eaf3ff"
          scale={[0.55, 12, 1]}
          position={[3.4, 0, 2.0]}
          rotation-y={-Math.PI / 2}
        />
        <Lightformer
          form="rect"
          intensity={2.4}
          color="#ffffff"
          scale={[10, 5, 1]}
          position={[0, 5, 1]}
          rotation-x={Math.PI / 2}
        />
        <Lightformer form="ring" intensity={1.1} color="#dce8f6" scale={6} position={[0, -2, -6]} />
      </Environment>

      <GlyphWater sim={sim} glyphA={pair.a} glyphB={pair.b} morph={morph} calm={calm} />
      <Bubbles calm={calm} />
      {!calm && <Droplets api={burstApi} />}
    </>
  );
}

export default function WaterStage({ active, calm = false, letters, index, onOpen }) {
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
