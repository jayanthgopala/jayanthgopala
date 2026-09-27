import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector2, Vector3, Vector4 } from 'three';
import { buildTerrainGeometry, TERRAIN_SIZE, WATER_Y } from '../lib/terrain.js';
import { iceMapsFor } from '../lib/baked.js';
import { LOOK, SUN_DIR } from '../lib/lighting.js';
import { reflectPass, revealAt, revealDiscard } from '../lib/reveal.js';
import { SHARED_WIND_GLSL, updateWindState } from '../lib/wind.js';
import { useWorldScroll } from '../scroll/ScrollProvider.jsx';

// Snow, rock, and crack tiling parameters
const SNOW_TILE = 62;
const SNOW_REPEAT = Math.round(TERRAIN_SIZE / SNOW_TILE);

const ROCK_TILE = 20;
const ROCK_REPEAT = Math.round(TERRAIN_SIZE / ROCK_TILE);

const CRACK_TILE = 70;
const CRACK_REPEAT = Math.round(TERRAIN_SIZE / CRACK_TILE);

// Procedural fog noise and FBM for ground mist
const GROUND_FOG_GLSL = `
  float fogHash( vec2 p ) {
    return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
  }

  float fogNoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix(
      mix( fogHash( i ), fogHash( i + vec2( 1.0, 0.0 ) ), u.x ),
      mix( fogHash( i + vec2( 0.0, 1.0 ) ), fogHash( i + vec2( 1.0, 1.0 ) ), u.x ),
      u.y
    );
  }

  float fogFbm( vec2 p ) {
    float v = 0.0;
    float a = 0.5;
    for ( int i = 0; i < 3; i ++ ) {
      v += a * fogNoise( p );
      p *= 2.03;
      a *= 0.5;
    }
    return v / 0.875;
  }
`;

// Ground mist layer constants
const FOG_BASE = LOOK.mist.base;
const FOG_SCALE_HEIGHT = 150.0;
const FOG_GAIN = LOOK.mist.gain;
const FOG_STEPS = 6;
const FOG_WIND_STRETCH = 0.15;
const FOG_WEATHER_SCALE = 1 / 300;
const FOG_WEATHER_MIN = 0.72;
const FOG_WEATHER_MAX = 1.32;
const FOG_DRIFT = [5.5, 1.4];

// Low wisp mist parameters
const FOG_WISP_SCALE = 1 / 140;
const FOG_WISP_DRIFT = [95.0, 10.5];
const FOG_WISP_HEIGHT = LOOK.mist.height;
const FOG_WISP_COLOR = LOOK.mist.color;
const FOG_WISP_DENSITY = LOOK.mist.density;
const FOG_WISP_REACH = 750.0;
const FOG_WISP_STEPS = 9;
const FOG_WISP_FADE = 380.0;
const FOG_WISP_LOW = 0.62;
const FOG_WISP_HIGH = 0.86;

// Wind turbulence settings [frequency, speed, amplitude]
const FOG_TURB_LONG = [0.0042, 0.23, 78.0];
const FOG_TURB_SHORT = [0.0125, 0.51, 26.0];
const FOG_TURB_LIFT = [0.052, 0.74, 14.0];

const FOG_EDDY_RADIUS = 120.0;
const FOG_EDDY_STRENGTH = 34.0;

// Injects world-space position varying into vertex and fragment shaders
const worldSpace = (shader) => {
  shader.uniforms.uReflecting = reflectPass;
  shader.uniforms.uSunDir = { value: new Vector3(...SUN_DIR) };
  shader.uniforms.uHaze = { value: new Vector3(...(LOOK.haze || [0.84, 0.89, 0.95])) };
  shader.uniforms.uMistColor = { value: new Vector3(...LOOK.mist.color) };
  shader.uniforms.uMistMax = { value: LOOK.mist.amount ?? 0.12 };
  shader.uniforms.uHazeAmount = { value: LOOK.hazeAmount ?? 0.28 };
  const alpen = LOOK.alpen.enabled ? LOOK.alpen : { color: [0, 0, 0], intensity: 0 };
  shader.uniforms.uAlpen = { value: new Vector4(...alpen.color, alpen.intensity) };
  // Exposed rock: how much shows and its colour. Looks without the setting
  // show dark rock only where they carry alpenglow, as before.
  shader.uniforms.uRockShow = { value: LOOK.rock.show ?? (LOOK.alpen.enabled ? 1 : 0) };
  shader.uniforms.uRockTone = { value: new Vector3(...(LOOK.rock.tone || [0.052, 0.041, 0.035])) };
  const glacier = LOOK.glacier || { light: [0, 0, 0], deep: [0, 0, 0], amount: 0 };
  shader.uniforms.uGlacierLight = { value: new Vector3(...glacier.light) };
  shader.uniforms.uGlacierDeep = { value: new Vector4(...glacier.deep, glacier.amount) };
  // A frozen fjord keeps the snow at its edge dry; open water soaks it dark.
  shader.uniforms.uWetDark = { value: LOOK.ice ? 0.12 : 0.3 };
  shader.vertexShader = `varying vec3 vFogWorld;
     ${shader.vertexShader}`.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
     vFogWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`
  );

  shader.fragmentShader = `varying vec3 vFogWorld;
     uniform float uTime;
     uniform float uReflecting;
     uniform vec3 uSunDir;
     uniform vec3 uHaze;
     uniform vec3 uMistColor;
     uniform float uMistMax;
     uniform float uHazeAmount;
     uniform vec4 uAlpen;
     uniform float uRockShow;
     uniform vec3 uRockTone;
     uniform vec3 uGlacierLight;
     uniform vec4 uGlacierDeep;
     uniform float uWetDark;
     uniform vec2 uCursorPos;
     uniform float uCursorForce;
     ${GROUND_FOG_GLSL}
     ${SHARED_WIND_GLSL}
     ${shader.fragmentShader}`;
};

// Binds secondary rock and crack textures to shader uniforms
const rockMaps = (shader, maps, scale, relief, crackScale) => {
  shader.uniforms.uRockMap = { value: maps.colorMap };
  shader.uniforms.uRockRough = { value: maps.roughnessMap };
  shader.uniforms.uRockNormal = { value: maps.normalMap };
  shader.uniforms.uRockScale = { value: scale };
  shader.uniforms.uRockRelief = { value: relief };
  shader.uniforms.uRockLow = { value: maps.patchStops.p35 };
  shader.uniforms.uRockHigh = { value: maps.patchStops.p88 };
  shader.uniforms.uGlazeLow = { value: maps.patchStops.p05 };
  shader.uniforms.uGlazeHigh = { value: maps.patchStops.p20 };
  shader.uniforms.uRockLowRelief = { value: maps.reliefStops.p25 };
  shader.uniforms.uRockHighRelief = { value: maps.reliefStops.p75 };
  shader.uniforms.uCrackScale = { value: crackScale };
  shader.uniforms.uRockSlope = { value: new Vector2(LOOK.rock.slope[0], LOOK.rock.slope[1]) };
  shader.uniforms.uRockZone = { value: new Vector2(LOOK.rock.zone[0], LOOK.rock.zone[1]) };

  shader.fragmentShader = `uniform sampler2D uRockMap;
     uniform sampler2D uRockRough;
     uniform sampler2D uRockNormal;
     uniform float uRockScale;
     uniform float uRockRelief;
     uniform float uRockLow;
     uniform float uRockHigh;
     uniform float uGlazeLow;
     uniform float uGlazeHigh;
     uniform float uRockLowRelief;
     uniform float uRockHighRelief;
     uniform float uCrackScale;
     uniform vec2 uRockSlope;
     uniform vec2 uRockZone;
     ${shader.fragmentShader}`;
};

// Raymarched ground fog and valley mist
const groundFog = (shader, windUniforms) => {
  shader.uniforms.uTime = windUniforms.uTime;
  shader.uniforms.uCursorPos = windUniforms.uCursorPos;
  shader.uniforms.uCursorForce = windUniforms.uCursorForce;

  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <fog_fragment>',
    `if ( uReflecting < 0.5 ) {
       vec3 toFrag = vFogWorld - cameraPosition;
       float dist = length( toFrag );
       vec3 dir = toFrag / max( dist, 1e-4 );

       // Jitter first step to avoid banding
       float jitter = fogHash( gl_FragCoord.xy );

       // Domain compression along dominant wind axis
       const vec2 windAxis = vec2( ${FOG_WIND_STRETCH.toFixed(3)}, 1.0 );

       // Raymarching through mist volume
       float reach = min( dist, 1100.0 );
       // Few steps, jittered per pixel: each one is three wind warps and a
       // gust, and the loop is unrolled when the shader compiles.
       const int STEPS = 10;
       float dw = reach / float( STEPS );
       float totalFog = 0.0;

       for ( int i = 0; i < STEPS; i ++ ) {
         float t = ( float( i ) + jitter ) * dw;
         vec3 p = cameraPosition + dir * t;

         // Fast near-ground wisps
         float speedNear = 1.65;
         vec2 warpNear = evaluateWindWarp( p, uTime, speedNear, uCursorPos, uCursorForce );
         vec2 qNear = ( p.xz + warpNear + SHARED_WIND_DIR * ( uTime * SHARED_WIND_SPEED * speedNear ) ) * 0.0065 * windAxis;
         float nNear = smoothstep( 0.35, 0.72, fogNoise( qNear ) );
         float hNear = exp( -max( p.y - ${FOG_BASE.toFixed(1)}, 0.0 ) / 32.0 );
         float fadeNear = smoothstep( 12.0, 42.0, t ) * ( 1.0 - smoothstep( 220.0, 480.0, t ) );

         // Midground valley mist
         float speedMid = 0.95;
         vec2 warpMid = evaluateWindWarp( p, uTime, speedMid, uCursorPos, uCursorForce );
         vec2 qMid = ( p.xz + warpMid + SHARED_WIND_DIR * ( uTime * SHARED_WIND_SPEED * speedMid ) ) * 0.0030 * windAxis;
         float nMid = smoothstep( 0.30, 0.68, fogNoise( qMid ) );
         float hMid = exp( -max( p.y - ${FOG_BASE.toFixed(1)}, 0.0 ) / 48.0 );
         float fadeMid = smoothstep( 50.0, 140.0, t ) * ( 1.0 - smoothstep( 550.0, 850.0, t ) );

         // Distant mountain pass mist
         float speedFar = 0.45;
         vec2 warpFar = evaluateWindWarp( p, uTime, speedFar, uCursorPos, uCursorForce );
         vec2 qFar = ( p.xz + warpFar + SHARED_WIND_DIR * ( uTime * SHARED_WIND_SPEED * speedFar ) ) * 0.0016 * windAxis;
         float nFar = smoothstep( 0.28, 0.65, fogNoise( qFar ) );
         float hFar = exp( -max( p.y - ${FOG_BASE.toFixed(1)}, 0.0 ) / 65.0 );
         float fadeFar = smoothstep( 180.0, 380.0, t ) * ( 1.0 - smoothstep( 850.0, 1150.0, t ) );

         // Gusts carry more snow through the near and middle air.
         float gust = sharedGust( p.xz, uTime );
         float stepMist = nNear * 1.45 * fadeNear * hNear * ( 0.6 + 1.6 * gust )
                        + nMid  * 1.25 * fadeMid  * hMid * ( 0.8 + 0.8 * gust )
                        + nFar  * 0.90 * fadeFar  * hFar;
         float dDome = length( p.xz - vec2( -30.0, 252.0 ) ) - 23.0;
         float iglooClearance = smoothstep( 2.0, 16.0, dDome );
         totalFog += stepMist * iglooClearance;
       }

       float mist = clamp( totalFog * 0.024, 0.0, uMistMax );
       vec3 mistColor = uMistColor;
       gl_FragColor.rgb = mix(
         gl_FragColor.rgb,
         mistColor,
         mist
       );
     }`
  );
};

// Blends snow, scree, rock, and distance transitions
const screeAndSnow = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <normal_fragment_maps>',
    `#include <normal_fragment_maps>

     float snowDist = length( vViewPosition );
     float snowFade = 1.0 - smoothstep( 140.0, 620.0, snowDist );
     float grainFade = 1.0 - smoothstep( 520.0, 1800.0, snowDist );

     // Transition into rock zones at distance
     float rockZone = smoothstep( uRockZone.x, uRockZone.y, snowDist );
     normal = normalize( mix( normalize( vNormal ), normal, snowFade ) );

     // Slope calculations for snow settling
     vec3 wGeo = inverseTransformDirection( normalize( vNormal ), viewMatrix );
     float lying = smoothstep( 0.45, 0.95, wGeo.y );
     float relief = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
     float patchy = mix( 0.35, 1.0, smoothstep( 0.30, 0.62, relief ) );

     // Multi-frequency noise for exposed ridges and slopes
     float hillBed = fogFbm( vFogWorld.xz * 0.0065 );
     float hillFig = fogFbm( vFogWorld.xz * 0.0190 );
     float hillSlope = 1.0 - smoothstep( 0.86, 0.985, wGeo.y );

     float hillBare = 1.0 - smoothstep(
       0.360, 0.435,
       hillBed * 0.66 + hillFig * 0.34 - hillSlope * 0.09
     );
     float hillRock = hillBare * rockZone;
     float lay = lying * patchy;

     // Base snow color with soft directional sun brightening
     diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.930, 0.955, 0.985 ), lay * 0.45 );
     float sunFace = clamp( dot( wGeo, uSunDir ), 0.0, 1.0 );
     diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 1.0 ), smoothstep( 0.30, 0.92, sunFace ) * 0.22 );
     roughnessFactor = 0.96;

     // Bare rock masking on steep faces
     float bare = ( 1.0 - smoothstep( uRockSlope.x, uRockSlope.y, wGeo.y ) ) * patchy * rockZone;
     float bareFade = 1.0 - smoothstep( 1000.0, 1600.0, snowDist );
     float paintedRock = clamp( hillRock * 1.15 + bare * 0.25, 0.0, 1.0 ) * bareFade;

     // Sample rock maps and reconstruct height field
     vec2 rockUv = vNormalMapUv * uRockScale;
     vec3 rockAlbedo = texture2D( uRockMap, rockUv ).rgb;
     vec2 rockData = texture2D( uRockRough, rockUv ).rg;
     float rockRough = rockData.g;
     float rockPatch = rockData.r;
     float rockH = clamp( ( rockRough - 0.40 ) / 0.55, 0.0, 1.0 );

     // Outcrop bed distribution
     float veins = fogFbm( vFogWorld.xz * 0.0034 );
     float beds = fogFbm( vFogWorld.xz * 0.0130 );
     float outcrop = clamp(
       smoothstep( 0.38, 0.72, veins ) * 0.72 + smoothstep( 0.42, 0.78, beds ) * 0.46,
       0.0, 1.0
     );

     float exposed = smoothstep( uRockLow, uRockHigh, rockPatch );
     float glazed = 1.0 - smoothstep( uGlazeLow, uGlazeHigh, rockPatch );
     exposed *= mix( 0.55, 1.0, smoothstep( uRockLowRelief, uRockHighRelief, rockH ) );

     float stone = clamp( bare * 1.05 + outcrop * 0.42, 0.0, 1.0 ) * grainFade * rockZone;
     float body = stone * exposed;
     float crust = stone * glazed;

     // Foreground snow surface detail and wind scour
     float nearZone = 1.0 - smoothstep( 140.0, 320.0, snowDist );
     float nearDrift = fogFbm( vFogWorld.xz * 0.014 );
     float nearPatches = fogFbm( vFogWorld.xz * 0.038 );
     float nearFormations = smoothstep( 0.32, 0.70, nearDrift * 0.65 + nearPatches * 0.35 );

     float scour = fogFbm( vec2( vFogWorld.x * 0.0035 + vFogWorld.z * 0.0015,
                                 vFogWorld.z * 0.045 - vFogWorld.x * 0.018 ) );

     diffuseColor.rgb *= mix( 0.84, 1.06, nearFormations * nearZone );
     diffuseColor.rgb *= mix( 0.92, 1.05, scour * nearZone );
     roughnessFactor = mix( roughnessFactor, 0.84, nearFormations * nearZone * 0.35 );

     // Subtle alpine blue-gray shading on steep couloirs
     diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.68, 0.74, 0.82 ), bare * 0.35 * bareFade );

     // Dark rock breaking through the snow on the ranges' steep faces, only
     // where the look asks for it (the alpenglow looks carry exposed rock).
     // Dark, warm-brown stone; the crag map only varies it, since the map
     // itself is pale ice-rock and would read as more snow in the dusk light.
     float rockGrain = dot( rockAlbedo, vec3( 0.299, 0.587, 0.114 ) );
     vec3 rockTone = uRockTone * ( 0.55 + 0.9 * rockGrain );
     // The far ranges are past the detail fades above, so their rock comes
     // from slope and height alone, broken up so ribs and buttresses show.
     float steepFace = 1.0 - smoothstep( 0.42, 0.62, wGeo.y );
     float rangeHigh = smoothstep( 30.0, 90.0, vFogWorld.y );
     float ribs = smoothstep( 0.46, 0.6, hillBed * 0.5 + hillFig * 0.5 + steepFace * 0.18 );
     float rangeRock = steepFace * rangeHigh * ribs * rockZone;
     float rockShow = clamp( max( paintedRock * 0.9 + body * 0.55, rangeRock * 1.2 ), 0.0, 0.9 ) * uRockShow;
     // Rocky ranges: dark stone in strata across the steeper faces, snow
     // lying on the ledges between, strongest where the look asks for it.
     float strata = smoothstep( 0.4, 0.62, fogFbm( vec2( vFogWorld.x * 0.016 + vFogWorld.y * 0.03, vFogWorld.z * 0.016 - vFogWorld.y * 0.02 ) ) );
     // (The mesh is coarse this far out, so faces read gentler than they
     // look: anything short of level counts.)
     float ledges = 1.0 - smoothstep( 0.72, 0.94, wGeo.y );
     rockShow = max( rockShow, ledges * strata * rangeHigh * rockZone * 0.95 * uRockShow );
     diffuseColor.rgb = mix( diffuseColor.rgb, rockTone, rockShow );

     // Glacier fronts: the steep lower faces of the ranges are blue ice, not
     // snow, streaked top to bottom where it has cracked and slumped.
     if ( uGlacierDeep.w > 0.0 ) {
       float gSteep = 1.0 - smoothstep( 0.62, 0.88, wGeo.y );
       float gLow = smoothstep( ${WATER_Y.toFixed(1)} + 3.0, ${WATER_Y.toFixed(1)} + 12.0, vFogWorld.y )
                  * ( 1.0 - smoothstep( 140.0, 260.0, vFogWorld.y ) );
       float gFar = smoothstep( 110.0, 240.0, snowDist ) * ( 1.0 - smoothstep( 1400.0, 2000.0, snowDist ) );
       vec2 gAlong = vec2( vFogWorld.x * 0.11 + vFogWorld.z * 0.11, vFogWorld.y * 0.015 );
       float gStreak = fogNoise( gAlong ) * 0.65 + fogNoise( gAlong * vec2( 3.1, 1.7 ) + 4.3 ) * 0.35;
       float glacier = gSteep * gLow * gFar * smoothstep( 0.25, 0.5, gStreak + gSteep * 0.25 ) * uGlacierDeep.w;
       vec3 iceTone = mix( uGlacierDeep.rgb, uGlacierLight, smoothstep( 0.3, 0.85, gStreak ) * 0.65 + sunFace * 0.35 );
       diffuseColor.rgb = mix( diffuseColor.rgb, iceTone, glacier );
       roughnessFactor = mix( roughnessFactor, 0.45, glacier );
       rockShow = max( rockShow, glacier );

       // Steep faces turned from the low sun fall into blue shade; flat snow,
       // which the low sun only grazes anyway, stays white.
       float shadeFace = ( 1.0 - smoothstep( 0.45, 0.95, wGeo.y ) ) * ( 1.0 - smoothstep( 0.0, 0.45, sunFace ) );
       diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.88, 0.93, 1.03 ), shadeFace );
     }

     // Alpenglow: sunlit slopes high on the ranges take the low sun's colour.
     float alpenHigh = smoothstep( 45.0, 260.0, vFogWorld.y );
     diffuseColor.rgb += uAlpen.rgb * uAlpen.w * smoothstep( 0.15, 0.85, sunFace ) * alpenHigh * ( 1.0 - rockShow * 0.6 );

     // The waterline: snow soaked dark just above the surface, and the short
     // drop of the shelf edge showing as blue ice rather than snow.
     float aboveWater = vFogWorld.y - ${WATER_Y.toFixed(1)};
     float wet = 1.0 - smoothstep( 0.0, 1.8, aboveWater );
     float iceEdge = ( 1.0 - smoothstep( 0.55, 0.9, wGeo.y ) ) * ( 1.0 - smoothstep( 0.8, 4.5, aboveWater ) );
     diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.50, 0.70, 0.86 ), iceEdge * 0.7 );
     diffuseColor.rgb *= 1.0 - uWetDark * wet;
     roughnessFactor = mix( roughnessFactor, 0.35, max( wet, iceEdge * 0.6 ) );

     // Snow crystals glinting near the eye (each from its own angle, so they
     // twinkle as the view moves), and the hollows between drifts in blue shade.
     float glint = step( 0.992, fogHash( floor( vFogWorld.xz * 6.0 ) + floor( normalize( vViewPosition ).xy * 24.0 ) ) );
     diffuseColor.rgb += vec3( 1.0, 0.96, 0.88 ) * glint * nearZone * lay * 1.2;
     diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.84, 0.9, 1.0 ), ( 1.0 - smoothstep( 0.3, 0.62, nearDrift ) ) * nearZone * 0.8 );

     // Atmospheric depth haze on distant mountains
     float distHaze = smoothstep( 280.0, 1400.0, snowDist ) * uHazeAmount;
     diffuseColor.rgb = mix( diffuseColor.rgb, uHaze, distHaze );

     normal = normalize( normal );`
  );
};

// Discards fragments outside expanding reveal front
const slabReveal = (shader, uReveal) => {
  shader.uniforms.uReveal = uReveal;
  shader.fragmentShader = `uniform float uReveal;
     ${shader.fragmentShader}`.replace(
    /\}\s*$/,
    `${revealDiscard('vFogWorld')}
   }`
  );
};

export default function Terrain() {
  const geometry = useMemo(() => buildTerrainGeometry(512, -300), []);
  const snow = useMemo(() => iceMapsFor('snow', SNOW_REPEAT), []);
  const rock = useMemo(() => iceMapsFor('crag'), []);

  const uTime = useRef({ value: 0 });
  const uCursorPos = useRef({ value: new Vector2(-30, 252) });
  const uCursorForce = useRef({ value: 0 });
  const uReveal = useRef({ value: 0 });
  const meshRef = useRef(null);
  const { intro } = useWorldScroll();

  useFrame((state, delta) => {
    const ws = updateWindState(state, delta);
    uTime.current.value = ws.time;
    uCursorPos.current.value.copy(ws.cursorPos);
    uCursorForce.current.value = ws.cursorForce;

    if (uReveal.current.value < 1) {
      uReveal.current.value = revealAt(intro.current);
    }
  });

  const onCompile = useMemo(
    () => (shader) => {
      worldSpace(shader);
      rockMaps(shader, rock, ROCK_REPEAT / SNOW_REPEAT, 3.0, CRACK_REPEAT / SNOW_REPEAT);
      screeAndSnow(shader);
      groundFog(shader, {
        uTime: uTime.current,
        uCursorPos: uCursorPos.current,
        uCursorForce: uCursorForce.current,
      });
      slabReveal(shader, uReveal.current);
    },
    [rock]
  );

  return (
    <mesh ref={meshRef} geometry={geometry} receiveShadow castShadow={false} frustumCulled={false}>
      <meshStandardMaterial
        color="#eef4fa"
        roughness={0.96}
        metalness={0}
        map={snow.colorMap}
        envMapIntensity={0.65}
        roughnessMap={snow.roughnessMap}
        normalMap={snow.normalMap}
        normalScale={[LOOK.snow.normalScale, LOOK.snow.normalScale]}
        onBeforeCompile={onCompile}
      />
    </mesh>
  );
}
