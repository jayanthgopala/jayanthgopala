import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferGeometry, Color, FrontSide, Plane, Raycaster, ShaderMaterial, Vector2, Vector3 } from 'three';
import { makeWaterMaterial } from '../water/ObjectWater.jsx';
import { RippleSim } from '../water/ripples.js';
import { MODEST, SIM_SIZE } from '../water/device.js';
import { sound } from '../lib/sound.js';
import { iconBlob } from './iconBlob.js';
import { LAKE_Y, LOGO_Y } from './layout.js';

// The current social mark as an object of water — the same water, and the
// same behaviour, as the objects on the project page.
//
// A closed rounded body in the icon's shape (no cut edges), in the project
// objects' material, pushed along its normals by the same damped ripple
// simulation: moving over it sends ripples out from under the pointer, a press
// drops into it, and it swells slowly on its own. It turns slowly by itself,
// and a drag turns it, coasting on after a flick. Switching links shrinks the
// old mark away and swells the next one in. The glossy floor mirrors it.

/** Width of the mark, sized to sit inside the narrow case. */
const MARK_SIZE = 1.35;

/** Surface resolution across the mark. */
const CELLS = MODEST ? 84 : 140;

/** Width of the mark's face the ripple sheet covers, in its own units. */
const FIELD_SPAN = 1.8;

/** As on the project page: slow idle turn, and how quickly a flick bleeds off. */
const IDLE_SPIN = 0.16;
const SPIN_DECAY = 0.055;

/** Seconds for the old mark to melt into a drop, and for the drop to re-form as the next. */
const SWAP_OUT = 0.5;
const SWAP_IN = 0.85;

/** The floor, relative to the mark's centre, which it is mirrored across. */
const LAKE_REL = LAKE_Y - LOGO_Y;

const ease = (x) => x * x * (3 - 2 * x);

// On low-end machines the reflection is a cheap tinted copy rather than a
// second body of transmissive water.
function makeCheapReflection() {
  return new ShaderMaterial({
    uniforms: { uStrength: { value: 0 }, uTint: { value: new Color('#9fb2c4') } },
    vertexShader: /* glsl */ `
      varying vec3 vNormalW;
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4( position, 1.0 );
        vWorld = w.xyz;
        vNormalW = normalize( mat3( modelMatrix ) * normal );
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uStrength;
      uniform vec3 uTint;
      varying vec3 vNormalW;
      varying vec3 vWorld;
      void main() {
        vec3 V = normalize( cameraPosition - vWorld );
        float fres = pow( 1.0 - abs( dot( normalize( vNormalW ), V ) ), 2.0 );
        gl_FragColor = vec4( uTint * ( 0.6 + 0.6 * fres ), uStrength * ( 0.3 + 0.4 * fres ) );
      }
    `,
    transparent: true,
    depthWrite: false,
  });
}

// Building a body blocks the main thread, so each is built in its own idle
// slot rather than all at once.
function useMarkGeometries(socials) {
  const [geometries, setGeometries] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let handle = 0;
    const built = [];
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 16));
    const cancelIdle = window.cancelIdleCallback || clearTimeout;

    const step = () => {
      if (cancelled) return;
      const i = built.length;
      if (i >= socials.length) {
        setGeometries(built);
        return;
      }
      try {
        built.push(
          iconBlob(socials[i].icon, socials[i].label, {
            size: MARK_SIZE,
            cells: CELLS,
            depth: 0.2,
            round: 0.15,
            smooth: MODEST ? 4 : 6,
          })
        );
      } catch (error) {
        console.error('[WaterMark] could not build mark', socials[i], error);
        built.push(new BufferGeometry());
      }
      handle = idle(step, { timeout: 500 });
    };

    setGeometries(null);
    // With a timeout: the ring canvas renders every frame, and without one an
    // idle slot may never come, so the marks would never be built.
    handle = idle(step, { timeout: 500 });
    return () => {
      cancelled = true;
      cancelIdle(handle);
      built.forEach((g) => g.dispose());
    };
  }, [socials]);

  return geometries;
}

export default function WaterMark({ socials, index, levels, reduced = false }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const turn = useRef(null);
  const body = useRef(null);
  const mirrorTurn = useRef(null);
  const reflection = useRef(null);

  const geometries = useMarkGeometries(socials);

  const sim = useMemo(() => {
    const s = new RippleSim(SIM_SIZE);
    s.setAspect(1);
    return s;
  }, []);

  const uniforms = useRef({
    uRipple: { value: sim.texture },
    uFocus: { value: 1 },
    uTime: { value: 0 },
    uRippleAmp: { value: reduced ? 0.05 : 0.12 },
    uIdleAmp: { value: reduced ? 0.02 : 0.06 },
    uImpactAmp: { value: reduced ? 0 : 0.18 },
    uFieldScale: { value: 1 / FIELD_SPAN },
    uMelt: { value: 1 },
  });

  const material = useMemo(() => {
    // The project water, with a dark rim so it reads against the white room,
    // and a little more reflection and clearcoat for the highlights to catch.
    const m = makeWaterMaterial(uniforms.current, {
      planar: true,
      morph: true,
      edge: { color: '#1c2a3a', amount: 0.55 },
    });
    m.envMapIntensity = 3.2;
    m.clearcoat = 1;
    m.clearcoatRoughness = 0.03;
    m.thickness = 1.4;
    // A closed body: its front faces and thickness stand in for the far side.
    m.side = FrontSide;
    return m;
  }, []);
  const cheapReflection = useMemo(() => (MODEST ? makeCheapReflection() : null), []);

  useEffect(
    () => () => {
      material.dispose();
      cheapReflection?.dispose();
      sim.dispose();
    },
    [material, cheapReflection, sim]
  );

  // Pointer, fed from the window: the canvas takes no pointer events of its
  // own, so the page's controls stay clickable.
  const pointer = useRef({ ndc: new Vector2(), seen: false, press: false });
  const own = useRef({ x: 0, y: 0, vx: 0, vy: 0, dragging: false, lastX: 0, lastY: 0 });

  useEffect(() => {
    if (reduced) return undefined;
    const toNdc = (event) => {
      const box = gl.domElement.getBoundingClientRect();
      pointer.current.ndc.set(
        ((event.clientX - box.left) / box.width) * 2 - 1,
        -((event.clientY - box.top) / box.height) * 2 + 1
      );
      pointer.current.seen = true;
    };

    const onMove = (event) => {
      toNdc(event);
      const o = own.current;
      if (!o.dragging) return;
      // Screen distance, as on the project page: the same drag turns it the
      // same amount however fast, and the leftover velocity is the flick.
      const dy = ((event.clientX - o.lastX) / window.innerWidth) * 3.2;
      const dx = ((event.clientY - o.lastY) / window.innerHeight) * 3.2;
      o.y += dy;
      o.x += dx;
      o.vy = dy * 18;
      o.vx = dx * 18;
      o.lastX = event.clientX;
      o.lastY = event.clientY;
    };

    const onDown = (event) => {
      if (levels.current.show < 0.85) return;
      if (event.target instanceof Element && event.target.closest('a, button, input, [role="button"]')) return;
      toNdc(event);
      const o = own.current;
      o.dragging = true;
      o.lastX = event.clientX;
      o.lastY = event.clientY;
      pointer.current.press = true;
    };

    const onUp = () => {
      own.current.dragging = false;
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [gl, reduced, levels]);

  const trace = useMemo(
    () => ({
      raycaster: new Raycaster(),
      plane: new Plane(),
      normal: new Vector3(),
      origin: new Vector3(),
      hit: new Vector3(),
      uv: new Vector2(),
      last: new Vector2(),
      hasLast: false,
    }),
    []
  );

  // Which mark is shown, and how far the water has melted between marks.
  const swap = useRef({ shown: 0, pending: null, phase: 'idle', melt: 0 });

  useEffect(() => {
    if (!socials.length) return;
    swap.current.pending = ((index % socials.length) + socials.length) % socials.length;
  }, [index, socials.length]);

  useEffect(() => {
    swap.current = { shown: 0, pending: null, phase: 'idle', melt: 0 };
  }, [geometries]);

  useFrame((_, delta) => {
    const mesh = body.current;
    const g = turn.current;
    const refl = reflection.current;
    if (!geometries?.length || !mesh || !g) return;

    const show = levels.current.show;
    if (show < 0.001) {
      mesh.visible = false;
      if (refl) refl.visible = false;
      return;
    }

    const dt = Math.min(delta, 0.05);
    const u = uniforms.current;
    u.uTime.value += dt;
    u.uFocus.value = show;

    // Re-form between marks, in place: the water melts into one rounded drop,
    // the shape is changed while it is only a drop, and the drop re-forms as
    // the next mark. Changing mind part way just melts back the other way.
    const s = swap.current;
    if (mesh.geometry !== geometries[s.shown]) mesh.geometry = geometries[s.shown];
    if (s.pending !== null && s.pending !== s.shown) {
      if (s.phase !== 'out') {
        s.phase = 'out';
        sim.impulse(0.5, 0.5, 0.5, 0.18);
      }
      s.melt = Math.min(1, s.melt + dt / (reduced ? 0.01 : SWAP_OUT));
      if (s.melt >= 1) {
        s.shown = s.pending;
        s.pending = null;
        mesh.geometry = geometries[s.shown];
        s.phase = 'in';
        // A last swirl through the drop as it starts to take the new shape.
        sim.impulse(0.5, 0.5, 0.6, 0.22);
      }
    } else {
      s.pending = null;
      s.melt = Math.max(0, s.melt - dt / (reduced ? 0.01 : SWAP_IN));
      if (s.melt === 0) s.phase = 'idle';
    }

    // Arriving in the room, the mark also forms up out of the drop.
    u.uMelt.value = Math.max(s.melt, 1 - show);
    mesh.scale.setScalar(Math.max(0.001, Math.min(1, show * 1.6)));
    mesh.position.y = 0;
    mesh.visible = show > 0.01;

    // Idle turn, then whatever a flick left over, decayed by time.
    const o = own.current;
    if (!reduced) o.y += IDLE_SPIN * dt;
    o.y += o.vy * dt;
    o.x += o.vx * dt;
    const bleed = SPIN_DECAY ** dt;
    o.vx *= bleed;
    o.vy *= bleed;
    o.x = Math.max(-1.2, Math.min(1.2, o.x));
    g.rotation.set(o.x, o.y, 0);

    // The reflection follows the body exactly, mirrored across the floor.
    if (refl && mirrorTurn.current) {
      mirrorTurn.current.rotation.copy(g.rotation);
      if (refl.geometry !== mesh.geometry) refl.geometry = mesh.geometry;
      refl.scale.copy(mesh.scale);
      refl.position.copy(mesh.position);
      refl.visible = mesh.visible;
      if (cheapReflection) cheapReflection.uniforms.uStrength.value = show;
    }

    // Touch: trace the pointer onto the mark's face, in its own turning frame,
    // and disturb the ripple sheet there — as the project objects do.
    const p = pointer.current;
    if (p.seen && show > 0.85 && s.phase === 'idle' && !reduced) {
      g.updateWorldMatrix(true, false);
      trace.normal.set(0, 0, 1).transformDirection(g.matrixWorld);
      trace.origin.setFromMatrixPosition(g.matrixWorld);
      trace.plane.setFromNormalAndCoplanarPoint(trace.normal, trace.origin);
      trace.raycaster.setFromCamera(p.ndc, camera);

      let onFace = false;
      if (trace.raycaster.ray.intersectPlane(trace.plane, trace.hit)) {
        g.worldToLocal(trace.hit);
        trace.uv.set(trace.hit.x / FIELD_SPAN + 0.5, trace.hit.y / FIELD_SPAN + 0.5);
        onFace = trace.uv.x >= 0 && trace.uv.x <= 1 && trace.uv.y >= 0 && trace.uv.y <= 1;
      }

      if (onFace) {
        if (p.press) {
          // A push into the surface.
          sim.impulse(trace.uv.x, trace.uv.y, 0.9, 0.085);
          sound.drop?.(1);
        } else if (trace.hasLast) {
          const speed = Math.hypot(trace.uv.x - trace.last.x, trace.uv.y - trace.last.y);
          if (speed > 0.0006) {
            sim.impulse(trace.uv.x, trace.uv.y, Math.min(0.32, speed * 8), 0.05);
            sound.waterRipple?.(speed, trace.uv.x, trace.uv.y);
          }
        }
        trace.last.copy(trace.uv);
        trace.hasLast = true;
      } else {
        trace.hasLast = false;
      }
    }
    p.press = false;

    sim.update(gl, dt);
    u.uRipple.value = sim.texture;
  });

  return (
    <group position={[0, LOGO_Y, 0]}>
      <group ref={turn}>
        <mesh ref={body} material={material} frustumCulled={false} visible={false} />
      </group>
      {/* Mirrored across the floor: the same water, seen through the glossy
          floor as the reflection (a cheap tinted copy on low-end machines). */}
      <group position={[0, 2 * LAKE_REL, 0]} scale={[1, -1, 1]}>
        <group ref={mirrorTurn}>
          <mesh
            ref={reflection}
            material={cheapReflection || material}
            renderOrder={2}
            frustumCulled={false}
            visible={false}
          />
        </group>
      </group>
    </group>
  );
}
