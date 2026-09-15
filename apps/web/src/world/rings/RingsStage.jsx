// The ring descent: the scene after the last project.
//
// Its own canvas, laid over the project page. Scroll first plays the cut in
// (composite.js), then drops the camera down the shaft through three shattered
// rings, and finally turns it level in the room at the bottom, where the social
// marks are held in particles.
//
// The scene is rendered to a target and composited by hand rather than through
// the effect composer, because the cut needs a transparent canvas: until the
// seam reaches a pixel, the project page underneath has to show through.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import {
  Color,
  HalfFloatType,
  Mesh,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import { sharedCutTexture } from '../lib/cut-texture.js';
import { sound } from '../lib/sound.js';
import { MIN_DPR, MODEST } from '../water/device.js';

/** Starting density: glass, fog and glow hide resolution, and fill rate is the cost. */
const RING_DPR = Math.min(
  typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
  MODEST ? 1 : 1.25
);
import IceBackdrop from '../water/Backdrop.jsx';
import { FALL_TOP, FOG, RING_Y } from './layout.js';
import { DESCENT_CURVE, DESCENT_U_LAST, DESCENT_U_MID, FALL_PAST_LAST, descentU } from '../chapters.js';
import { COMPOSITE_FRAGMENT, COMPOSITE_VERTEX } from './composite.js';
import GlassRing from './GlassRing.jsx';
import { Drift, Membrane, Tunnel } from './RingGlow.jsx';
import RingRoom from './RingRoom.jsx';
import SocialParticles from './SocialParticles.jsx';

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;

const UP = new Vector3(0, 1, 0);
const DOWN_UP = new Vector3(0, 0, -1);
const STRAIGHT_DOWN = new Vector3(0, -1, 0);
// Direction from the room view position to the pedestal it faces.
const ROOM_LOOK = new Vector3(0, -0.35, -3.8).normalize();

/**
 * Camera path, from the fall progress.
 *
 * It opens steep over the first ring while that ring circles, and settles onto
 * the axis above it. From there it follows DESCENT_CURVE the whole way: down
 * through the first ring, easing off the axis through the rest, and sweeping
 * out into the room view in one continuous curve — no straight drop with a
 * hook at the bottom. The gaze turns from straight down toward the pedestal
 * gradually, from the middle ring on. Up is -Z while looking down so lookAt
 * never degenerates.
 */
function Director({ fall, ringCut, levels }) {
  const camera = useThree((s) => s.camera);
  const pos = useMemo(() => new Vector3(), []);
  const target = useMemo(() => new Vector3(), []);
  const up = useMemo(() => new Vector3(), []);
  const look = useMemo(() => new Vector3(), []);
  const curvePos = useMemo(() => new Vector3(), []);
  const curveTarget = useMemo(() => new Vector3(), []);
  const curveUp = useMemo(() => new Vector3(), []);
  const lastY = useRef(null);

  useFrame(({ clock }) => {
    const f = fall.current;
    const t = clock.elapsedTime;

    // Opening: settle from steep over the first ring onto its axis.
    const a = easeInOut(smooth(0, 0.22, f));
    pos.set(0, lerp(3.1, FALL_TOP, a), lerp(2.2, 0.001, a));
    target.set(0, lerp(-1.65, -3.0, a), lerp(0.35, 0, a));
    up.copy(DOWN_UP);

    // Descent along the curve.
    const u = descentU(f);
    // How far the gaze has turned toward the room: from the middle ring on.
    const w = smooth(DESCENT_U_MID, 1, u);

    if (u > 0) {
      DESCENT_CURVE.getPointAt(u, curvePos);
      curvePos.x = Math.sin(t * 0.25) * 0.06 * w;
      look.copy(STRAIGHT_DOWN).lerp(ROOM_LOOK, w).normalize();
      curveTarget.copy(curvePos).add(look);
      curveUp.copy(DOWN_UP).lerp(UP, w);

      // Hand over from the opening to the curve over a short window, so the
      // two never meet with a jump.
      const k = smooth(0.2, 0.26, f);
      pos.lerp(curvePos, k);
      target.lerp(curveTarget, k);
      up.lerp(curveUp, k);
    }

    camera.position.copy(pos);
    camera.up.copy(up.normalize());
    camera.lookAt(target);

    // A widening pulse through the rings, gone by the last one; then the room's
    // own field of view.
    const through = clamp01(u / DESCENT_U_LAST);
    const fov = lerp(28, 30, w) + 6 * Math.sin(Math.PI * through) * (1 - w);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    const L = levels.current;
    L.f = f;
    // Whole by 60% of the cut: past that the ring is plainly on screen, and a
    // block still settling reads as one left floating in front of it.
    L.form = smooth(0.05, 0.6, ringCut.current);
    L.spin = through * Math.PI * 0.6;
    L.room = smooth(FALL_PAST_LAST - 0.15, FALL_PAST_LAST + 0.02, f);
    L.halo = smooth(FALL_PAST_LAST, FALL_PAST_LAST + 0.18, f);
    L.show = smooth(FALL_PAST_LAST + 0.08, 1, f);

    // How close the camera is to passing through a ring, for the radial blur.
    const onAxis = 1 - smooth(0.2, 1.2, pos.z);
    let prox = 0;
    for (const ry of RING_Y) prox = Math.max(prox, smooth(1.1, 0, Math.abs(pos.y - ry)));
    L.prox = prox * onAxis;

    if (lastY.current !== null) {
      for (const ry of RING_Y) {
        if ((lastY.current - ry) * (pos.y - ry) < 0) {
          sound.portal();
          sound.drop(0.6);
        }
      }
    }
    lastY.current = pos.y;
  });

  return null;
}

/** Renders the scene to a target, then draws the cut composite to the canvas. */
function Composite({ ringCut, levels, reduced }) {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  // Read so the target resizes when the adaptive resolution changes.
  const dpr = useThree((s) => s.viewport.dpr);

  const target = useMemo(
    // Half float for the glow shoulder, but no multisampling: a 4x MSAA float
    // target at full size was the heaviest thing on the GPU here.
    () => new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 0 }),
    []
  );
  // Shared and prepared in idle time by RingsSection; never disposed here.
  const cutTexture = useMemo(() => sharedCutTexture(), []);
  const fog = useMemo(() => new Color(FOG), []);

  const quad = useMemo(() => {
    const material = new ShaderMaterial({
      uniforms: {
        tScene: { value: target.texture },
        tCut: { value: cutTexture },
        uCut: { value: 0 },
        uAspect: { value: 1.777 },
        uReduced: { value: reduced ? 1 : 0 },
        uRing: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: COMPOSITE_VERTEX,
      fragmentShader: COMPOSITE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    });
    const mesh = new Mesh(new PlaneGeometry(2, 2), material);
    mesh.frustumCulled = false;
    const s = new Scene();
    s.add(mesh);
    return { scene: s, mesh, camera: new OrthographicCamera(-1, 1, 1, -1, 0, 1) };
  }, [target, cutTexture, reduced]);

  useEffect(() => {
    const ratio = gl.getPixelRatio();
    target.setSize(Math.max(1, Math.round(size.width * ratio)), Math.max(1, Math.round(size.height * ratio)));
  }, [gl, size, target, dpr]);

  useEffect(
    () => () => {
      target.dispose();
      quad.mesh.geometry.dispose();
      quad.mesh.material.dispose();
    },
    [target, quad]
  );

  // Priority 1: R3F hands rendering over to this frame callback.
  useFrame(({ clock }) => {
    const u = quad.mesh.material.uniforms;
    u.uCut.value = ringCut.current;
    u.uAspect.value = size.width / Math.max(1, size.height);
    u.uRing.value = reduced ? 0 : levels.current.prox;
    u.uTime.value = clock.elapsedTime;

    gl.setRenderTarget(target);
    gl.setClearColor(fog, 1);
    gl.clear();
    gl.render(scene, camera);

    gl.setRenderTarget(null);
    gl.setClearColor(0x000000, 0);
    gl.clear();
    gl.render(quad.scene, quad.camera);
  }, 1);

  return null;
}

/**
 * Density while preparing. Uploading buffers and linking programs costs the
 * same at any size, but the hidden frames themselves are filled pixel by pixel,
 * so they are kept tiny and the canvas goes to full size once they are done.
 */
const WARM_DPR = 0.35;

/**
 * Prepares the scene without ever blocking the page.
 *
 * 1. Every shader is compiled with compileAsync — hidden objects briefly made
 *    visible so they are included — and nothing is drawn until the browser
 *    reports the programs linked. Drawing before then forces a synchronous
 *    link, which is what froze the page on the last project.
 * 2. Then one top-level piece of the scene per frame is drawn forced-visible,
 *    so buffers and textures reach the GPU a little at a time rather than all
 *    in one frame.
 * The canvas is transparent throughout, so none of it is seen.
 */
function Warmup({ onWarm }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const work = useRef({ step: 'compile', queue: [], touched: [] });

  useEffect(() => {
    let alive = true;
    const hidden = [];
    scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });

    let pending = null;
    try {
      pending = gl.compileAsync ? gl.compileAsync(scene, camera) : gl.compile(scene, camera);
    } catch {
      pending = null;
    }
    hidden.forEach((o) => {
      o.visible = false;
    });

    Promise.resolve(pending)
      .catch(() => {})
      .then(() => {
        if (!alive) return;
        work.current.queue = scene.children.slice();
        work.current.step = 'draw';
      });

    return () => {
      alive = false;
    };
  }, [gl, scene, camera]);

  // Before the composite draws: reveal the next piece.
  useFrame(() => {
    const w = work.current;
    if (w.step !== 'draw') return;
    const next = w.queue.shift();
    if (!next) {
      w.step = 'done';
      onWarm?.();
      return;
    }
    next.traverse((o) => {
      w.touched.push([o, o.visible, o.frustumCulled]);
      o.visible = true;
      o.frustumCulled = false;
    });
  }, 0.5);

  // After it: put that piece back as it was.
  useFrame(() => {
    const w = work.current;
    for (const [o, visible, culled] of w.touched) {
      o.visible = visible;
      o.frustumCulled = culled;
    }
    w.touched.length = 0;
  }, 2);

  return null;
}

export default function RingsStage({ active, ringCut, ringFall, socials, index, words, reduced = false, onWarm }) {
  const warmed = useRef(false);
  // Resolution may only adapt once prepared and while the cut is not on screen:
  // resizing clears the canvas for a frame, which read as a flicker mid-cut.
  const offCut = () => warmed.current && (ringCut.current <= 0 || ringCut.current >= 1);
  // Resolution follows the frame rate, so a slow machine drops detail, not frames.
  const [dpr, setDpr] = useState(WARM_DPR);

  const handleWarm = useCallback(() => {
    warmed.current = true;
    setDpr(RING_DPR);
    onWarm?.();
  }, [onWarm]);
  const levels = useRef({
    f: 0, form: 0, spin: 0, room: 0, halo: 0, show: 0, prox: 0,
    near: RING_Y.map(() => 0),
  });

  return (
    <div className="w-rings-stage">
      <Canvas
        frameloop={active ? 'always' : 'never'}
        dpr={dpr}
        camera={{ fov: 28, near: 0.02, far: 60, position: [0, 3.1, 2.2] }}
        gl={{ antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      >
        {/* Dense enough that the next ring down is half lost and the third is a ghost. */}
        <fog attach="fog" args={[FOG, 1.5, 9.5]} />

        {/* No environment map: the glass lights itself in its shader, so the
            cubemap only ever lit the floor. Plain lights do that for free. Kept
            dim — the grade passes everything under 0.7 through untouched. */}
        <ambientLight intensity={0.55} />
        <directionalLight position={[2.5, 6, 3]} intensity={0.8} color="#f4f8ff" />

        {/* The project page's own ice ground — base, dots, glow, wash, drifting
            smear and frost — so the rings sit on exactly the same white. */}
        <IceBackdrop followCamera scroll={ringFall} />
        <Director fall={ringFall} ringCut={ringCut} levels={levels} />

        {RING_Y.map((y, i) => (
          <group key={y}>
            <GlassRing y={y} order={i} levels={levels} />
            {/* Frosted pane in the first ring only, the one in view as the page
                opens; the rings below have none, so the stack reads clearly. */}
            {i === 0 && <Membrane y={y} radius={0.86} />}
          </group>
        ))}

        <Tunnel levels={levels} />
        <Drift count={MODEST ? 160 : 360} />
        <RingRoom levels={levels} words={words} />

        {socials.length > 0 && (
          <SocialParticles socials={socials} index={index} levels={levels} reduced={reduced} />
        )}

        <PerformanceMonitor
          flipflops={3}
          onDecline={() => offCut() && setDpr((d) => Math.max(MIN_DPR, Math.round((d - 0.2) * 100) / 100))}
          onIncline={() => offCut() && setDpr((d) => Math.min(RING_DPR, Math.round((d + 0.2) * 100) / 100))}
          onFallback={() => offCut() && setDpr(MIN_DPR)}
        />
        <Warmup onWarm={handleWarm} />
        <Composite ringCut={ringCut} levels={levels} reduced={reduced} />
      </Canvas>
    </div>
  );
}
