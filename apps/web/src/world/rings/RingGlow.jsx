import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  ShaderMaterial,
} from 'three';
import { NOISE, VUV } from './glsl.js';
import { FOG, SHAFT_BOTTOM } from './layout.js';
import { FALL_PAST_LAST } from '../chapters.js';

const SHAFT_TOP = 1.5;

// The light in the descent: the frost film across each ring, the smoke that
// swirls around its inner edge, the tunnel haze, and flat glowing rings.
//
// All additive. Each writes alpha 1 so AdditiveBlending (src alpha, one) adds
// the colour as written rather than squaring it.

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function useAdditive(fragmentShader, uniforms, extra = {}) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uTime: { value: 0 }, ...uniforms },
        vertexShader: VUV,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        ...extra,
      }),
    // Built once per mount; uniforms are driven per frame.
    []
  );
  useEffect(() => () => material.dispose(), [material]);
  return material;
}

/** A flat glowing band, optionally with two gaps that turn. */
export function GlowRing({
  y,
  radius,
  width,
  intensity = 1,
  dashes = 0,
  spin = 0,
  color = '#dcecff',
  levels,
  channel,
}) {
  const ref = useRef(null);
  const half = radius + width * 4;

  const material = useAdditive(
    /* glsl */ `
      uniform float uRadius, uWidth, uHalf, uIntensity, uDashes, uSpin, uTime, uLevel;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        vec2 p = ( vUv - 0.5 ) * 2.0 * uHalf;
        float r = length( p );
        float x = ( r - uRadius ) / uWidth;
        float v = exp( -x * x * 6.0 ) + exp( -x * x * 0.6 ) * 0.25;
        float a = atan( p.y, p.x ) + uTime * uSpin;
        if ( uDashes > 0.0 ) v *= smoothstep( 0.04, 0.2, abs( sin( a * uDashes * 0.5 ) ) );
        v *= uIntensity * uLevel * ( 0.85 + 0.15 * sin( uTime * 2.0 + a * 3.0 ) );
        gl_FragColor = vec4( uColor * v, 1.0 );
      }
    `,
    {
      uRadius: { value: radius },
      uWidth: { value: width },
      uHalf: { value: half },
      uIntensity: { value: intensity },
      uDashes: { value: dashes },
      uSpin: { value: spin },
      uLevel: { value: 1 },
      uColor: { value: new Color(color) },
    },
    { side: DoubleSide }
  );

  useFrame(({ clock }) => {
    const u = material.uniforms;
    u.uTime.value = clock.elapsedTime;
    u.uLevel.value = levels && channel ? levels.current[channel] : 1;
    if (ref.current) ref.current.visible = u.uLevel.value > 0.001;
  });

  return (
    // An annulus around the band rather than a full square: RingGeometry's UVs
    // span the outer radius exactly like the plane's did, so the shader is
    // unchanged, but the empty middle is never rasterised.
    <mesh ref={ref} position={[0, y, 0]} rotation-x={-Math.PI / 2} material={material} frustumCulled={false}>
      <ringGeometry args={[Math.max(0, radius - width * 4), half, 128, 1]} />
    </mesh>
  );
}

/**
 * A frosted pane across a ring's opening, carrying the page background's own
 * effect — the slow warped smear and the frost grain — in ice colour, instead
 * of bright ripples. Drawn in the ring's own space, so it moves with the ring
 * against the screen-fixed background and veils the rings further down.
 */
export function Membrane({ y, radius, strength = 1 }) {
  const ref = useRef(null);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uFade: { value: 0 },
          uStrength: { value: strength },
          uBase: { value: new Color(FOG) },
        },
        vertexShader: VUV,
        fragmentShader:
          NOISE +
          /* glsl */ `
          uniform float uTime, uFade, uStrength;
          uniform vec3 uBase;
          varying vec2 vUv;

          float fbm3( vec2 p ) {
            return rNoise( p ) * 0.55 + rNoise( p * 2.1 ) * 0.28 + rNoise( p * 4.3 ) * 0.17;
          }

          void main() {
            vec2 p = ( vUv - 0.5 ) * 2.0;
            float r = length( p );
            if ( r > 1.0 ) discard;

            // The background's smear: a wide, slow warp bending broad bands.
            vec2 warp = vec2(
              rNoise( p * 0.9 + vec2( uTime * 0.055, -uTime * 0.038 ) ),
              rNoise( p * 1.1 + vec2( -uTime * 0.047, uTime * 0.031 ) )
            );
            vec2 q = p * 1.6 + ( warp - 0.5 ) * 2.6;
            float haze = fbm3( vec2( q.x * 0.42, q.y * 1.35 ) + vec2( uTime * 0.085, uTime * 0.012 ) );
            float shade = clamp( ( haze - 0.5 ) * 3.0, -1.0, 1.0 );

            // And its frost: fine grain that scatters rather than shines.
            float grain = fbm3( p * 6.0 + 3.1 );

            // Toned a little under the page colour and with stronger swings, so
            // the pane reads against the white rather than vanishing into it.
            vec3 col = uBase * ( 0.9 - shade * 0.22 ) + vec3( grain * 0.08 );
            float alpha = ( 0.55 + 0.3 * abs( shade ) ) * smoothstep( 1.0, 0.8, r ) * uFade * uStrength;
            gl_FragColor = vec4( col, alpha );
          }
        `,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
    []
  );
  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ clock, camera }) => {
    const dy = Math.abs(camera.position.y - y);
    material.uniforms.uTime.value = clock.elapsedTime;
    // Gone just before the camera meets it, so passing through never flashes.
    const fade = smooth(0.05, 0.9, dy) * smooth(10, 2.5, dy) * 0.9;
    material.uniforms.uFade.value = fade;
    if (ref.current) ref.current.visible = fade > 0.001;
  });

  return (
    <mesh ref={ref} position={[0, y, 0]} rotation-x={-Math.PI / 2} material={material} frustumCulled={false}>
      <planeGeometry args={[radius * 2, radius * 2]} />
    </mesh>
  );
}

/** Faint haze lining the shaft the rings hang in. */
export function Tunnel({ levels }) {
  const ref = useRef(null);
  const material = useAdditive(
    NOISE +
      /* glsl */ `
      uniform float uTime, uLevel;
      varying vec2 vUv;
      void main() {
        vec2 around = vec2( cos( vUv.x * 6.2832 ), sin( vUv.x * 6.2832 ) ) * 1.5;
        vec2 uv = around + vec2( 0.0, vUv.y * 6.0 + uTime * 0.05 );
        // Two plain noise samples: the camera is inside this, so it is full screen.
        float w = rNoise( uv * 1.4 ) * rNoise( uv * 2.3 + 3.0 );
        float band = smoothstep( 0.0, 0.15, vUv.y ) * smoothstep( 1.0, 0.8, vUv.y );
        float v = pow( w * 2.2, 3.0 ) * 0.18 * band * uLevel;
        gl_FragColor = vec4( vec3( 0.85, 0.9, 1.0 ) * v, 1.0 );
      }
    `,
    { uLevel: { value: 1 } },
    { side: BackSide }
  );

  useFrame(({ clock }) => {
    // Only once the camera is inside the shaft: seen from outside, the haze
    // reads as vertical streaks down the frame.
    const f = levels.current.f;
    const level = smooth(0.12, 0.3, f) * (1 - smooth(FALL_PAST_LAST - 0.04, FALL_PAST_LAST + 0.1, f));
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uLevel.value = level;
    if (ref.current) ref.current.visible = level > 0.001;
  });

  return (
    <mesh ref={ref} position={[0, (SHAFT_TOP + SHAFT_BOTTOM) / 2, 0]} material={material} frustumCulled={false}>
      <cylinderGeometry args={[1.6, 1.6, SHAFT_TOP - SHAFT_BOTTOM, 64, 1, true]} />
    </mesh>
  );
}

const DRIFT_LOW = SHAFT_BOTTOM - 0.5;
const DRIFT_SPAN = 2 - DRIFT_LOW;

/** Specks rising up the shaft, so the fall has something to measure speed by. */
export function Drift({ count = 600 }) {
  const gl = useThree((s) => s.gl);

  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    const p = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 1.45;
      p[i * 3] = Math.cos(a) * r;
      p[i * 3 + 1] = DRIFT_LOW + Math.random() * DRIFT_SPAN;
      p[i * 3 + 2] = Math.sin(a) * r;
    }
    g.setAttribute('position', new BufferAttribute(p, 3));
    return g;
  }, [count]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: 1 },
          uLow: { value: DRIFT_LOW },
          uSpan: { value: DRIFT_SPAN },
        },
        vertexShader: /* glsl */ `
          uniform float uTime, uPixelRatio, uLow, uSpan;
          varying float vAlpha;
          void main() {
            vec3 p = position;
            p.y = mod( p.y - uLow + uTime * 0.25, uSpan ) + uLow;
            p.x += sin( uTime * 0.4 + position.z * 9.0 ) * 0.05;
            vec4 mv = modelViewMatrix * vec4( p, 1.0 );
            gl_Position = projectionMatrix * mv;
            float depth = max( 0.15, -mv.z );
            gl_PointSize = clamp( 3.0 * uPixelRatio / depth, 1.0, 6.0 );
            vAlpha = 0.5 * smoothstep( 9.0, 1.0, depth );
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vAlpha;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            float v = smoothstep( 0.25, 0.0, dot( c, c ) ) * vAlpha;
            gl_FragColor = vec4( vec3( v ), 1.0 );
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    []
  );

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uPixelRatio.value = gl.getPixelRatio();
  });

  return <points geometry={geometry} material={material} frustumCulled={false} />;
}
