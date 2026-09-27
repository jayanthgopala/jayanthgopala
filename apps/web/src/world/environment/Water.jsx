import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  ClampToEdgeWrapping,
  Color,
  SRGBColorSpace,
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
import { TERRAIN_CENTER_Z, TERRAIN_SIZE, WATER_Y, groundAt } from '../lib/terrain.js';
import { LOOK, SUN_DIR } from '../lib/lighting.js';
import { reflectPass, revealAt, revealDiscard } from '../lib/reveal.js';
import { useWorldScroll } from '../scroll/ScrollProvider.jsx';
import { BOAT_BEAM, BOAT_LENGTH, LEAD, boatPose } from '../lib/dock.js';

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
      const depth = WATER_Y - groundAt(x0 + i * step, z0 + j * step);
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

// Mirror resolution against the drawing buffer. The ripples and the frosted
// ice soften the image anyway, so a small mirror costs little in look.
const REFLECTION_SCALE = 0.5;

const WATER = LOOK.water || {
  deep: [0.035, 0.085, 0.14],
  shallow: [0.16, 0.32, 0.4],
  reflect: 0.9,
};

// What the mirror shows where nothing is drawn: the sky straight overhead.
const MIRROR_CLEAR = new Color().setRGB(...LOOK.sky.zenith.map((c) => c / 255), SRGBColorSpace);

// Ice over the fjord, when the look freezes it.
const ICE = LOOK.ice || null;

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
    uFrozen: { value: 0 },
    uLead: { value: LEAD.map(([x, z, r]) => new Vector3(x, z, r)) },
    uIce: { value: new Color() },
    uIceDeep: { value: new Color() },
    uSnow: { value: new Color() },
    uIceReflect: { value: 0.6 },
    // The boat's centre (x, z) and heading (cos, sin of its yaw).
    uBoat: { value: new Vector4(0, 0, 1, 0) },
    // How hard the yacht is running, 0 at rest to 1 flat out: its wake.
    uWake: { value: 0 },
    uZenith: { value: MIRROR_CLEAR },
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
    #define LEAD_N ${LEAD.length}
    #define HALF_L ${(BOAT_LENGTH / 2).toFixed(2)}
    #define HALF_B ${(BOAT_BEAM / 2).toFixed(2)}

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
    uniform float uFrozen;
    uniform vec3 uLead[ LEAD_N ];
    uniform vec3 uIce;
    uniform vec3 uIceDeep;
    uniform vec3 uSnow;
    uniform float uIceReflect;
    uniform vec4 uBoat;
    uniform float uWake;
    uniform vec3 uZenith;

    // Looked down on steeply, water mirrors the sky straight overhead, and
    // there the planar mirror is unreliable (its image of the sky can drop
    // out, leaving flat white), so the reflection eases over to that sky.
    vec3 steepSky( vec3 reflected, vec3 V ) {
      return mix( reflected, uZenith, smoothstep( 0.55, 0.85, V.y ) );
    }

    varying vec4 vMirror;
    varying vec3 vWorld;

    float hash( vec2 p ) {
      return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
    }

    vec2 hash2( vec2 p ) {
      p = vec2( dot( p, vec2( 127.1, 311.7 ) ), dot( p, vec2( 269.5, 183.3 ) ) );
      return fract( sin( p ) * 43758.5453 );
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

    // Distance to the nearest edge between jittered cells: where sheet ice
    // has cracked into plates.
    float plates( vec2 p ) {
      vec2 n = floor( p );
      vec2 f = fract( p );
      vec2 mg = vec2( 0.0 );
      vec2 mr = vec2( 0.0 );
      float md = 8.0;
      for ( int j = -1; j <= 1; j ++ ) {
        for ( int i = -1; i <= 1; i ++ ) {
          vec2 g = vec2( float( i ), float( j ) );
          vec2 r = g + hash2( n + g ) - f;
          float d = dot( r, r );
          if ( d < md ) {
            md = d;
            mr = r;
            mg = g;
          }
        }
      }
      md = 8.0;
      for ( int j = -1; j <= 1; j ++ ) {
        for ( int i = -1; i <= 1; i ++ ) {
          vec2 g = mg + vec2( float( i ), float( j ) );
          vec2 r = g + hash2( n + g ) - f;
          vec2 e = r - mr;
          if ( dot( e, e ) > 1e-5 ) md = min( md, dot( 0.5 * ( mr + r ), normalize( e ) ) );
        }
      }
      return md;
    }

    // A crack line of about the given width in cell units, kept a pixel wide
    // at least so it neither aliases nor vanishes with distance.
    float crackLine( float d, float width ) {
      float aa = fwidth( d );
      // Thinner than a pixel far off: fade it rather than widen it.
      return ( 1.0 - smoothstep( width, width + aa, d ) ) * clamp( width * 2.5 / max( aa, 1e-5 ), 0.0, 1.0 );
    }

    // Distance from a point to one stretch of a line of open water.
    float stretch( vec2 p, vec3 a, vec3 b ) {
      vec2 ba = b.xy - a.xy;
      vec2 pa = p - a.xy;
      float h = clamp( dot( pa, ba ) / dot( ba, ba ), 0.0, 1.0 );
      return length( pa - ba * h ) - mix( a.z, b.z, h );
    }

    // Signed distance to the open water, in world units: the open fjord in
    // front of the island, past a ragged ice edge, and the lead along the
    // dock (openWaterDistance and frontEdgeZ in dock.js).
    float leadDistance( vec2 p ) {
      float d = 296.0 + 8.0 * sin( p.x * 0.045 ) + 5.0 * sin( p.x * 0.11 + 1.3 ) - p.y;
      for ( int i = 0; i < LEAD_N - 1; i ++ ) d = min( d, stretch( p, uLead[ i ], uLead[ i + 1 ] ) );
      return d;
    }

    // Half the yacht's beam at u from transom (-1) to bow (+1): hullHalfWidth in dock.js.
    float hullHalf( float u ) {
      if ( u <= -0.2 ) {
        float k = ( -0.2 - u ) / 0.8;
        return HALF_B * ( 1.0 - 0.14 * k * k );
      }
      float k = ( u + 0.2 ) / 1.2;
      return HALF_B * sqrt( max( 0.0, 1.0 - k * k ) );
    }

    // The yacht's wake, 0..1 foam: the two arms of a Kelvin wake spreading
    // from the stern at about 19 degrees, churned water straight behind it,
    // and the bow wave curling off the forward half of the hull.
    float wakeFoam( vec2 p ) {
      vec2 d = p - uBoat.xy;
      float lx = d.x * uBoat.z - d.y * uBoat.w;
      float lz = d.x * uBoat.w + d.y * uBoat.z;
      float side = abs( lz );
      float behind = -lx - HALF_L;
      float aft = max( behind, 0.0 );
      float astern = smoothstep( -3.0, 1.0, behind );

      float arm = side - HALF_B * 0.8 - 0.35 * aft;
      float arms = exp( -arm * arm / ( 2.0 + aft * 0.06 ) ) * exp( -aft / ( 18.0 + 60.0 * uWake ) );
      float churn = exp( -side * side / ( HALF_B * HALF_B * 0.7 ) ) * exp( -aft / ( 10.0 + 26.0 * uWake ) );

      float u = lx / HALF_L;
      float gap = side - hullHalf( clamp( u, -1.0, 1.0 ) );
      float bow = exp( -gap * gap / 1.6 ) * smoothstep( -0.3, 0.5, u ) * step( abs( u ), 1.0 );

      return ( ( arms * 0.8 + churn ) * astern + bow * 0.7 ) * uWake;
    }

    void main() {
      ${revealDiscard('vWorld')}

      vec3 toEye = cameraPosition - vWorld;
      float dist = length( toEye );
      vec3 V = toEye / dist;
      float near = 1.0 - smoothstep( 60.0, 900.0, dist );

      // Depth under this point: 0 at the shore, 1 at DEPTH_RANGE and beyond.
      vec2 duv = ( vWorld.xz - uDepthRect.xy ) / uDepthRect.zw;
      float depth = texture2D( uDepth, duv ).r;
      float lap = 1.0 - smoothstep( 0.0, 0.05, depth );

      // Open water: all of it, or only the lead once the fjord is frozen.
      float lead = leadDistance( vWorld.xz ) + ( noised( vWorld.xz * 0.32 ).x - 0.5 ) * 1.8;
      float open = uFrozen > 0.5 ? 1.0 - smoothstep( -0.5, 0.5, lead ) : 1.0;

      vec3 waterCol = vec3( 0.0 );
      if ( open > 0.001 ) {
        vec2 sl = slope( vWorld.xz, near ) * mix( 0.35, 1.0, near );
        vec3 N = normalize( vec3( -sl.x, 1.0, -sl.y ) );

        // The mirror image, bent by the ripples. Shallows and the shore band
        // get less bend, as the surface calms against the ice.
        vec4 mirror = vMirror;
        // The bend scales with clip w, so far off it would smear the image
        // into streaks at grazing angles; it calms with distance like the ripples.
        mirror.xy += N.xz * 0.9 * mix( 0.4, 1.0, smoothstep( 0.0, 0.25, depth ) ) * mirror.w * 0.045 * mix( 0.08, 1.0, near );
        vec3 reflected = steepSky( texture2DProj( tDiffuse, mirror ).rgb, V );

        // Schlick, lifted: calm water reflects strongly even from above.
        float cosT = clamp( dot( N, V ), 0.0, 1.0 );
        float fresnel = 0.06 + 0.94 * pow( 1.0 - cosT, 4.0 );
        float reflectance = mix( 0.4, 1.0, fresnel ) * uReflect;

        // Water body: clear green-blue over the shallows, dark blue out deep,
        // lit a little by the sky.
        vec3 body = mix( uShallow, uDeep, smoothstep( 0.0, 0.22, depth ) );
        body *= 0.75 + 0.25 * clamp( dot( N, uSunDir ) * 2.0, 0.0, 1.0 );
        waterCol = mix( body, reflected, reflectance );

        // Sun glitter: only the sparkle on the ripple crests along its path;
        // the sun's own reflection comes from the mirror.
        vec3 H = normalize( V + uSunDir );
        float nh = clamp( dot( N, H ), 0.0, 1.0 );
        waterCol += uSunColor * ( pow( nh, 1400.0 ) * 10.0 + pow( nh, 260.0 ) * 0.25 ) * near;

        // Pale band where the water laps the ice.
        waterCol = mix( waterCol, vec3( 0.62, 0.72, 0.82 ), lap * 0.25 );

        // White water behind and beside the yacht while it runs, broken up
        // so it reads as foam and not paint.
        if ( uWake > 0.001 ) {
          float foam = wakeFoam( vWorld.xz );
          float grain = noised( vWorld.xz * 0.7 + vec2( uTime * 0.3, uTime * 0.1 ) ).x;
          waterCol = mix( waterCol, vec3( 0.9, 0.94, 0.98 ), smoothstep( 0.2, 0.7, foam * ( 0.55 + 0.9 * grain ) ) * 0.9 );
        }
      }

      vec3 iceCol = vec3( 0.0 );
      if ( open < 0.999 ) {
        // Sheet ice: flat but for a faint waviness frozen into it, which is
        // enough to soften what it mirrors.
        vec3 bump = noised( vWorld.xz * 0.09 + 11.0 ) * 0.5 + noised( vWorld.xz * 0.27 - 3.0 ) * 0.25;
        vec3 N = normalize( vec3( -bump.y * 0.05 * near, 1.0, -bump.z * 0.05 * near ) );

        // Big plates split by long cracks, and finer crazing near the eye.
        // Bent, so the cracks wander rather than run straight between cells.
        vec2 bend = vec2( noised( vWorld.xz * 0.05 + 2.0 ).x, noised( vWorld.xz * 0.05 - 6.0 ).x ) - 0.5;
        vec2 plateUv = vWorld.xz / 46.0 + 3.7 + bend * 0.5;
        float wide = plates( plateUv );
        float fineFade = 1.0 - smoothstep( 60.0, 260.0, dist );
        // The fine crazing only near the eye, where it shows.
        float fine = fineFade > 0.0 ? plates( vWorld.xz / 15.0 - 1.9 + bend * 0.9 ) : 1.0;
        float crack = max( crackLine( wide, 0.0045 ), crackLine( fine, 0.006 ) * fineFade * 0.55 );
        // Each plate sits at its own slight tilt, so the mirror breaks at the cracks.
        vec2 tilt = hash2( floor( plateUv ) ) - 0.5;
        N = normalize( N + vec3( tilt.x, 0.0, tilt.y ) * 0.012 * near );

        // A softened mirror: the reflection sampled three ways about the point.
        vec4 mirror = vMirror;
        mirror.xy += N.xz * mirror.w * 0.08;
        float spread = 0.004 * mirror.w * mix( 0.3, 1.0, near );
        vec3 reflected = texture2DProj( tDiffuse, mirror ).rgb * 0.5
          + texture2DProj( tDiffuse, mirror + vec4( spread, spread * 0.4, 0.0, 0.0 ) ).rgb * 0.25
          + texture2DProj( tDiffuse, mirror - vec4( spread * 0.4, spread, 0.0, 0.0 ) ).rgb * 0.25;
        reflected = steepSky( reflected, V );

        float cosT = clamp( dot( N, V ), 0.0, 1.0 );
        float fresnel = 0.04 + 0.96 * pow( 1.0 - cosT, 5.0 );
        float reflectance = mix( 0.42, 1.0, fresnel ) * uIceReflect;

        // Clear blue ice, deeper blue where it is thicker and darker.
        float thick = noised( vWorld.xz * 0.012 + 5.0 ).x * 0.7 + noised( vWorld.xz * 0.05 ).x * 0.3;
        vec3 body = mix( uIceDeep, uIce, smoothstep( 0.25, 0.8, thick ) );
        iceCol = mix( body, reflected, reflectance );

        // The low sun catching the surface along its path.
        vec3 H = normalize( V + uSunDir );
        float nh = clamp( dot( N, H ), 0.0, 1.0 );
        iceCol += uSunColor * ( pow( nh, 2400.0 ) * 6.0 + pow( nh, 180.0 ) * 0.12 ) * near;

        // Snow blown into patches over the ice and banked along the shore;
        // the cracks hold a line of it too.
        // Crisp-edged, as wind-packed snow is, with a ragged fringe.
        float drift = noised( vWorld.xz * 0.028 + 21.0 ).x * 0.6 + noised( vWorld.xz * 0.09 - 8.0 ).x * 0.4
                    + ( noised( vWorld.xz * 0.45 + 1.3 ).x - 0.5 ) * 0.07;
        float edge = 0.01 + fwidth( drift );
        // None blown into the lead's edge, which the slush rim covers.
        float snowy = max( smoothstep( 0.74 - edge, 0.74 + edge, drift ) * smoothstep( 2.0, 10.0, lead ), lap * 0.95 );
        // Brighter where it lies deeper, blue-shadowed where it thins out.
        float deepSnow = smoothstep( 0.74, 0.86, drift );
        vec3 snowCol = uSnow * mix( vec3( 0.84, 0.89, 0.97 ), vec3( 1.02 ), deepSnow )
                     * ( 0.94 + 0.08 * noised( vWorld.xz * 0.8 ).x );
        iceCol = mix( iceCol, vec3( 0.93, 0.96, 1.0 ), crack * 0.75 * ( 1.0 - snowy ) );
        iceCol = mix( iceCol, snowCol, snowy );

        // Frost: tiny crystals, each catching the light from its own angle
        // only, so they glint and go out as the eye moves.
        float crystal = hash( floor( vWorld.xz * 7.0 ) + floor( V.xz * 30.0 ) );
        iceCol += vec3( 1.0, 0.94, 0.84 ) * step( 0.993, crystal ) * fineFade * ( 0.6 + 1.4 * snowy );
      }

      vec3 col = mix( iceCol, waterCol, open );

      // Slush and broken ice rimming the lead.
      if ( uFrozen > 0.5 ) {
        float rim = smoothstep( -1.0, -0.2, lead ) * ( 1.0 - smoothstep( 0.2, 1.4, lead ) );
        col = mix( col, uSnow * 0.9, rim * 0.5 );
      }

      // Far ice and water fade into the same air as the far ranges.
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
    if (ICE) {
      u.uFrozen.value = 1;
      u.uIce.value.setRGB(...ICE.color);
      u.uIceDeep.value.setRGB(...ICE.deep);
      u.uSnow.value.setRGB(...ICE.snow);
      u.uIceReflect.value = ICE.reflect;
    }

    // The mirror draws the scene a second time; flag it so the terrain can
    // skip its raymarched mist, which the ripples would smear out anyway.
    // Its oblique clip plane can also cut away part of the sky's backdrop when
    // the water is looked down on, and what shows through is the clear
    // colour; so for the mirror that is the sky overhead, not white.
    const drawMirror = mirror.onBeforeRender;
    const heldClear = new Color();
    mirror.onBeforeRender = function onBeforeRender(renderer, ...rest) {
      reflectPass.value = 1;
      renderer.getClearColor(heldClear);
      const heldAlpha = renderer.getClearAlpha();
      renderer.setClearColor(MIRROR_CLEAR, 1);
      try {
        drawMirror.call(this, renderer, ...rest);
      } finally {
        reflectPass.value = 0;
        renderer.setClearColor(heldClear, heldAlpha);
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
    u.uBoat.value.set(boatPose.x, boatPose.z, Math.cos(boatPose.yaw), Math.sin(boatPose.yaw));
    u.uWake.value = boatPose.speed;
    // Once the cut has covered the world there is nothing to reflect for; the
    // project page and the ring room never pay for the mirror.
    water.visible = cut.current < 0.999;
  });

  return <primitive object={water} />;
}
