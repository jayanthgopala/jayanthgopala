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
import { Color, NoToneMapping, Vector2, Vector3 } from 'three';
import { ICE_PAGE } from '../lib/ice-page.js';
import Backdrop from './Backdrop.jsx';
import ObjectWater from './ObjectWater.jsx';
import { shapeGeometry } from './shapes.js';
import Bubbles from './Bubbles.jsx';
import { RippleSim } from './ripples.js';
import { sound } from '../lib/sound.js';
import { ENV_SIZE, MAX_DPR, SIM_SIZE } from './device.js';


// Anything the backdrop fails to cover should still be ice, never the black
// a default clear gives.
const CLEAR = new Color(`rgb(${ICE_PAGE.base[0]}, ${ICE_PAGE.base[1]}, ${ICE_PAGE.base[2]})`);

/** Half-width of the pick plane the pointer is tested against. */
const PLANE = 3.2;

/**
 * Radius the object is treated as occupying, for deciding whether a click was
 * aimed at it. A little over the geometry's own 1.25 so the rim and the water
 * pushed out past it still count as the object rather than as a miss.
 */
const HIT_RADIUS = 1.45;

/** The geometry's own radius, which every shape is normalised to. */
const OBJECT_RADIUS = 1.25;

/** How far an object travels to leave the frame, in world units. */
const SLIDE = 3.2;

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

function Scene({ pointer, calm, shapes, index, position, spin, anchor, overObject }) {
  const { gl, camera, size } = useThree();

  const sim = useMemo(() => {
    const s = new RippleSim(SIM_SIZE);
    s.setAspect(1); // The object field is square.
    return s;
  }, []);

  useEffect(() => () => sim.dispose(), [sim]);

  // The object under the camera and the one queued behind it. Only these two
  // are ever built, however long the project list is.
  const here = shapes[index] ?? null;
  const next = shapes[index + 1] ?? null;

  const announced = useRef(index);
  useEffect(() => {
    if (announced.current === index) return;
    announced.current = index;
    sound.pass();
  }, [index]);

  // Tessellating a shape costs a beat, and paying it the moment one scrolls
  // into view would hitch exactly when the motion needs to be smooth. The stage
  // mounts before the cut finishes, so there is idle time here to spend.
  useEffect(() => {
    // The first two are what the reader meets; the rest can wait for idle.
    const ordered = [...new Set(shapes)];
    ordered.slice(0, 2).forEach((id) => shapeGeometry(id));
    const pending = ordered.slice(2);
    let cancelled = false;
    const schedule = window.requestIdleCallback || ((fn) => setTimeout(fn, 1));

    const build = () => {
      if (cancelled) return;
      const id = pending.shift();
      if (!id) return;
      shapeGeometry(id);
      schedule(build);
    };

    schedule(build);
    return () => {
      cancelled = true;
    };
  }, [shapes]);

  // Driven straight from scroll every frame, so the slide tracks the wheel
  // rather than playing a fixed animation once a threshold is crossed.
  const hereGroup = useRef(null);
  const nextGroup = useRef(null);
  const hereFocus = useRef(1);
  const nextFocus = useRef(0);

  const marker = useRef(new Vector3());

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


    // Measured against the index React has actually rendered, not against a
    // fraction reset on crossing. Scroll advances the position ref immediately
    // while `index` arrives a frame or more later; anchoring to the rendered
    // index means that gap just reads as the slide continuing past 1, instead
    // of the outgoing letter snapping back to centre for a frame.
    // Straight through: the position handed in is already damped and rate
    // capped, so the object should track it one to one. Anything applied on top
    // of that shows up as the object stalling and then catching up.
    const t = position.current - index;
    if (hereGroup.current) hereGroup.current.position.y = t * SLIDE;
    if (nextGroup.current) nextGroup.current.position.y = (t - 1) * SLIDE;
    const clamped = Math.min(1, t);
    hereFocus.current = 1 - clamped;
    nextFocus.current = clamped;

    // Where the object actually is on screen, so the labels can be pinned to it
    // rather than to the middle of the viewport. Whichever of the two is nearer
    // the centre is the one being named.
    if (anchor) {
      const group = clamped < 0.5 ? hereGroup.current : nextGroup.current;
      if (group) {
        group.updateWorldMatrix(true, false);
        const point = marker.current.setFromMatrixPosition(group.matrixWorld);
        const offset = point.y;
        point.project(camera);
        anchor.current.x = point.x * 0.5 + 0.5;
        // Screen coordinates run down the page; clip space runs up it.
        anchor.current.y = point.y * -0.5 + 0.5;

        // Is the whole object in frame, rather than merely present?
        //
        // Derived from the camera instead of a threshold on the scroll, so it
        // stays true at any viewport shape: half the visible height where the
        // object sits, against how far it has travelled plus its own radius.
        const halfHeight =
          Math.tan((camera.fov * Math.PI) / 360) * Math.abs(camera.position.z);
        anchor.current.whole = Math.abs(offset) + OBJECT_RADIUS <= halfHeight;
      }
    }

    if (state.inside && !calm) {
      r.origin.setFromMatrixPosition(camera.matrixWorld);
      r.direction
        .set(state.ndc.x, state.ndc.y, 0.5)
        .unproject(camera)
        .sub(r.origin)
        .normalize();

      // Whichever object is nearer the centre owns the pointer.
      const focused = clamped < 0.5 ? t * SLIDE : (t - 1) * SLIDE;

      // Is the pointer actually over it? Closest approach of the ray to the
      // object's centre, against its radius — the page behind should not open
      // a project just because it was clicked.
      if (overObject) {
        const cx = -r.origin.x;
        const cy = focused - r.origin.y;
        const cz = -r.origin.z;
        const along = cx * r.direction.x + cy * r.direction.y + cz * r.direction.z;
        const distance = Math.sqrt(
          Math.max(0, cx * cx + cy * cy + cz * cz - along * along)
        );
        overObject.current = along > 0 && distance <= HIT_RADIUS;
      }
      if (planeUv(r.origin, r.direction, focused, r.uv)) {
        if (state.press) {
          state.press = false;
          // A push into the surface, with no spray thrown off it.
          sim.impulse(r.uv.x, r.uv.y, 0.9, 0.085);
          sound.drop(1);
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
      if (overObject) overObject.current = false;
    }

    sim.update(gl, dt);
  });

  return (
    <>
      <Backdrop scroll={position} />

      {/* Studio glass lighting: bright narrow strips against a darker surround.
          The contrast is the point — an evenly lit environment reflects as a
          flat sheen and the letter loses its edges, which is exactly how it was
          reading before. */}
      <Environment resolution={ENV_SIZE} frames={1}>
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

      {here && (
        <group ref={hereGroup}>
          <ObjectWater sim={sim} shape={here} focus={hereFocus} spin={spin} calm={calm} />
        </group>
      )}

      {next && (
        <group ref={nextGroup} position={[0, -SLIDE, 0]}>
          <ObjectWater sim={sim} shape={next} focus={nextFocus} spin={spin} calm={calm} />
        </group>
      )}
      <Bubbles calm={calm} />
    </>
  );
}

export default function WaterStage({
  active, calm = false, shapes, index, position, anchor, onOpen,
}) {
  // Written by the scene each frame; read by the pointer handlers, which run
  // outside the canvas and have no other way to know what is under the cursor.
  const overObject = useRef(false);
  const wrap = useRef(null);
  const pointer = useRef({ ndc: { x: 0, y: 0 }, inside: false, press: false });
  const [ring, setRing] = useState({ x: 0, y: 0, on: false });

  // Per-frame rotation the object should take on, decayed each frame so a flick
  // keeps turning briefly after release instead of stopping dead.
  // Drag collected since the last frame, waiting to be claimed. Not an
  // orientation: holding one here meant every object read the same value and a
  // drag turned all of them at once.
  const spin = useRef({ x: 0, y: 0, vx: 0, vy: 0 });
  const dragging = useRef(false);

  // A click that followed a drag is a scrub, not a choice.
  const down = useRef({ x: 0, y: 0, at: 0 });

  const last = useRef({ x: 0, y: 0 });

  const track = useCallback((event) => {
    const node = wrap.current;
    if (!node) return;
    const box = node.getBoundingClientRect();
    pointer.current.ndc.x = ((event.clientX - box.left) / box.width) * 2 - 1;
    pointer.current.ndc.y = -((event.clientY - box.top) / box.height) * 2 + 1;
    pointer.current.inside = true;

    if (dragging.current) {
      // Screen distance, not pointer velocity: dragging the same distance
      // turns the object the same amount however fast you did it. The residual
      // velocity is what lets a flick carry on after release.
      const dy = ((event.clientX - last.current.x) / box.width) * 3.2;
      const dx = ((event.clientY - last.current.y) / box.height) * 3.2;
      spin.current.y += dy;
      spin.current.x += dx;
      spin.current.vy = dy * 18;
      spin.current.vx = dx * 18;
    }
    last.current = { x: event.clientX, y: event.clientY };

    setRing({ x: event.clientX - box.left, y: event.clientY - box.top, on: true });
  }, []);

  const leave = useCallback(() => {
    pointer.current.inside = false;
    dragging.current = false;
    setRing((r) => (r.on ? { ...r, on: false } : r));
  }, []);

  const press = useCallback(
    (event) => {
      last.current = { x: event.clientX, y: event.clientY };
      dragging.current = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      track(event);
      pointer.current.press = true;
      down.current = { x: event.clientX, y: event.clientY, at: performance.now() };
    },
    [track]
  );

  const release = useCallback(
    (event) => {
      dragging.current = false;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      const moved = Math.hypot(event.clientX - down.current.x, event.clientY - down.current.y);
      const held = performance.now() - down.current.at;
      // Anything that travelled was a turn, not a choice — and a click has to
      // have landed on the object itself, not on the page around it.
      if (moved < 8 && held < 600 && overObject.current) onOpen?.();
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
        dpr={[1, MAX_DPR]}
        camera={{ fov: 32, position: [0, 0, 7.2], near: 0.1, far: 40 }}
        onCreated={({ gl }) => gl.setClearColor(CLEAR, 1)}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
          toneMapping: NoToneMapping,
        }}
      >
        <Scene
          overObject={overObject}
          anchor={anchor}
          spin={spin}
          pointer={pointer}
          calm={calm}
          shapes={shapes}
          index={index}
          position={position}
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
