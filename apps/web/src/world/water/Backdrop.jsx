// The page behind the jar.
//
// This is what the glass and the liquid actually refract, so it cannot be an
// approximation of the ice page — any drift in the dot grid or the wash would
// show as a seam against the frozen world canvas underneath. It is the same
// `iceGround` the cut shader draws, from the same ICE_PAGE constants, evaluated
// in screen space so the 36px dot lattice lands on identical pixels.

import { useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { FrontSide, ShaderMaterial, Vector2, Vector3, Vector4 } from 'three';
import { ICE_PAGE } from '../lib/ice-page.js';

const rgb = (c) => new Vector3(c[0] / 255, c[1] / 255, c[2] / 255);
const rgba = (c) => new Vector4(c[0] / 255, c[1] / 255, c[2] / 255, c[3]);

const VERT = /* glsl */ `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec2 uViewport;
uniform float uTime;
uniform float uCaustic;
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

// Caustic web: a point is folded through itself a few times, and the reciprocal
// of the distance to the folded position gives the characteristic bright
// filaments where light has been focused.
float caustic(vec2 p, float t) {
  vec2 i = p;
  float c = 0.0;
  const float INTENSITY = 0.005;

  for (int n = 0; n < 4; n++) {
    float k = t * (1.0 - 3.5 / float(n + 1));
    i = p + vec2(cos(k - i.x) + sin(k + i.y), sin(k - i.y) + cos(k + i.x));
    c += 1.0 / length(vec2(
      p.x / (sin(i.x + k) / INTENSITY),
      p.y / (cos(i.y + k) / INTENSITY)
    ));
  }

  c = 1.17 - pow(c * 0.25, 1.4);
  return pow(abs(c), 8.0);
}

void main() {
  // gl_FragCoord counts from the bottom left; the cut shader works from the
  // top left. Flipping here is what keeps the two dot grids in register.
  vec2 px = vec2(gl_FragCoord.x, uViewport.y - gl_FragCoord.y);

  vec3 c = uIceBase;

  vec2 cell = px - uIceDotSize.y * floor(px / uIceDotSize.y + 0.5);
  float dotMask = 1.0 - smoothstep(uIceDotSize.x - 0.5, uIceDotSize.x + 0.5, length(cell));
  c = mix(c, uIceDot.rgb, uIceDot.a * dotMask);

  vec2 halfSize = uViewport * 0.5;
  float r = clamp(length(px - halfSize) / length(halfSize), 0.0, 1.0);
  c = overGradient(uGlowCentre, uGlowEdge, r, c);

  float y = clamp(px.y / uViewport.y, 0.0, 1.0);
  c = y < uWashClear
    ? overGradient(uWashTop, vec4(0.0), y / uWashClear, c)
    : overGradient(vec4(0.0), uWashBottom, (y - uWashClear) / (1.0 - uWashClear), c);

  // Light through moving water, laid over the page. Kept faint: it has to read
  // as the room the letter is in, not as a texture competing with it.
  vec2 aspect = vec2(uViewport.x / uViewport.y, 1.0);
  float light = caustic((px / uViewport.y) * 3.4 * aspect, uTime * 0.22);
  c += light * uCaustic;

  gl_FragColor = vec4(toLinear(min(c, vec3(1.0))), 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Distance behind the jar, far enough that refraction has something to bend. */
const DEPTH = 9;

export default function Backdrop() {
  const { size, camera, viewport } = useThree();

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: FrontSide,
        uniforms: {
          uViewport: { value: new Vector2(1, 1) },
          uTime: { value: 0 },
          uCaustic: { value: 0.22 },
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
    []
  );

  // The dot lattice is defined in device pixels, matching the cut shader's own
  // viewport uniform rather than CSS pixels.
  useFrame((_, dt) => {
    material.uniforms.uTime.value += Math.min(dt, 0.05);
    material.uniforms.uViewport.value.set(
      size.width * viewport.dpr,
      size.height * viewport.dpr
    );
  });

  // Sized to cover the frustum at its depth, with margin for refraction pulling
  // in samples from beyond the frame edge.
  const span = useMemo(() => {
    const distance = DEPTH + camera.position.z;
    const height = 2 * Math.tan((camera.fov * Math.PI) / 360) * distance;
    return { h: height * 1.6, w: height * (size.width / size.height) * 1.6 };
  }, [camera, size.width, size.height]);

  return (
    <mesh position={[0, 0, -DEPTH]} material={material} renderOrder={-1}>
      <planeGeometry args={[span.w, span.h]} />
    </mesh>
  );
}
