import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, Object3D, ShaderMaterial } from 'three';
import { arcBlock, mulberry32 } from './geometry.js';
import { NOISE } from './glsl.js';
import { FOG, RING_Y } from './layout.js';
import { MODEST } from '../water/device.js';

// One level of the shaft: a segmented ring of clear water, like glass.
//
// Concentric layers of carved blocks, instanced per layer, with gaps and loose
// pieces. The look is all in the shader — reflected studio strips, light
// rippling through the body as if it were water, bright bevels — because a
// clear material only shows what it reflects and bends, and the fog behind it
// has nothing to offer. Pieces drift in and lock together while the cut plays;
// the level circles and tilts, and settles flat as the camera comes onto its
// axis.

// Only the whole outer ring: the broken inner rings between it and the centre
// were taken out at the user's request.
const LAYOUTS = [
  [{ radius: 1.0, width: 0.3, height: 0.26, count: 8, fill: 0.95, missing: [], loose: [] }],
  [{ radius: 1.0, width: 0.28, height: 0.24, count: 7, fill: 0.93, missing: [], loose: [] }],
];

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const dummy = new Object3D();
dummy.rotation.order = 'YXZ';

const VERTEX = /* glsl */ `
  attribute float aEdge;
  uniform float uTime;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying vec3 vLocal;
  varying float vEdge;

  void main() {
    vec3 p = position;
    // A slow swell along the block, as if the body were liquid.
    p += normal * 0.008 * sin( position.x * 9.0 + position.z * 7.0 + uTime * 1.4 );

    mat4 m = modelMatrix;
    #ifdef USE_INSTANCING
      m = modelMatrix * instanceMatrix;
    #endif

    vec4 w = m * vec4( p, 1.0 );
    vWorld = w.xyz;
    vNormalW = normalize( mat3( m ) * normal );
    vLocal = position;
    vEdge = aEdge;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uGlow;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying vec3 vLocal;
  varying float vEdge;

  ${NOISE}

  // A studio toned from the page colour, with hard light in it: two thin
  // vertical strips, a soft top light, and moving ripple bands. Darker than the
  // page below, so the glass bends visible tone against the pale ground.
  vec3 studio( vec3 d ) {
    float a = atan( d.z, d.x );
    float strips = pow( max( 0.0, sin( a * 2.0 + 0.6 ) ), 40.0 ) * 3.0
                 + pow( max( 0.0, sin( a * 3.0 - 1.1 ) ), 60.0 ) * 2.0;
    float top = smoothstep( 0.55, 0.95, d.y ) * 1.6;
    float ripple = pow( 1.0 - abs( sin( d.x * 7.0 + sin( d.z * 9.0 + uTime * 0.6 ) * 0.8 + d.y * 5.0 ) ), 10.0 );
    vec3 base = mix( uFogColor * 0.35, uFogColor * 0.85, d.y * 0.5 + 0.5 );
    return base + vec3( 0.85, 0.93, 1.0 ) * ( strips + top + ripple * ( 0.45 + 0.45 * d.y ) );
  }

  void main() {
    vec3 N = normalize( vNormalW );
    vec3 V = normalize( cameraPosition - vWorld );
    float ndv = clamp( dot( N, V ), 0.0, 1.0 );
    float fres = 0.04 + 0.96 * pow( 1.0 - ndv, 5.0 );

    vec3 R = reflect( -V, N );
    vec3 T = refract( -V, N, 0.75 );

    // Light moving through the body: contour bands of a drifting noise field,
    // shifted by the refracted ray so they slide with the view like real caustics.
    vec2 q = vLocal.xz * 6.0 + vLocal.y * 4.0 + T.xz * 1.2 + vec2( uTime * 0.12, -uTime * 0.09 );
    // Two noise samples instead of two four-octave stacks; the second band set
    // comes from the same field at another frequency.
    float n = rNoise( q ) * 0.62 + rNoise( q * 2.1 + 3.7 ) * 0.38;
    float caustic = pow( 1.0 - abs( sin( n * 14.0 ) ), 7.0 );
    float caustic2 = pow( 1.0 - abs( sin( n * 23.0 + 1.7 ) ), 10.0 );

    vec3 inner = studio( normalize( T + ( vec3( n ) - 0.5 ) * 0.6 ) ) * 0.55;
    vec3 col = uFogColor * 0.3 + inner
             + vec3( 0.8, 0.9, 1.0 ) * ( caustic * 0.9 + caustic2 * 0.6 )
             + studio( R ) * fres * 1.4;

    float edge = smoothstep( 0.7, 1.0, vEdge );

    // On a pale ground white highlights alone vanish: the silhouette is drawn
    // by darkening where the surface turns away, as thick glass does.
    col *= mix( 1.0, 0.55, smoothstep( 0.35, 0.9, fres ) * ( 1.0 - edge ) );

    col += vec3( 0.85, 0.93, 1.0 ) * edge * ( 0.8 + 1.5 * fres );

    // Faces looking in at the axis catch a cool glow, so the ring reads as an opening.
    float rl = length( vWorld.xz );
    vec2 inward = rl > 1e-4 ? -vWorld.xz / rl : vec2( 0.0 );
    col += vec3( 0.5, 0.72, 1.0 ) * pow( clamp( dot( N.xz, inward ), 0.0, 1.0 ), 3.0 )
         * uGlow * smoothstep( 0.7, 0.9, rl );

    float alpha = clamp( 0.45 + 0.4 * fres + 0.35 * caustic + 0.5 * edge, 0.0, 1.0 );

    float fog = smoothstep( uFogNear, uFogFar, distance( cameraPosition, vWorld ) );
    col = mix( col, uFogColor, fog );
    alpha *= 1.0 - fog * fog;

    gl_FragColor = vec4( col, alpha );
  }
`;

export default function GlassRing({ y, order = 0, levels }) {
  const group = useRef(null);
  const spins = useRef([]);
  const meshes = useRef([]);
  const layout = order % LAYOUTS.length;

  const layers = useMemo(() => {
    const rand = mulberry32(7 + order * 13);
    return LAYOUTS[layout].map((spec) => {
      const span = ((Math.PI * 2) / spec.count) * spec.fill;
      const geometry = arcBlock({
        radius: spec.radius,
        width: spec.width,
        height: spec.height,
        span,
        steps: MODEST ? 10 : 16,
        cornerSteps: MODEST ? 2 : 3,
      });
      const offset = rand() * Math.PI * 2;
      const pieces = [];
      for (let k = 0; k < spec.count; k += 1) {
        if (spec.missing.includes(k)) continue;
        pieces.push({
          angle: offset + (k * Math.PI * 2) / spec.count + (rand() - 0.5) * 0.04,
          r: [rand(), rand(), rand()],
          loose: spec.loose.includes(k),
        });
      }
      return { geometry, pieces };
    });
  }, [layout, order]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          // Halved: stronger, it blew the middle of each ring out to white and
          // hid the frosted pane inside it.
          uGlow: { value: 0.6 },
          uFogColor: { value: new Color(FOG) },
          uFogNear: { value: 1.5 },
          uFogFar: { value: 9.5 },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
      }),
    []
  );

  useEffect(() => () => layers.forEach((l) => l.geometry.dispose()), [layers]);
  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ clock, camera }) => {
    const g = group.current;
    if (!g) return;

    const t = clock.elapsedTime;
    const cam = camera.position;
    const dy = cam.y - y;
    const L = levels.current;

    const dist = Math.hypot(cam.x, dy, cam.z);
    const near = smooth(4.4, 0.8, dist);
    L.near[order] = near;

    // Well below a ring it is behind the view for good.
    // Nor drawn while far enough below to be lost in the fog.
    // Kept a little longer below: the glide into the room passes under the
    // last ring, and dropping it too soon popped it out mid-move.
    g.visible = dy > -3 && dy < 9.5 && L.form > 0.001;
    if (!g.visible) return;

    material.uniforms.uTime.value = t;

    // The first ring locks together as the cut plays in. Each one after it
    // joins in turn — a cascade down the shaft — starting as the camera closes
    // on the ring above it and finished before the camera gets there.
    const above = RING_Y[Math.max(0, order - 1)];
    const passedAbove = smooth(above + 1.6, above + 0.4, cam.y);
    const joined = order === 0 ? L.form : Math.min(L.form, passedAbove);
    const burst = 1 - joined;

    // Tilted and circling only while still apart. A ring that has joined sits
    // level and still, so it never looks left floating after the one above it
    // has settled. The first ring also levels as the camera comes onto its axis.
    const settle = order === 0 ? 1 - smooth(0.05, 0.22, L.f) : burst;
    const tilt = 0.3 * (1 - near) * settle;
    g.rotation.x = Math.sin(t * 0.4 + order * 1.3) * tilt;
    g.rotation.z = Math.cos(t * 0.33 + order * 2.1) * tilt;

    layers.forEach((layer, li) => {
      const dir = li % 2 ? -1 : 1;
      const spin = spins.current[li];
      if (spin) spin.rotation.y = dir * (t * 0.12 + L.spin);

      const mesh = meshes.current[li];
      if (!mesh) return;

      layer.pieces.forEach((p, i) => {
        const [a, b, c] = p.r;
        const spread = 1 + li * 0.3;
        // No push from the camera: a ring that has just joined stays whole as
        // it is passed.
        const push =
          burst * (0.35 + 0.7 * a) * spread +
          (p.loose ? 0.09 + 0.03 * Math.sin(t * 0.6 + b * 9) : 0);
        const tip = push * 1.3 + burst * 1.2;

        dummy.position.set(
          Math.cos(p.angle) * push,
          // Pieces bob only while apart; once joined the ring is one solid body.
          (b - 0.5) * (push * 1.1 + burst * 1.2) + Math.sin(t * 0.9 + b * 6) * 0.015 * burst,
          -Math.sin(p.angle) * push
        );
        dummy.rotation.set((a - 0.5) * tip, p.angle + (c - 0.5) * tip * 0.6, (b - 0.5) * tip);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });

      mesh.instanceMatrix.needsUpdate = true;
    });
  });

  return (
    <group ref={group} position={[0, y, 0]}>
      {layers.map((layer, li) => (
        <group
          key={li}
          ref={(el) => {
            spins.current[li] = el;
          }}
        >
          <instancedMesh
            ref={(el) => {
              meshes.current[li] = el;
            }}
            args={[layer.geometry, material, layer.pieces.length]}
            frustumCulled={false}
          />
        </group>
      ))}
    </group>
  );
}
