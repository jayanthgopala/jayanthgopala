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
uniform float uDpr;
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

void main() {
  // The cut shader sizes the dot lattice in CSS pixels (its viewport uniform
  // comes from R3F's size, which is CSS). gl_FragCoord is in device pixels, so
  // it has to be divided down or the grid comes out denser and finer here than
  // on the page behind — at any DPR above 1 the dots all but disappear.
  // The flip is because the cut shader measures from the top left.
  vec2 css = gl_FragCoord.xy / max(uDpr, 0.0001);
  vec2 px = vec2(css.x, uViewport.y - css.y);

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

  gl_FragColor = vec4(toLinear(c), 1.0);

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
          uDpr: { value: 1 },
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

  // CSS pixels, exactly as IceCut passes them, with the device-pixel ratio kept
  // alongside so the shader can convert gl_FragCoord into the same space.
  useFrame(() => {
    material.uniforms.uViewport.value.set(size.width, size.height);
    material.uniforms.uDpr.value = viewport.dpr;
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
