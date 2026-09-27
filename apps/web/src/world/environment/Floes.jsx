import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  IcosahedronGeometry,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WATER_Y, groundAt } from '../lib/terrain.js';
import { makeNoise2D } from '../lib/noise.js';
import { revealAt, withReveal } from '../lib/reveal.js';
import { useWorldScroll } from '../scroll/ScrollProvider.jsx';
import { LOOK } from '../lib/lighting.js';
import { RUN_CURVE, openWaterDistance } from '../lib/dock.js';

// Broken sea ice drifting on the fjord: flat irregular slabs, snow on top and
// blue ice down the sides, riding a little above the surface. When the look
// freezes the fjord over they are frozen in instead: low drifts and pressure
// slabs of snow standing still in the sheet, clear of the open lead.
const FROZEN = Boolean(LOOK.ice);

const SEED = 4127;
const VARIANTS = 4;
const COUNT = 96;
const BRASH = 80;
// Chunks afloat in the open water (the lead and the channel), and how far
// they keep from the boat's course.
const FLOATS = 26;
const COURSE_CLEAR = 9;
const COURSE = RUN_CURVE.getSpacedPoints(60);

// Where floes may drift, and the clear water kept around the camera's path.
const AREA = { x: [-400, 400], z: [-40, 470] };
// Clear water just under the opening camera, so no slab fills the frame.
const CAMERA_AT = [22, 362];
const CAMERA_CLEAR = 26;
// Half the floes are drawn from the water in front of the opening view.
const NEAR = { x: [-140, 170], z: [282, 430] };

function createRng(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

const SNOW = [0.93, 0.955, 0.99];
const ICE = FROZEN ? [0.36, 0.6, 0.84] : [0.22, 0.58, 0.72];

/**
 * One slab: a sphere pressed into a pillow of ice, broken-edged in plan, with
 * a low rounded crown of snow and a deep keel. Its crown sits at y = 0.
 */
const CROWN = 0.26;

function floeGeometry(variant) {
  const noise = makeNoise2D(SEED + variant * 97);
  // Shared corners, so the shoulder shades smooth rather than faceted.
  const geometry = mergeVertices(new IcosahedronGeometry(1, 4).deleteAttribute('normal').deleteAttribute('uv'));
  const pos = geometry.attributes.position;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.z, v.x);
    // Lobes and a jag round the rim, so edges read as broken, not round.
    const rim =
      0.82 +
      noise(Math.cos(a) * 0.9 + variant, Math.sin(a) * 0.9) * 0.22 +
      noise(Math.cos(a) * 3.4 + 5, Math.sin(a) * 3.4 - variant) * 0.1 +
      noise(Math.cos(a) * 13 - 2, Math.sin(a) * 13 + variant) * 0.06;
    const stretch = 1 + variant * 0.12;
    // Rounded shoulder up to a gently uneven crown; the keel stays deep.
    const y =
      v.y > 0
        ? CROWN * (1 - Math.pow(1 - v.y, 6)) +
          (noise(v.x * 2.2, v.z * 2.2) * 0.07 + noise(v.x * 6.1 + 3, v.z * 6.1) * 0.025) * v.y
        : v.y * 0.9;
    pos.setXYZ(i, v.x * rim * stretch, y - CROWN, v.z * rim);
  }
  geometry.computeVertexNormals();

  // Snow where the surface faces up, clear blue ice down the sides.
  const normal = geometry.attributes.normal;
  const colors = new Float32Array(normal.count * 3);
  for (let i = 0; i < normal.count; i += 1) {
    const up = Math.min(1, Math.max(0, (normal.getY(i) - 0.45) / 0.4));
    for (let k = 0; k < 3; k += 1) colors[i * 3 + k] = ICE[k] + (SNOW[k] - ICE[k]) * up;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

/** Whether a floe of this radius sits wholly on open water. */
function afloat(x, z, r) {
  // A floe draws most of its own depth, so it may ride over the shallows; it
  // only has to stay clear of ground that breaks the surface.
  if (groundAt(x, z) > WATER_Y - 0.8) return false;
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    if (groundAt(x + Math.cos(a) * r * 1.2, z + Math.sin(a) * r * 1.2) > WATER_Y - 0.3) return false;
  }
  return true;
}

function placeFloes() {
  const rand = createRng(SEED);
  const placed = [];
  let tries = 0;
  while (placed.length < COUNT && tries < 4000) {
    tries += 1;
    const box = tries % 2 === 0 ? NEAR : AREA;
    const x = box.x[0] + rand() * (box.x[1] - box.x[0]);
    const z = box.z[0] + rand() * (box.z[1] - box.z[0]);
    if (Math.hypot(x - CAMERA_AT[0], z - CAMERA_AT[1]) < CAMERA_CLEAR) continue;
    // Keep the moorings clear: the boat and the dock posts.
    if (Math.hypot(x - 32, z - 295) < 26) continue;

    // Larger toward the camera, where the reference's big slabs sit.
    const nearness = Math.min(1, Math.max(0, (z - 150) / 350));
    const r = Math.min(11, (2.5 + rand() * 4.5) * (1 + nearness * 1.6));
    if (!afloat(x, z, r)) continue;
    // Clear of the boat's course, and apart from each other so each slab
    // reads on its own with dark water between.
    if (COURSE.some((p) => Math.hypot(p.x - x, p.z - z) < COURSE_CLEAR + r)) continue;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < (p.r + r) * 1.5)) continue;

    placed.push({
      x,
      z,
      r,
      variant: Math.floor(rand() * VARIANTS),
      yaw: rand() * Math.PI * 2,
      thickness: FROZEN ? 2.2 + rand() * 2.2 : 4 + rand() * 3,
      freeboard: FROZEN ? 0.35 + rand() * 0.7 : 1.0 + rand() * 1.2,
      phase: rand() * Math.PI * 2,
      // Out in the open water it floats; in the sheet ice it is frozen in.
      float: FROZEN && openWaterDistance(x, z) < -1.5,
    });
  }
  // Brash: small broken pieces scattered between the floes and along the
  // island's edge, so the ice varies in size as it does on real water.
  let brash = 0;
  tries = 0;
  while (brash < BRASH && tries < 4000) {
    tries += 1;
    const box = tries % 3 === 0 ? AREA : NEAR;
    const x = box.x[0] + rand() * (box.x[1] - box.x[0]);
    const z = box.z[0] + rand() * (box.z[1] - box.z[0]);
    if (Math.hypot(x - CAMERA_AT[0], z - CAMERA_AT[1]) < CAMERA_CLEAR) continue;
    if (Math.hypot(x - 32, z - 295) < 20) continue;
    if (COURSE.some((p) => Math.hypot(p.x - x, p.z - z) < COURSE_CLEAR)) continue;
    const r = 0.7 + rand() * 1.8;
    if (!afloat(x, z, r)) continue;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 0.6)) continue;
    placed.push({
      x,
      z,
      r,
      variant: Math.floor(rand() * VARIANTS),
      yaw: rand() * Math.PI * 2,
      thickness: FROZEN ? 0.9 + rand() * 0.8 : 1.4 + rand() * 1.2,
      freeboard: FROZEN ? 0.12 + rand() * 0.25 : 0.35 + rand() * 0.45,
      phase: rand() * Math.PI * 2,
      float: FROZEN && openWaterDistance(x, z) < -1.5,
    });
    brash += 1;
  }
  // Chunks broken off into the open water, riding in it: along the edges of
  // the lead and the channel, never on the boat's course.
  let floats = 0;
  tries = 0;
  while (floats < FLOATS && tries < 6000) {
    tries += 1;
    const x = -10 + rand() * 170;
    const z = 40 + rand() * 300;
    const edge = openWaterDistance(x, z);
    if (edge > -2.5 || edge < -10) continue;
    if (COURSE.some((p) => Math.hypot(p.x - x, p.z - z) < COURSE_CLEAR)) continue;
    if (Math.hypot(x - 30, z - 301) < 16) continue;
    const r = 1.1 + rand() * 2.4;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 0.8)) continue;
    placed.push({
      x,
      z,
      r,
      variant: Math.floor(rand() * VARIANTS),
      yaw: rand() * Math.PI * 2,
      thickness: 1.3 + rand() * 0.9,
      freeboard: 0.3 + rand() * 0.3,
      phase: rand() * Math.PI * 2,
      float: true,
    });
    floats += 1;
  }
  return placed;
}

export default function Floes() {
  const { intro } = useWorldScroll();
  const uReveal = useRef({ value: 0 });
  const calm = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );

  const material = useMemo(() => {
    const m = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.62,
      metalness: 0,
      envMapIntensity: 0.8,
    });
    m.onBeforeCompile = (shader) => {
      withReveal(shader, uReveal.current);
      // Wind-packed grain and a frost sparkle on the snow, and cold light
      // glowing through the ice down the sides.
      shader.fragmentShader = shader.fragmentShader
        .replace(
          'void main() {',
          `float floeHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
           float floeNoise( vec2 p ) {
             vec2 i = floor( p ); vec2 f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
             return mix( mix( floeHash( i ), floeHash( i + vec2( 1, 0 ) ), u.x ),
                         mix( floeHash( i + vec2( 0, 1 ) ), floeHash( i + vec2( 1, 1 ) ), u.x ), u.y );
           }
           void main() {`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
           {
             vec2 q = vRevealWorld.xz * 0.9;
             float e = 0.35;
             float n0 = floeNoise( q ) + 0.5 * floeNoise( q * 2.7 );
             float nx = floeNoise( q + vec2( e, 0.0 ) ) + 0.5 * floeNoise( ( q + vec2( e, 0.0 ) ) * 2.7 );
             float nz = floeNoise( q + vec2( 0.0, e ) ) + 0.5 * floeNoise( ( q + vec2( 0.0, e ) ) * 2.7 );
             vec3 bumpW = normalize( vec3( -( nx - n0 ) * 0.9, 1.0, -( nz - n0 ) * 0.9 ) );
             vec3 upW = inverseTransformDirection( normal, viewMatrix );
             float top = smoothstep( 0.5, 0.85, upW.y );
             vec3 bumped = normalize( mix( upW, bumpW, top * 0.55 ) );
             normal = normalize( ( viewMatrix * vec4( bumped, 0.0 ) ).xyz );
             diffuseColor.rgb *= mix( 1.0, 0.9 + 0.12 * n0, top );
           }`
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
           {
             vec3 upW = inverseTransformDirection( normal, viewMatrix );
             float side = 1.0 - smoothstep( 0.35, 0.75, upW.y );
             totalEmissiveRadiance += vec3( 0.03, 0.16, 0.2 ) * side * ${FROZEN ? '0.6' : '1.0'};
             float glitter = step( 0.985, floeHash( floor( vRevealWorld.xz * 6.0 ) ) ) * smoothstep( 0.6, 0.9, upW.y );
             totalEmissiveRadiance += vec3( 1.0, 0.92, 0.8 ) * glitter * 0.9;
           }`
        );
    };
    return m;
  }, []);

  const floes = useMemo(() => placeFloes(), []);

  const meshes = useMemo(() => {
    const out = [];
    for (let v = 0; v < VARIANTS; v += 1) {
      const members = floes.filter((f) => f.variant === v);
      if (members.length === 0) continue;
      const mesh = new InstancedMesh(floeGeometry(v), material, members.length);
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      out.push({ mesh, members });
    }
    return out;
  }, [floes, material]);

  const dummy = useMemo(() => new Object3D(), []);

  const place = (time) => {
    for (const { mesh, members } of meshes) {
      // Frozen in, only the chunks afloat move; a mesh without any is left be.
      if (FROZEN && time > 0 && !members.some((f) => f.float)) continue;
      members.forEach((f, i) => {
        // A slow heave and a slight roll on the swell.
        const t = calm || (FROZEN && !f.float) ? 0 : time;
        const heave = Math.sin(t * 0.55 + f.phase) * 0.12;
        dummy.position.set(f.x, WATER_Y + f.freeboard + heave, f.z);
        dummy.rotation.set(
          Math.sin(t * 0.41 + f.phase * 1.7) * 0.012,
          f.yaw,
          Math.cos(t * 0.37 + f.phase) * 0.012
        );
        dummy.scale.set(f.r, f.thickness, f.r);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  };

  useLayoutEffect(() => {
    place(0);
    return () => {
      for (const { mesh } of meshes) mesh.geometry.dispose();
      material.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meshes, material]);

  useFrame((state) => {
    uReveal.current.value = revealAt(intro.current);
    if (!calm) place(state.clock.elapsedTime);
  });

  return (
    <group name="floes">
      {meshes.map(({ mesh }, i) => (
        <primitive key={i} object={mesh} />
      ))}
    </group>
  );
}
