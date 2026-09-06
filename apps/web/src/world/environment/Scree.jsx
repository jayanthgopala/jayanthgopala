import { useEffect, useMemo, useRef } from 'react';
import { Color, Object3D } from 'three';
import { iceMapsFor } from '../lib/baked.js';
import { makeRockGeometry, apronPlacements } from '../lib/scatter.js';

/**
 * Loose stone: an apron of scree banked around the igloo, a sparse drift down
 * the corridor, and a handful of boulders standing in the middle distance.
 *
 * THIS IS THE THING THE TERRAIN CANNOT DO. The ground now carries a rock
 * texture that breaks through the ice wherever the landform is steep (see
 * Terrain.jsx), and a texture is the right tool for the surface — but it lives
 * in the plane and therefore has no silhouette. Scale in a landscape is read
 * off objects that break the outline of the ground: the moment a stone stands
 * proud of the snow with the key on one side of it and its own shadowed flank
 * on the other, the snow behind it acquires a distance. That is what the apron
 * buys, and it is why these are solids and not more texture.
 *
 * FIVE DRAW CALLS FOR SIX HUNDRED STONES. Every stone of a given shape is one
 * instance of one geometry, so the field costs one draw per shape plus one for
 * the boulders. The variety comes from per-instance rotation, non-uniform scale
 * and tone rather than from per-instance meshes — the same trade the igloo
 * makes for its blocks.
 */

/** How many shapes are authored. Everything else is transform. */
const SHAPES = 4;

/*
 * CUT FROM 300 CANDIDATES OVER A 104-UNIT RING TO 90 OVER A 46-UNIT ONE — and
 * the drift down the corridor and the standing boulders are gone entirely.
 *
 * MEASURED AGAINST THE REFERENCE, which has essentially no loose stone in it at
 * all. Its ground carries dark rock as GRAIN IN THE SURFACE, not as objects
 * lying on it; you can look across its whole plain and not find a single
 * discrete pebble. Ours had several hundred spread to the horizon, and however
 * well each one was modelled the effect was a gravel path, which is the one
 * thing that stopped the two frames reading as the same place.
 *
 * What survives is the honest part of the idea: a little debris gathered right
 * at the foot of the wall, where a structure genuinely collects it. Close in it
 * gives the base something to sit in and gives the eye a scale reference next
 * to the blocks; further out it was only ever decoration.
 */
const APRON_COUNT = 90;

/**
 * SNOW GATHERS ON THE STONES, and it is read off the MAPPED normal here — the
 * opposite of the rule the igloo and the terrain follow.
 *
 * Both of those take the geometric normal deliberately, because at their size a
 * per-texel decision produces speckle rather than drifts: a dome is metres
 * across and the texture on it is centimetres, so letting every pit vote gives
 * noise. A pebble is the size of the texture. Its whole surface is a tile or
 * two across, so the mapped normal IS its shape at the scale snow settles at,
 * and using it is what gives each stone a ragged snow line following its own
 * knuckles instead of a clean band drawn round its equator.
 *
 * The albedo term does the rest: snow holds on the pale raised parts and slips
 * off the dark hollows, so the edge is broken rather than drawn.
 */
const snowOnStones = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <normal_fragment_maps>',
    `#include <normal_fragment_maps>

     vec3 skyward = inverseTransformDirection( normal, viewMatrix );
     float collects = smoothstep( 0.18, 0.82, skyward.y );

     float relief = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
     float holds = mix( 0.22, 1.0, smoothstep( 0.10, 0.26, relief ) );
     float lying = collects * holds;

     /*
      * A LITTLE BRIGHTER THAN THE GROUND'S SNOW, which sits at 0.458.
      *
      * These are the nearest things in the frame and the terrain's value is
      * tuned for ground seen through a hundred units of haze. Matching the
      * number would match the wrong thing: snow on a stone two metres away has
      * almost no air in front of it, so it has to render lighter to read as the
      * same material.
      */
     diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.545, 0.567, 0.601 ), lying * 0.82 );
     roughnessFactor = mix( roughnessFactor, 0.97, lying * 0.85 );

     /*
      * A DARKENED UNDERSIDE, AND IT IS WHAT PUTS THEM ON THE GROUND.
      *
      * Nothing at this size casts a shadow — a shadow-map texel covers 0.42
      * world units here, so a half-metre pebble's shadow is a texel and a half
      * and renders as a smear or as nothing. Without some darkening at the base
      * the stones read as stickers laid on the snow.
      *
      * Downward-facing fragments are exactly the ones an ambient occlusion pass
      * would darken, because what they can see is the ground a few centimetres
      * away. The complement of skyward.y is that computation, for free, from a
      * normal that is already here.
      */
     float sunk = smoothstep( 0.15, -0.55, skyward.y );
     diffuseColor.rgb *= mix( 1.0, 0.42, sunk );`
  );
};

/**
 * One instanced field.
 *
 * `tier` supplies the size distribution, because that is the only thing really
 * separating gravel from a boulder — the shapes themselves are scale-free,
 * which is why four of them cover the whole range.
 */
function Field({ geometry, placements, tier, maps, castShadow = false }) {
  const meshRef = useRef(null);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || placements.length === 0) return;

    const dummy = new Object3D();
    const tint = new Color();

    for (let i = 0; i < placements.length; i += 1) {
      const p = placements[i];
      /*
       * The placement's own random draw drives everything about the instance,
       * so a stone's size, spin and tone all follow from where it landed.
       * Pulling fresh randoms here would look identical and would mean the
       * whole field reshuffled whenever the count changed; this way it does not.
       */
      const r = p.rng;
      const r2 = (r * 7.13) % 1;
      const r3 = (r * 31.7) % 1;
      const r4 = (r * 91.3) % 1;

      /*
       * BIASED SMALL. Raising a uniform draw to a power above 1 pushes the mass
       * toward the low end, which is how scree is actually distributed: a great
       * many chips, some cobbles, few blocks. An unbiased draw gives an even
       * spread of sizes and reads as a bag of aggregate tipped out.
       */
      /* `scale` carries the satellite reduction — debris is smaller than the
         stone it fell off. It is 1 for everything placed in its own right. */
      const size = (tier.min + (tier.max - tier.min) * Math.pow(r, tier.bias)) * (p.scale || 1);

      /* Wider than they are tall, but only a little: see flatten in scatter.js
         for what happens when this is pushed. */
      const sx = size * (0.88 + r2 * 0.3);
      const sy = size * (0.78 + r3 * 0.34);
      const sz = size * (0.88 + r4 * 0.3);

      /* Sunk into the bed. A stone resting ON a surface reads as placed there a
         moment ago; one with its lower fifth buried has been there all winter. */
      dummy.position.set(p.x, p.y - sy * (0.2 + r3 * 0.26), p.z);
      /* A full spin about Y, and only a slight tip — a stone settled in snow
         lies nearly level, and steeply tilted ones read as thrown. */
      dummy.rotation.set((r2 - 0.5) * 0.42, r * Math.PI * 2, (r4 - 0.5) * 0.42);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      /*
       * Per-instance tone. Small — this is one rock type weathering unevenly,
       * not several. It multiplies the map, so it moves a stone's overall level
       * without touching the map's own light-to-dark ramp.
       */
      const shade = 0.78 + r3 * 0.44;
      tint.setRGB(shade * (1 + (r2 - 0.5) * 0.06), shade, shade * (1 + (r4 - 0.5) * 0.05));
      mesh.setColorAt(i, tint);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    /*
     * Bounds computed from the instance matrices, not from the geometry. An
     * InstancedMesh left alone takes its bounding sphere from the source mesh —
     * a unit sphere at the origin — so the entire field would be culled the
     * moment the world origin left the frustum, which on this camera path is
     * immediately.
     */
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
      {/*
        DARK, COLD STONE. The map's own range is a warm mid-grey — see the rock
        variant in ice-texture.js, where that is correct for dry rock — and this
        tint takes it down to the near-black slate the reference's outcrops are
        and leans the hue cold, so the stone belongs to the same light as the
        ice rather than looking like desert rock dropped into a snowfield.

        Dark is also what makes the snow term work: the whole point of the
        stones is contrast against the white, and a mid-grey stone under a
        dusting of snow has none.
      */}
      <meshStandardMaterial
        /*
         * DARKER AGAIN, from #4b5059, and it is a measurement rather than a
         * preference. The reference's foreground runs from p10 83 to p90 179;
         * ours ran 123 to 142, and nothing in our frame was dark. Loose stone
         * near the lens is the cheapest available source of a genuine dark end,
         * and it can only supply one if it is actually dark.
         */
        color="#3a3f47"
        roughness={0.82}
        metalness={0}
        map={maps.colorMap}
        aoMap={maps.aoMap}
        aoMapIntensity={1.1}
        roughnessMap={maps.roughnessMap}
        normalMap={maps.normalMap}
        /* Strong. These are seen closer than anything else in the world, and
           the relief is the only thing separating a stone from a grey blob. */
        normalScale={[1.35, 1.35]}
        /* Matched to the terrain's. A stone lit by more sky than the snow it
           sits on reads as a cutout pasted over the shot. */
        envMapIntensity={0.55}
        onBeforeCompile={snowOnStones}
        dithering
      />
    </instancedMesh>
  );
}

export default function Scree() {
  /*
   * Fractured stone at pebble scale.
   *
   * A HIGH FREQUENCY, unlike the ground's. The terrain samples this same
   * generator at 2.4 so its macro forms come out around 26 world units — the
   * size of an outcrop. A stone is under a metre across and its whole surface
   * is one tile, so the detail has to be packed into that tile instead: at 5.6
   * the fracture pattern lands at roughly the size of a chip off the edge of a
   * rock, which is what it is meant to be.
   */
  /* Parameters in lib/ice-sets.js under 'scree'; the reasoning for the 5.6 is
     immediately above. */
  const maps = useMemo(() => iceMapsFor('scree'), []);

  const shapes = useMemo(
    () =>
      Array.from({ length: SHAPES }, (_, i) =>
        makeRockGeometry({
          seed: 31 + i * 17,
          /*
           * Detail 1 is 80 triangles a stone. Deliberately low: the lobes give
           * the silhouette and the normal map gives the surface, so subdividing
           * further buys a rounder outline and nothing else — and it would be
           * paid six hundred times over. The last shape gets one more level
           * because it is also the boulder, and a boulder IS its silhouette.
           */
          detail: i === SHAPES - 1 ? 2 : 1,
          forms: 4 + i,
          bumps: 10 + i * 4,
          /* 0.78 to 0.96: settled, but still solids. See the note on flatten —
             squashing these was what made the first pass read as grey discs. */
          flatten: 0.78 + i * 0.06,
        })
      ),
    []
  );

  /*
   * One placement list per shape, so each shape's instances are a strided slice
   * of the whole field. Splitting by index rather than by region is what keeps
   * the four shapes mixed everywhere instead of landing in four patches.
   */
  const fields = useMemo(() => {
    /* A tight ring, banked hard against the wall: bias 2.6 puts most of what
       survives inside the first ten units of it. */
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
          /* Chips and cobbles only. The largest is now under a metre: anything
             bigger sitting beside the dome competes with it, and the reference
             has nothing of the sort anywhere near its igloo. */
          tier={{ min: 0.14, max: 1.15, bias: 2.8 }}
          maps={maps}
        />
      ))}

    </group>
  );
}
