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
  Plane,
  PlaneGeometry,
  Raycaster,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import { ToneMappingMode } from 'postprocessing';
import { NOISE_GLSL, SKY_FRAG, SKY_VERT, WIND_GLSL } from './lib/snow-shaders.js';
import { hillRise, hillWarp, landRidges, plainTexture, snowDrifts, snowSwell } from './lib/snow-hills.js';

// Where the igloo stands, and the palette the whole frame is keyed to: a pale
// arctic day where distance washes out to white rather than darkening.
const IGLOO_AT = [-30, 252];
const SKY_ZENITH = '#9aabc2';
const SKY_HORIZON = '#eef3f8';
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
// Mist lying in the valleys: it fills the low ground between the hills and
// pools at the foot of the ranges, the crests rising clear of it, and it churns
// and drifts with the wind. Drawn by the snow itself, so it can never cut a
// line into a hill, and only from beyond the igloo, which stays clear.
const VALLEY_MIST = {
  time: { value: 0 },
  near: [250, 520], // fades in over this distance from the lens
  floor: 22, // fully misted up to this height
  top: 98, // and thinned to nothing by this one
  amount: 1.0,
};

const SNOW_MARKS_GLSL = `
float snMarkAt( sampler2D tex, vec4 rect, vec2 p ) {
  vec2 uv = ( p - rect.xy ) / rect.zw;
  if ( uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 ) return 0.0;
  return texture2D( tex, uv ).r;
}
float snMarks( vec2 p ) {
  return snMarkAt( uTrail, uTrailRect, p );
}
vec3 snowMarks( vec3 n, vec2 p, out float depth ) {
  depth = snMarks( p );
  if ( depth <= 0.001 ) return n;
  float e = 0.25;
  float dx = snMarks( p + vec2( e, 0.0 ) ) - snMarks( p - vec2( e, 0.0 ) );
  float dz = snMarks( p + vec2( 0.0, e ) ) - snMarks( p - vec2( 0.0, e ) );
  // A dip: the walls face inward, so the far wall catches light, the near one shades.
  return normalize( n + vec3( dx, 0.0, dz ) * 0.35 );
}
`;

// A soft trail pressed into the snow wherever the pointer moves over the
// ground, filling back in: a canvas laid over that patch of ground, which the
// snow shader reads as a shallow dip and lights as one.
const TRAIL_RECT = [-220, 200, 380, 200];
const SNOW_MARKS = {
  trail: { value: null },
  trailRect: { value: TRAIL_RECT },
};

// The pointer's trail: drawn where the pointer meets the ground, faded a little
// every frame so the snow fills back in over a few seconds.
function SnowTrail() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const state = useMemo(() => {
    const W = 1024;
    const H = 540;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const tex = new CanvasTexture(canvas);
    tex.flipY = false;
    return { W, H, ctx, tex, last: null, pending: [], ray: new Raycaster(), ndc: new Vector2(), hit: new Vector3(), plane: new Plane(new Vector3(0, 1, 0), -0.6) };
  }, []);

  useEffect(() => {
    SNOW_MARKS.trail.value = state.tex;
    const el = gl.domElement;
    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      state.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      state.pending.push(state.ndc.clone());
    };
    const onLeave = () => {
      state.last = null;
    };
    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerleave', onLeave, { passive: true });
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      state.tex.dispose();
    };
  }, [gl, state]);

  useFrame(() => {
    const { ctx, W, H } = state;
    ctx.fillStyle = 'rgba(0,0,0,0.008)';
    ctx.fillRect(0, 0, W, H);
    for (const ndc of state.pending) {
      state.ray.setFromCamera(ndc, camera);
      if (!state.ray.ray.intersectPlane(state.plane, state.hit)) continue;
      const px = ((state.hit.x - TRAIL_RECT[0]) / TRAIL_RECT[2]) * W;
      const py = ((state.hit.z - TRAIL_RECT[1]) / TRAIL_RECT[3]) * H;
      if (px < 0 || py < 0 || px > W || py > H) {
        state.last = null;
        continue;
      }
      const from = state.last || [px, py];
      const d = Math.hypot(px - from[0], py - from[1]);
      const n = Math.max(1, Math.ceil(d / 2));
      for (let k = 1; k <= n; k++) {
        const x = from[0] + ((px - from[0]) * k) / n;
        const y = from[1] + ((py - from[1]) * k) / n;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 7);
        g.addColorStop(0, 'rgba(255,255,255,0.22)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 7, y - 7, 14, 14);
      }
      state.last = [px, py];
    }
    state.pending.length = 0;
    state.tex.needsUpdate = true;
  });

  return null;
}

function snowSurface(shader) {
  shader.uniforms.uMistTime = VALLEY_MIST.time;
  shader.uniforms.uTrail = SNOW_MARKS.trail;
  shader.uniforms.uTrailRect = SNOW_MARKS.trailRect;
  shader.vertexShader =
    'attribute float aCavity;\nvarying vec3 vSnowWorld;\nvarying float vCavity;\n' +
    shader.vertexShader.replace(
      '#include <begin_vertex>',
      [
        '#include <begin_vertex>',
        '  vSnowWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;',
        '  vCavity = aCavity;',
      ].join('\n')
    );

  shader.fragmentShader =
    'varying vec3 vSnowWorld;\nvarying float vCavity;\nuniform float uMistTime;\n' +
    'uniform sampler2D uTrail;\nuniform vec4 uTrailRect;\n' +
    SNOW_MARKS_GLSL +
    NOISE_GLSL +
    WIND_GLSL +
    shader.fragmentShader.replace(
      '#include <fog_fragment>',
      [
        'float vmDist = length( vSnowWorld - cameraPosition );',
        `float vmFar = smoothstep( ${VALLEY_MIST.near[0].toFixed(1)}, ${VALLEY_MIST.near[1].toFixed(1)}, vmDist );`,
        `float vmLow = 1.0 - smoothstep( ${VALLEY_MIST.floor.toFixed(1)}, ${VALLEY_MIST.top.toFixed(1)}, vSnowWorld.y );`,
        // Churning: noise warped by itself, both layers drifting downwind.
        'vec2 vmQ = vSnowWorld.xz * 0.0045 + vec2( uMistTime * 0.010, uMistTime * 0.003 );',
        'float vmN = snFbm( vmQ + vec2( snFbm( vmQ * 2.1 - uMistTime * 0.006 ), snFbm( vmQ * 2.1 + 3.7 ) ) * 0.9 );',
        'float vmDensity = vmLow * smoothstep( 0.32, 0.72, vmN * 0.9 + vmLow * 0.25 ) * vmFar;',
        `gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( 0.95, 0.965, 0.985 ), vmDensity * ${VALLEY_MIST.amount.toFixed(2)} );`,
        '#include <fog_fragment>',
      ].join('\n')
    ).replace(
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
        // Low, flat land: the hills' velvety snow, not a streaked sheet.
        'float snLand = 1.0 - smoothstep( 6.0, 22.0, vSnowWorld.y );',
        'float snRelief = ( 0.8 + 1.6 * snPatch ) * snNear * mix( 1.0, 0.3, snLand );',
        'snWorldN = normalize( snWorldN + vec3( -( snHX - snH0 ), 0.0, -( snHZ - snH0 ) ) * snRelief / snStep );',
        // The pointer's trail, as a shallow dip.
        'float snMark = 0.0;',
        'snWorldN = snowMarks( snWorldN, vSnowWorld.xz, snMark );',
        'normal = normalize( ( viewMatrix * vec4( snWorldN, 0.0 ) ).xyz );',
        // Wide dune-scale value break, so the plain is never a flat sheet.
        'float snBroad = snFbm( vSnowWorld.xz * 0.0045 );',
        'float snCrest = smoothstep( 0.42, 0.78, snH0 );',
        // Slope is the only thing separating one white hill from the next, so
        // it is read across a wide band rather than only at the steepest part.
        // The open snow in front is seen from above, so its gentle rolls barely
        // tilt from the light; there the blue shade answers smaller slopes, to
        // read with the same texture the hills have.
        'float snFront = ( 1.0 - smoothstep( 6.0, 22.0, vSnowWorld.y ) ) * smoothstep( -30.0, 30.0, vSnowWorld.z ) * smoothstep( 40.0, 70.0, length( vSnowWorld.xz - vec2( -30.0, 252.0 ) ) );',
        'float snFlat = mix( smoothstep( 0.70, 0.999, snWorldN.y ), smoothstep( 0.84, 0.999, snWorldN.y ), snFront );',
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
        // The steep faces of the far ranges: snow scoured thin into streaks
        // down the fall line, the darker ground showing through.
        'float snDist = length( vSnowWorld - cameraPosition );',
        'float snSteep = 1.0 - smoothstep( 0.7, 0.93, snWorldN.y );',
        'float snStreak = snFbm( vec2( ( vSnowWorld.x + vSnowWorld.z ) * 0.05, vSnowWorld.y * 0.022 ) );',
        'float snRock = snSteep * smoothstep( 0.48, 0.74, snStreak ) * smoothstep( 280.0, 620.0, snDist ) * smoothstep( 55.0, 120.0, vSnowWorld.y );',
        'snSnow = mix( snSnow, vec3( 0.34, 0.38, 0.46 ), snRock * 0.9 );',
        // Near snow reads bright and white, not grey.
        'snSnow = mix( snSnow, snLit, ( 1.0 - smoothstep( 20.0, 170.0, snDist ) ) * 0.4 );',
        // Folds and valleys sit in soft blue shade, crests a touch brighter:
        // the depth real snow has between its rises. (aCavity, from the mesh.)
        'snSnow *= mix( vec3( 1.0 ), vec3( 0.80, 0.87, 0.98 ), clamp( vCavity, 0.0, 1.0 ) * 0.7 );',
        'snSnow *= 1.0 + clamp( -vCavity, 0.0, 1.0 ) * 0.05;',
        // Contact shade where the snow meets the igloo's wall.
        'float snFoot = 1.0 - smoothstep( 22.0, 29.0, length( vSnowWorld.xz - vec2( -30.0, 252.0 ) ) );',
        'snSnow *= mix( vec3( 1.0 ), vec3( 0.78, 0.85, 0.97 ), snFoot * 0.55 );',
        'snSnow *= mix( vec3( 1.0 ), vec3( 0.86, 0.91, 0.99 ), snMark * 0.35 );',
        'snSnow = mix( snSnow, snLit, snLand * 0.3 );',
        // Fine grain in the snow's surface, as packed crystals have, fading
        // out with distance before it can shimmer.
        'float snGrainA = snNoise( vSnowWorld.xz * 2.5 ) * 0.6 + snNoise( vSnowWorld.xz * 6.0 + 4.3 ) * 0.4;',
        'snSnow *= mix( 1.0, 0.95 + 0.08 * snGrainA, 1.0 - smoothstep( 60.0, 220.0, length( vSnowWorld - cameraPosition ) ) );',
        'diffuseColor.rgb *= snSnow;',
        // Scoured crests take a touch more gloss than the packed hollows.
        'roughnessFactor = mix( roughnessFactor, 0.62, snCrest * snNear * 0.45 );',
      ].join('\n')
    ).replace(
      '#include <emissivemap_fragment>',
      [
        '#include <emissivemap_fragment>',
        // Ice crystals glinting in the near snow, each from its own angle, so
        // they twinkle as the view moves.
        // One crystal at a random spot in each small cell, lit for only some
        // view directions: scattered points, never a grid.
        'vec2 snCellP = vSnowWorld.xz * 7.0;',
        'vec2 snCell = floor( snCellP );',
        'vec2 snSpot = vec2( snHash( snCell + 1.3 ), snHash( snCell + 7.9 ) ) * 0.8 + 0.1;',
        'float snDot = smoothstep( 0.09, 0.0, length( fract( snCellP ) - snSpot ) );',
        'vec3 snRay = normalize( vSnowWorld - cameraPosition );',
        'float snTwinkle = step( 0.93, snHash( snCell + floor( snRay.xz * 30.0 ) * 0.37 ) );',
        'float snGlint = snDot * snTwinkle * ( 1.0 - smoothstep( 10.0, 45.0, snDist ) );',
        'totalEmissiveRadiance += vec3( 1.0, 0.98, 0.94 ) * snGlint * 2.0;',
        // The same crystals across the whole foreground, at a size that still
        // reads further out.
        'vec2 snCellQ = vSnowWorld.xz * 1.2;',
        'vec2 snCell2 = floor( snCellQ );',
        'vec2 snSpot2 = vec2( snHash( snCell2 + 3.1 ), snHash( snCell2 + 5.7 ) ) * 0.8 + 0.1;',
        'float snDot2 = smoothstep( 0.12, 0.0, length( fract( snCellQ ) - snSpot2 ) );',
        'float snTwinkle2 = step( 0.95, snHash( snCell2 + floor( snRay.xz * 24.0 ) * 0.53 ) );',
        'float snGlint2 = snDot2 * snTwinkle2 * smoothstep( 35.0, 60.0, snDist ) * ( 1.0 - smoothstep( 140.0, 220.0, snDist ) );',
        'totalEmissiveRadiance += vec3( 1.0, 0.98, 0.94 ) * snGlint2 * 1.6;',
        // Light bounced between snow and overcast sky: open snow never falls
        // to grey, as it does under a single sun.
        'float snOpen = smoothstep( 0.75, 0.98, snWorldN.y );',
        'totalEmissiveRadiance += vec3( 0.80, 0.85, 0.92 ) * 0.2 * snOpen * ( 1.0 - smoothstep( 80.0, 900.0, snDist ) );',
        // Low land catches the light as brightly as the hills' faces do.
        'totalEmissiveRadiance += vec3( 0.86, 0.90, 0.96 ) * 0.14 * snLand;',
      ].join('\n')
    );
}

// The snow masses, as an explicit table rather than a handful of blended
// bumps. What gives the reference its depth is many rounded drifts at many
// depths whose SILHOUETTES OVERLAP — a near ridge cutting across a farther
// one, each with a lit crown and a blue flank. A few wide gaussians can only
// ever make one smooth roll, however they are tuned.
//
// x, z  centre, in world units (the igloo stands at [-30, 252], camera at z 386)
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

// The snowfield's height at (x, z), as the terrain mesh is built from it.
function terrainHeight(x, z) {
  // Coordinates relative to igloo center ([-30, 252])
  const dx = x - -30;
  const dz = z - 252;
  const r = Math.hypot(dx, dz);

  // Base snow cradle around igloo: subtle mound and drift at base perimeter
  const cradle = 0.45 * Math.exp(-(r * r) / (2 * 45 * 45));
  const drift = 0.65 * Math.exp(-Math.pow(r - 24.5, 2) / (2 * 5.5 * 5.5));

  // Low wind drifts across the snow plain
  let height = cradle + drift + snowDrifts(x, z) * 0.9 * (0.35 + 0.65 * smoothstep(26, 60, r));

  // The open snow in front carries the hills' own texture: soft rolls with
  // fluted grooves, kept off the igloo's clearing.
  height += plainTexture(x, z) * smoothstep(40, 80, r) * smoothstep(120, 220, z);

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

  return height;
}

function landWeight(x, z) {
  const [x0, x1] = [-1600 + 175 * CELL_X, -1600 + 266 * CELL_X];
  const [z0, z1] = [-1450 + 213 * CELL_Z, -1450 + 281 * CELL_Z];
  if (x < x0 || x > x1 || z < z0 || z > z1) return 0;
  const r = Math.hypot(x + 30, z - 252);
  return (
    smoothstep(x0, x0 + 40, x) *
    (1 - smoothstep(x1 - 40, x1, x)) *
    smoothstep(z0, z0 + 35, z) *
    (1 - smoothstep(z1 - 30, z1, z)) *
    smoothstep(36, 64, r)
  );
}

// The terrain's rows and columns, band by band. The outer bands keep the even
// 480 x 450 grid on exactly the same lines, so the hills are built from the
// same points; the middle band, the land in front of the lens, is dense enough
// to carry the mountains' kind of carved ridges up close.
const CELL_X = 3200 / 480;
const CELL_Z = 3000 / 450;
const GRID_X = {
  bands: [[-1600, -1600 + 175 * CELL_X], [-1600 + 175 * CELL_X, -1600 + 266 * CELL_X], [-1600 + 266 * CELL_X, 1600]],
  counts: [175, 340, 214],
};
const GRID_Z = {
  bands: [[-1450, -1450 + 213 * CELL_Z], [-1450 + 213 * CELL_Z, -1450 + 281 * CELL_Z], [-1450 + 281 * CELL_Z, 1550]],
  counts: [213, 330, 169],
};
for (const axis of [GRID_X, GRID_Z]) axis.segments = axis.counts.reduce((a, b) => a + b, 0);

function bandAt(axis, u) {
  let k = u * axis.segments;
  for (let b = 0; b < axis.bands.length; b++) {
    const n = axis.counts[b];
    if (k <= n || b === axis.bands.length - 1) {
      const [from, to] = axis.bands[b];
      return from + (to - from) * Math.min(1, k / n);
    }
    k -= n;
  }
  return axis.bands[axis.bands.length - 1][1];
}

// Seamless, contiguous arctic snow landscape: the igloo sits on a wind-swept
// plain, and the drifts in RIDGES rise behind and beside it into a panorama.
// 100% rock-free and crag-free.
function SnowTerrain() {
  useFrame((state) => {
    VALLEY_MIST.time.value = state.clock.elapsedTime;
  });

  const geometry = useMemo(() => {
    // 3200 wide (X), 3000 deep (Z), so the farthest crowns still have ground
    // behind them and the plane's own edge never reaches the frame.
    // ~6.7 units a cell: fine enough for the flutes down each hill's flanks.
    const geo = new PlaneGeometry(3200, 3000, GRID_X.segments, GRID_Z.segments);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, 50);
    const pos = geo.attributes.position;
    const cols = GRID_X.segments + 1;
    const rows = GRID_Z.segments + 1;

    for (let i = 0; i < pos.count; i++) {
      const x = bandAt(GRID_X, (i % cols) / GRID_X.segments);
      const z = bandAt(GRID_Z, Math.floor(i / cols) / GRID_Z.segments);
      const ground = terrainHeight(x, z);
      // Humps on the low land only; the hills keep their own smooth shape.
      const low = 1 - 0.5 * smoothstep(5, 18, ground);
      pos.setXYZ(i, x, ground + landRidges(x, z) * landWeight(x, z) * low, z);
    }

    // How far each point sits below (+) or above (-) the ground a few cells
    // around it: creases and valley floors read as cavities, crests as the
    // opposite. Shading only; the shape is untouched.
    const reach = 3;
    const cavity = new Float32Array(pos.count);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        let sum = 0;
        let n = 0;
        for (let dj = -reach; dj <= reach; dj += reach) {
          for (let di = -reach; di <= reach; di += reach) {
            if (!di && !dj) continue;
            const ii = Math.min(cols - 1, Math.max(0, i + di));
            const jj = Math.min(rows - 1, Math.max(0, j + dj));
            sum += pos.getY(jj * cols + ii);
            n++;
          }
        }
        const k = j * cols + i;
        cavity[k] = Math.max(-1, Math.min(1, (sum / n - pos.getY(k)) / 5));
      }
    }
    geo.setAttribute('aCavity', new BufferAttribute(cavity, 1));

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

// Snow banked against the igloo's foot, irregular all round, lower across the
// entrance. A fine ring of its own: the terrain's cells are wider than the bank.
// The inner edge starts inside the wall, so no gap shows where they meet.
const BANK = { inner: 18.5, peak: 24.6, outer: 31, height: 1.9 };
// The entrance faces along the igloo's yaw (IglooBlocks: IGLOO_YAW).
const DOOR_BEARING = 1.24;

function SnowBank() {
  const geometry = useMemo(() => {
    const radial = 18;
    const around = 160;
    const positions = new Float32Array((radial + 1) * (around + 1) * 3);
    const index = [];
    for (let j = 0; j <= around; j++) {
      const theta = (j / around) * Math.PI * 2;
      // Lumpy along its length, and low where the doorway is.
      const lump =
        0.75 + 0.3 * Math.sin(theta * 5 + 1.3) + 0.18 * Math.sin(theta * 11 - 0.4) + 0.1 * Math.sin(theta * 23 + 2.0);
      const toDoor = Math.abs(Math.atan2(Math.sin(theta - DOOR_BEARING), Math.cos(theta - DOOR_BEARING)));
      const door = smoothstep(0.18, 0.55, toDoor);
      for (let i = 0; i <= radial; i++) {
        const u = i / radial;
        const r = BANK.inner + (BANK.outer - BANK.inner) * u;
        // Steep against the wall, a long tail outward, sunk at both ends.
        const rise = r < BANK.peak
          ? smoothstep(BANK.inner, BANK.peak, r)
          : 1 - smoothstep(BANK.peak, BANK.outer, r) ** 0.7;
        // Only the very last ring sinks below the ground, to blend into it;
        // anywhere else a dip would show the bank's underside as a dark hole.
        const h = i === radial ? -0.3 : 0.05 + BANK.height * rise * lump * (0.25 + 0.75 * door);
        const k = (j * (radial + 1) + i) * 3;
        positions[k] = IGLOO_AT[0] + Math.sin(theta) * r;
        positions[k + 1] = h;
        positions[k + 2] = IGLOO_AT[1] + Math.cos(theta) * r;
      }
    }
    for (let j = 0; j < around; j++) {
      for (let i = 0; i < radial; i++) {
        const a = j * (radial + 1) + i;
        const b = (j + 1) * (radial + 1) + i;
        // Wound so the faces (and normals) point up, toward the sky.
        index.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    return geo;
  }, []);

  return (
    <mesh geometry={geometry} receiveShadow frustumCulled={false}>
      <meshStandardMaterial color="#f2f7fd" roughness={0.86} onBeforeCompile={snowSurface} />
    </mesh>
  );
}

// Soft blob used for the low mist banks: one radial falloff, torn at its edges
// so the bands never read as a painted oval.
function mistTexture() {
  const W = 512;
  const H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  let seed = 20261;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  // Torn wisps: many long, thin, soft streaks laid along the wind, densest
  // through the middle of the bank and thinning toward its edges.
  for (let i = 0; i < 140; i++) {
    const x = rand() * W;
    const y = H * (0.5 + (rand() - 0.5) * 0.7 * rand());
    const rx = 30 + rand() * 120;
    const ry = 4 + rand() * 14;
    const edge = Math.min(x, W - x) / (W / 2);
    const a = (0.06 + rand() * 0.22) * Math.min(1, edge * 1.6);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
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
      { at: [-250, 16, -150], size: [620, 48], opacity: 0.6, speed: 2.4 },
      { at: [120, 26, -60], size: [520, 40], opacity: 0.32, speed: -1.5 },
      { at: [-420, 30, 20], size: [480, 36], opacity: 0.28, speed: 1.2 },
      { at: [300, 18, -190], size: [660, 52], opacity: 0.6, speed: -1.9 },
      { at: [-60, 30, -380], size: [980, 70], opacity: 0.65, speed: 1.4 },
      { at: [-460, 44, -640], size: [900, 86], opacity: 0.6, speed: -2.2 },
      { at: [440, 42, -660], size: [900, 86], opacity: 0.6, speed: 1.7 },
      // Wisps drifting across the middle hills, behind the igloo.
      { at: [-320, 46, -20], size: [720, 60], opacity: 1.0, speed: 1.8 },
      { at: [360, 50, -40], size: [720, 60], opacity: 1.0, speed: -1.6 },
      // Veils at the igloo's height, behind it to either side.
      { at: [-280, 22, 140], size: [620, 40], opacity: 0.85, speed: 2.0 },
      { at: [280, 24, 150], size: [620, 40], opacity: 0.85, speed: -1.8 },
      { at: [-40, 40, 60], size: [520, 44], opacity: 0.45, speed: 2.2 },
      // Banks drifting across the feet of the ranges, above the middle hills.
      { at: [-350, 72, -420], size: [900, 90], opacity: 0.85, speed: 1.6 },
      { at: [300, 78, -400], size: [900, 90], opacity: 0.85, speed: -1.4 },
      { at: [-20, 88, -560], size: [1200, 100], opacity: 0.8, speed: 1.1 },
      { at: [-650, 82, -520], size: [800, 90], opacity: 0.75, speed: -1.2 },
      { at: [650, 86, -560], size: [800, 90], opacity: 0.75, speed: 1.3 },
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

// Big, soft flakes drifting down close to the lens: what gives the reference
// its depth in the air. Few of them, and slow.
function NearFlakes({ count = 160 }) {
  const pointsRef = useRef(null);
  const grain = useMemo(() => grainTexture(), []);
  useEffect(() => () => grain.dispose(), [grain]);
  const camera = useThree((s) => s.camera);

  const [geometry, sway] = useMemo(() => {
    const geo = new BufferGeometry();
    const positions = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 90;
      positions[i * 3 + 1] = Math.random() * 40 - 10;
      positions[i * 3 + 2] = -25 - Math.random() * 65;
      phase[i] = Math.random() * Math.PI * 2;
    }
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    return [geo, phase];
  }, [count]);

  useFrame((state, delta) => {
    const points = pointsRef.current;
    if (!points) return;
    // Carried with the lens, so the flakes are always in the near air.
    points.position.copy(camera.position);
    const array = points.geometry.attributes.position.array;
    const dt = Math.min(delta, 1 / 20);
    const t = state.clock.elapsedTime;
    for (let i = 0; i < count; i++) {
      const k = i * 3;
      array[k + 1] -= (1.6 + (i % 7) * 0.25) * dt;
      array[k] += (2.2 + Math.sin(t * 0.6 + sway[i]) * 1.4) * dt;
      if (array[k + 1] < -12) array[k + 1] = 30;
      if (array[k] > 45) array[k] = -45;
    }
    points.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry} frustumCulled={false} renderOrder={3}>
      <pointsMaterial
        map={grain}
        color="#ffffff"
        size={0.35}
        transparent
        opacity={0.55}
        depthWrite={false}
        fog={false}
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
        camera={{ fov: 38, near: 4, far: 2800, position: [-34, 21, 386] }}
        onCreated={({ gl, scene }) => {
          gl.toneMappingExposure = 1.18;
          scene.background = new Color(SKY_HORIZON);
          // Deep aerial haze: the ranges wash out toward white with distance,
          // and the terrain's far edge is gone well before it reaches the sky.
          scene.fog = new Fog(HAZE, 760, 3300);
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
          <NearFlakes count={160} />

          {/* 3D igloo settled firmly into the snow ground */}
          <IglooBlocks at={IGLOO_AT} lift={0.0} tint="#eef5fd" onReady={onIglooReady} />
          <SnowBank />
          <SnowTrail />

          <Preload all />
        </Suspense>

        <CameraRig begin={begin} />
        <SceneHandle />
        <Warmup armed={warm} onWarm={onWarm} />

        <EffectComposer disableNormalPass>
          <Bloom intensity={0.3} luminanceThreshold={0.9} luminanceSmoothing={0.28} mipmapBlur />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <BrightnessContrast brightness={0.05} contrast={0.1} />
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
