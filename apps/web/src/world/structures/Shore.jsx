import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SphereGeometry,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
} from 'three';
import { WATER_Y, groundAt } from '../lib/terrain.js';
import { makeNoise2D } from '../lib/noise.js';
import { revealAt, withReveal } from '../lib/reveal.js';
import { useWorldScroll } from '../scroll/ScrollProvider.jsx';
import { DOCK } from '../lib/dock.js';
import { WIND_DIR, gustAt } from '../lib/wind.js';
import { sound } from '../lib/sound.js';
import { createRng, ropeGeometry, screenX, snowDusted, spring } from './props.js';

// The shore by the igloo's door: a lantern on a post, and the line of dock
// posts the runabout (Runabout.jsx) is tied to. Everything is built here from
// primitives and one painted wood texture — nothing is downloaded.

// Positions, from the door (which faces +x, toward the right of the opening
// view) out to the water in front.
const POST_AT = [8, 259.5];

// Dark boulders about the shelf, snow lying on their tops: [x, z, size].
const BOULDERS = [
  [-64, 271, 4.2],
  [-56, 279, 2.6],
  [-72, 266, 3.1],
  [-44, 284, 1.6],
  [15, 255, 2.3],
  [-21, 287, 1.4],
];

// The lantern swings on its chain like a pendulum: its natural rate (rad/s),
// how quickly a swing dies away, how hard a gust leans on it, and how hard a
// touch pushes it.
const LAMP_RATE = 2.6;
const LAMP_DAMP = 0.9;
const LAMP_WIND = 1.9;
const LAMP_PUSH = 0.028;
const LAMP_MAX = 0.6;

// The lantern's light, before its flicker.
const LAMP_LIGHT = 760;

/** A soft round glow, bright at the middle and gone by the edge. */
function haloTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  const r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  r.addColorStop(0, 'rgba(255, 236, 200, 1)');
  r.addColorStop(0.18, 'rgba(255, 190, 110, 0.55)');
  r.addColorStop(0.5, 'rgba(255, 150, 70, 0.14)');
  r.addColorStop(1, 'rgba(255, 140, 60, 0)');
  g.fillStyle = r;
  g.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
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
  const halo = useRef(null);
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
      new MeshStandardMaterial({ color: '#cbb48c', roughness: 0.95, metalness: 0 }),
      uReveal.current,
      0.3
    );
    // Lantern glass: hot enough to bloom and to throw a gold path on the water.
    const glass = new MeshStandardMaterial({
      color: '#ffd08a',
      emissive: '#ff9838',
      emissiveIntensity: 4.5,
      roughness: 0.2,
      metalness: 0,
    });
    glass.onBeforeCompile = (shader) => withReveal(shader, uReveal.current);
    // Snow lying in caps on whatever it can settle on.
    const snow = new MeshStandardMaterial({ color: '#f1f5fb', roughness: 0.9, metalness: 0 });
    snow.onBeforeCompile = (shader) => withReveal(shader, uReveal.current);
    // Never drawn, only hit: a larger target round the lantern so it is
    // easy to touch.
    const hit = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
    // The glow in the cold air round the lantern: a soft warm halo, bright
    // enough to bloom, that swings with it.
    const halo = new SpriteMaterial({
      map: haloTexture(),
      color: '#ffb35c',
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    return { grain, wood, darkWood, stone, iron, rope, glass, snow, hit, halo };
  }, []);

  const scene = useMemo(() => {
    // Lantern post: an upright, an arm reaching toward the water, a brace, and
    // the lantern hanging from the arm's end.
    const postBase = groundAt(...POST_AT) - 1;
    const postHeight = 17;
    const postTop = postBase + postHeight;
    const armLength = 5.2;

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
    // A low deck along the dock, a plank's width inshore of the posts and
    // standing just clear of the ice, snowed over like everything else.
    const deck = [];
    for (let i = 0; i < posts.length - 1; i += 1) {
      const a = posts[i];
      const b = posts[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      deck.push({
        x: (a.x + b.x) / 2,
        z: (a.z + b.z) / 2 - 2.4,
        length: Math.hypot(dx, dz) + 1.6,
        yaw: -Math.atan2(dz, dx),
      });
    }

    return {
      deck,
      post: { base: postBase, height: postHeight, top: postTop, arm: armLength },
      posts,
      ropes,
    };
  }, []);

  const geo = useMemo(
    () => ({
      box: new BoxGeometry(1, 1, 1),
      pile: new CylinderGeometry(0.75, 0.85, 1, 10),
      cap: new CylinderGeometry(0.95, 0.8, 0.5, 10),
      lanternCap: new ConeGeometry(1.05, 0.9, 4),
      lanternGlass: new CylinderGeometry(0.72, 0.72, 1.9, 4),
      chain: new CylinderGeometry(0.07, 0.07, 1.6, 4),
      boulder: boulderGeometry(),
      wrap: new TorusGeometry(0.98, 0.2, 6, 14),
      // A dome of snow with a rounded lip, for caps on posts and lids.
      snowCap: new SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      hitBall: new SphereGeometry(1, 8, 6),
    }),
    []
  );

  useEffect(
    () => () => {
      Object.values(geo).forEach((g) => g.dispose());
      scene.ropes.forEach((g) => g.dispose());
      mats.halo.map.dispose();
      Object.values(mats).forEach((m) => m.dispose());
    },
    [geo, mats, scene]
  );

  // Swing state, and a push waiting to be applied next frame.
  const motion = useRef({ swingX: 0, swingXV: 0, swingZ: 0, swingZV: 0, pushLamp: [0, 0] });
  const lantern = useRef(null);
  const lampAt = useMemo(() => new Vector3(), []);

  // A touch pushes the lantern the way the cursor is moving; a tap, with no
  // movement, pushes it away from where it was touched. Returns the push.
  const pushLamp = (e) => {
    const clamp = (v) => Math.max(-30, Math.min(30, v));
    let dx = e.nativeEvent?.movementX || 0;
    let dy = e.nativeEvent?.movementY || 0;
    if (!dx && !dy && lantern.current) {
      lantern.current.getWorldPosition(lampAt);
      dx = lampAt.x > e.point.x ? 14 : -14;
    }
    dx = clamp(dx);
    dy = clamp(dy);
    const m = motion.current;
    m.pushLamp[0] += dx * LAMP_PUSH;
    m.pushLamp[1] += dy * LAMP_PUSH * 0.6;
    return Math.hypot(dx, dy) * LAMP_PUSH;
  };
  const brushLamp = (e) => {
    e.stopPropagation();
    pushLamp(e);
  };
  // Contact (the cursor arriving on it, or a tap) also knocks the lantern
  // against its chain, as loud as the push is hard.
  const strikeLamp = (e) => {
    e.stopPropagation();
    const push = pushLamp(e);
    if (!lantern.current) return;
    lantern.current.getWorldPosition(lampAt);
    sound.lampTap(Math.min(1, push * 2.2), screenX(lampAt, e.camera));
  };

  useFrame((state, delta) => {
    uReveal.current.value = revealAt(intro.current);
    const t = state.clock.elapsedTime;
    const dt = Math.min(delta, 1 / 30);
    const m = motion.current;

    if (lamp.current) {
      // A candle's unsteadiness, and dark once the world is cut away.
      const flicker = calm ? 1 : 1 + Math.sin(t * 9.1) * 0.03 + Math.sin(t * 23.7) * 0.02;
      lamp.current.intensity = LAMP_LIGHT * flicker;
      if (halo.current) halo.current.material.opacity = 0.55 * flicker;
      lamp.current.visible = cut.current < 0.999;
    }
    // Lantern: the breeze leans on it (a little always, a lot in a gust, with
    // some flutter), and a touch sets it swinging. Still, with reduced motion.
    if (lantern.current && !calm) {
      const gust = gustAt(POST_AT[0], POST_AT[1], t);
      const blow = (0.12 + gust) * LAMP_WIND * (1 + Math.sin(t * 3.3) * 0.18 * gust);
      // Wind toward -x swings the bottom toward -x (negative about z); wind
      // toward -z swings it toward -z (positive about x).
      spring(m, 'swingZ', LAMP_RATE, LAMP_DAMP, WIND_DIR[0] * blow, dt);
      spring(m, 'swingX', LAMP_RATE, LAMP_DAMP, -WIND_DIR[1] * blow, dt);
      m.swingZV += m.pushLamp[0];
      m.swingXV += m.pushLamp[1];
      m.pushLamp[0] = 0;
      m.pushLamp[1] = 0;
      m.swingZ = Math.max(-LAMP_MAX, Math.min(LAMP_MAX, m.swingZ));
      m.swingX = Math.max(-LAMP_MAX, Math.min(LAMP_MAX, m.swingX));
      lantern.current.rotation.set(m.swingX, 0, m.swingZ);

      // The hook creaks as fast as the lantern swings on it, and higher the
      // harder the chain pulls: its weight, plus the swing's own pull (ω²).
      const omega = Math.hypot(m.swingXV, m.swingZV);
      lantern.current.getWorldPosition(lampAt);
      sound.lamp({
        speed: omega,
        load: 1 + (omega * omega) / (LAMP_RATE * LAMP_RATE),
        pan: screenX(lampAt, state.camera),
        near: Math.min(1, 60 / Math.max(1, state.camera.position.distanceTo(lampAt))),
      });
    }
  });

  const { post, posts, ropes, deck } = scene;
  const lanternX = POST_AT[0] + post.arm - 0.7;
  // The lantern hangs from a hook under the arm's end and swings about it.
  const hookY = post.top - 1.5;

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
        {/* Snow along the arm and on the post's head */}
        <mesh
          geometry={geo.snowCap}
          material={mats.snow}
          position={[POST_AT[0] + post.arm / 2 - 0.3, post.top - 0.66, POST_AT[1]]}
          scale={[(post.arm + 0.8) / 2, 0.4, 0.62]}
        />
        <mesh
          geometry={geo.snowCap}
          material={mats.snow}
          position={[POST_AT[0], post.base + post.height, POST_AT[1]]}
          scale={[0.95, 0.55, 0.95]}
        />
        {/* Lantern on its hook: chain, cap, glass and base, with the light it
            throws, all swinging together. */}
        <group
          ref={lantern}
          position={[lanternX, hookY, POST_AT[1]]}
          onPointerOver={strikeLamp}
          onPointerMove={brushLamp}
          onPointerDown={strikeLamp}
        >
          <mesh geometry={geo.chain} material={mats.iron} position={[0, -0.8, 0]} />
          <mesh
            geometry={geo.lanternCap}
            material={mats.iron}
            position={[0, -1.55, 0]}
            rotation={[0, Math.PI / 4, 0]}
          />
          <mesh
            geometry={geo.snowCap}
            material={mats.snow}
            position={[0, -1.25, 0]}
            scale={[0.55, 0.3, 0.55]}
          />
          <mesh
            geometry={geo.lanternGlass}
            material={mats.glass}
            position={[0, -2.9, 0]}
            rotation={[0, Math.PI / 4, 0]}
          />
          <mesh
            geometry={geo.box}
            material={mats.iron}
            position={[0, -3.95, 0]}
            scale={[1.3, 0.25, 1.3]}
          />
          <mesh geometry={geo.hitBall} material={mats.hit} position={[0, -2.6, 0]} scale={3.2} />
          <sprite ref={halo} material={mats.halo} position={[0, -2.9, 0]} scale={[7, 7, 1]} />
          <pointLight
            ref={lamp}
            position={[0, -2.9, 0.2]}
            color="#ffa850"
            intensity={LAMP_LIGHT}
            distance={130}
            decay={2}
          />
        </group>
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
          <mesh
            geometry={geo.snowCap}
            material={mats.snow}
            position={[0, p.top - p.base + 0.42, 0]}
            scale={[1.25, 0.85, 1.25]}
          />
          {/* Rope wound round the post where the lines are made fast */}
          {[1.1, 1.55, 2.0].map((down) => (
            <mesh
              key={down}
              geometry={geo.wrap}
              material={mats.rope}
              position={[0, p.top - p.base - down, 0]}
              rotation={[Math.PI / 2, 0, down]}
            />
          ))}
        </group>
      ))}
      {ropes.map((g, i) => (
        <mesh key={i} geometry={g} material={mats.rope} castShadow />
      ))}

      {/* The dock's deck: planks on the posts, snowed over */}
      {deck.map((d, i) => (
        <group key={i} position={[d.x, WATER_Y + 1.5, d.z]} rotation={[0, d.yaw, 0]}>
          <mesh geometry={geo.box} material={mats.darkWood} scale={[d.length, 0.7, 4.2]} castShadow receiveShadow />
          <mesh
            geometry={geo.snowCap}
            material={mats.snow}
            position={[0, 0.3, 0]}
            scale={[d.length / 2, 0.55, 2.3]}
            receiveShadow
          />
        </group>
      ))}
    </group>
  );
}
