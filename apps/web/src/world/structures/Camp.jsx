import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  Color,
  DoubleSide,
  IcosahedronGeometry,
  Vector3,
} from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeNoise2D } from '../lib/noise.js';

// The igloo's camp: rocks breaking through the snow in the foreground and a
// line of trail markers with red flags beside the footprints. The red is the
// minimal site's own (#8E2420).

const SEAL = '#8e2420';
const noise = makeNoise2D(7121);

// x, z, size, squash, turn
const ROCKS = [
  { x: -70, z: 312, s: 6.5, sq: 0.75, r: 0.4 },
  { x: -60, z: 318, s: 3.2, sq: 0.8, r: 1.9 },
  { x: -82, z: 302, s: 4.2, sq: 0.7, r: 2.7 },
  { x: -48, z: 304, s: 1.8, sq: 0.8, r: 0.9 },
  { x: 46, z: 290, s: 3.4, sq: 0.7, r: 1.3 },
  { x: 54, z: 296, s: 1.8, sq: 0.75, r: 2.2 },
];

// Markers stand a little to the left of the footprints, up to the door.
const MARKERS = [
  { x: -22, z: 322, h: 6.6, lean: 0.05 },
  { x: -21, z: 304, h: 6.8, lean: -0.04 },
  { x: -10, z: 279, h: 6.4, lean: 0.03 },
];

function rockGeometry(seed) {
  // Welded, so the stone shades smooth rather than as flat facets.
  const geo = mergeVertices(new IcosahedronGeometry(1, 5).deleteAttribute('normal').deleteAttribute('uv'));
  const pos = geo.attributes.position;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n =
      noise(v.x * 0.9 + seed, v.z * 0.9 - seed) * 0.2 +
      noise(v.y * 1.8 - seed, v.x * 1.8 + seed * 0.5) * 0.07;
    // Flatter on top, as snow-scoured stone weathers.
    v.multiplyScalar(1 + n);
    if (v.y > 0.35) v.y = 0.35 + (v.y - 0.35) * 0.6;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

// Stone with snow lying on whatever faces the sky.
function snowOnStone(shader) {
  shader.vertexShader = 'varying vec3 vCampN;\nvarying vec3 vCampP;\n' + shader.vertexShader.replace(
    '#include <begin_vertex>',
    '#include <begin_vertex>\n  vCampN = normalize( mat3( modelMatrix ) * objectNormal );\n  vCampP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;'
  );
  shader.fragmentShader = 'varying vec3 vCampN;\nvarying vec3 vCampP;\n' + shader.fragmentShader.replace(
    '#include <color_fragment>',
    [
      '#include <color_fragment>',
      'float campGrain = fract( sin( dot( floor( vCampP.xz * 3.0 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );',
      'diffuseColor.rgb *= 0.92 + 0.12 * campGrain;',
      'float campSnow = smoothstep( 0.18, 0.5, vCampN.y + ( campGrain - 0.5 ) * 0.12 );',
      'diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.95, 0.97, 1.0 ), campSnow );',
    ].join('\n')
  );
}

// A flag that ripples in the wind: the sheet bends more toward its free edge.
const FLAG_VERT = `
uniform float uTime;
uniform float uGust;
varying vec2 vUv;
varying float vShade;
void main() {
  vUv = uv;
  vec3 p = position;
  float free = uv.x;
  float wave = sin( uv.x * 6.0 - uTime * ( 7.0 + uGust * 6.0 ) ) * ( 0.18 + uGust * 0.25 ) * free;
  p.z += wave;
  p.y -= free * free * 0.12;
  vShade = 0.82 + 0.18 * cos( uv.x * 6.0 - uTime * ( 7.0 + uGust * 6.0 ) );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( p, 1.0 );
}
`;
const FLAG_FRAG = `
uniform vec3 uColor;
varying vec2 vUv;
varying float vShade;
void main() {
  gl_FragColor = vec4( uColor * vShade, 1.0 );
  #include <colorspace_fragment>
}
`;

function Marker({ m, groundAt }) {
  const gust = useRef(0);
  const uniforms = useMemo(
    () => ({ uTime: { value: Math.random() * 10 }, uGust: { value: 0 }, uColor: { value: new Color(SEAL) } }),
    []
  );
  const y = groundAt(m.x, m.z);
  useFrame((state, delta) => {
    uniforms.uTime.value += Math.min(delta, 0.05);
    gust.current = Math.max(0, gust.current - delta * 0.6);
    uniforms.uGust.value = gust.current;
  });
  return (
    <group position={[m.x, y - 0.4, m.z]} rotation={[0, 0, m.lean]} onPointerOver={() => (gust.current = 1)}>
      <mesh position={[0, m.h / 2, 0]} castShadow>
        <cylinderGeometry args={[0.13, 0.16, m.h, 6]} />
        <meshStandardMaterial color="#4a3a2c" roughness={0.9} />
      </mesh>
      <mesh position={[0.9, m.h - 0.75, 0]}>
        <planeGeometry args={[1.8, 1.05, 16, 4]} />
        <shaderMaterial uniforms={uniforms} vertexShader={FLAG_VERT} fragmentShader={FLAG_FRAG} side={DoubleSide} />
      </mesh>
    </group>
  );
}

export default function Camp({ groundAt }) {
  const rocks = useMemo(() => ROCKS.map((r, i) => ({ ...r, geo: rockGeometry(i * 3.7 + 1.1), y: groundAt(r.x, r.z) })), [groundAt]);
  useEffect(() => () => rocks.forEach((r) => r.geo.dispose()), [rocks]);
  return (
    <group>
      {rocks.map((r, i) => (
        <mesh
          key={i}
          geometry={r.geo}
          position={[r.x, r.y - r.s * r.sq * 0.12, r.z]}
          rotation={[0, r.r, 0]}
          scale={[r.s, r.s * r.sq, r.s * 0.85]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial color="#8a93a3" roughness={0.92} onBeforeCompile={snowOnStone} />
        </mesh>
      ))}
      {MARKERS.map((m, i) => (
        <Marker key={i} m={m} groundAt={groundAt} />
      ))}
    </group>
  );
}
