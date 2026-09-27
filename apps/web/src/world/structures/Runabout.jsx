import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  DoubleSide,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import { WATER_Y } from '../lib/terrain.js';
import { withReveal, revealAt } from '../lib/reveal.js';
import { gustAt } from '../lib/wind.js';
import { sound } from '../lib/sound.js';
import { useWorldScroll } from '../scroll/ScrollProvider.jsx';
import { BOAT_AT, BOAT_BASE, BOAT_BEAM, BOAT_SCALE, BOAT_YAW, RUN_CURVE, RUN_SPAN, boatPose } from '../lib/dock.js';
import { mahoganyTexture, runaboutGeometry } from '../lib/runabout-geometry.js';
import { screenX, snowDusted, spring } from './props.js';

// The mahogany runabout moored off the dock. At rest it rides the swell in
// the lead and rocks when touched. The opening scroll drives it: it comes off
// the dock, round to face the camera and in across the open water, as far as
// the page has been scrolled, and back to its mooring when scrolled back.

// Rocking on its spring: roll and heave rates, their damping, and how hard a
// touch knocks it.
const ROCK_RATE = 2.1;
const ROCK_DAMP = 0.6;
const PUSH = 0.014;

// Following the scroll: how quickly the boat catches up with it (as the
// camera does), and the speed (world units a second) that counts as flat
// out, for its trim, the wake and the engine.
const FOLLOW = 3.2;
const FULL_SPEED = 40;

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export default function Runabout() {
  const { intro, progress } = useWorldScroll();
  const group = useRef(null);
  const uReveal = useRef({ value: 0 });
  const calm = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );

  const geo = useMemo(() => runaboutGeometry(), []);
  const mats = useMemo(() => {
    const grain = mahoganyTexture();
    // Deep varnish: the wood under a glossy clear coat, as a Riva's is.
    const wood = snowDusted(
      new MeshPhysicalMaterial({
        map: grain,
        color: '#c88f6c',
        roughness: 0.45,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        envMapIntensity: 1.0,
      }),
      uReveal.current,
      0.08
    );
    const cushions = snowDusted(
      new MeshStandardMaterial({ color: '#e6d8bc', roughness: 0.6, metalness: 0, envMapIntensity: 0.5 }),
      uReveal.current,
      0.15
    );
    const glass = new MeshStandardMaterial({
      color: '#c9dbe8',
      roughness: 0.03,
      metalness: 0.2,
      transparent: true,
      opacity: 0.32,
      envMapIntensity: 1.6,
      side: DoubleSide,
      depthWrite: false,
    });
    glass.onBeforeCompile = (shader) => withReveal(shader, uReveal.current);
    const chrome = new MeshStandardMaterial({ color: '#eef1f4', roughness: 0.12, metalness: 1, envMapIntensity: 1.4 });
    chrome.onBeforeCompile = (shader) => withReveal(shader, uReveal.current);
    // Never drawn, only hit: the whole hull as one easy target.
    const hit = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
    return { grain, wood, cushions, glass, chrome, hit };
  }, []);

  useEffect(
    () => () => {
      Object.values(geo).forEach((g) => g.dispose());
      Object.values(mats).forEach((m) => m.dispose());
    },
    [geo, mats]
  );

  const motion = useRef({
    roll: 0, rollV: 0, heave: 0, heaveV: 0, push: 0,
    // How far along the course (0..1), how fast it is going (0..1), and how
    // quickly it is turning.
    run: 0, pace: 0, yawRate: 0, lastYaw: BOAT_YAW,
  });
  const at = useMemo(() => new Vector3(), []);
  const tangent = useMemo(() => new Vector3(), []);

  // A touch at rest: the cursor's sideways movement sets which way it rolls;
  // a tap, with no movement, rolls it away from the side it was touched on.
  const touch = (e) => {
    e.stopPropagation();
    const m = motion.current;
    if (m.run > 0.01) return;
    let dx = e.nativeEvent?.movementX || 0;
    if (!dx && group.current) dx = e.point.z > group.current.position.z ? -16 : 16;
    const push = Math.max(-24, Math.min(24, dx)) * PUSH;
    m.push += push;
    sound.boatKnock(Math.min(1, Math.abs(push) * 4), boatPose.pan);
  };

  useFrame((state, delta) => {
    uReveal.current.value = revealAt(intro.current);
    const b = group.current;
    if (!b) return;
    const t = state.clock.elapsedTime;
    const dt = Math.max(1e-3, Math.min(delta, 1 / 20));
    const m = motion.current;

    // Where along its course the scroll has got to, eased like the camera.
    const target = calm ? 0 : smooth(RUN_SPAN[0], RUN_SPAN[1], progress.current);
    m.run += (target - m.run) * (1 - Math.exp(-FOLLOW * dt));
    if (Math.abs(target - m.run) < 1e-4) m.run = target;
    const under = m.run > 1e-4;

    // The rocking spring, with any touch applied as an impulse.
    spring(m, 'roll', ROCK_RATE, ROCK_DAMP, 0, dt);
    spring(m, 'heave', ROCK_RATE * 1.3, ROCK_DAMP * 1.6, 0, dt);
    if (m.push) {
      m.rollV += m.push;
      m.heaveV -= Math.abs(m.push) * 2.2;
      m.push = 0;
    }

    // The swell rocks it less as it gets up and runs across it.
    const swell = calm ? 0 : 1 - 0.7 * smooth(0.05, 0.4, m.pace);
    let x;
    let z;
    let yaw;
    if (!under) {
      x = BOAT_AT[0] + (calm ? 0 : Math.sin(t * 0.19) * 0.35);
      z = BOAT_AT[1] + (calm ? 0 : Math.sin(t * 0.23 + 0.7) * 0.2);
      yaw = BOAT_YAW + (calm ? 0 : Math.sin(t * 0.21) * 0.03);
    } else {
      RUN_CURVE.getPointAt(m.run, at);
      RUN_CURVE.getTangentAt(m.run, tangent);
      x = at.x;
      z = at.z;
      // Off the mooring heading onto the course's own over the first stretch.
      let turn = Math.atan2(-tangent.z, tangent.x) - BOAT_YAW;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      yaw = BOAT_YAW + turn * smooth(0, 0.12, m.run);
    }

    // Its speed over the water, from how far it moved this frame.
    const moved = Math.hypot(x - b.position.x, z - b.position.z);
    m.pace += (Math.min(1, moved / dt / FULL_SPEED) - m.pace) * (1 - Math.exp(-6 * dt));
    const pace = m.pace;
    let yawStep = yaw - m.lastYaw;
    yawStep = Math.atan2(Math.sin(yawStep), Math.cos(yawStep));
    m.yawRate += (yawStep / dt - m.yawRate) * (1 - Math.exp(-5 * dt));
    m.lastYaw = yaw;

    // Getting onto the plane: the bow climbs over the hump, then levels off
    // as the hull rides up and runs flatter at speed.
    const hump = Math.exp(-(((pace - 0.35) / 0.2) ** 2));
    const gust = calm ? 0 : gustAt(x, z, t);
    b.position.set(
      x,
      WATER_Y + (Math.sin(t * 0.8) * 0.2 + Math.sin(t * 1.5 + 1.0) * 0.07) * swell + m.heave + pace * 0.45,
      z
    );
    // Heading first, then pitch and roll in the boat's own frame, so heeling
    // into a turn tips it sideways whichever way it faces (in the default
    // order the roll was about the world's x, and once the boat faced the
    // camera it dipped the bow instead).
    b.rotation.order = 'YZX';
    b.rotation.set(
      // Roll: the swell, the breeze, a touch, and heeling into the turn.
      (Math.sin(t * 0.6) * 0.035 + Math.sin(t * 1.1 + 0.4) * 0.012) * swell +
        gust * 0.02 +
        m.roll -
        Math.max(-0.12, Math.min(0.12, m.yawRate * pace * 0.5)),
      yaw,
      // Pitch: the swell, and the bow lifting as it climbs onto the plane.
      Math.sin(t * 0.5 + 1.3) * 0.02 * swell + hump * 0.1 + pace * 0.03
    );
    b.updateMatrixWorld();

    boatPose.x = x;
    boatPose.z = z;
    boatPose.yaw = yaw;
    boatPose.speed = pace;
    boatPose.pan = screenX(b.position, state.camera);

    // Its sound, from the motion itself: water slapping the hull as fast as
    // the hull moves through it (the swell's rise and fall, a touch, and the
    // roll at the beam's edge), and the engine and wash from the throttle
    // and speed. Fainter the further off.
    const swellV = (0.2 * 0.8 * Math.cos(t * 0.8) + 0.07 * 1.5 * Math.cos(t * 1.5 + 1.0)) * swell;
    const near = Math.min(1, 70 / Math.max(1, state.camera.position.distanceTo(b.position)));
    sound.boat({
      lap: Math.min(1, (Math.abs(swellV + m.heaveV) + Math.abs(m.rollV) * BOAT_BEAM * 0.5) * 0.6),
      speed: pace,
      // The engine runs once it has cast off, the throttle following its pace.
      throttle: under ? Math.min(1, 0.08 + pace * 1.4) : 0,
      pan: boatPose.pan,
      near,
    });
  });

  return (
    <group
      ref={group}
      name="runabout"
      position={[BOAT_AT[0], WATER_Y, BOAT_AT[1]]}
      rotation={[0, BOAT_YAW, 0]}
      onPointerOver={touch}
      onPointerDown={touch}
    >
      {/* Modelled at its base size and shown BOAT_SCALE times larger. */}
      <group scale={BOAT_SCALE}>
        <mesh geometry={geo.wood} material={mats.wood} castShadow receiveShadow />
        <mesh geometry={geo.cushions} material={mats.cushions} castShadow receiveShadow />
        <mesh geometry={geo.chrome} material={mats.chrome} />
        <mesh geometry={geo.glass} material={mats.glass} renderOrder={2} />
        {/* The hit target: a box round the hull, above the water. */}
        <mesh material={mats.hit} position={[0, 1.5, 0]} scale={[BOAT_BASE[0], 3, BOAT_BASE[1]]}>
          <boxGeometry />
        </mesh>
      </group>
    </group>
  );
}
