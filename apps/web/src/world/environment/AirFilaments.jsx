import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { DoubleSide, PlaneGeometry, ShaderMaterial, Uniform, Vector3 } from 'three';
import { LOOK } from '../lib/lighting.js';
import { wind, agitationAt } from '../lib/wind-field.js';

/**
 * Wind-blown filaments of snow in the air.
 *
 * THE FIFTH ATTEMPT AT THIS, AND THE FIRST ONE BUILT FROM THE RIGHT PRIMITIVE.
 * The four before it are worth listing because each was a different wrong guess
 * about what the reference is made of:
 *
 *   a rising plume        — a source and a column. It has neither.
 *   drifting banks        — soft-edged masses. It has no masses.
 *   breeze streaks        — long thresholded noise. Too solid, too blobby.
 *   flow ribbons of light — bundles of parallel strands inside a rectangle.
 *                           Closest in spirit and still wrong, because the
 *                           strands were parallel and confined to a shape.
 *
 * The close reference settles it. The strands are HAIR-THIN — a pixel or two —
 * they BRAID, splitting apart and rejoining, and they have no containing form at
 * all: there is no rectangle, no bank, no bundle, just a field of filaments
 * flowing through the frame. Two techniques produce exactly that and neither was
 * being used.
 *
 * THE RIDGE, which is what makes a line instead of a cloud. Thresholding noise
 * gives regions — everything above a value — and regions have area, which is why
 * every previous attempt came out as patches however hard it was pushed. Taking
 * `1 - |2n - 1|` instead gives the CREST of the field: it peaks where the noise
 * passes through its midpoint, which is a curve rather than an area. Raised to a
 * high power that curve narrows to a hair. The exponent is the line width, and
 * nothing about it can produce a blob.
 *
 * DOMAIN WARPING, which is what makes them braid. Displacing the sample position
 * by another noise field before reading it bends every filament along a shared
 * flow, so neighbouring strands converge, run together and separate again. This
 * is the part the ribbon version could never have had: its strands were parallel
 * by construction, and parallel strands read as a comb or a brush, never as air.
 *
 * The two compose: warp the domain, then take the ridge of what is there.
 */

const FIL_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

const FIL_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uSharp;
  uniform float uWarp;
  uniform float uScale;
  uniform float uStretch;
  uniform float uSpeed;
  uniform vec2 uSeed;
  uniform float uEdge;
  uniform float uGust;
  varying vec2 vUv;

  float hash( vec2 p ) {
    return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
  }

  float vnoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix(
      mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), u.x ),
      mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), u.x ),
      u.y
    );
  }

  float fbm( vec2 p ) {
    float v = 0.0;
    float a = 0.5;
    for ( int i = 0; i < 4; i ++ ) {
      v += a * vnoise( p );
      p *= 2.03;
      a *= 0.5;
    }
    return v / 0.9375;
  }

  void main() {
    /*
     * STRETCHED HARD ALONG THE FLOW. Filaments lie ALONG the direction the air
     * is moving, so the field is sampled with its x axis compressed relative to
     * its y: features run many times further across the frame than they do up
     * it. Isotropic sampling here would give a tangle rather than a current.
     */
    vec2 p = vec2( vUv.x * uScale, vUv.y * uScale * uStretch ) + uSeed;
    /* Scrolled by the SHARED field's gust, so the wisps surge and ease with
       everything else in the scene rather than on a private clock. */
    p.x -= uTime * uSpeed * uGust;

    /*
     * THE WARP. Two more noise lookups displace the sample position before it is
     * read, so every filament is bent along a flow shared with its neighbours —
     * which is what makes them converge, run together and separate. Sampled at a
     * lower frequency than the filaments themselves, so the braid is a broad
     * motion and not a per-strand wobble.
     */
    vec2 w = vec2(
      fbm( p * 0.55 + vec2( 11.3, 4.1 ) ),
      fbm( p * 0.55 + vec2( 27.9, 19.7 ) )
    );
    p += ( w - 0.5 ) * uWarp;

    float n = fbm( p );

    /*
     * THE RIDGE. Peaks where the field crosses its own midpoint, which is a
     * CURVE rather than an area — this is the whole difference between a
     * filament and a patch. The power then narrows that curve to a hair: at 40
     * it is a pixel or two wide at this scale, and no value of it can widen the
     * result into a blob, because the ridge has no area to begin with.
     */
    float fil = 1.0 - abs( n * 2.0 - 1.0 );
    fil = pow( fil, uSharp );

    /*
     * A SECOND, BROADER RIDGE UNDERNEATH. Real blown snow has a few bright
     * strands standing in a much fainter wash of the same structure. Without it
     * the filaments hang in nothing and read as scratches on the lens.
     */
    float haze = pow( 1.0 - abs( n * 2.0 - 1.0 ), uSharp * 0.06 ) * 0.05;

    /* Agitated air carries more loose snow, so the wisps thicken slightly when
       the wind is up. Subtle on purpose — this should register as the weather
       changing, never as an opacity being animated. */
    float a = ( fil + haze ) * uEdge * ( 0.72 + uGust * 0.34 );

    /* Feathered on every edge so the plane's own rectangle never shows. The
       vertical ramps are very wide — a current has no top or bottom. */
    a *= smoothstep( 0.0, 0.14, vUv.x ) * smoothstep( 1.0, 0.86, vUv.x );
    a *= smoothstep( 0.0, 0.42, vUv.y ) * smoothstep( 1.0, 0.58, vUv.y );

    gl_FragColor = vec4( uColor, clamp( a, 0.0, 1.0 ) * uOpacity );
  }
`;

const rand = (i, salt) => {
  const n = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return n - Math.floor(n);
};

export default function AirFilaments() {
  const F = LOOK.filaments;
  const { camera } = useThree();
  const group = useRef();

  const sheets = useMemo(() => {
    const out = [];
    for (let i = 0; i < F.count; i += 1) {
      out.push({
        w: F.size[0] + rand(i, 3) * (F.size[1] - F.size[0]),
        h: F.height[0] + rand(i, 5) * (F.height[1] - F.height[0]),
        y: F.band.y[0] + rand(i, 7) * (F.band.y[1] - F.band.y[0]),
        z: F.band.z[0] + rand(i, 11) * (F.band.z[1] - F.band.z[0]),
        speed: F.speed[0] + rand(i, 13) * (F.speed[1] - F.speed[0]),
        drift: F.drift[0] + rand(i, 17) * (F.drift[1] - F.drift[0]),
        phase: rand(i, 19),
        seed: [rand(i, 23) * 40, rand(i, 29) * 40],
        opacity: F.opacity * (0.7 + rand(i, 31) * 0.6),
        sharp: F.sharp[0] + rand(i, 37) * (F.sharp[1] - F.sharp[0]),
      });
    }
    return out;
  }, [F]);

  const geometry = useMemo(() => new PlaneGeometry(1, 1, 1, 1), []);

  const materials = useMemo(
    () =>
      sheets.map(
        (c) =>
          new ShaderMaterial({
            vertexShader: FIL_VERT,
            fragmentShader: FIL_FRAG,
            uniforms: {
              uTime: new Uniform(0),
              uColor: new Uniform(new Vector3(...F.color)),
              uOpacity: new Uniform(c.opacity),
              uSharp: new Uniform(c.sharp),
              uWarp: new Uniform(F.warp),
              uScale: new Uniform(F.scale),
              uStretch: new Uniform(F.stretch),
              uSpeed: new Uniform(c.speed),
              uSeed: new Uniform(c.seed),
              uEdge: new Uniform(1),
              uGust: new Uniform(1),
            },
            side: DoubleSide,
            transparent: true,
            /* Overlapping sheets must not occlude one another; depth TEST stays
               on so a sheet behind a ridge is hidden by it. */
            depthWrite: false,
            fog: false,
          })
      ),
    [sheets, F]
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (!group.current) return;
    group.current.children.forEach((mesh, i) => {
      const c = sheets[i];
      const m = materials[i];
      m.uniforms.uTime.value = t;

      /*
       * THE SHEETS THEMSELVES BARELY MOVE, AND THE FILAMENTS MOVE INSIDE THEM.
       *
       * This is the opposite of the drifting-bank version, where each plane
       * travelled across the frame and its contents were fixed. Blown snow does
       * not work that way: the air is everywhere at once and it is the STRUCTURE
       * within it that streams past. So the sheets hold roughly still — a slow
       * lateral crawl only, to keep the field from ever being static — and the
       * scroll inside the shader does the work.
       */
      const span = F.band.x[1] - F.band.x[0] + c.w;
      let x = F.band.x[0] + c.phase * span + t * c.drift;
      x = ((((x - F.band.x[0]) % span) + span) % span) + F.band.x[0];
      mesh.position.set(x, c.y, c.z);

      /*
       * READ, NEVER WRITE. The gust comes from the shared field, so the wisps,
       * the grains, the frost and the audio bed all surge together — one cause,
       * many effects.
       *
       * SAMPLED AT THE SHEET'S OWN POSITION, which is why this sits after the
       * placement rather than before it. The first version read the agitation at
       * a coordinate the sheet objects do not carry, so every wisp measured the
       * cursor's distance from x = 0 instead of from itself — the disturbance
       * was global, which is exactly the "one gimmick fired five times" failure
       * the shared field exists to avoid.
       */
      m.uniforms.uGust.value = wind.gust * (1 + agitationAt(x, c.z) * 0.5);

      /* Billboarded about Y only, so the sheets stay upright as the lens
         pitches rather than reading as tilted cards. */
      mesh.rotation.y = Math.atan2(camera.position.x - x, camera.position.z - c.z);
    });
  });

  return (
    <group ref={group}>
      {sheets.map((c, i) => (
        <mesh
          key={i}
          geometry={geometry}
          material={materials[i]}
          scale={[c.w, c.h, 1]}
          frustumCulled={false}
        />
      ))}
    </group>
  );
}
