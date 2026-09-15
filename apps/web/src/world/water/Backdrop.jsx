// The space the object sits in.
//
// The ice page is still the ground, and still drawn from the same ICE_PAGE
// constants the cut shader uses, evaluated in screen space so the 36px dot
// lattice lands on identical pixels and the fade between the two shows no seam.
//
// Everything layered on top of it is there to make the background read as a
// material with depth rather than a flat fill: a drifting smear, and frost that
// glazes over a patch and clears again.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BackSide, FrontSide, ShaderMaterial, Vector2, Vector3, Vector4 } from 'three';
import { ICE_PAGE } from '../lib/ice-page.js';
import { GLAZE_ACTIVE } from './device.js';

const rgb = (c) => new Vector3(c[0] / 255, c[1] / 255, c[2] / 255);
const rgba = (c) => new Vector4(c[0] / 255, c[1] / 255, c[2] / 255, c[3]);

/** How many patches of frost can be forming at once. */
const GLAZE = 4;

/** Seconds a patch takes to bloom and clear. */
const GLAZE_LIFE = [7, 14];

const VERT = /* glsl */ `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec2 uViewport;
uniform float uDpr;
uniform float uTime;
uniform float uSmear;
uniform float uScroll;
uniform float uDots; // 1 draws the dot lattice, 0 leaves it out
uniform vec4 uGlaze[${GLAZE}]; // xy = screen uv, z = radius, w = strength

uniform vec3 uIceBase;
uniform vec4 uIceDot;
uniform vec2 uIceDotSize;
uniform vec4 uGlowCentre;
uniform vec4 uGlowEdge;
uniform vec4 uWashTop;
uniform vec4 uWashBottom;
uniform float uWashClear;

vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

vec3 overGradient(vec4 a, vec4 b, float t, vec3 below) {
  vec3 pm = mix(a.rgb * a.a, b.rgb * b.a, t);
  return pm + below * (1.0 - mix(a.a, b.a, t));
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float fbm(vec2 p) {
  return vnoise(p) * 0.55 + vnoise(p * 2.1) * 0.28 + vnoise(p * 4.3) * 0.17;
}

/**
 * Drifting cloud smear.
 *
 * The streaks come from sampling a field compressed hard in y, so its structure
 * runs across the frame rather than clumping; the curl comes from warping that
 * lookup with a second, slower field. Plain layered noise gives fog — it is the
 * warp that makes it look like something moving through air.
 */
float smear(vec2 p, float t) {
  // A slow, wide warp. Large amplitude over a low frequency is what bends the
  // bands into swells instead of shredding them into wisps.
  //
  // One noise sample per axis rather than a three-octave stack: the warp is
  // deliberately low frequency, so the extra octaves added nothing visible, and
  // this shader runs over the whole screen twice a frame (once for the page,
  // once more for the refraction pass behind the object).
  vec2 warp = vec2(
    vnoise(p * 0.42 + vec2(t * 0.055, t * -0.038)),
    vnoise(p * 0.51 + vec2(t * -0.047, t * 0.031))
  );

  vec2 q = p + (warp - 0.5) * 2.6;

  // Only mildly compressed, so the forms stay broad rather than becoming
  // threads, and sampled at one scale only — a second octave here is exactly
  // the fine detail that made it look continuous rather than made of waves.
  vec2 stretched = vec2(q.x * 0.42, q.y * 1.35);

  return fbm(stretched + vec2(t * 0.085, t * 0.012));
}

void main() {
  // The cut shader sizes the dot lattice in CSS pixels; gl_FragCoord is in
  // device pixels, so it has to be divided down or the grid comes out denser
  // and finer here than on the page behind.
  vec2 css = gl_FragCoord.xy / max(uDpr, 0.0001);
  vec2 px = vec2(css.x, uViewport.y - css.y);
  vec2 screen = clamp(css / max(uViewport, vec2(1.0)), 0.0, 1.0);
  float aspect = uViewport.x / max(uViewport.y, 1.0);

  vec3 c = uIceBase;

  vec2 cell = px - uIceDotSize.y * floor(px / uIceDotSize.y + 0.5);
  float dotMask = 1.0 - smoothstep(uIceDotSize.x - 0.5, uIceDotSize.x + 0.5, length(cell));
  c = mix(c, uIceDot.rgb, uIceDot.a * dotMask * uDots);

  vec2 halfSize = uViewport * 0.5;
  float r = clamp(length(px - halfSize) / length(halfSize), 0.0, 1.0);
  c = overGradient(uGlowCentre, uGlowEdge, r, c);

  float y = clamp(px.y / uViewport.y, 0.0, 1.0);
  c = y < uWashClear
    ? overGradient(uWashTop, vec4(0.0), y / uWashClear, c)
    : overGradient(vec4(0.0), uWashBottom, (y - uWashClear) / (1.0 - uWashClear), c);

  // Offset by the scroll, so the background travels with the page instead of
  // sitting still behind an object that moves. Subtracted, not added: scrolling
  // down has to carry the background up with the content, and adding ran it the
  // other way.
  vec2 field = vec2(screen.x * aspect, screen.y - uScroll) * 0.95;
  float haze = smear(field, uTime);

  // Layered noise comes back bunched around the middle — a band of roughly
  // 0.35 to 0.65 — so subtracting it straight gave an almost uniform darkening
  // with no visible structure at all. Centred on zero and stretched, the
  // variation becomes the thing you see, and the mean stays put so the page
  // does not simply get darker.
  // Centred on 0.63, not 0.5. Layered noise through a warp does not come back
  // symmetric — this field averages 0.63 — so subtracting around the midpoint
  // biased every pixel darker and dimmed the whole page by about twenty levels.
  float shade = clamp((haze - 0.63) * 3.0, -1.0, 1.0);
  c -= shade * uSmear;

  // Frost glazing over a patch and clearing again. Each is a soft disc with a
  // crystalline grain inside it — the grain is what makes it read as ice rather
  // than as a bright spot.
  for (int i = 0; i < ${GLAZE}; i++) {
    vec4 frost = uGlaze[i];
    if (frost.w <= 0.0) continue;

    vec2 delta = (screen - frost.xy) * vec2(aspect, 1.0);
    float fall = 1.0 - smoothstep(frost.z * 0.35, frost.z, length(delta));
    if (fall <= 0.0) continue;

    // No brightening at all. Adding light made these read as lamps pointed at
    // the page — bright spots — rather than as anything forming on it. What
    // frost actually does is scatter: it flattens whatever is behind it, so
    // that is all this does, with the grain breaking up the edge.
    float grain = vnoise(delta * 34.0 + frost.xy * 40.0);
    float veil = fall * frost.w * (0.6 + grain * 0.4);
    c = mix(c, vec3(dot(c, vec3(0.3333))), veil * 0.3);
  }

  gl_FragColor = vec4(toLinear(clamp(c, 0.0, 1.0)), 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Distance behind the object, far enough that refraction has something to bend. */
const DEPTH = 9;

/** Comfortably past the frustum at this depth, at any viewport shape. */
const SPAN = 120;

/**
 * @param followCamera For a scene whose camera travels (the ring shaft): the
 *   same screen-space ground is drawn on a sphere kept around the camera,
 *   instead of on a plane behind a camera that never moves.
 */
export default function Backdrop({ scroll, followCamera = false }) {
  const { size, viewport } = useThree();
  const meshRef = useRef(null);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: followCamera ? BackSide : FrontSide,
        uniforms: {
          uViewport: { value: new Vector2(1, 1) },
          uDpr: { value: 1 },
          uTime: { value: 0 },
          uSmear: { value: 0.11 },
          uScroll: { value: 0 },
          // The ring shaft wants the ground without its dot lattice.
          uDots: { value: followCamera ? 0 : 1 },
          uGlaze: { value: Array.from({ length: GLAZE }, () => new Vector4()) },
          uIceBase: { value: rgb(ICE_PAGE.base) },
          uIceDot: { value: rgba([...ICE_PAGE.dot.color, ICE_PAGE.dot.alpha]) },
          uIceDotSize: {
            value: new Vector2(ICE_PAGE.dot.radius, ICE_PAGE.dot.spacing),
          },
          uGlowCentre: { value: rgba(ICE_PAGE.glow.centre) },
          uGlowEdge: { value: rgba(ICE_PAGE.glow.edge) },
          uWashTop: { value: rgba(ICE_PAGE.wash.top) },
          uWashBottom: { value: rgba(ICE_PAGE.wash.bottom) },
          uWashClear: { value: ICE_PAGE.wash.clearAt },
        },
      }),
    [followCamera]
  );

  useEffect(() => () => material.dispose(), [material]);

  // Each patch keeps its own clock, so they overlap rather than pulsing
  // together — which is what makes the frost read as weather instead of as an
  // animation on a loop.
  const patches = useMemo(
    () =>
      Array.from({ length: GLAZE }, () => ({
        x: Math.random(),
        y: Math.random(),
        radius: 0.16 + Math.random() * 0.22,
        life: GLAZE_LIFE[0] + Math.random() * (GLAZE_LIFE[1] - GLAZE_LIFE[0]),
        age: Math.random() * 6,
      })),
    []
  );

  useFrame((state, delta) => {
    if (followCamera && meshRef.current) meshRef.current.position.copy(state.camera.position);

    const dt = Math.min(delta, 0.05);
    const u = material.uniforms;
    u.uTime.value += dt;
    u.uViewport.value.set(size.width, size.height);
    u.uDpr.value = viewport.dpr;
    u.uScroll.value = (scroll?.current ?? 0) * 0.5;

    for (let i = 0; i < GLAZE; i += 1) {
      // Slots past the active count stay at zero strength, which the shader
      // skips outright — cheaper than compiling a second shader for phones.
      if (i >= GLAZE_ACTIVE) {
        u.uGlaze.value[i].set(0, 0, 0, 0);
        continue;
      }

      const patch = patches[i];
      patch.age += dt;

      if (patch.age > patch.life) {
        patch.age = 0;
        patch.x = Math.random();
        patch.y = Math.random();
        patch.radius = 0.16 + Math.random() * 0.22;
        patch.life = GLAZE_LIFE[0] + Math.random() * (GLAZE_LIFE[1] - GLAZE_LIFE[0]);
      }

      // In slowly, hold, out slowly.
      const t = Math.min(1, Math.max(0, patch.age / patch.life));
      u.uGlaze.value[i].set(patch.x, patch.y, patch.radius, Math.sin(Math.PI * t) ** 1.6);
    }
  });

  // Fixed and oversized rather than fitted to the camera.
  //
  // Deriving the size from the viewport meant dividing by size.height, which is
  // zero until the first measurement lands — one NaN vertex gives the mesh a
  // NaN bounding sphere, frustum culling drops it, and the clear colour shows
  // through as a black screen. The pattern is drawn in screen space from
  // gl_FragCoord, so the plane's own dimensions never mattered; it only has to
  // be larger than the frustum, which this is at any aspect.
  // A sphere kept centred on the travelling camera. The pattern is drawn from
  // gl_FragCoord, so it lands on the same pixels as the project page whatever
  // the geometry; it only has to surround the camera.
  if (followCamera) {
    return (
      <mesh ref={meshRef} material={material} renderOrder={-10} frustumCulled={false}>
        <sphereGeometry args={[30, 32, 16]} />
      </mesh>
    );
  }

  return (
    <mesh
      position={[0, 0, -DEPTH]}
      material={material}
      renderOrder={-1}
      frustumCulled={false}
    >
      <planeGeometry args={[SPAN, SPAN]} />
    </mesh>
  );
}
