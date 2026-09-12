import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { AdaptiveEvents, Preload } from '@react-three/drei';
import Atmosphere from './environment/Atmosphere.jsx';
import Sky from './environment/Sky.jsx';
import Clouds from './environment/Clouds.jsx';
import Terrain from './environment/Terrain.jsx';
import Scree from './environment/Scree.jsx';
import Weather from './environment/Weather.jsx';
import Lattice from './environment/Lattice.jsx';
import IglooBlocks from './structures/IglooBlocks.jsx';
import CameraRig from './camera/CameraRig.jsx';
import TravelGlitch from './effects/TravelGlitch.jsx';
import IceCut, { CutFrameGate } from './effects/IceCut.jsx';
import { EffectComposer, Bloom, Vignette, ChromaticAberration, TiltShift2, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Vector2, WebGLRenderTarget } from 'three';
import { useWorldScroll } from './scroll/ScrollProvider.jsx';
import { LOOK } from './lib/lighting.js';

// Radial chromatic aberration driven by scroll travel speed.
function TravelFringe() {
  const { flight } = useWorldScroll();
  const ref = useRef(null);
  const initial = useRef(new Vector2(0, 0));

  useFrame((state) => {
    const effect = ref.current;
    if (!effect) return;
    const amount = Math.pow(flight.current, 0.8);
    const px = 14.0 / state.gl.getDrawingBufferSize(scratch).x;
    effect.offset.set(amount * px, amount * px * 0.65);
  });

  return <ChromaticAberration ref={ref} offset={initial.current} radialModulation modulationOffset={0.22} />;
}

// Peripheral tilt-shift blur during camera movement.
function TravelSmear() {
  const { flight } = useWorldScroll();
  const ref = useRef(null);

  useFrame(() => {
    const effect = ref.current;
    if (!effect) return;
    const t = flight.current;
    effect.blur = Math.pow(t, 0.6) * 1.45;
  });

  return <TiltShift2 ref={ref} blur={0} focusArea={0.38} feather={0.58} />;
}

// Pre-compiles shaders before descent begins to prevent initial frame drops.
function Warmup({ armed = false, onWarm }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const phase = useRef({ step: 'idle', armedAt: 0, smooth: 0 });

  useEffect(() => {
    if (!armed) return undefined;
    if (phase.current.step === 'done') {
      onWarm?.();
      return undefined;
    }
    let cancelled = false;
    const p = phase.current;
    p.armedAt = performance.now();
    p.step = 'compiling';

    const target = new WebGLRenderTarget(4, 4);
    const previous = gl.getRenderTarget();
    let pending;
    try {
      gl.setRenderTarget(target);
      pending = gl.compileAsync(scene, camera);
    } catch {
      pending = null;
    } finally {
      gl.setRenderTarget(previous);
    }

    Promise.resolve(pending)
      .catch(() => {})
      .then(() => {
        if (!cancelled && p.step === 'compiling') p.step = 'settling';
      });

    return () => {
      cancelled = true;
      target.dispose();
    };
  }, [armed, gl, scene, camera]);

  useFrame((_, delta) => {
    const p = phase.current;
    if (p.step === 'idle' || p.step === 'done') return;
    if (p.step === 'settling') p.smooth = delta < 1 / 30 ? p.smooth + 1 : 0;
    if (p.smooth >= 12 || performance.now() - p.armedAt > 3000) {
      p.step = 'done';
      onWarm?.();
    }
  });

  return null;
}

const scratch = new Vector2();

const TRAVEL_FX = {
  smear: true,
  fringe: true,
  glitch: false,
};

const EXPOSURE = LOOK.grade.exposure;

export default function Stage({ onIglooReady, begin = false, warm = false, onWarm }) {
  return (
    <div className="w-stage">
      <Canvas
        className="w-canvas"
        shadows="percentage"
        dpr={[1, 1.75]}
        gl={{
          antialias: true,
          powerPreference: 'high-performance',
          alpha: false,
          stencil: false,
        }}
        camera={{ fov: 42, near: 4, far: 2600, position: [0, 62, 330] }}
        onCreated={({ gl }) => {
          gl.toneMappingExposure = EXPOSURE;
        }}
      >
        <Suspense fallback={null}>
          <Sky />
          <Clouds />
          <Terrain />
          <Scree />
          <Weather />
          <Atmosphere />
          <IglooBlocks at={[-30, 252]} tint="#c2d6ea" onReady={onIglooReady} />
          <Preload all />
        </Suspense>

        <CameraRig begin={begin} />
        <Warmup armed={warm} onWarm={onWarm} />
        <Lattice at={[-30, 252]} />

        <EffectComposer disableNormalPass>
          <Bloom
            intensity={LOOK.grade.bloom.intensity}
            luminanceThreshold={LOOK.grade.bloom.threshold}
            luminanceSmoothing={LOOK.grade.bloom.smoothing}
            mipmapBlur
          />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <Vignette offset={LOOK.grade.vignette.offset} darkness={LOOK.grade.vignette.darkness} eskil={false} />
          {TRAVEL_FX.smear && <TravelSmear />}
          {TRAVEL_FX.fringe && <TravelFringe />}
          {TRAVEL_FX.glitch && <TravelGlitch />}
          <IceCut />
        </EffectComposer>

        <AdaptiveEvents />
        <CutFrameGate />
      </Canvas>
    </div>
  );
}
