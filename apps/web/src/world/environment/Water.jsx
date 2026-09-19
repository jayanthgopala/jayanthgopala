import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  LinearFilter,
  PlaneGeometry,
  RedFormat,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { TERRAIN_CENTER_Z, TERRAIN_SIZE, WATER_Y, heightAt } from '../lib/terrain.js';
import { LOOK, SUN_DIR } from '../lib/lighting.js';
import { reflectPass, revealAt, revealDiscard } from '../lib/reveal.js';
import { useWorldScroll } from '../scroll/ScrollProvider.jsx';

// The fjord: one mirror at WATER_Y over the whole valley. The terrain rises
// through it wherever there is land, so the shoreline is simply where the two
// meet; this surface only has to look like water where it shows.

// Depth below the surface, for the shallows' colour and the shore band.
const DEPTH_TEX = 512;
const DEPTH_RANGE = 14;

function buildDepthTexture() {
  const n = DEPTH_TEX;
  const data = new Uint8Array(n * n);
  const x0 = -TERRAIN_SIZE / 2;
  const z0 = TERRAIN_CENTER_Z - TERRAIN_SIZE / 2;
  const step = TERRAIN_SIZE / (n - 1);
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const depth = WATER_Y - heightAt(x0 + i * step, z0 + j * step);
      data[j * n + i] = Math.max(0, Math.min(255, Math.round((depth / DEPTH_RANGE) * 255)));
    }
  }
  const tex = new DataTexture(data, n, n, RedFormat, UnsignedByteType);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

// Mirror resolution against the drawing buffer. The ripples smear the image
// anyway, so half size costs little in look and three quarters of the pixels.
const REFLECTION_SCALE = 0.5;

const WATER = LOOK.water || {
  deep: [0.035, 0.085, 0.14],
  shallow: [0.16, 0.32, 0.4],
  reflect: 0.9,
};

const WaterShader = {
  name: 'FjordWater',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uDepth: { value: null },
    uDepthRect: { value: new Vector4() },
    uTime: { value: 0 },
    uSunDir: { value: new Vector3() },
    uSunColor: { value: new Color() },
    uDeep: { value: new Color() },
    uShallow: { value: new Color() },
    uHaze: { value: new Color() },
    uReflect: { value: 0.9 },
    uCalm: { value: 0 },
    uReveal: { value: 0 },
  },

  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vMirror;
    varying vec3 vWorld;

    void main() {
      vMirror = textureMatrix * vec4( position, 1.0 );
      vec4 world = modelMatrix * vec4( position, 1.0 );
      vWorld = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D uDepth;
    uniform vec4 uDepthRect;
    uniform float uTime;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform vec3 uDeep;
    uniform vec3 uShallow;
    uniform vec3 uHaze;
    uniform float uReflect;
    uniform float uCalm;
    uniform float uReveal;

    varying vec4 vMirror;
    varying vec3 vWorld;

    float hash( vec2 p ) {
      return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
    }

    // Value noise with its analytic gradient, so the ripple normal costs one
    // lookup per octave rather than three.
    vec3 noised( vec2 p ) {
      vec2 i = floor( p );
      vec2 f = fract( p );
      vec2 u = f * f * ( 3.0 - 2.0 * f );
      vec2 du = 6.0 * f * ( 1.0 - f );
      float a = hash( i );
      float b = hash( i + vec2( 1.0, 0.0 ) );
      float c = hash( i + vec2( 0.0, 1.0 ) );
      float d = hash( i + vec2( 1.0, 1.0 ) );
      return vec3(
        a + ( b - a ) * u.x + ( c - a ) * u.y + ( a - b - c + d ) * u.x * u.y,
        du * ( vec2( b - a, c - a ) + ( a - b - c + d ) * u.yx )
      );
    }

    // Slope of the surface: long swells crossing, and a finer chop drifting
    // with the wind, both fading with distance so the far water stays glassy
    // instead of shimmering.
    vec2 slope( vec2 p, float fade ) {
      float t = uTime * ( 1.0 - uCalm );
      vec2 s = vec2( 0.0 );
      s += noised( p * 0.045 + vec2( t * 0.05, t * 0.02 ) ).yz * 0.045 * 0.55;
      s += noised( mat2( 0.8, -0.6, 0.6, 0.8 ) * p * 0.11 - vec2( t * 0.09, -t * 0.04 ) ).yz * 0.11 * 0.28;
      s += noised( mat2( 0.6, 0.8, -0.8, 0.6 ) * p * 0.31 + vec2( t * 0.21, t * 0.13 ) ).yz * 0.31 * 0.09 * fade;
      s += noised( p * 0.83 - vec2( t * 0.38, t * 0.26 ) ).yz * 0.83 * 0.03 * fade;
      return s;
    }

    void main() {
      ${revealDiscard('vWorld')}

      vec3 toEye = cameraPosition - vWorld;
      float dist = length( toEye );
      vec3 V = toEye / dist;

      float near = 1.0 - smoothstep( 60.0, 900.0, dist );
      vec2 sl = slope( vWorld.xz, near ) * mix( 0.35, 1.0, near );
      vec3 N = normalize( vec3( -sl.x, 1.0, -sl.y ) );

      // Depth under this point: 0 at the shore, 1 at DEPTH_RANGE and beyond.
      vec2 duv = ( vWorld.xz - uDepthRect.xy ) / uDepthRect.zw;
      float depth = texture2D( uDepth, duv ).r;

      // The mirror image, bent by the ripples. Shallows and the shore band get
      // less bend, as the surface calms against the ice.
      vec4 mirror = vMirror;
      mirror.xy += N.xz * 0.9 * mix( 0.4, 1.0, smoothstep( 0.0, 0.25, depth ) ) * mirror.w * 0.045;
      vec3 reflected = texture2DProj( tDiffuse, mirror ).rgb;

      // Schlick, lifted: calm dusk water reflects strongly even from above.
      float cosT = clamp( dot( N, V ), 0.0, 1.0 );
      float fresnel = 0.06 + 0.94 * pow( 1.0 - cosT, 4.0 );
      float reflectance = mix( 0.4, 1.0, fresnel ) * uReflect;

      // Water body: clear green-blue over the shallows, dark blue out deep,
      // lit a little by the sky.
      vec3 body = mix( uShallow, uDeep, smoothstep( 0.0, 0.22, depth ) );
      body *= 0.75 + 0.25 * clamp( dot( N, uSunDir ) * 2.0, 0.0, 1.0 );

      vec3 col = mix( body, reflected, reflectance );

      // Sun glitter: a tight core and a wider sparkle path toward the eye.
      vec3 H = normalize( V + uSunDir );
      float nh = clamp( dot( N, H ), 0.0, 1.0 );
      // The sun's own reflection comes from the mirror; this only adds the
      // sparkle on the ripple crests along its path.
      float glint = pow( nh, 1400.0 ) * 10.0 + pow( nh, 260.0 ) * 0.25;
      col += uSunColor * glint * near;

      // Pale band where the water laps the ice.
      float lap = 1.0 - smoothstep( 0.0, 0.05, depth );
      col = mix( col, vec3( 0.62, 0.72, 0.82 ), lap * 0.25 );

      // Far water fades into the same air as the far ranges.
      col = mix( col, uHaze, smoothstep( 500.0, 2200.0, dist ) * 0.45 );

      gl_FragColor = vec4( col, 1.0 );

      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
};

export default function Water() {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const { cut, intro } = useWorldScroll();
  const calm = useRef(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  const depthTexture = useMemo(() => buildDepthTexture(), []);

  const water = useMemo(() => {
    const geometry = new PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE);
    const mirror = new Reflector(geometry, {
      shader: WaterShader,
      textureWidth: 512,
      textureHeight: 512,
      clipBias: 0.002,
      multisample: 0,
    });
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.set(0, WATER_Y, TERRAIN_CENTER_Z);
    mirror.frustumCulled = false;
    mirror.name = 'fjord';

    const u = mirror.material.uniforms;
    u.uDepth.value = depthTexture;
    u.uDepthRect.value.set(
      -TERRAIN_SIZE / 2,
      TERRAIN_CENTER_Z - TERRAIN_SIZE / 2,
      TERRAIN_SIZE,
      TERRAIN_SIZE
    );
    u.uSunDir.value.set(...SUN_DIR).normalize();
    u.uSunColor.value.setRGB(...(LOOK.sunColor || [255, 240, 220]).map((c) => c / 255)).multiplyScalar(1.6);
    u.uDeep.value.setRGB(...WATER.deep);
    u.uShallow.value.setRGB(...WATER.shallow);
    u.uHaze.value.setRGB(...(LOOK.haze || [0.84, 0.89, 0.95]));
    u.uReflect.value = WATER.reflect;
    u.uCalm.value = calm.current ? 1 : 0;

    // The mirror draws the scene a second time; flag it so the terrain can
    // skip its raymarched mist, which the ripples would smear out anyway.
    const drawMirror = mirror.onBeforeRender;
    mirror.onBeforeRender = function onBeforeRender(...args) {
      reflectPass.value = 1;
      try {
        drawMirror.apply(this, args);
      } finally {
        reflectPass.value = 0;
      }
    };

    return mirror;
  }, [depthTexture]);

  // Keep the mirror at a fixed fraction of the drawing buffer.
  useEffect(() => {
    const buffer = gl.getDrawingBufferSize(new Vector2());
    water
      .getRenderTarget()
      .setSize(
        Math.max(2, Math.round(buffer.x * REFLECTION_SCALE)),
        Math.max(2, Math.round(buffer.y * REFLECTION_SCALE))
      );
  }, [gl, size, water]);

  useEffect(
    () => () => {
      water.dispose();
      water.geometry.dispose();
      depthTexture.dispose();
    },
    [water, depthTexture]
  );

  useFrame((state) => {
    const u = water.material.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uReveal.value = revealAt(intro.current);
    // Once the cut has covered the world there is nothing to reflect for; the
    // project page and the ring room never pay for the mirror.
    water.visible = cut.current < 0.999;
  });

  return <primitive object={water} />;
}
