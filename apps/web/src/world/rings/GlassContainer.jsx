import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { DoubleSide, Raycaster, ShaderMaterial, Vector2, Vector3 } from 'three';
import { NOISE } from './glsl.js';
import { TUBE_BOTTOM, TUBE_TOP, CASE_HEIGHT, CASE_RADIUS } from './layout.js';

// The glass the beads are held in.
//
// Real glass, drawn rather than simulated. Transmission would cost a second
// render of the whole room for a cylinder that has almost nothing behind it, so
// instead this is the four things that actually tell the eye a surface is
// glass: a hard bright line where it turns away, two long specular highlights
// down the sides, bright ellipses at the cut rims, and a faint cool body so the
// column reads as a volume the beads sit inside.
//
// Where the pointer touches it, a fine triangulated lattice lights up around
// the spot and fades again once the pointer moves on.
//
// It also owns the only raycast in the room. The beads inside need to know
// where the pointer meets the glass, and doing it here and handing the hit on
// costs one raycast rather than two.

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormalW;

  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4( position, 1.0 );
    vWorld = w.xyz;
    vNormalW = normalize( mat3( modelMatrix ) * normal );
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uLevel;
  uniform vec3 uTouch;
  uniform float uTouchAmt;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormalW;

  ${NOISE}

  #define AROUND 260.0

  vec2 cellHash( vec2 c ) {
    // Wrapped around the cylinder, so the cells at the seam are the same cells.
    c.x = mod( c.x, AROUND );
    return fract( sin( vec2( dot( c, vec2( 127.1, 311.7 ) ), dot( c, vec2( 269.5, 183.3 ) ) ) ) * 43758.5453 );
  }

  // A grid vertex pushed off its spot at random and drifting slowly, so the
  // mesh is irregular and never still.
  vec2 vertexAt( vec2 c ) {
    vec2 h = cellHash( c );
    return c + ( h - 0.5 ) * 0.55
         + 0.12 * vec2( sin( uTime * 0.7 + h.x * 6.2831 ), cos( uTime * 0.6 + h.y * 6.2831 ) );
  }

  float segDist( vec2 p, vec2 a, vec2 b ) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp( dot( pa, ba ) / dot( ba, ba ), 0.0, 1.0 );
    return length( pa - ba * h );
  }

  // Distance to the nearest edge of a triangulated mesh over those vertices:
  // each cell split along a diagonal chosen at random.
  float meshDist( vec2 p ) {
    vec2 i = floor( p );
    float d = 1e9;
    for ( int yy = -1; yy <= 1; yy++ ) {
      for ( int xx = -1; xx <= 1; xx++ ) {
        vec2 c = i + vec2( float( xx ), float( yy ) );
        vec2 a = vertexAt( c );
        vec2 b = vertexAt( c + vec2( 1.0, 0.0 ) );
        vec2 t = vertexAt( c + vec2( 0.0, 1.0 ) );
        vec2 e = vertexAt( c + vec2( 1.0, 1.0 ) );
        d = min( d, segDist( p, a, b ) );
        d = min( d, segDist( p, a, t ) );
        d = min( d, cellHash( c + 17.0 ).x > 0.5 ? segDist( p, a, e ) : segDist( p, b, t ) );
      }
    }
    return d;
  }

  void main() {
    vec3 N = normalize( vNormalW );
    vec3 V = normalize( cameraPosition - vWorld );
    float edge = pow( 1.0 - abs( dot( N, V ) ), 3.0 );

    // Small, irregular, slowly shifting triangles, only around the touch. The
    // mesh is costly, so it is only evaluated where it can be seen.
    // Cells about 0.03 across: very fine triangles, more a texture than a net.
    vec2 g = vec2( vUv.x * AROUND, vUv.y * 130.0 );
    float d = distance( vWorld, uTouch );
    float reveal = exp( -pow( d / 0.38, 2.0 ) ) * uTouchAmt;
    float lattice = 0.0;
    if ( reveal > 0.002 ) {
      lattice = 1.0 - smoothstep( 0.01, 0.035, meshDist( g ) );
      reveal *= 0.6 + 0.4 * rNoise( g * 0.25 + uTime * 0.6 );
    }

    // Two long highlights down the sides, from the same strip lights the room
    // hangs either side of the chamber. Squared hard, so they are narrow bands
    // rather than a general sheen.
    vec3 keyA = normalize( vec3( -1.0, 0.18, 0.55 ) );
    vec3 keyB = normalize( vec3( 0.92, 0.1, 0.5 ) );
    float streak = pow( max( dot( N, keyA ), 0.0 ), 22.0 ) * 0.9
                 + pow( max( dot( N, keyB ), 0.0 ), 30.0 ) * 0.6;

    // The cut rims at each end, where the wall's thickness catches the light.
    float rim = smoothstep( 0.055, 0.0, vUv.y ) + smoothstep( 0.945, 1.0, vUv.y );

    // And one narrow highlight drifting slowly round the tube, the way a
    // reflection crawls over glass as you move past it. It is the only thing
    // keeping the chamber itself from being completely static.
    float sweep = pow( max( 0.0, sin( vUv.x * 6.2831 - uTime * 0.13 ) ), 90.0 ) * 0.7
                + pow( max( 0.0, sin( vUv.x * 6.2831 - uTime * 0.13 + 2.4 ) ), 60.0 ) * 0.3;
    sweep *= smoothstep( 0.0, 0.18, vUv.y ) * smoothstep( 1.0, 0.82, vUv.y );

    // A faint cool body, so the chamber reads as a volume. Both walls are drawn
    // and neither writes depth, so the tint doubles across the tube and the
    // column comes out a shade cooler than the white room — which is what the
    // white beads are legible against.
    // Held back from the first pass at this: the rings of light now sit
    // exactly where the glass rims are, so a bright rim here only doubles them,
    // and the room behind is grey rather than white, so the body needs far less
    // to separate the column from it.
    float alpha = clamp(
      0.04
      + edge * 0.4
      + streak * 0.3
      + rim * 0.16
      + sweep * 0.3
      + lattice * reveal * 0.22,
      0.0,
      1.0
    ) * uLevel;

    // The body is cool and the highlights are white, so the glass does not just
    // read as a grey tube lit from the front.
    vec3 body = vec3( 0.78, 0.83, 0.89 );
    vec3 tint = mix( body, vec3( 1.0 ), clamp( edge + streak + rim + sweep, 0.0, 1.0 ) );
    gl_FragColor = vec4( tint, alpha );
  }
`;

/**
 * @param hover Optional ref, set true while the pointer is over the case, so
 *   the page can open the current link on a click inside it.
 * @param touch Optional `{ point, amt }` written every frame with where the
 *   pointer meets the glass, in world space, and how far the touch has eased
 *   in. The particles inside read it rather than raycasting again.
 */
export default function GlassContainer({ levels, hover, touch: share }) {
  const ref = useRef(null);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);

  const pointer = useRef({ ndc: new Vector2(), seen: false });
  const touch = useMemo(() => ({ raycaster: new Raycaster(), hit: new Vector3(), amt: 0 }), []);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uLevel: { value: 0 },
          uTouch: { value: new Vector3(0, -999, 0) },
          uTouchAmt: { value: 0 },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
    []
  );

  useEffect(() => () => material.dispose(), [material]);

  // Fed from the window: the canvas takes no pointer events of its own.
  useEffect(() => {
    const onMove = (event) => {
      const box = gl.domElement.getBoundingClientRect();
      pointer.current.ndc.set(
        ((event.clientX - box.left) / box.width) * 2 - 1,
        -((event.clientY - box.top) / box.height) * 2 + 1
      );
      pointer.current.seen = true;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [gl]);

  useFrame(({ clock }, delta) => {
    const level = levels.current.show;
    const u = material.uniforms;
    u.uTime.value = clock.elapsedTime;
    u.uLevel.value = level;

    const mesh = ref.current;
    if (!mesh) return;
    mesh.visible = level > 0.001;
    if (!mesh.visible) {
      if (hover) hover.current = false;
      if (share) share.amt = 0;
      return;
    }

    let touching = false;
    if (pointer.current.seen && level > 0.85) {
      touch.raycaster.setFromCamera(pointer.current.ndc, camera);
      const hits = touch.raycaster.intersectObject(mesh, false);
      if (hits.length) {
        // The near wall, where the pointer actually meets the glass.
        u.uTouch.value.copy(hits[0].point);
        touching = true;
      }
    }

    if (hover) hover.current = touching;

    const dt = Math.min(delta, 0.05);
    touch.amt = touching
      ? Math.min(1, touch.amt + dt * 5)
      : touch.amt * Math.exp(-dt * 1.8);
    u.uTouchAmt.value = touch.amt;

    if (share) {
      share.point.copy(u.uTouch.value);
      share.amt = touch.amt;
    }
  });

  return (
    <mesh
      ref={ref}
      position={[0, (TUBE_BOTTOM + TUBE_TOP) / 2, 0]}
      material={material}
      frustumCulled={false}
    >
      <cylinderGeometry args={[CASE_RADIUS, CASE_RADIUS, CASE_HEIGHT, 96, 1, true]} />
    </mesh>
  );
}
