import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  IcosahedronGeometry,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  TubeGeometry,
  Vector3,
} from 'three';
import { WATER_Y, heightAt } from '../lib/terrain.js';
import { makeNoise2D } from '../lib/noise.js';
import { revealAt, withReveal } from '../lib/reveal.js';
import { useWorldScroll } from '../scroll/ScrollProvider.jsx';

// The shore by the igloo's door: a lantern on a post, a crate, and a rowboat
// tied to a line of dock posts. Everything is built here from primitives and
// one painted wood texture — nothing is downloaded.

// Positions, from the door (which faces +x, toward the right of the opening
// view) out to the water in front.
const CRATE_AT = [2, 255.5];
const POST_AT = [8, 259.5];
const DOCK = [
  [10, 277],
  [21, 279],
  [32, 281],
  [43, 282.5],
];
const BOAT_AT = [26, 292];

// Dark boulders about the shelf, snow lying on their tops: [x, z, size].
const BOULDERS = [
  [-64, 271, 4.2],
  [-56, 279, 2.6],
  [-72, 266, 3.1],
  [-44, 284, 1.6],
  [15, 255, 2.3],
  [-21, 287, 1.4],
];
const BOAT_YAW = 0.08;

function createRng(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** Weathered planks: four boards with grain, knots and dark seams. */
function woodTexture() {
  const W = 256;
  const H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const rand = createRng(9173);

  const boards = 4;
  const bh = H / boards;
  for (let b = 0; b < boards; b += 1) {
    const tone = 0.85 + rand() * 0.3;
    ctx.fillStyle = `rgb(${Math.round(118 * tone)}, ${Math.round(84 * tone)}, ${Math.round(58 * tone)})`;
    ctx.fillRect(0, b * bh, W, bh);

    // Grain: long wavering strokes, lighter and darker than the board.
    for (let g = 0; g < 26; g += 1) {
      const y0 = b * bh + rand() * bh;
      const dark = rand() < 0.6;
      ctx.strokeStyle = dark ? `rgba(46, 30, 18, ${0.15 + rand() * 0.25})` : `rgba(190, 150, 110, ${0.08 + rand() * 0.12})`;
      ctx.lineWidth = 0.6 + rand() * 1.4;
      ctx.beginPath();
      const amp = 0.6 + rand() * 2.2;
      const freq = 0.01 + rand() * 0.03;
      const phase = rand() * 6.28;
      for (let x = 0; x <= W; x += 8) {
        const y = y0 + Math.sin(x * freq + phase) * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // A knot or two.
    for (let k = 0; k < 2; k += 1) {
      if (rand() < 0.4) continue;
      const kx = rand() * W;
      const ky = b * bh + bh * (0.3 + rand() * 0.4);
      ctx.fillStyle = 'rgba(52, 34, 20, 0.55)';
      ctx.beginPath();
      ctx.ellipse(kx, ky, 4 + rand() * 4, 2 + rand() * 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Seam between boards.
    ctx.fillStyle = 'rgba(28, 18, 10, 0.85)';
    ctx.fillRect(0, b * bh, W, 2.5);
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/**
 * Snow settles on whatever faces up. Patched into each material along with
 * the reveal, so the props sit under the same dusting as the ground.
 */
function snowDusted(material, uReveal, amount = 1) {
  material.onBeforeCompile = (shader) => {
    withReveal(shader, uReveal);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
       {
         vec3 up = inverseTransformDirection( normal, viewMatrix );
         float settled = smoothstep( 0.55, 0.85, up.y ) * ${amount.toFixed(2)};
         diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.92, 0.95, 0.99 ), settled );
         roughnessFactor = mix( roughnessFactor, 0.92, settled );
       }`
    );
  };
  // Distinct cache key per dusting amount, since the amount is baked in.
  material.customProgramCacheKey = () => `snow-${amount}`;
  return material;
}

/**
 * A rowboat hull as one open shell: pointed at the bow, fuller at the stern,
 * the sheer rising toward both ends. Length along x, beam along z, up +y,
 * the gunwale's lowest point at y = 0.
 */
function hullGeometry(length = 24, beam = 7.6, depth = 3) {
  const nu = 28;
  const nv = 14;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= nu; i += 1) {
    const u = -1 + (2 * i) / nu;
    // Fuller aft (u < 0) than forward.
    const taper = Math.pow(Math.max(0, 1 - u * u), u < 0 ? 0.32 : 0.62);
    const w = (beam / 2) * taper;
    const d = depth * (1 - 0.35 * u * u);
    const sheer = 0.5 * depth * u * u;
    for (let j = 0; j <= nv; j += 1) {
      const t = -Math.PI / 2 + (Math.PI * j) / nv;
      positions.push((u * length) / 2, sheer - d * Math.cos(t) * (0.45 + 0.55 * taper), w * Math.sin(t));
      uvs.push(i / nu * 3, j / nv);
    }
  }

  for (let i = 0; i < nu; i += 1) {
    for (let j = 0; j < nv; j += 1) {
      const a = i * (nv + 1) + j;
      const b = a + nv + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** The hull's top edge on one side, for the gunwale rail. */
function gunwaleCurve(side, length = 24, beam = 7.6, depth = 3) {
  const points = [];
  for (let i = 0; i <= 16; i += 1) {
    const u = -1 + (2 * i) / 16;
    const taper = Math.pow(Math.max(0, 1 - u * u), u < 0 ? 0.32 : 0.62);
    points.push(new Vector3((u * length) / 2, 0.5 * depth * u * u, side * (beam / 2) * taper));
  }
  return new CatmullRomCurve3(points);
}

/** A rope hung between two points, sagging under its own weight. */
function ropeGeometry(a, b, sag) {
  const points = [];
  for (let i = 0; i <= 12; i += 1) {
    const t = i / 12;
    const p = new Vector3().lerpVectors(a, b, t);
    p.y -= Math.sin(Math.PI * t) * sag;
    points.push(p);
  }
  return new TubeGeometry(new CatmullRomCurve3(points), 24, 0.2, 5, false);
}

const groundAt = (x, z) => heightAt(x, z);

/** A lumpy stone: an icosphere pushed in and out by noise, flat shaded. */
function boulderGeometry() {
  const noise = makeNoise2D(5813);
  const geometry = new IcosahedronGeometry(1, 2);
  const pos = geometry.attributes.position;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i);
    const bump = 1 + noise(v.x * 1.3 + v.y * 0.7, v.z * 1.3 - v.y * 0.5) * 0.22;
    v.multiplyScalar(bump);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export default function Shore() {
  const { intro, cut } = useWorldScroll();
  const uReveal = useRef({ value: 0 });
  const lamp = useRef(null);
  const boat = useRef(null);
  const calm = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );

  const mats = useMemo(() => {
    const grain = woodTexture();
    const wood = snowDusted(
      new MeshStandardMaterial({ map: grain, color: '#b89a82', roughness: 0.86, metalness: 0 }),
      uReveal.current
    );
    const darkWood = snowDusted(
      new MeshStandardMaterial({ map: grain, color: '#6e5646', roughness: 0.9, metalness: 0 }),
      uReveal.current
    );
    const hull = snowDusted(
      new MeshStandardMaterial({ map: grain, color: '#9a7a62', roughness: 0.82, metalness: 0, side: DoubleSide }),
      uReveal.current,
      0.55
    );
    const stone = snowDusted(
      new MeshStandardMaterial({ color: '#3a3431', roughness: 0.92, metalness: 0, flatShading: true }),
      uReveal.current,
      0.95
    );
    const iron = snowDusted(
      new MeshStandardMaterial({ color: '#2b2622', roughness: 0.55, metalness: 0.6 }),
      uReveal.current,
      0.5
    );
    const rope = snowDusted(
      new MeshStandardMaterial({ color: '#8c7658', roughness: 0.95, metalness: 0 }),
      uReveal.current,
      0.3
    );
    // Lantern glass: hot enough to bloom and to throw a gold path on the water.
    const glass = new MeshStandardMaterial({
      color: '#ffd89a',
      emissive: '#ffae4a',
      emissiveIntensity: 5.5,
      roughness: 0.2,
      metalness: 0,
    });
    glass.onBeforeCompile = (shader) => withReveal(shader, uReveal.current);
    return { grain, wood, darkWood, hull, stone, iron, rope, glass };
  }, []);

  const scene = useMemo(() => {
    // Lantern post: an upright, an arm reaching toward the water, a brace, and
    // the lantern hanging from the arm's end.
    const postBase = groundAt(...POST_AT) - 1;
    const postHeight = 17;
    const postTop = postBase + postHeight;
    const armLength = 5.2;

    // Crate, seated on the highest of its corners so none of it floats.
    const crate = { w: 6.2, h: 4.6, d: 4.6 };
    let crateBase = -Infinity;
    for (const [dx, dz] of [[-3, -2.2], [3, -2.2], [-3, 2.2], [3, 2.2], [0, 0]]) {
      crateBase = Math.max(crateBase, groundAt(CRATE_AT[0] + dx, CRATE_AT[1] + dz));
    }
    crateBase -= 0.4;

    // Dock posts, driven into the bed and standing clear of the water.
    const rand = createRng(311);
    const posts = DOCK.map(([x, z]) => ({
      x,
      z,
      base: Math.min(groundAt(x, z), WATER_Y) - 5,
      top: Math.max(groundAt(x, z), WATER_Y) + 7 + rand() * 1.2,
      tilt: [(rand() - 0.5) * 0.06, (rand() - 0.5) * 0.06],
    }));

    const ropes = [];
    for (let i = 0; i < posts.length - 1; i += 1) {
      const a = posts[i];
      const b = posts[i + 1];
      ropes.push(
        ropeGeometry(new Vector3(a.x, a.top - 1.4, a.z), new Vector3(b.x, b.top - 1.4, b.z), 1.6)
      );
    }
    // Mooring line from the second post down to the boat's bow.
    const bow = new Vector3(BOAT_AT[0] + 11.5, WATER_Y + 2.4, BOAT_AT[1] - 0.9);
    ropes.push(ropeGeometry(new Vector3(posts[2].x, posts[2].top - 1.8, posts[2].z), bow, 1.2));

    return {
      post: { base: postBase, height: postHeight, top: postTop, arm: armLength },
      crate: { ...crate, base: crateBase },
      posts,
      ropes,
    };
  }, []);

  const geo = useMemo(
    () => ({
      box: new BoxGeometry(1, 1, 1),
      pile: new CylinderGeometry(0.75, 0.85, 1, 10),
      cap: new CylinderGeometry(0.95, 0.8, 0.5, 10),
      hull: hullGeometry(),
      railL: new TubeGeometry(gunwaleCurve(1), 32, 0.26, 6, false),
      railR: new TubeGeometry(gunwaleCurve(-1), 32, 0.26, 6, false),
      lanternCap: new ConeGeometry(1.05, 0.9, 4),
      lanternGlass: new CylinderGeometry(0.72, 0.72, 1.9, 4),
      chain: new CylinderGeometry(0.07, 0.07, 1.6, 4),
      boulder: boulderGeometry(),
    }),
    []
  );

  useEffect(
    () => () => {
      Object.values(geo).forEach((g) => g.dispose());
      scene.ropes.forEach((g) => g.dispose());
      Object.values(mats).forEach((m) => m.dispose());
    },
    [geo, mats, scene]
  );

  useFrame((state) => {
    uReveal.current.value = revealAt(intro.current);
    const t = state.clock.elapsedTime;
    if (lamp.current) {
      // A candle's unsteadiness, and dark once the world is cut away.
      const flicker = calm ? 1 : 1 + Math.sin(t * 9.1) * 0.03 + Math.sin(t * 23.7) * 0.02;
      lamp.current.intensity = 420 * flicker;
      lamp.current.visible = cut.current < 0.999;
    }
    if (boat.current && !calm) {
      boat.current.position.y = WATER_Y + 1.0 + Math.sin(t * 0.6) * 0.14;
      boat.current.rotation.x = Math.sin(t * 0.47 + 1.3) * 0.025;
      boat.current.rotation.z = Math.sin(t * 0.39) * 0.012;
    }
  });

  const { post, crate, posts, ropes } = scene;
  const lanternX = POST_AT[0] + post.arm - 0.7;
  const lanternY = post.top - 4.4;

  return (
    <group name="shore">
      {/* Lantern post */}
      <group>
        <mesh
          geometry={geo.box}
          material={mats.darkWood}
          position={[POST_AT[0], post.base + post.height / 2, POST_AT[1]]}
          scale={[1.3, post.height, 1.3]}
          castShadow
          receiveShadow
        />
        <mesh
          geometry={geo.box}
          material={mats.darkWood}
          position={[POST_AT[0] + post.arm / 2 - 0.3, post.top - 1.1, POST_AT[1]]}
          scale={[post.arm + 0.8, 0.9, 0.9]}
          castShadow
        />
        <mesh
          geometry={geo.box}
          material={mats.darkWood}
          position={[POST_AT[0] + 1.3, post.top - 2.5, POST_AT[1]]}
          rotation={[0, 0, Math.PI / 4]}
          scale={[3.4, 0.6, 0.6]}
          castShadow
        />
        {/* Lantern: chain, cap, glass and base, with the light it throws. */}
        <mesh geometry={geo.chain} material={mats.iron} position={[lanternX, post.top - 2.3, POST_AT[1]]} />
        <mesh
          geometry={geo.lanternCap}
          material={mats.iron}
          position={[lanternX, lanternY + 1.35, POST_AT[1]]}
          rotation={[0, Math.PI / 4, 0]}
        />
        <mesh
          geometry={geo.lanternGlass}
          material={mats.glass}
          position={[lanternX, lanternY, POST_AT[1]]}
          rotation={[0, Math.PI / 4, 0]}
        />
        <mesh
          geometry={geo.box}
          material={mats.iron}
          position={[lanternX, lanternY - 1.05, POST_AT[1]]}
          scale={[1.3, 0.25, 1.3]}
        />
        <pointLight
          ref={lamp}
          position={[lanternX, lanternY, POST_AT[1] + 0.2]}
          color="#ffb45c"
          intensity={420}
          distance={80}
          decay={2}
        />
      </group>

      {/* Crate: board body, dark corner posts, and a lid proud of the sides. */}
      <group position={[CRATE_AT[0], crate.base, CRATE_AT[1]]} rotation={[0, -0.18, 0]}>
        <mesh
          geometry={geo.box}
          material={mats.wood}
          position={[0, crate.h / 2, 0]}
          scale={[crate.w, crate.h, crate.d]}
          castShadow
          receiveShadow
        />
        {[
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ].map(([sx, sz]) => (
          <mesh
            key={`${sx}${sz}`}
            geometry={geo.box}
            material={mats.darkWood}
            position={[(sx * crate.w) / 2, crate.h / 2, (sz * crate.d) / 2]}
            scale={[0.55, crate.h + 0.1, 0.55]}
            castShadow
          />
        ))}
        <mesh
          geometry={geo.box}
          material={mats.darkWood}
          position={[0, crate.h + 0.25, 0]}
          scale={[crate.w + 0.5, 0.5, crate.d + 0.5]}
          castShadow
          receiveShadow
        />
      </group>

      {/* Boulders, half sunk in the shelf */}
      {BOULDERS.map(([x, z, size], i) => (
        <mesh
          key={i}
          geometry={geo.boulder}
          material={mats.stone}
          position={[x, groundAt(x, z) - size * 0.3, z]}
          rotation={[0, i * 1.7, 0]}
          scale={[size * 1.25, size * 0.8, size]}
          castShadow
          receiveShadow
        />
      ))}

      {/* Dock posts and the rope between them */}
      {posts.map((p, i) => (
        <group key={i} position={[p.x, p.base, p.z]} rotation={[p.tilt[0], 0, p.tilt[1]]}>
          <mesh
            geometry={geo.pile}
            material={mats.darkWood}
            position={[0, (p.top - p.base) / 2, 0]}
            scale={[1, p.top - p.base, 1]}
            castShadow
          />
          <mesh geometry={geo.cap} material={mats.wood} position={[0, p.top - p.base + 0.2, 0]} />
        </group>
      ))}
      {ropes.map((g, i) => (
        <mesh key={i} geometry={g} material={mats.rope} castShadow />
      ))}

      {/* Rowboat, afloat and tied off to the dock */}
      <group ref={boat} position={[BOAT_AT[0], WATER_Y + 1.0, BOAT_AT[1]]} rotation={[0, BOAT_YAW, 0]}>
        <mesh geometry={geo.hull} material={mats.hull} castShadow receiveShadow />
        <mesh geometry={geo.railL} material={mats.darkWood} castShadow />
        <mesh geometry={geo.railR} material={mats.darkWood} castShadow />
        {/* Thwarts */}
        {[-4.5, 2.5].map((x) => (
          <mesh
            key={x}
            geometry={geo.box}
            material={mats.wood}
            position={[x, -0.9, 0]}
            scale={[1.6, 0.35, 6.4]}
            castShadow
            receiveShadow
          />
        ))}
        {/* Snow lying in the bilge */}
        <mesh geometry={geo.box} material={mats.wood} position={[-1, -2.1, 0]} scale={[14, 0.2, 3.2]} receiveShadow />
      </group>
    </group>
  );
}
