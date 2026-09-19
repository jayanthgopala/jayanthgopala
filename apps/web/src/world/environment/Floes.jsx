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
import { WATER_Y, heightAt } from '../lib/terrain.js';
import { makeNoise2D } from '../lib/noise.js';
import { revealAt, withReveal } from '../lib/reveal.js';
import { useWorldScroll } from '../scroll/ScrollProvider.jsx';

// Broken sea ice drifting on the fjord: flat irregular slabs, snow on top and
// blue ice down the sides, riding a little above the surface.

const SEED = 4127;
const VARIANTS = 4;
const COUNT = 96;

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
const ICE = [0.22, 0.58, 0.72];

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
      noise(Math.cos(a) * 9 - 2, Math.sin(a) * 9 + variant) * 0.035;
    const stretch = 1 + variant * 0.12;
    // Rounded shoulder up to a gently uneven crown; the keel stays deep.
    const y =
      v.y > 0
        ? CROWN * (1 - Math.pow(1 - v.y, 3)) +
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
  if (heightAt(x, z) > WATER_Y - 0.8) return false;
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    if (heightAt(x + Math.cos(a) * r * 1.2, z + Math.sin(a) * r * 1.2) > WATER_Y - 0.3) return false;
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
    if (Math.hypot(x - 26, z - 290) < 24) continue;

    // Larger toward the camera, where the reference's big slabs sit.
    const nearness = Math.min(1, Math.max(0, (z - 150) / 350));
    const r = Math.min(8, (2.5 + rand() * 4.5) * (1 + nearness * 1.3));
    if (!afloat(x, z, r)) continue;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < (p.r + r) * 1.25)) continue;

    placed.push({
      x,
      z,
      r,
      variant: Math.floor(rand() * VARIANTS),
      yaw: rand() * Math.PI * 2,
      thickness: 4 + rand() * 3,
      freeboard: 1.0 + rand() * 1.2,
      phase: rand() * Math.PI * 2,
    });
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
    m.onBeforeCompile = (shader) => withReveal(shader, uReveal.current);
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
      members.forEach((f, i) => {
        // A slow heave and a slight roll on the swell.
        const t = calm ? 0 : time;
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
