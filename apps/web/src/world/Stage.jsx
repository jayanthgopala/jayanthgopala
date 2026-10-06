import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { AdaptiveEvents, Preload } from '@react-three/drei';
import IglooBlocks from './structures/IglooBlocks.jsx';
import CameraRig from './camera/CameraRig.jsx';
import IceCut, { CutFrameGate } from './effects/IceCut.jsx';
import {
  EffectComposer,
  Bloom,
  Vignette,
  ToneMapping,
  BrightnessContrast,
  HueSaturation,
} from '@react-three/postprocessing';
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Fog,
  Object3D,
  PlaneGeometry,
  WebGLRenderTarget,
} from 'three';
import { ToneMappingMode } from 'postprocessing';
import { NOISE_GLSL, SKY_FRAG, SKY_VERT, WIND_GLSL } from './lib/snow-shaders.js';
import { hillRise, hillWarp, snowDrifts, snowSwell } from './lib/snow-hills.js';

// Where the igloo stands, and the palette the whole frame is keyed to: a pale
// arctic day where distance washes out to white rather than darkening.
const IGLOO_AT = [-30, 252];
const SKY_ZENITH = '#a8c6e8';
const SKY_HORIZON = '#f3f8fd';
const HAZE = '#edf4fc';
// Sun bearing, as an offset from the igloo: high, front-left.
const SUN_OFFSET = [-180, 190, 262];

// Development only: expose scene on window
function SceneHandle() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    window.__worldScene = scene;
    return () => {
      delete window.__worldScene;
    };
  }, [scene]);
  return null;
}

// Pre-compiles shaders before descent begins to prevent initial frame drops
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
  }, [armed, gl, scene, camera, onWarm]);

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

// Sky dome carried on the camera so it never leaves the far plane during the
// retreat. Unfogged, and its horizon is the fog colour, so the terrain's far
// edge dissolves into it with no visible seam.
function SnowSky() {
  const meshRef = useRef(null);
  const camera = useThree((s) => s.camera);

  const uniforms = useMemo(
    () => ({
      uZenith: { value: new Color(SKY_ZENITH) },
      uHorizon: { value: new Color(SKY_HORIZON) },
      uGlow: { value: new Color('#ffffff') },
      uSun: { value: [SUN_OFFSET[0], SUN_OFFSET[1], SUN_OFFSET[2]] },
      uTime: { value: 0 },
    }),
    []
  );

  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime;
    if (meshRef.current) meshRef.current.position.copy(camera.position);
  });

  return (
    <mesh ref={meshRef} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[1200, 48, 32]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={SKY_VERT}
        fragmentShader={SKY_FRAG}
        side={BackSide}
        depthWrite={false}
        fog={false}
      />
    </mesh>
  );
}

// Wind-carved snow detail applied to the terrain: the geometry carries the
// dunes and ranges, this carries the sastrugi ripples, the cool blue in the
// hollows and the near-white on the wind-scoured crests.
function snowSurface(shader) {
  shader.vertexShader =
    'varying vec3 vSnowWorld;\n' +
    shader.vertexShader.replace(
      '#include <begin_vertex>',
      [
        '#include <begin_vertex>',
        '  vSnowWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;',
      ].join('\n')
    );

  shader.fragmentShader =
    'varying vec3 vSnowWorld;\n' +
    NOISE_GLSL +
    WIND_GLSL +
    shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      [
        '#include <normal_fragment_maps>',
        'vec3 snWorldN = inverseTransformDirection( normalize( normal ), viewMatrix );',
        // Finite differences on the sastrugi field give the ripple normal.
        // The field is sampled at ~20 world units per feature: any finer and
        // the ripples alias into chevrons as soon as they get any distance.
        'float snScale = 0.05;',
        'float snStep = 2.5;',
        'float snH0 = snSastrugi( vSnowWorld.xz * snScale );',
        'float snHX = snSastrugi( ( vSnowWorld.xz + vec2( snStep, 0.0 ) ) * snScale );',
        'float snHZ = snSastrugi( ( vSnowWorld.xz + vec2( 0.0, snStep ) ) * snScale );',
        // Ripples flatten out with distance so the far ranges stay smooth.
        'float snNear = 1.0 - smoothstep( 70.0, 520.0, length( vSnowWorld - cameraPosition ) );',
        // Patchy, so the ripples come and go like real wind crust instead of
        // running across the whole plain as one rippled sheet.
        'float snPatch = smoothstep( 0.35, 0.7, snFbm( vSnowWorld.xz * 0.012 + 7.0 ) );',
        'float snRelief = ( 0.8 + 1.6 * snPatch ) * snNear;',
        'snWorldN = normalize( snWorldN + vec3( -( snHX - snH0 ), 0.0, -( snHZ - snH0 ) ) * snRelief / snStep );',
        'normal = normalize( ( viewMatrix * vec4( snWorldN, 0.0 ) ).xyz );',
        // Wide dune-scale value break, so the plain is never a flat sheet.
        'float snBroad = snFbm( vSnowWorld.xz * 0.0045 );',
        'float snCrest = smoothstep( 0.42, 0.78, snH0 );',
        // Slope is the only thing separating one white hill from the next, so
        // it is read across a wide band rather than only at the steepest part.
        'float snFlat = smoothstep( 0.70, 0.999, snWorldN.y );',
        // Shaded snow stays blue, never grey: the blue channel barely drops.
        'vec3 snShade = vec3( 0.448, 0.560, 0.782 );',
        'vec3 snLit = vec3( 0.972, 0.988, 1.0 );',
        'vec3 snSnow = mix( snShade, snLit, clamp( snFlat * 0.86 + snCrest * 0.22 * snNear + snBroad * 0.16, 0.0, 1.0 ) );',
        'float snSun = dot( snWorldN, vec3( -0.490, 0.501, 0.713 ) );',
        'snSnow *= mix( 0.74, 1.08, smoothstep( -0.30, 0.80, snSun ) );',
        // Past the ripples, wind-packed and loose snow still break the slopes
        // up: long soft patches a shade apart, stretched along the wind.
        'float snPack = snFbm( snWindWarp( vSnowWorld.xz * 0.02 ) );',
        'snSnow *= mix( 0.95, 1.03, smoothstep( 0.3, 0.7, snPack ) );',
        'diffuseColor.rgb *= snSnow;',
        // Scoured crests take a touch more gloss than the packed hollows.
        'roughnessFactor = mix( roughnessFactor, 0.62, snCrest * snNear * 0.45 );',
      ].join('\n')
    );
}

// The snow masses, as an explicit table rather than a handful of blended
// bumps. What gives the reference its depth is many rounded drifts at many
// depths whose SILHOUETTES OVERLAP — a near ridge cutting across a farther
// one, each with a lit crown and a blue flank. A few wide gaussians can only
// ever make one smooth roll, however they are tuned.
//
// x, z  centre, in world units (the igloo stands at [-30, 252], camera at z 335)
// h     crown height
// rx,rz radii; rz < rx keeps the masses reading as ridges facing the lens
const RIDGES = [
  // Foreground drifts, crossing low and close
  { x: -320, z: 120, h: 36, rx: 105, rz: 64 },
  { x: -150, z: 162, h: 28, rx: 78, rz: 55 },
  { x: 60, z: 150, h: 24, rx: 67, rz: 52 },
  { x: 250, z: 128, h: 32, rx: 92, rz: 60 },

  // Mid ridges: the band the igloo is set against
  { x: -480, z: -100, h: 85, rx: 118, rz: 81 },
  { x: -260, z: -60, h: 76, rx: 106, rz: 77 },
  { x: -40, z: -125, h: 59, rx: 120, rz: 85 },
  { x: 210, z: -40, h: 93, rx: 105, rz: 76 },
  { x: 430, z: -145, h: 83, rx: 120, rz: 84 },

  // Far panorama: the tallest crowns, read through the most haze
  { x: -780, z: -700, h: 189, rx: 197, rz: 134 },
  { x: -520, z: -520, h: 177, rx: 162, rz: 113 },
  { x: -180, z: -600, h: 151, rx: 169, rz: 120 },
  { x: 220, z: -480, h: 170, rx: 155, rz: 109 },
  { x: 560, z: -560, h: 186, rx: 169, rz: 116 },
  { x: 20, z: -830, h: 198, rx: 210, rz: 141 },
  { x: 840, z: -720, h: 195, rx: 197, rz: 134 },
];

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (edge0, edge1, v) => {
  const t = clamp01((v - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

// Seamless, contiguous arctic snow landscape: the igloo sits on a wind-swept
// plain, and the drifts in RIDGES rise behind and beside it into a panorama.
// 100% rock-free and crag-free.
function SnowTerrain() {
  const geometry = useMemo(() => {
    // 3200 wide (X), 3000 deep (Z), so the farthest crowns still have ground
    // behind them and the plane's own edge never reaches the frame.
    // ~6.7 units a cell: fine enough for the flutes down each hill's flanks.
    const geo = new PlaneGeometry(3200, 3000, 480, 450);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, 50);
    const pos = geo.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);

      // Coordinates relative to igloo center ([-30, 252])
      const dx = x - -30;
      const dz = z - 252;
      const r = Math.hypot(dx, dz);

      // Base snow cradle around igloo: subtle mound and drift at base perimeter
      const cradle = 0.45 * Math.exp(-(r * r) / (2 * 45 * 45));
      const drift = 0.65 * Math.exp(-Math.pow(r - 24.5, 2) / (2 * 5.5 * 5.5));

      // Low wind drifts across the snow plain
      let height = cradle + drift + snowDrifts(x, z) * 0.9 * (0.35 + 0.65 * smoothstep(26, 60, r));

      // Composed with max, never summed. Summed, every drift's tail adds to
      // its neighbour's and the whole table fuses into one wall that fills the
      // frame — no ridgelines, no gaps, no sky.
      const warp = hillWarp(x, z);
      let ridges = 0;
      for (let k = 0; k < RIDGES.length; k++) {
        const rise = hillRise(x, z, RIDGES[k], k + 1, warp);
        if (rise > ridges) ridges = rise;
      }

      // Long swells stitching the drifts into one continuous snowfield
      const swell = snowSwell(x, z) * smoothstep(-40, -260, dz);

      // The igloo keeps its own clearing: no drift is allowed to climb into it.
      height += Math.max(ridges, swell) * smoothstep(55, 125, r);

      pos.setY(i, height);
    }

    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }, []);

  return (
    <group position={[0, 0, 0]}>
      <mesh geometry={geometry} receiveShadow frustumCulled={false}>
        <meshStandardMaterial
          color="#f2f7fd"
          roughness={0.86}
          metalness={0.0}
          side={DoubleSide}
          onBeforeCompile={snowSurface}
        />
      </mesh>

      {/* Ground contact shadow receiver directly on snow beneath igloo */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-30, 0.04, 252]} receiveShadow>
        <planeGeometry args={[70, 70]} />
        <shadowMaterial opacity={0.18} />
      </mesh>
    </group>
  );
}

// Soft blob used for the low mist banks: one radial falloff, torn at its edges
// so the bands never read as a painted oval.
function mistTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // Punch soft holes so the bank has torn, uneven edges.
  ctx.globalCompositeOperation = 'destination-out';
  let seed = 20261;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 40; i++) {
    const r = 12 + rand() * 46;
    const hole = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    hole.addColorStop(0, `rgba(0,0,0,${(0.15 + rand() * 0.35).toFixed(3)})`);
    hole.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.translate(rand() * size, rand() * size);
    ctx.fillStyle = hole;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
  }

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// Low mist banks pooling at the foot of the ranges and drifting across them:
// what reads in the reference as the ground haze the wind is dragging.
function MistBanks() {
  const texture = useMemo(() => mistTexture(), []);
  const groupRef = useRef(null);

  // Wide, shallow bands at the base of each range, plus two nearer wisps.
  const bands = useMemo(
    () => [
      { at: [-250, 16, -150], size: [620, 48], opacity: 0.36, speed: 2.4 },
      { at: [300, 18, -190], size: [660, 52], opacity: 0.34, speed: -1.9 },
      { at: [-60, 30, -380], size: [980, 70], opacity: 0.38, speed: 1.4 },
      { at: [-460, 44, -640], size: [900, 86], opacity: 0.34, speed: -2.2 },
      { at: [440, 42, -660], size: [900, 86], opacity: 0.34, speed: 1.7 },
    ],
    []
  );

  useFrame((state) => {
    const group = groupRef.current;
    if (!group) return;
    const t = state.clock.elapsedTime;
    group.children.forEach((child, i) => {
      const band = bands[i];
      if (!band) return;
      // Wrap the drift so a band never walks out of the frame for good.
      const span = band.size[0] * 0.6;
      const travel = (((t * band.speed) % (span * 2)) + span * 2) % (span * 2);
      child.position.x = band.at[0] - span + travel;
      child.position.y = band.at[1] + Math.sin(t * 0.13 + i) * 2.2;
    });
  });

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <group ref={groupRef}>
      {bands.map((band, i) => (
        <mesh key={i} position={band.at} renderOrder={2} frustumCulled={false}>
          <planeGeometry args={band.size} />
          <meshBasicMaterial
            map={texture}
            transparent
            opacity={band.opacity}
            depthWrite={false}
            fog={false}
            color="#f4f9ff"
          />
        </mesh>
      ))}
    </group>
  );
}

// A round, soft-edged grain. Without a map, points draw as hard squares, and
// the near ones are big enough on screen to read as floating white tiles.
function grainTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

// Snow carried on the wind rather than falling: fine grains streaming across
// the frame, thin enough to read as spindrift.
function Spindrift({ count = 900 }) {
  const pointsRef = useRef(null);
  const grain = useMemo(() => grainTexture(), []);
  useEffect(() => () => grain.dispose(), [grain]);

  const [geometry, drift] = useMemo(() => {
    const geo = new BufferGeometry();
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count * 2);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = -30 + (Math.random() - 0.5) * 300;
      positions[i * 3 + 1] = Math.random() * 80;
      positions[i * 3 + 2] = 252 + (Math.random() - 0.5) * 240;
      speeds[i * 2] = 2.0 + Math.random() * 3.6; // fall
      speeds[i * 2 + 1] = 5.0 + Math.random() * 9.0; // downwind
    }

    geo.setAttribute('position', new BufferAttribute(positions, 3));
    return [geo, speeds];
  }, [count]);

  useFrame((state, delta) => {
    if (!pointsRef.current) return;
    const pos = pointsRef.current.geometry.attributes.position;
    const array = pos.array;
    const dt = Math.min(delta, 1 / 20);
    const time = state.clock.elapsedTime;

    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      array[idx + 1] -= drift[i * 2] * dt;
      array[idx] += (drift[i * 2 + 1] + Math.sin(time * 0.7 + array[idx + 1] * 0.06) * 2.0) * dt;

      if (array[idx + 1] < 0 || array[idx] > -30 + 150) {
        array[idx + 1] = 80;
        array[idx] = -30 - 150 - Math.random() * 40;
        array[idx + 2] = 252 + (Math.random() - 0.5) * 240;
      }
    }
    pos.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        map={grain}
        color="#ffffff"
        size={0.5}
        transparent
        opacity={0.3}
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  );
}

// High-key arctic daylight: a soft front-left sun, a cool bounce off the snow,
// and almost no black anywhere in the frame.
function Lighting() {
  const target = useMemo(() => {
    const object = new Object3D();
    object.position.set(IGLOO_AT[0], 6, IGLOO_AT[1]);
    return object;
  }, []);

  const sunAt = [IGLOO_AT[0] + SUN_OFFSET[0], SUN_OFFSET[1], IGLOO_AT[1] + SUN_OFFSET[2]];

  return (
    <>
      {/* Snow is a near-white albedo, so the lights have to stay well under
          unity irradiance in total — pushed higher, every slope clips to the
          same white as the sky and the ranges vanish. */}
      <ambientLight color="#9cc0e2" intensity={0.08} />

      {/* Main daylight, aimed AT the igloo so its shadow frustum actually
          contains it — pointed at the origin it missed the subject entirely. */}
      <primitive object={target} />
      <directionalLight
        color="#fffdf7"
        intensity={1.3}
        position={sunAt}
        target={target}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0006}
        shadow-normalBias={0.35}
        shadow-camera-near={60}
        shadow-camera-far={760}
        shadow-camera-left={-90}
        shadow-camera-right={90}
        shadow-camera-top={90}
        shadow-camera-bottom={-90}
      />

      {/* Cool counter light from behind the ranges, catching the crests */}
      <directionalLight color="#a8c8ea" intensity={0.16} position={[110, 80, -90]} />

      {/* Sky above, snow below: the bounce that keeps the shadows blue, not grey */}
      <hemisphereLight args={['#bcd8f6', '#eaf2fc', 0.3]} />
    </>
  );
}

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
        camera={{ fov: 38, near: 4, far: 2800, position: [-28, 20, 335] }}
        onCreated={({ gl, scene }) => {
          gl.toneMappingExposure = 1.18;
          scene.background = new Color(SKY_HORIZON);
          // Deep aerial haze: the ranges wash out toward white with distance,
          // and the terrain's far edge is gone well before it reaches the sky.
          scene.fog = new Fog(HAZE, 520, 2650);
        }}
      >
        <Lighting />

        <Suspense fallback={null}>
          {/* Gradient sky with wind-drawn cirrus */}
          <SnowSky />

          {/* Panoramic smooth rounded snow hills & mountains across horizon */}
          <SnowTerrain />

          {/* Mist pooling at the foot of the ranges */}
          <MistBanks />

          {/* Snow streaming on the wind */}
          <Spindrift count={900} />

          {/* 3D igloo settled firmly into the snow ground */}
          <IglooBlocks at={IGLOO_AT} lift={0.0} tint="#eef5fd" onReady={onIglooReady} />

          <Preload all />
        </Suspense>

        <CameraRig begin={begin} />
        <SceneHandle />
        <Warmup armed={warm} onWarm={onWarm} />

        <EffectComposer disableNormalPass>
          <Bloom intensity={0.3} luminanceThreshold={0.9} luminanceSmoothing={0.28} mipmapBlur />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <BrightnessContrast brightness={0.06} contrast={0.03} />
          <HueSaturation saturation={0.06} />
          <Vignette offset={0.44} darkness={0.12} eskil={false} />
          <IceCut />
        </EffectComposer>

        <AdaptiveEvents />
        <CutFrameGate />
      </Canvas>
    </div>
  );
}
