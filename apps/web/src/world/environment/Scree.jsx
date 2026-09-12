import { useEffect, useMemo, useRef } from 'react';
import { Color, Object3D } from 'three';
import { iceMapsFor } from '../lib/baked.js';
import { makeRockGeometry, apronPlacements } from '../lib/scatter.js';

// Instanced scree stones scattered around the igloo structure

const SHAPES = 4;
const APRON_COUNT = 90;

// Snow accumulation based on mapped normals
const snowOnStones = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <normal_fragment_maps>',
    `#include <normal_fragment_maps>

     vec3 skyward = inverseTransformDirection( normal, viewMatrix );
     float collects = smoothstep( 0.18, 0.82, skyward.y );

     float relief = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
     float holds = mix( 0.22, 1.0, smoothstep( 0.10, 0.26, relief ) );
     float lying = collects * holds;

     // Snow color highlight
     diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.545, 0.567, 0.601 ), lying * 0.82 );
     roughnessFactor = mix( roughnessFactor, 0.97, lying * 0.85 );

     // Contact shadow ambient darkening
     float sunk = smoothstep( 0.15, -0.55, skyward.y );
     diffuseColor.rgb *= mix( 1.0, 0.42, sunk );`
  );
};

// Instanced stone field
function Field({ geometry, placements, tier, maps, castShadow = false }) {
  const meshRef = useRef(null);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || placements.length === 0) return;

    const dummy = new Object3D();
    const tint = new Color();

    for (let i = 0; i < placements.length; i += 1) {
      const p = placements[i];
      const r = p.rng;
      const r2 = (r * 7.13) % 1;
      const r3 = (r * 31.7) % 1;
      const r4 = (r * 91.3) % 1;

      // Size distribution with bias toward smaller stones
      const size = (tier.min + (tier.max - tier.min) * Math.pow(r, tier.bias)) * (p.scale || 1);

      const sx = size * (0.88 + r2 * 0.3);
      const sy = size * (0.78 + r3 * 0.34);
      const sz = size * (0.88 + r4 * 0.3);

      // Sunk slightly into the ground
      dummy.position.set(p.x, p.y - sy * (0.2 + r3 * 0.26), p.z);
      dummy.rotation.set((r2 - 0.5) * 0.42, r * Math.PI * 2, (r4 - 0.5) * 0.42);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // Slight tone variation per stone
      const shade = 0.78 + r3 * 0.44;
      tint.setRGB(shade * (1 + (r2 - 0.5) * 0.06), shade, shade * (1 + (r4 - 0.5) * 0.05));
      mesh.setColorAt(i, tint);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // Recompute bounding sphere for frustum culling
    mesh.computeBoundingSphere();
  }, [placements, tier]);

  if (placements.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, placements.length]}
      castShadow={castShadow}
      receiveShadow
    >
      <meshStandardMaterial
        color="#3a3f47"
        roughness={0.82}
        metalness={0}
        map={maps.colorMap}
        aoMap={maps.aoMap}
        aoMapIntensity={1.1}
        roughnessMap={maps.roughnessMap}
        normalMap={maps.normalMap}
        normalScale={[1.35, 1.35]}
        envMapIntensity={0.55}
        onBeforeCompile={snowOnStones}
        dithering
      />
    </instancedMesh>
  );
}

export default function Scree() {
  const maps = useMemo(() => iceMapsFor('scree'), []);

  const shapes = useMemo(
    () =>
      Array.from({ length: SHAPES }, (_, i) =>
        makeRockGeometry({
          seed: 31 + i * 17,
          detail: i === SHAPES - 1 ? 2 : 1,
          forms: 4 + i,
          bumps: 10 + i * 4,
          flatten: 0.78 + i * 0.06,
        })
      ),
    []
  );

  // Distribute shapes across apron positions
  const fields = useMemo(() => {
    const apron = apronPlacements({ count: APRON_COUNT, inner: 26, outer: 46, bias: 2.6, seed: 7 });

    const bins = Array.from({ length: SHAPES }, () => []);
    apron.forEach((p, i) => bins[i % SHAPES].push(p));

    return { bins };
  }, []);

  return (
    <group>
      {shapes.map((geometry, i) => (
        <Field
          key={i}
          geometry={geometry}
          placements={fields.bins[i]}
          tier={{ min: 0.14, max: 1.15, bias: 2.8 }}
          maps={maps}
        />
      ))}
    </group>
  );
}
