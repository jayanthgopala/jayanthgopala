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
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import { ToneMappingMode } from 'postprocessing';
import { NOISE_GLSL, SKY_FRAG, SKY_VERT, WIND_GLSL } from './lib/snow-shaders.js';
import { OPENING_FRAME } from './chapters.js';
import { hillRise, hillWarp, plainTexture, refHumps, snowMounds, snowDrifts, snowSwell } from './lib/snow-hills.js';

// Where the igloo stands, and the palette the whole frame is keyed to: a pale
// arctic day where distance washes out to white rather than darkening.
const IGLOO_AT = [-30, 252];
const SKY_ZENITH = '#7d8ca3';
const SKY_HORIZON = '#eef3f8';
const HAZE = '#edf4fc';
// Sun bearing, as an offset from the igloo: high, front-left.
const SUN_OFFSET = [-180, 190, 262];

// Development only: expose scene on window
function SceneHandle() {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    window.__worldScene = scene;
    window.__worldCamera = camera;
    return () => {
      delete window.__worldScene;
      delete window.__worldCamera;
    };
  }, [scene, camera]);
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
// The backplate's camera: the opening frame's basis and lens, so a sky
// direction finds the pixel the reference shows it at.
const PLATE = { width: 1871, height: 841, rows: 240 };
function plateUniforms() {
  const eye = new Vector3(...OPENING_FRAME.eye);
  const f = new Vector3(...OPENING_FRAME.aim).sub(eye).normalize();
  const r = new Vector3().crossVectors(f, new Vector3(0, 1, 0)).normalize();
  const u = new Vector3().crossVectors(r, f);
  const th = Math.tan((OPENING_FRAME.fov * Math.PI) / 360);
  return {
    uPlate: { value: null },
    uPlateOn: { value: 0 },
    uRefF: { value: f },
    uRefR: { value: r },
    uRefU: { value: u },
    uRefTan: { value: new Vector2(th * (PLATE.width / PLATE.height), th) },
    uPlateRows: { value: PLATE.rows / PLATE.height },
  };
}

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
      ...plateUniforms(),
    }),
    []
  );
  // The reference's clouds, cut from the opening frame (HUD painted out),
  // laid back onto the dome along the same view. Until it loads, or past its
  // edges, the procedural sky shows.
  if (!uniforms.uPlate.value) {
    const texture = new TextureLoader().load('/environments/sky-backplate.jpg');
    texture.colorSpace = SRGBColorSpace;
    uniforms.uPlate.value = texture;
  }

  useEffect(() => () => uniforms.uPlate.value?.dispose(), [uniforms]);

  useFrame((state) => {
    // The material keeps its own copy of the uniforms, so write to that.
    const live = meshRef.current?.material.uniforms ?? uniforms;
    live.uTime.value = state.clock.elapsedTime;
    live.uPlateOn.value = live.uPlate.value?.image ? 1 : 0;
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
  near: [300, 620], // fades in over this distance from the lens
  floor: 4, // fully misted up to this height
  top: 112, // and thinned to nothing by this one
  amount: 0.4,
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

// The reference's mountain band, projected onto the far range from the
// opening camera (camera-projection mapping): seen from the opening frame the
// range carries the picture's own rock and mist; as the lens retreats the
// geometry carries it, and that far off it barely shifts. Shared by every
// compile of the snow material, and loaded once.
const RANGE_ROWS = [120, 440];
let rangePlate = null;
function rangeUniforms() {
  if (!rangePlate) {
    const basis = plateUniforms();
    rangePlate = {
      uRange: { value: null },
      uRangeOn: { value: 0 },
      uRefEye: { value: new Vector3(...OPENING_FRAME.eye) },
      uRefF: basis.uRefF,
      uRefR: basis.uRefR,
      uRefU: basis.uRefU,
      uRefTan: basis.uRefTan,
    };
    const texture = new TextureLoader().load('/environments/range-plate.jpg', () => {
      rangePlate.uRangeOn.value = 1;
    });
    texture.colorSpace = SRGBColorSpace;
    rangePlate.uRange.value = texture;
  }
  return rangePlate;
}

function snowSurface(shader) {
  Object.assign(shader.uniforms, rangeUniforms());
  shader.uniforms.uMistTime = VALLEY_MIST.time;
  shader.uniforms.uTrail = SNOW_MARKS.trail;
  shader.uniforms.uTrailRect = SNOW_MARKS.trailRect;
  shader.vertexShader =
    'attribute float aCavity;\nattribute float aCast;\nvarying vec3 vSnowWorld;\nvarying float vCavity;\nvarying float vCast;\n' +
    shader.vertexShader.replace(
      '#include <begin_vertex>',
      [
        '#include <begin_vertex>',
        '  vSnowWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;',
        '  vCavity = aCavity;',
        '  vCast = aCast;',
      ].join('\n')
    );

  shader.fragmentShader =
    'varying vec3 vSnowWorld;\nvarying float vCavity;\nvarying float vCast;\nuniform float uMistTime;\n' +
    'uniform sampler2D uRange;\nuniform float uRangeOn;\nuniform vec3 uRefEye;\nuniform vec3 uRefF;\nuniform vec3 uRefR;\nuniform vec3 uRefU;\nuniform vec2 uRefTan;\n' +
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
        'float vmDensity = vmLow * smoothstep( 0.28, 0.7, vmN * 0.9 + vmLow * 0.3 ) * vmFar;',
        `gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( 0.95, 0.965, 0.985 ), vmDensity * ${VALLEY_MIST.amount.toFixed(2)} );`,
        '#include <fog_fragment>',
        // The far range takes the reference's own pixels, projected from the
        // opening camera (see rangeUniforms). Only far snow, only inside the
        // picture's band, and never where the picture has its igloo.
        'vec3 rgD = vSnowWorld - uRefEye;',
        'float rgZ = dot( rgD, uRefF );',
        'if ( uRangeOn > 0.5 && rgZ > 0.0 ) {',
        '  vec2 rgNdc = vec2( dot( rgD, uRefR ), dot( rgD, uRefU ) ) / ( rgZ * uRefTan );',
        '  vec2 rgFr = vec2( rgNdc.x * 0.5 + 0.5, 0.5 - rgNdc.y * 0.5 );',
        `  float rgV = ( rgFr.y - ${(RANGE_ROWS[0] / 841).toFixed(4)} ) / ${((RANGE_ROWS[1] - RANGE_ROWS[0]) / 841).toFixed(4)};`,
        '  float rgW = smoothstep( 480.0, 680.0, length( rgD ) )',
        '    * smoothstep( -0.02, 0.0, rgFr.x ) * ( 1.0 - smoothstep( 1.0, 1.02, rgFr.x ) )',
        '    * smoothstep( 0.0, 0.05, rgV ) * ( 1.0 - smoothstep( 0.85, 1.0, rgV ) );',
        '  rgW *= 1.0 - step( 0.42, rgFr.x ) * step( rgFr.x, 0.7 ) * step( 0.33, rgFr.y );',
        '  vec3 rgPh = texture2D( uRange, vec2( clamp( rgFr.x, 0.001, 0.999 ), 1.0 - clamp( rgV, 0.001, 0.999 ) ) ).rgb;',
        // Already graded: offset the scene's tone map and grade, as the sky does.
        '  rgPh = mix( vec3( dot( rgPh, vec3( 0.2126, 0.7152, 0.0722 ) ) ), rgPh, 0.82 ) * 0.9;',
        '  gl_FragColor.rgb = mix( gl_FragColor.rgb, rgPh, rgW );',
        '}',
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
        'float snRelief = ( 0.8 + 1.6 * snPatch ) * snNear * mix( 1.0, 0.75, snLand );',
        'snWorldN = normalize( snWorldN + vec3( -( snHX - snH0 ), 0.0, -( snHZ - snH0 ) ) * snRelief / snStep );',
        // The pointer's trail, as a shallow dip.
        'float snMark = 0.0;',
        'snWorldN = snowMarks( snWorldN, vSnowWorld.xz, snMark );',
        // Packed-crystal micro relief on the near snow, the photographic
        // grain the reference's foreground has. Fades out before it aliases.
        'float snMicNear = 1.0 - smoothstep( 25.0, 140.0, length( vSnowWorld - cameraPosition ) );',
        'vec2 snMicP = vSnowWorld.xz * 3.2;',
        'float snMic0 = snNoise( snMicP ) * 0.6 + snNoise( snMicP * 2.7 + 1.7 ) * 0.4;',
        'float snMicX = snNoise( snMicP + vec2( 0.5, 0.0 ) ) * 0.6 + snNoise( ( snMicP + vec2( 0.5, 0.0 ) ) * 2.7 + 1.7 ) * 0.4;',
        'float snMicZ = snNoise( snMicP + vec2( 0.0, 0.5 ) ) * 0.6 + snNoise( ( snMicP + vec2( 0.0, 0.5 ) ) * 2.7 + 1.7 ) * 0.4;',
        'snWorldN = normalize( snWorldN + vec3( snMic0 - snMicX, 0.0, snMic0 - snMicZ ) * 0.55 * snMicNear );',
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
        'float snFlat = mix( smoothstep( 0.5, 0.995, snWorldN.y ), smoothstep( 0.55, 0.998, snWorldN.y ), snFront );',
        // Shaded snow stays blue, never grey: the blue channel barely drops.
        'vec3 snShade = mix( vec3( 0.71, 0.76, 0.87 ), vec3( 0.72, 0.76, 0.85 ), snFront * ( 1.0 - smoothstep( 120.0, 240.0, length( vSnowWorld - cameraPosition ) ) ) );',
        'vec3 snLit = vec3( 0.972, 0.988, 1.0 );',
        'vec3 snSnow = mix( snShade, snLit, clamp( snFlat * 0.86 + snCrest * 0.22 * snNear + snBroad * 0.16, 0.0, 1.0 ) );',
        // The snow is modelled by light from the left and behind, as in the
        // reference: lit faces bright, the far sides of every rise in blue
        // shade. (The igloo keeps the scene's own light.)
        'float snSun = dot( snWorldN, normalize( vec3( -0.62, 0.55, -0.50 ) ) );',
        'snSnow *= mix( mix( mix( vec3( 0.74, 0.79, 0.89 ), vec3( 0.62, 0.66, 0.75 ), smoothstep( 500.0, 800.0, length( vSnowWorld - cameraPosition ) ) ), vec3( 0.71, 0.75, 0.84 ), snFront * ( 1.0 - smoothstep( 120.0, 240.0, length( vSnowWorld - cameraPosition ) ) ) ), vec3( 1.06 + 0.06 * snFront ), smoothstep( -0.1, 0.8, snSun ) );',
        // Past the ripples, wind-packed and loose snow still break the slopes
        // up: long soft patches a shade apart, stretched along the wind.
        'float snPack = snFbm( snWindWarp( vSnowWorld.xz * 0.02 ) );',
        'snSnow *= mix( 0.95, 1.03, smoothstep( 0.3, 0.7, snPack ) );',
        // The steep faces of the far ranges: snow scoured thin into streaks
        // down the fall line, the darker ground showing through.
        'float snDist = length( vSnowWorld - cameraPosition );',
        'float snSteep = 1.0 - smoothstep( 0.7, 0.93, snWorldN.y );',
        'float snStreak = snFbm( vec2( ( vSnowWorld.x + vSnowWorld.z ) * 0.13, vSnowWorld.y * 0.045 ) );',
        'float snRock = snSteep * smoothstep( 0.42, 0.7, snStreak ) * smoothstep( 280.0, 620.0, snDist ) * smoothstep( 55.0, 120.0, vSnowWorld.y );',
        // Wind-scoured streaks down the far ranges' steep faces: grey-blue,
        // never dark rock, as on the reference's summits.
        'snSnow *= mix( vec3( 1.0 ), vec3( 0.66, 0.72, 0.84 ), snRock );',
        // Rock breaking through the snow just under the summits, in patches
        // along the steep upper ridges, as on the reference's peaks.
        'float snSummit = ( 1.0 - smoothstep( 0.6, 0.97, snWorldN.y ) ) * smoothstep( 100.0, 160.0, vSnowWorld.y ) * smoothstep( 0.46, 0.66, snFbm( vSnowWorld.xz * 0.05 + vec2( vSnowWorld.y * 0.04 ) ) );',
        'snSnow *= mix( vec3( 1.0 ), vec3( 0.58, 0.63, 0.74 ), snSummit * 0.75 );',
        // Finer scoured detail on the steep summit faces.
        'float snRockFine = smoothstep( 0.5, 0.75, snFbm( vec2( ( vSnowWorld.x - vSnowWorld.z ) * 0.32, vSnowWorld.y * 0.11 ) ) );',
        'snSnow *= mix( vec3( 1.0 ), vec3( 0.74, 0.79, 0.89 ), snRockFine * snSteep * smoothstep( 280.0, 620.0, snDist ) * smoothstep( 90.0, 160.0, vSnowWorld.y ) * 0.8 );',
        // Near snow reads bright and white, not grey.
        'snSnow = mix( snSnow, snLit, ( 1.0 - smoothstep( 20.0, 170.0, snDist ) ) * 0.08 );',
        // Folds and valleys sit in soft blue shade, crests a touch brighter:
        // the depth real snow has between its rises. (aCavity, from the mesh.)
        'snSnow *= mix( vec3( 1.0 ), vec3( 0.80, 0.87, 0.98 ), clamp( vCavity, 0.0, 1.0 ) * 0.3 );',
        'snSnow *= 1.0 + clamp( -vCavity, 0.0, 1.0 ) * 0.05;',
        // Cast shadows of the mounds, baked from the low back-left light:
        // the soft blue-grey troughs the reference's foreground lies in.
        'snSnow *= mix( vec3( 1.0 ), vec3( 0.68, 0.72, 0.81 ), clamp( vCast, 0.0, 1.0 ) );',
        // Contact shade where the snow meets the igloo's wall.
        'float snFoot = 1.0 - smoothstep( 22.0, 29.0, length( vSnowWorld.xz - vec2( -30.0, 252.0 ) ) );',
        'snSnow *= mix( vec3( 1.0 ), vec3( 0.78, 0.85, 0.97 ), snFoot * 0.55 );',
        'snSnow *= mix( vec3( 1.0 ), vec3( 0.86, 0.91, 0.99 ), snMark * 0.35 );',
        'snSnow = mix( snSnow, snLit, snLand * 0.03 );',
        // Fine grain in the snow's surface, as packed crystals have, fading
        // out with distance before it can shimmer.
        'float snGrainA = snNoise( vSnowWorld.xz * 3.0 ) * 0.35 + snNoise( vSnowWorld.xz * 9.0 + 4.3 ) * 0.35 + snHash( floor( vSnowWorld.xz * 22.0 ) ) * 0.3;',
        'snSnow *= mix( 1.0, 0.82 + 0.26 * snGrainA, 1.0 - smoothstep( 90.0, 340.0, length( vSnowWorld - cameraPosition ) ) );',
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
        'float snTwinkle = step( 0.86, snHash( snCell + floor( snRay.xz * 30.0 ) * 0.37 ) );',
        'float snGlint = snDot * snTwinkle * ( 1.0 - smoothstep( 10.0, 45.0, snDist ) );',
        'totalEmissiveRadiance += vec3( 1.0, 0.98, 0.94 ) * snGlint * 2.0;',
        // The same crystals across the whole foreground, at a size that still
        // reads further out.
        'vec2 snCellQ = vSnowWorld.xz * 1.2;',
        'vec2 snCell2 = floor( snCellQ );',
        'vec2 snSpot2 = vec2( snHash( snCell2 + 3.1 ), snHash( snCell2 + 5.7 ) ) * 0.8 + 0.1;',
        'float snDot2 = smoothstep( 0.12, 0.0, length( fract( snCellQ ) - snSpot2 ) );',
        'float snTwinkle2 = step( 0.88, snHash( snCell2 + floor( snRay.xz * 24.0 ) * 0.53 ) );',
        'float snGlint2 = snDot2 * snTwinkle2 * smoothstep( 35.0, 60.0, snDist ) * ( 1.0 - smoothstep( 140.0, 220.0, snDist ) );',
        'totalEmissiveRadiance += vec3( 1.0, 0.98, 0.94 ) * snGlint2 * 1.6;',
        // Light bounced between snow and overcast sky: open snow never falls
        // to grey, as it does under a single sun.
        'float snOpen = smoothstep( 0.75, 0.98, snWorldN.y );',
        'totalEmissiveRadiance += vec3( 0.80, 0.85, 0.92 ) * 0.12 * snOpen * ( 1.0 - smoothstep( 80.0, 900.0, snDist ) );',
        // Low land catches the light as brightly as the hills' faces do.
        'totalEmissiveRadiance += vec3( 0.86, 0.90, 0.96 ) * 0.05 * snLand;',
        // Lit crowns in front go near white, as in the reference.
        'totalEmissiveRadiance += vec3( 0.95, 0.97, 1.0 ) * 0.26 * smoothstep( -0.1, 0.7, snSun ) * snFront * ( 1.0 - smoothstep( 150.0, 300.0, snDist ) );',
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
  { x: -480, z: -100, h: 60, rx: 118, rz: 81 },
  { x: -260, z: -60, h: 54, rx: 106, rz: 77 },
  { x: -40, z: -125, h: 44, rx: 120, rz: 85 },
  { x: 210, z: -40, h: 48, rx: 105, rz: 76 },
  { x: 430, z: -145, h: 58, rx: 120, rz: 84 },

  // Far panorama: the tallest crowns, read through the most haze
  { x: -780, z: -700, h: 227, rx: 221, rz: 143 },
  { x: -520, z: -520, h: 213, rx: 182, rz: 120 },
  { x: -180, z: -600, h: 180, rx: 190, rz: 128 },
  { x: 220, z: -480, h: 177, rx: 174, rz: 116 },
  { x: 560, z: -560, h: 193, rx: 190, rz: 123 },
  { x: 20, z: -830, h: 235, rx: 235, rz: 150 },
  { x: 840, z: -720, h: 203, rx: 221, rz: 143 },
  // The big right-hand mountain of the reference, its flank sweeping down
  // into the mist toward the frame edge.
  { x: 470, z: -420, h: 200, rx: 245, rz: 140 },
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
  height += plainTexture(x, z) * 0.1 * smoothstep(40, 80, r) * smoothstep(120, 220, z);

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

// The low light the foreground is modelled by (the shader's snSun, from the
// back-left), flattened to a sun about 22 degrees up so the mounds throw the
// long shadows the reference has. Toward-the-light, per horizontal unit.
const CAST_DIR = [-0.778, -0.628];
const CAST_RISE = 0.27;
const CAST_REACH = 48;

/**
 * Bakes the mounds' cast shadows over the dense front band: from each point,
 * march toward the light across the built heightfield; where the snow rises
 * above the ray the point is in shadow, softly, by how deep the ray is buried.
 */
function castShadows(arr, cols) {
  const out = new Float32Array(arr.length / 3);
  const [c0, c1] = [GRID_X.counts[0], GRID_X.counts[0] + GRID_X.counts[1]];
  const [r0, r1] = [GRID_Z.counts[0], GRID_Z.counts[0] + GRID_Z.counts[1]];
  const [x0, x1] = GRID_X.bands[1];
  const [z0, z1] = GRID_Z.bands[1];
  const dx = (x1 - x0) / GRID_X.counts[1];
  const dz = (z1 - z0) / GRID_Z.counts[1];
  const y = (c, r) => arr[(r * cols + c) * 3 + 1];
  const heightAt = (x, z) => {
    const fc = c0 + (x - x0) / dx;
    const fr = r0 + (z - z0) / dz;
    if (fc < c0 || fc >= c1 || fr < r0 || fr >= r1) return -Infinity;
    const c = Math.floor(fc);
    const r = Math.floor(fr);
    const tx = fc - c;
    const tz = fr - r;
    return (y(c, r) * (1 - tx) + y(c + 1, r) * tx) * (1 - tz) + (y(c, r + 1) * (1 - tx) + y(c + 1, r + 1) * tx) * tz;
  };
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      const k = r * cols + c;
      const x = arr[k * 3];
      const y0 = arr[k * 3 + 1];
      const z = arr[k * 3 + 2];
      let shade = 0;
      for (let d = 1.2; d < CAST_REACH && shade < 1; d += 1.2) {
        const h = heightAt(x + CAST_DIR[0] * d, z + CAST_DIR[1] * d);
        if (h === -Infinity) break;
        const buried = h - (y0 + 0.15 + CAST_RISE * d);
        if (buried > 0) shade = Math.max(shade, Math.min(1, buried / 1.2));
      }
      out[k] = shade;
    }
  }
  return out;
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
      // The reference's humps, kept clear of the igloo's wall, over a quiet
      // remnant of the wind texture.
      const clear = smoothstep(26, 38, Math.hypot(x + 30, z - 252));
      pos.setXYZ(i, x, ground + Math.max(refHumps(x, z), snowMounds(x, z) * landWeight(x, z) * low * (0.4 + 0.6 * smoothstep(190, 300, z))) * clear, z);
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
    geo.setAttribute('aCast', new BufferAttribute(castShadows(pos.array, cols), 1));

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
const BANK = { inner: 18.5, peak: 24.6, outer: 33, height: 2.7 };
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

// Dense rolling fog: soft round puffs heaped into a bank with a lumpy top and
// a full base, for the billows lying across the mountains.
function billowTexture() {
  const W = 512;
  const H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  let seed = 90417;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 260; i++) {
    const x = rand() * W;
    const y = H * (0.42 + rand() * 0.4);
    const r = 14 + rand() * 34;
    const edge = Math.min(x, W - x) / (W / 2);
    const a = (0.2 + rand() * 0.3) * Math.min(1, edge * 2.2) * Math.min(1, (H - y) / 26);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Fade every border to nothing, so no plane ever shows a straight edge.
  ctx.globalCompositeOperation = 'destination-in';
  const fadeX = ctx.createLinearGradient(0, 0, W, 0);
  fadeX.addColorStop(0, 'rgba(255,255,255,0)');
  fadeX.addColorStop(0.18, 'rgba(255,255,255,1)');
  fadeX.addColorStop(0.82, 'rgba(255,255,255,1)');
  fadeX.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = fadeX;
  ctx.fillRect(0, 0, W, H);
  const fadeY = ctx.createLinearGradient(0, 0, 0, H);
  fadeY.addColorStop(0, 'rgba(255,255,255,0)');
  fadeY.addColorStop(0.25, 'rgba(255,255,255,1)');
  fadeY.addColorStop(0.7, 'rgba(255,255,255,1)');
  fadeY.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = fadeY;
  ctx.fillRect(0, 0, W, H);
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// Low mist banks pooling at the foot of the ranges and drifting across them:
// what reads in the reference as the ground haze the wind is dragging.
function MistBanks() {
  const texture = useMemo(() => mistTexture(), []);
  const billow = useMemo(() => billowTexture(), []);
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
      // Billows rolling through the hollows just behind the igloo.
      { at: [-360, 34, -90], size: [760, 70], opacity: 0.5, speed: 1.3 },
      { at: [320, 38, -110], size: [760, 70], opacity: 0.5, speed: -1.2 },
      { at: [-30, 58, -230], size: [1000, 80], opacity: 0.5, speed: 0.9 },
      // Thick fog pooled at the mountains' feet, as in the reference.
      { at: [-520, 70, -330], size: [1100, 90], opacity: 0.6, speed: 1.1, billow: true },
      { at: [420, 74, -300], size: [1100, 90], opacity: 0.6, speed: -1.0, billow: true },
      { at: [-80, 82, -420], size: [1300, 100], opacity: 0.45, speed: 0.8, billow: true },
      // Billows half-way up the range, between the summits.
      // Fog rising in the gaps between the peaks: set inside the range, so the
      // mountains in front hide it everywhere but between their summits.
      { at: [-330, 112, -540], size: [900, 110], opacity: 1.0, speed: 0.6, billow: true },
      { at: [330, 118, -560], size: [900, 110], opacity: 1.0, speed: -0.5, billow: true },
      { at: [0, 126, -640], size: [1100, 120], opacity: 1.0, speed: 0.4, billow: true },
      { at: [520, 64, -200], size: [800, 80], opacity: 0.85, speed: -0.8, billow: true },
      { at: [-560, 60, -210], size: [800, 80], opacity: 0.75, speed: 0.9, billow: true },
      { at: [-420, 66, -370], size: [1000, 100], opacity: 0.9, speed: 1.0, billow: true },
      { at: [380, 70, -360], size: [1000, 100], opacity: 0.9, speed: -0.9, billow: true },
      { at: [-40, 74, -400], size: [1300, 110], opacity: 0.9, speed: 0.7, billow: true },
      // Banks drifting across the feet of the ranges, above the middle hills.
      { at: [-350, 96, -420], size: [900, 100], opacity: 0.95, speed: 1.6 },
      { at: [300, 100, -400], size: [900, 100], opacity: 0.95, speed: -1.4 },
      { at: [-20, 112, -560], size: [1200, 110], opacity: 0.9, speed: 1.1 },
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

  useEffect(() => () => {
    texture.dispose();
    billow.dispose();
  }, [texture, billow]);

  return (
    <group ref={groupRef}>
      {bands.map((band, i) => (
        <mesh key={i} position={band.at} renderOrder={2} frustumCulled={false}>
          <planeGeometry args={band.size} />
          <meshBasicMaterial
            map={band.billow ? billow : texture}
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
        size={0.28}
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
        size={0.12}
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
        camera={{ fov: 38, near: 4, far: 2800, position: [-33, 20, 368] }}
        onCreated={({ gl, scene }) => {
          gl.toneMappingExposure = 1.08;
          scene.background = new Color(SKY_HORIZON);
          // Deep aerial haze: the ranges wash out toward white with distance,
          // and the terrain's far edge is gone well before it reaches the sky.
          scene.fog = new Fog(HAZE, 700, 3300);
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
          <BrightnessContrast brightness={0.0} contrast={0.2} />
          <HueSaturation saturation={0.1} />
          <Vignette offset={0.44} darkness={0.12} eskil={false} />
          <IceCut />
        </EffectComposer>

        <AdaptiveEvents />
        <CutFrameGate />
      </Canvas>
    </div>
  );
}
