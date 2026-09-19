import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BackSide, CustomBlending, OneMinusSrcAlphaFactor, ShaderMaterial, SrcAlphaFactor } from 'three';
import GlassContainer from './GlassContainer.jsx';
import TubeRig from './TubeRig.jsx';
import { NOISE } from './glsl.js';
import { CASE_RADIUS, LAKE_Y, LOGO_Y, PLINTH_RADIUS } from './layout.js';
import { MODEST } from '../water/device.js';

// Where the descent comes to rest: a gallery, and the chamber standing in it.
//
// A curved wall with a lit soffit running round it and a polished floor the
// whole thing reflects in — painted by direction in two shaders rather than
// modelled, because none of it is ever approached: the camera arrives, levels
// off, and stays.
//
// Bare, deliberately. Nothing on the walls, no openings and no washes, so the
// only light anywhere in the frame comes off the chamber itself.
//
// Warm light, cold room. The walls, the ceiling and the floor are the site's
// own blue-grey ice; every light in here — the cove in the wall, the rings at
// the chamber's foot, the spill and the caustics they throw — is amber. Neither
// half means much alone, and together they give the room a temperature.
//
// What sells the polish is the floor: the rings at the foot of the chamber
// smear down it toward the viewer in long lanes, broken up by the floor's own
// grain. A plain gradient there reads as paper, and the room stops being a room.
//
// The floor is dry. It carried a film of meltwater with caustics moving through
// it for a while — it also carried two noise lookups a pixel over most of the
// frame, and the room is better without both.
//
// These shaders render into the ring stage's linear render target and are
// composited from there, so every colour here is written in linear space.

/** Where the outer ring of light at the chamber's foot sits, for the floor to catch. */
const SPILL_RADIUS = CASE_RADIUS * 1.74;

function Floor({ levels }) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uLevel: { value: 0 }, uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          void main() {
            vec4 w = modelMatrix * vec4( position, 1.0 );
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }
        `,
        fragmentShader:
          NOISE +
          /* glsl */ `
          uniform float uLevel;
          uniform float uTime;
          varying vec3 vWorld;

          void main() {
            vec2 xz = vWorld.xz;
            float r = length( xz );
            vec3 V = normalize( vWorld - cameraPosition );

            // Polished grey, opening out lighter toward the horizon.
            float graze = pow( 1.0 - clamp( -V.y, 0.0, 1.0 ), 4.0 );
            vec3 col = mix( vec3( 0.482, 0.546, 0.615 ), vec3( 0.718, 0.776, 0.837 ), graze );

            // The chamber's contact shadow, tight at the plate.
            float foot = max( r - ${(PLINTH_RADIUS * 0.82).toFixed(3)}, 0.0 );
            col *= 1.0 - exp( -pow( foot / 0.1, 2.0 ) ) * 0.4;

            // The light spilling out from under it: a bright band where the
            // outer ring sits, and a broad pool around the whole base. Warm,
            // because the rings down there are — this amber on a blue-grey
            // floor is the whole reason the room has a temperature.
            float spill = exp( -pow( ( r - ${SPILL_RADIUS.toFixed(3)} ) / 0.22, 2.0 ) );
            col += vec3( 1.0, 0.94, 0.86 ) * spill * 0.6;
            col += vec3( 1.0, 0.95, 0.89 ) * exp( -pow( r / 1.8, 2.0 ) ) * 0.15;

            // Frost creeping out from under the plinth, bitten at its edge by
            // the polish grain below rather than by a noise lookup of its own.
            float bite = rNoise( vec2( xz.x * 7.0, xz.y * 0.5 + uTime * 0.02 ) );
            float creep = ( r - ${(PLINTH_RADIUS * 1.15).toFixed(3)} ) / 0.95 + ( bite - 0.5 ) * 0.6;
            col += vec3( 0.86, 0.93, 1.0 ) * ( 1.0 - smoothstep( 0.0, 1.0, creep ) ) * 0.07;

            // Polish: that light smears toward the viewer — the camera sits out
            // along +z — in a lane that widens as it comes, broken up by the
            // floor's grain so it reads as a reflection and not a gradient.
            float toward = smoothstep( -0.15, 0.4, xz.y );
            float lane = exp( -pow( xz.x / ( 0.3 + 0.32 * max( xz.y, 0.0 ) ), 2.0 ) );
            float run = toward * ( 1.0 - smoothstep( 0.8, 5.2, xz.y ) );
            // Warm close to the chamber and cooling as it runs out, the way a
            // reflection loses the colour of its source with distance.
            vec3 lit = mix( vec3( 1.0, 0.96, 0.91 ), vec3( 0.95, 0.97, 1.0 ), smoothstep( 0.4, 3.0, xz.y ) );
            col += lit * lane * run * ( 0.2 + 0.2 * ( bite - 0.5 ) );

            // And a wide, much fainter sheen either side of the lane, so the
            // reflection has a falloff rather than an edge.
            col += vec3( 0.95, 0.97, 1.0 ) * exp( -pow( xz.x / 1.5, 2.0 ) ) * run * 0.07;

            // Thinner close to the chamber, so the mark's reflection standing
            // under the floor shows up through it, and solid further out where
            // there is nothing beneath to see.
            float alpha = mix( 0.62, 1.0, smoothstep( 0.6, 3.4, r ) );
            float far = length( xz - cameraPosition.xz );
            alpha *= 1.0 - smoothstep( 10.0, 13.0, far );

            gl_FragColor = vec4( col, alpha * uLevel );
          }
        `,
        transparent: true,
        depthWrite: false,
      }),
    []
  );
  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uLevel.value = levels.current.room;
  });

  return (
    <mesh position={[0, LAKE_Y, 0]} rotation-x={-Math.PI / 2} material={material} frustumCulled={false}>
      <circleGeometry args={[14, MODEST ? 64 : 128]} />
    </mesh>
  );
}

// The gallery itself, painted on a dome kept around the camera.
//
// It is kept in the opaque list (not `transparent`) and blended with custom
// blending instead, because anything refracting or reflecting in this room only
// picks up what was drawn before it.
function Studio({ levels }) {
  const ref = useRef(null);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uLevel: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize( position );
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uLevel;
          varying vec3 vDir;

          vec3 gallery( vec3 d ) {
            float h = d.y;
            // Azimuth, zero straight ahead. The set dressing is placed by angle,
            // so a wide window sees more wall either side of the chamber.
            float a = atan( d.x, -d.z );

            // The wall, bouncing lighter toward the floor. Deeper than a
            // white sweep would be: with the chamber's own light this bright,
            // walls any paler leave nothing for it to read against.
            vec3 c = mix( vec3( 0.645, 0.695, 0.762 ), vec3( 0.398, 0.452, 0.535 ), smoothstep( -0.1, 0.22, h ) );

            // Above the soffit line it turns over into the ceiling and deepens.
            c = mix( c, vec3( 0.311, 0.364, 0.430 ), smoothstep( 0.16, 0.34, h ) );

            // The lit seam where the ceiling meets the wall, right round the
            // room. Low enough to be in frame: the room view sees barely ten
            // degrees above the mark.
            // Kept faint and narrow. Any stronger and it stops being the edge
            // of a ceiling and becomes a bright bar ruled across the frame at
            // the height of the chamber's shoulder.
            c += vec3( 1.0, 0.95, 0.87 ) * exp( -pow( ( h - 0.19 ) / 0.009, 2.0 ) ) * 0.15;

            // The chamber's own light bouncing back off the floor onto the
            // bottom of the wall. Broad and very faint — it is the difference
            // between a room and a backdrop.
            c += vec3( 1.0, 0.93, 0.82 ) * exp( -pow( ( h + 0.015 ) / 0.11, 2.0 ) ) * 0.05;

            // No opening and no wall washes: the walls are one even sweep, so
            // the only light in the frame is the chamber's own.
            return c;
          }

          void main() {
            vec3 d = normalize( vDir );
            // Below the horizon the room carries on mirrored and a shade
            // deeper, eased rather than stepped so the halves meet without a
            // band. The floor covers most of it.
            float below = smoothstep( 0.0, 0.2, -d.y );
            vec3 c = gallery( vec3( d.x, abs( d.y ), d.z ) ) * mix( 1.0, 0.82, below );
            gl_FragColor = vec4( c, smoothstep( 0.0, 0.5, uLevel ) );
          }
        `,
        side: BackSide,
        transparent: false,
        blending: CustomBlending,
        blendSrc: SrcAlphaFactor,
        blendDst: OneMinusSrcAlphaFactor,
        depthWrite: false,
      }),
    []
  );
  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ camera }) => {
    material.uniforms.uLevel.value = levels.current.room;
    if (ref.current) ref.current.position.copy(camera.position);
  });

  return (
    <mesh ref={ref} material={material} renderOrder={-9} frustumCulled={false}>
      {/* Inside the ice page's backdrop sphere (radius 30), which writes
          depth: anything beyond it is never drawn. */}
      <sphereGeometry args={[20, 16, 8]} />
    </mesh>
  );
}

export default function RingRoom({ levels, hover, touch }) {
  const group = useRef(null);

  useFrame(() => {
    if (group.current) group.current.visible = levels.current.room > 0.001;
  });

  return (
    <group ref={group} visible={false}>
      <Studio levels={levels} />
      <Floor levels={levels} />
      {/* The chamber and its rig are modelled in the mark's own frame, so they
          hang off the mark's height rather than the room's. */}
      <group position={[0, LOGO_Y, 0]}>
        <GlassContainer levels={levels} hover={hover} touch={touch} />
        <TubeRig levels={levels} />
      </group>
    </group>
  );
}
