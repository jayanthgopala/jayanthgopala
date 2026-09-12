import { useEffect, useMemo, useRef } from 'react';
import { Color, Object3D } from 'three';
import { iceMapsFor } from '../lib/baked.js';
import { makeRockGeometry, apronPlacements } from '../lib/scatter.js';

// An apron of scree banked around the igloo. The ground's rock texture has no silhouette, and scale is read off
// objects that break the outline, so these are solids.
// Every stone of a shape is one instance of one geometry, the variety is per-instance transform and tone.

const SHAPES = 4;

// Cut from 300 candidates over a 104-unit ring. The reference has essentially no loose stone, its rock is grain in
// the surface, and ours read as a gravel path. What survives is debris at the foot of the wall where a structure collects it.
const APRON_COUNT = 90;

// Read off the mapped normal here, the opposite of the rule the igloo and terrain follow. They take the geometric
// normal because at their size a per-texel decision gives speckle. A pebble's whole surface is a tile or two across,
// so the mapped normal is its shape at the scale snow settles at, and the snow line follows its own knuckles.
const snowOnStones = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <normal_fragment_maps>',
    `#include <normal_fragment_maps>

     vec3 skyward = inverseTransformDirection( normal, viewMatrix );
     float collects = smoothstep( 0.18, 0.82, skyward.y );

     float relief = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
     float holds = mix( 0.22, 1.0, smoothstep( 0.10, 0.26, relief ) );
     float lying = collects * holds;

     // brighter than the ground's snow at 0.458, these are the nearest things in frame with no haze in front of them
     diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.545, 0.567, 0.601 ), lying * 0.82 );
     roughnessFactor = mix( roughnessFactor, 0.97, lying * 0.85 );

     // Nothing this size casts a shadow, a shadow map texel covers 0.42 units here, so without darkening at the base
     // the stones read as stickers on the snow. Downward facing fragments are what an AO pass would darken anyway.
     float sunk = smoothstep( 0.15, -0.55, skyward.y );
     diffuseColor.rgb *= mix( 1.0, 0.42, sunk );`
  );
};

// tier supplies the size distribution, which is the only thing separating gravel from a boulder, the shapes are scale-free.
function Field({ geometry, placements, tier, maps, castShadow = false }) {
  const meshRef = useRef(null);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || placements.length === 0) return;

    const dummy = new Object3D();
    const tint = new Color();

    for (let i = 0; i < placements.length; i += 1) {
      const p = placements[i];
      // Everything about the instance derives from the placement's own draw. Fresh randoms here would look identical
      // and would reshuffle the whole field whenever the count changed.
      const r = p.rng;
      const r2 = (r * 7.13) % 1;
      const r3 = (r * 31.7) % 1;
      const r4 = (r * 91.3) % 1;

      // Biased small, a power above 1 pushes the mass low, which is how scree sits. scale carries the satellite reduction.
      const size = (tier.min + (tier.max - tier.min) * Math.pow(r, tier.bias)) * (p.scale || 1);

      const sx = size * (0.88 + r2 * 0.3);
      const sy = size * (0.78 + r3 * 0.34);
      const sz = size * (0.88 + r4 * 0.3);

      // Sunk into the bed. A stone resting on a surface reads as placed a moment ago, one part buried has been there.
      dummy.position.set(p.x, p.y - sy * (0.2 + r3 * 0.26), p.z);
      // full spin about Y, only a slight tip, a steeply tilted stone reads as thrown
      dummy.rotation.set((r2 - 0.5) * 0.42, r * Math.PI * 2, (r4 - 0.5) * 0.42);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // multiplies the map, so it moves a stone's level without touching the map's own light to dark ramp
      const shade = 0.78 + r3 * 0.44;
      tint.setRGB(shade * (1 + (r2 - 0.5) * 0.06), shade, shade * (1 + (r4 - 0.5) * 0.05));
      mesh.setColorAt(i, tint);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // An InstancedMesh left alone takes its bounding sphere from the source mesh, a unit sphere at the origin, so the
    // whole field is culled the moment the world origin leaves the frustum, which on this path is immediately.
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
      {/* The map's own range is a warm mid-grey, right for dry rock. This takes it to cold near-black slate so the
          stone belongs to the same light as the ice, and so a dusting of snow on it still has contrast. */}
      <meshStandardMaterial
        color="#3a3f47"
        roughness={0.82}
        metalness={0}
        map={maps.colorMap}
        aoMap={maps.aoMap}
        aoMapIntensity={1.1}
        roughnessMap={maps.roughnessMap}
        normalMap={maps.normalMap}
        // strong, these are seen closer than anything else and the relief is what separates a stone from a grey blob
        normalScale={[1.35, 1.35]}
        // matched to the terrain's, a stone lit by more sky than the snow it sits on reads as a cutout
        envMapIntensity={0.55}
        onBeforeCompile={snowOnStones}
        dithering
      />
    </instancedMesh>
  );
}

export default function Scree() {
  // parameters in ice-sets.js under scree. High frequency unlike the ground's, a stone's whole surface is one tile
  // so the fracture detail has to be packed into it.
  const maps = useMemo(() => iceMapsFor('scree'), []);

  const shapes = useMemo(
    () =>
      Array.from({ length: SHAPES }, (_, i) =>
        makeRockGeometry({
          seed: 31 + i * 17,
          // 80 triangles a stone. The lobes give the silhouette and the normal map the surface, so subdividing buys
          // a rounder outline and nothing else, paid six hundred times over.
          detail: i === SHAPES - 1 ? 2 : 1,
          forms: 4 + i,
          bumps: 10 + i * 4,
          flatten: 0.78 + i * 0.06,
        })
      ),
    []
  );

  // Split by index rather than by region, which is what keeps the four shapes mixed everywhere instead of in patches.
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
          // chips and cobbles only, anything bigger beside the dome competes with it
          tier={{ min: 0.14, max: 1.15, bias: 2.8 }}
          maps={maps}
        />
      ))}

    </group>
  );
}
