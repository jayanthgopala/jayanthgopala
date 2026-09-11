import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  ClampToEdgeWrapping,
  DataTexture,
  DoubleSide,
  LinearFilter,
  NormalBlending,
  PlaneGeometry,
  RGFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
} from 'three';
import { MOUND_AT, TERRAIN_SIZE, TERRAIN_CENTER_Z, heightAt } from '../lib/terrain.js';
import { LOOK } from '../lib/lighting.js';
import { SHARED_WIND_GLSL, updateWindState } from '../lib/wind.js';

/**
 * COLD ARCTIC VALLEY MIST
 *
 * WHY THE WEATHER WAS INVISIBLE, AND WHY THE FIX IS NOT "MORE OPACITY".
 *
 * The mist was drawn every frame and could not be seen. Its fragment shader
 * built alpha as a chain of eight multiplied masks — cutoff curve, pow, leading
 * edge, region gate, foreground gate, altitude, valley, slope — and only THEN
 * multiplied by uLayerOpacity. Every term is below one, so they compounded: the
 * midground layer, the strongest of the three, peaked near 0.002. That is below
 * the threshold of vision on any display.
 *
 * The instinct is to raise uLayerOpacity until something shows, and that is the
 * wrong repair. It produces the failure this rewrite is written against — flat
 * translucent bands laid over the picture, uniform fog, a white overlay. Mist
 * that is visible because it is DENSE reads as a texture on the lens. Mist that
 * is visible because it is LOCALISED reads as air.
 *
 * So the alpha chain is restructured into exactly four terms, each of which
 * reaches a true 1.0 somewhere in the frame:
 *
 *   alpha = shape * valley * region * depth * uLayerOpacity
 *
 *   shape   the noise field, saturating so cores actually reach one
 *   valley  where the land is BELOW its surroundings; zero on every crest
 *   region  which patches of air are carrying mist at all; zero elsewhere
 *   depth   the distance band this layer occupies; zero outside it
 *
 * Three of those are hard gates with no floor, which is what leaves large areas
 * of snow completely clean. Because they saturate rather than merely attenuate,
 * uLayerOpacity now means exactly what its name says — the peak alpha of the
 * layer — and it can therefore stay in the 0.07-0.20 range the look needs
 * instead of being pushed up to compensate for arithmetic.
 *
 * VALLEYS ARE FOUND BY COMPARISON, NOT BY ALTITUDE. An earlier attempt gated on
 * absolute ground height, which is wrong twice over: it puts mist across every
 * low plain including the clean foreground, and it strips it from a genuine col
 * high between two peaks — the one place the reference most wants it. The
 * height texture now carries a second channel holding the same field blurred
 * over ~160 world units, and the mist keys on the DIFFERENCE. Ground below its
 * own neighbourhood is a depression and holds mist; ground above it is a crest
 * and cannot, so a bank fades out as it climbs a shoulder rather than draping
 * over it.
 *
 * NO SNOW PARTICLES. A sprite-based blowing-snow pass was built here and then
 * removed, and this is the record so it does not come back a third time. It is
 * the obvious way to make wind visible and it is the wrong one for this shot:
 * against sunlit snow that is already near white, grains have no contrast to
 * spend, so they have to be made large and dense before they register — at
 * which point they read as particles laid over the frame rather than as
 * weather in it. Sizing them down to look physical puts them back below a
 * pixel. There is no setting between those two that is good, which is the same
 * conclusion LOOK.particles records.
 *
 * The movement in this scene comes from the mist alone: three layers at
 * different depths, speeds and noise scales, so the middle ground travels
 * visibly against a near ground and a far ground that barely move. Parallax
 * between the layers is what reads as wind — not objects crossing the frame.
 */

/* ─── Height texture: R = ground, G = ground blurred over ~160 units ──── */

const HEIGHT_TEX = 256;
const HEIGHT_MAX = 720;

/** World units per texel — needed for the terrain normal in the shader. */
const TEXEL_WORLD = TERRAIN_SIZE / (HEIGHT_TEX - 1);

/**
 * Blur radius in texels for the regional reference height.
 *
 * This number IS the definition of "valley" in this scene. Too small and every
 * ripple in the drift surface reads as a depression, which scatters mist evenly
 * and gives back the uniform fog. Too large and the reference approaches the
 * global mean, which collapses back into gating on absolute altitude. Sixteen
 * texels is about 163 world units, which is the width of the hollows the
 * terrain actually builds between its mounds.
 */
const BLUR_RADIUS = 16;

function buildHeightTexture() {
  const n = HEIGHT_TEX;
  const raw = new Float32Array(n * n);
  const x0 = -TERRAIN_SIZE / 2;
  const z0 = TERRAIN_CENTER_Z - TERRAIN_SIZE / 2;
  const step = TERRAIN_SIZE / (n - 1);

  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      raw[j * n + i] = heightAt(x0 + i * step, z0 + j * step);
    }
  }

  // Separable box blur, clamped at the edges. Two 1D passes rather than one 2D
  // kernel: 33x33 per texel would be a million samples per row.
  const tmp = new Float32Array(n * n);
  const blur = new Float32Array(n * n);
  const span = BLUR_RADIUS * 2 + 1;

  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      let sum = 0;
      for (let k = -BLUR_RADIUS; k <= BLUR_RADIUS; k += 1) {
        const s = Math.max(0, Math.min(n - 1, i + k));
        sum += raw[j * n + s];
      }
      tmp[j * n + i] = sum / span;
    }
  }
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      let sum = 0;
      for (let k = -BLUR_RADIUS; k <= BLUR_RADIUS; k += 1) {
        const s = Math.max(0, Math.min(n - 1, j + k));
        sum += tmp[s * n + i];
      }
      blur[j * n + i] = sum / span;
    }
  }

  const data = new Uint8Array(n * n * 2);
  for (let i = 0; i < n * n; i += 1) {
    data[i * 2 + 0] = Math.max(0, Math.min(255, Math.round((raw[i] / HEIGHT_MAX) * 255)));
    data[i * 2 + 1] = Math.max(0, Math.min(255, Math.round((blur[i] / HEIGHT_MAX) * 255)));
  }

  const tex = new DataTexture(data, n, n, RGFormat, UnsignedByteType);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Direction TO the sun, from the key light the rest of the scene uses. */
const SUN_DIR = new Vector3(...LOOK.key.position).normalize();

/* ─── Mist vertex shader ──────────────────────────────────────────────── */

const MIST_VERT = /* glsl */ `
  uniform sampler2D uHeight;
  uniform vec2 uTerrainOrigin;
  uniform vec2 uTerrainSize;
  uniform vec3 uSunDir;
  uniform float uTime;
  uniform float uLayerHeight;
  uniform float uLayerSpeed;
  uniform float uSeed;

  varying vec3 vWorldPos;
  varying vec2 vUv;
  varying float vDepression;
  varying float vSunFacing;
  varying float vRelH;

  void main() {
    vUv = uv;
    vec4 worldP = modelMatrix * vec4( position, 1.0 );

    vec2 huv = ( worldP.xz - uTerrainOrigin ) / uTerrainSize;
    vec2 hs = texture2D( uHeight, huv ).rg * ${HEIGHT_MAX.toFixed(1)};
    float ground = hs.r;
    float regional = hs.g;

    /*
     * DEPRESSION, IN WORLD UNITS. Positive where the land sits below its own
     * neighbourhood — a hollow, a valley floor, the lee of a bank. Negative on
     * every shoulder and crest. This single number is what keeps the mist off
     * the high ground without any reference to absolute altitude.
     */
    vDepression = regional - ground;

    // Terrain normal from the height gradient, for the sunlight term
    float texel = 1.0 / ${HEIGHT_TEX.toFixed(1)};
    float hR = texture2D( uHeight, huv + vec2( texel, 0.0 ) ).r * ${HEIGHT_MAX.toFixed(1)};
    float hL = texture2D( uHeight, huv - vec2( texel, 0.0 ) ).r * ${HEIGHT_MAX.toFixed(1)};
    float hU = texture2D( uHeight, huv + vec2( 0.0, texel ) ).r * ${HEIGHT_MAX.toFixed(1)};
    float hD = texture2D( uHeight, huv - vec2( 0.0, texel ) ).r * ${HEIGHT_MAX.toFixed(1)};
    vec3 nrm = normalize( vec3( -( hR - hL ) * 0.5, ${TEXEL_WORLD.toFixed(3)}, -( hU - hD ) * 0.5 ) );
    vSunFacing = dot( nrm, uSunDir );

    /*
     * VERTICAL DRIFT. Three slow sines beating against each other, total
     * amplitude about three units. Enough that the sheet breathes and the mist
     * is seen to rise and settle inside the hollow rather than sliding across
     * it; small enough that it never reads as a wave. The brief's flow, not
     * its wave.
     */
    float s = uSeed;
    float t = uTime * uLayerSpeed;
    float rise = sin( worldP.x * 0.0068 + worldP.z * 0.0049 + t * 0.40 + s ) * 1.5
               + sin( worldP.z * 0.0104 - worldP.x * 0.0035 - t * 0.26 + s * 1.618 ) * 1.0
               + sin( worldP.x * 0.0151 + worldP.z * 0.0082 + t * 0.17 + s * 2.718 ) * 0.6;

    float finalH = ground + uLayerHeight + rise;
    vRelH = finalH - ground;

    worldP.y = finalH;
    vWorldPos = worldP.xyz;

    gl_Position = projectionMatrix * viewMatrix * worldP;
  }
`;

/* ─── Mist fragment shader ────────────────────────────────────────────── */

const MIST_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uLayerSpeed;
  uniform float uLayerOpacity;
  uniform float uNoiseScale;
  uniform float uCoverage;
  uniform vec4 uDepthBand;   // near-in, near-full, far-full, far-out
  uniform float uSeed;

  varying vec3 vWorldPos;
  varying vec2 vUv;
  varying float vDepression;
  varying float vSunFacing;
  varying float vRelH;

  ${SHARED_WIND_GLSL}

  float mHash( vec2 p ) {
    return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
  }

  float mNoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix(
      mix( mHash( i ), mHash( i + vec2( 1.0, 0.0 ) ), u.x ),
      mix( mHash( i + vec2( 0.0, 1.0 ) ), mHash( i + vec2( 1.0, 1.0 ) ), u.x ),
      u.y
    );
  }

  // 5-octave rotated FBM. The rotation between octaves is what stops the
  // lattice of the value noise showing through as grid-aligned streaks.
  float mFbm( vec2 p ) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2( 0.80, 0.60, -0.60, 0.80 );
    for ( int i = 0; i < 5; i++ ) {
      v += a * mNoise( p );
      p = rot * p * 2.04;
      a *= 0.47;
    }
    return v / 0.935;
  }

  void main() {
    vec3 p = vWorldPos;
    float distCam = length( p - cameraPosition );

    vec2 windDir = normalize( SHARED_WIND_DIR );
    vec2 windPerp = vec2( -windDir.y, windDir.x );
    float t = uTime * SHARED_WIND_SPEED * uLayerSpeed;

    /* ── 1. DEPTH BAND ────────────────────────────────────────────────────
     * Each layer owns one slice of distance and is silent outside it. This is
     * what keeps the near ground almost clear while the midground hollows
     * carry the mist, and it is also why three layers can overlap without
     * summing into a wall: they are never both at full strength on the same
     * pixel. Cheapest gate in the shader, so it runs first.
     */
    float depth = smoothstep( uDepthBand.x, uDepthBand.y, distCam )
                * ( 1.0 - smoothstep( uDepthBand.z, uDepthBand.w, distCam ) );
    if ( depth <= 0.002 ) discard;

    /* ── 2. VALLEY GATE ───────────────────────────────────────────────────
     * Zero on crests, by construction: vDepression is negative wherever the
     * ground stands above its own neighbourhood. A bank climbing a shoulder
     * thins and vanishes instead of draping over it. No floor on this term —
     * a crest with faint mist on it is the thing that reads as an overlay.
     *
     * The relative-height term above it does the same job vertically: mist
     * lying deeper in the hollow than the sheet's nominal height is denser,
     * so the layer pools rather than floating at a constant altitude.
     */
    float valley = smoothstep( -2.0, 26.0, vDepression );
    valley *= mix( 0.45, 1.0, smoothstep( 26.0, 4.0, vRelH ) );
    if ( valley <= 0.004 ) discard;

    /* ── 3. FLOW FIELD & DOMAIN WARP ──────────────────────────────────────
     * Three noise fields at different scales, and the coordinates of the later
     * ones are displaced by the earlier ones. Domain warping is the whole
     * reason the result has irregular, broken edges instead of soft ellipses:
     * a threshold on undistorted FBM gives rounded blobs, while a threshold on
     * FBM whose input has itself been pushed around by noise gives torn sheets
     * with filaments and holes.
     *
     * Everything is measured along the wind axis rather than along X and Z, so
     * the anisotropy below stretches features DOWNWIND whatever the heading is.
     */
    vec2 flow = evaluateWindWarp( p, uTime, uLayerSpeed, vec2( 0.0 ), 0.0 );
    vec2 pw = p.xz + flow;

    // Field A: low frequency, sets where the body of a bank is
    vec2 pA = vec2( dot( pw, windDir ) * 0.30 + t * 0.42, dot( pw, windPerp ) * 1.05 )
            * uNoiseScale * 0.55 + uSeed;
    float fA = mFbm( pA );

    // Field B: mid frequency, warped by A — this is what tears the edges
    vec2 warp = ( vec2( fA, mFbm( pA + vec2( 5.2, 1.7 ) ) ) - 0.5 ) * 48.0;
    vec2 pB = vec2( dot( pw + warp, windDir ) * 0.34, dot( pw + warp, windPerp ) * 1.55 )
            * uNoiseScale + vec2( t * 0.030, 0.0 );
    float fB = mFbm( pB );

    // Field C: high frequency, thin filaments and the small holes through them
    vec2 pC = pB * 2.6 + vec2( t * 0.022, t * 0.006 ) + uSeed * 0.8;
    float fC = mFbm( pC );

    float field = fB * 0.62 + fC * 0.26 + fA * 0.12;

    /* ── 4. SHAPE ─────────────────────────────────────────────────────────
     * uCoverage is the threshold, and it is the sparseness control: raising it
     * leaves more of the frame with no mist at all. The ramp above it is
     * narrow (0.13) so that a core reaches a true 1.0 — that saturation is
     * what lets uLayerOpacity stay low and still be seen.
     */
    float shape = smoothstep( uCoverage, uCoverage + 0.13, field );
    if ( shape <= 0.004 ) discard;

    /*
     * INTERNAL DENSITY VARIATION. A second, independent low-frequency field
     * modulates the body so one bank is nearly gone while its neighbour is at
     * full strength, and so density varies WITHIN a single bank. Without this
     * every wisp reads at one opacity and the layer looks printed on.
     */
    float variation = mFbm( pB * 0.42 + vec2( 11.3, 4.1 ) );
    shape *= mix( 0.30, 1.15, smoothstep( 0.32, 0.74, variation ) );
    shape = clamp( shape, 0.0, 1.0 );

    // Broken, thinner leading edge where the bank is running into clear air
    float grad = mFbm( pB + vec2( 0.03, 0.0 ) ) - mFbm( pB - vec2( 0.03, 0.0 ) );
    shape *= mix( 0.55, 1.0, smoothstep( -0.06, 0.08, grad * sign( windDir.x ) ) );

    /* ── 5. REGION ────────────────────────────────────────────────────────
     * Very large-scale noise deciding which parts of the map carry weather at
     * all, drifting slowly downwind so the pattern is not static. No floor:
     * large stretches of snow are meant to be completely untouched, and that
     * contrast is what makes the mist that IS there noticeable.
     */
    vec2 pR = vec2( dot( pw, windDir ) * 0.22 + t * 0.20, dot( pw, windPerp ) * 0.70 )
            * 0.0021 + uSeed * 0.35;
    float region = smoothstep( 0.44, 0.66, mFbm( pR ) );
    if ( region <= 0.004 ) discard;

    float alpha = shape * valley * region * depth * uLayerOpacity;

    /* ── 6. THE IGLOO STAYS CRISP ─────────────────────────────────────────
     * The dome is the subject. This is the one term allowed to be near
     * absolute, because a soft-edged igloo is a worse failure than absent
     * weather.
     */
    float dDome = length( p.xz - vec2( ${MOUND_AT[0].toFixed(1)}, ${MOUND_AT[1].toFixed(1)} ) ) - 24.0;
    vec2 pPorch = abs( p.xz - vec2( ${MOUND_AT[0].toFixed(1)}, ${(MOUND_AT[1] + 15).toFixed(1)} ) ) - vec2( 7.0, 8.0 );
    float dPorch = length( max( pPorch, 0.0 ) ) + min( max( pPorch.x, pPorch.y ), 0.0 );
    alpha *= mix( 0.10, 1.0, smoothstep( 3.5, 30.0, min( dDome, dPorch ) ) );

    // Never let the sheet's own boundary show as a straight edge
    vec2 cuv = abs( vUv - 0.5 );
    alpha *= ( 1.0 - smoothstep( 0.40, 0.50, cuv.x ) ) * ( 1.0 - smoothstep( 0.40, 0.50, cuv.y ) );

    if ( alpha <= 0.0015 ) discard;

    /* ── 7. COLOUR: COOL ATMOSPHERIC, LIT BY THE SAME SUN AS THE SNOW ─────
     * The base is a blue-white grey, not white. Pure white is what makes a mist
     * read as an overlay: real cold air scatters the sky as much as the sun,
     * and the sky here is blue.
     *
     * The sunlight term is what makes it volumetric rather than a transparent
     * texture. Mist over a slope turned toward the key brightens toward white;
     * mist settled in a shadowed hollow cools and darkens. Thin portions
     * brighten furthest, because a thin filament is lit through its whole depth
     * while a dense core shadows its own far side — so the sun is weighted by
     * (1 - shape), and the edges of a bank catch the light while its body
     * stays cool. That difference across a single wisp is most of what sells
     * the volume.
     */
    vec3 colBase = vec3( 0.82, 0.88, 0.94 );
    vec3 colShadow = vec3( 0.66, 0.73, 0.84 );
    vec3 colLit = vec3( 0.99, 0.99, 1.00 );

    float lit = smoothstep( -0.05, 0.55, vSunFacing );
    float thin = 1.0 - smoothstep( 0.25, 0.95, shape );

    vec3 col = mix( colShadow, colBase, smoothstep( 0.0, 0.45, lit ) );
    col = mix( col, colLit, lit * mix( 0.25, 0.85, thin ) );

    // Aerial perspective: distant mist takes the fog's colour
    col = mix( col, vec3( 0.80, 0.85, 0.92 ), smoothstep( 260.0, 900.0, distCam ) * 0.45 );

    gl_FragColor = vec4( col, alpha );
  }
`;

/**
 * One depth stratum of valley mist.
 *
 * @param {object}   props
 * @param {number}   props.size        Sheet extent in world units.
 * @param {number}   props.centerZ     Where the sheet sits on the view axis.
 * @param {number}   props.layerHeight Nominal height above the ground.
 * @param {number}   props.layerSpeed  Multiplier on the shared wind speed.
 * @param {number}   props.opacity     Peak alpha; the field saturates to 1.
 * @param {number}   props.noiseScale  Feature size — smaller is wider.
 * @param {number}   props.coverage    Threshold; higher leaves more clean snow.
 * @param {number[]} props.depthBand   [in, full, full, out] distance from lens.
 */
function MistLayer({
  heightTexture,
  size,
  centerZ,
  segments,
  layerHeight,
  layerSpeed,
  opacity,
  noiseScale,
  coverage,
  depthBand,
  seed,
}) {
  const geometry = useMemo(() => {
    const geo = new PlaneGeometry(size[0], size[1], segments[0], segments[1]);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [size, segments]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: MIST_VERT,
        fragmentShader: MIST_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: DoubleSide,
        blending: NormalBlending,
        uniforms: {
          uHeight: { value: heightTexture },
          uTerrainOrigin: {
            value: [-TERRAIN_SIZE / 2, TERRAIN_CENTER_Z - TERRAIN_SIZE / 2],
          },
          uTerrainSize: { value: [TERRAIN_SIZE, TERRAIN_SIZE] },
          uSunDir: { value: SUN_DIR },
          uTime: { value: 0 },
          uLayerHeight: { value: layerHeight },
          uLayerSpeed: { value: layerSpeed },
          uLayerOpacity: { value: opacity },
          uNoiseScale: { value: noiseScale },
          uCoverage: { value: coverage },
          uDepthBand: { value: depthBand },
          uSeed: { value: seed },
        },
      }),
    [heightTexture, layerHeight, layerSpeed, opacity, noiseScale, coverage, depthBand, seed],
  );

  useFrame((state, delta) => {
    material.uniforms.uTime.value = updateWindState(state, delta).time;
  });

  return (
    <mesh
      geometry={geometry}
      material={material}
      position={[-20, 0, centerZ]}
      renderOrder={1}
      frustumCulled={false}
    />
  );
}

/* ─── Weather root ────────────────────────────────────────────────────── */

export default function Weather() {
  const heightTexture = useMemo(() => buildHeightTexture(), []);

  return (
    <group name="arctic-valley-mist">
      {/*
        FAR: mountain-pass drift. Very slow, very wide features, almost
        transparent. Its job is to give the distance a sense of moving air
        without the back of the picture churning — if everything moves, nothing
        reads as fast, so this is deliberately the faintest of the three.
      */}
      <MistLayer
        heightTexture={heightTexture}
        size={[2600, 2200]}
        segments={[120, 100]}
        centerZ={-500}
        layerHeight={22.0}
        layerSpeed={0.16}
        opacity={0.09}
        noiseScale={0.0019}
        coverage={0.5}
        depthBand={[420, 720, 1200, 1650]}
        seed={12.4}
      />

      {/*
        MIDGROUND: the valley mist, and the layer that carries the whole read.
        Moderate speed, mid-scale features, the highest opacity of the three —
        which is still only 0.20, because it is seen against the shadowed
        flanks behind the igloo rather than against the lit foreground.
      */}
      <MistLayer
        heightTexture={heightTexture}
        size={[1500, 1300]}
        segments={[150, 130]}
        centerZ={-40}
        layerHeight={9.0}
        layerSpeed={0.55}
        opacity={0.2}
        noiseScale={0.0046}
        coverage={0.47}
        depthBand={[110, 250, 620, 950]}
        seed={5.8}
      />

      {/*
        NEAR: small fast wisps hugging the snow. Sparse by a high coverage
        threshold rather than by low opacity — a few crisp tongues of drift
        crossing clean snow, and long stretches with nothing at all. The depth
        band starts well out from the lens so the immediate foreground stays
        clear.
      */}
      <MistLayer
        heightTexture={heightTexture}
        size={[800, 800]}
        segments={[130, 130]}
        centerZ={180}
        layerHeight={2.2}
        layerSpeed={1.05}
        opacity={0.13}
        noiseScale={0.0115}
        coverage={0.56}
        depthBand={[45, 130, 260, 430]}
        seed={1.2}
      />
    </group>
  );
}
