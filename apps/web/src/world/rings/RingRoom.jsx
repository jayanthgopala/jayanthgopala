import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BackSide, CanvasTexture, LatheGeometry, RepeatWrapping, SRGBColorSpace, Vector2 } from 'three';
import { GlowRing } from './RingGlow.jsx';
import { FLOOR_Y, HALO_Y, PEDESTAL_TOP, ROOM_LIFT } from './layout.js';
import { MODEST } from '../water/device.js';

// The round room at the bottom of the shaft: terraced ice floor stepping down
// to a pedestal, lit rims on every step, a halo overhead, and blurred type
// running round the walls.

// Listed outside-in so the lathe's faces point up (see LatheGeometry winding).
const PROFILE = [
  [9, -10.26],
  [5.02, -10.26],
  [5.0, -10.31],
  [3.42, -10.31],
  [3.4, -10.36],
  [2.32, -10.36],
  [2.3, -10.4],
  [1.52, -10.4],
  [1.5, FLOOR_Y],
  [0.99, FLOOR_Y],
  [0.97, -10.33],
  [0.95, PEDESTAL_TOP],
  [0, PEDESTAL_TOP],
];

const RIMS = [
  { r: 5.01, y: -10.26, i: 0.5 },
  { r: 3.41, y: -10.31, i: 0.65 },
  { r: 2.31, y: -10.36, i: 0.8 },
  { r: 1.51, y: -10.4, i: 1.0 },
  { r: 0.96, y: PEDESTAL_TOP, i: 1.6 },
];

function useWallTexture(words) {
  const key = words.join('|');
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 256;
    const g = canvas.getContext('2d');
    g.filter = 'blur(6px)';
    g.fillStyle = '#2c3645';
    g.font = '600 96px "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace';
    g.textBaseline = 'middle';
    const text = `${words.join('   //   ')}   //   `;
    const step = Math.max(1, g.measureText(text).width);
    for (let x = 24; x < canvas.width; x += step) g.fillText(text, x, 128);

    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.wrapS = RepeatWrapping;
    // Negative repeat un-mirrors the text, which is seen from inside the cylinder.
    t.repeat.x = -2;
    return t;
    // Rebuilt only when the words themselves change.
    // eslint-disable-next-line
  }, [key]);

  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

export default function RingRoom({ levels, words }) {
  const group = useRef(null);
  const wall = useRef(null);

  const lathe = useMemo(
    () => new LatheGeometry(PROFILE.map(([r, y]) => new Vector2(r, y)), MODEST ? 64 : 96),
    []
  );
  useEffect(() => () => lathe.dispose(), [lathe]);

  const texture = useWallTexture(words);

  useFrame(({ clock }) => {
    const room = levels.current.room;
    if (group.current) group.current.visible = room > 0.001;
    if (wall.current) {
      wall.current.rotation.y = clock.elapsedTime * 0.012;
      wall.current.material.opacity = 0.3 * room;
    }
  });

  return (
    <group ref={group} position={[0, ROOM_LIFT, 0]} visible={false}>
      <mesh geometry={lathe}>
        {/* Low env: the strips that light the water would wash the floor out. */}
        <meshStandardMaterial color="#8f9aa9" roughness={0.5} metalness={0} envMapIntensity={0.4} />
      </mesh>

      {RIMS.map((rim) => (
        <GlowRing
          key={rim.r}
          y={rim.y + 0.004}
          radius={rim.r}
          width={0.035}
          intensity={rim.i}
          levels={levels}
          channel="room"
        />
      ))}

      <GlowRing y={HALO_Y} radius={1.25} width={0.09} intensity={2.2} dashes={2} spin={-0.2} levels={levels} channel="halo" />

      <mesh ref={wall} position={[0, -9.3, 0]}>
        <cylinderGeometry args={[6.4, 6.4, 1.6, 96, 1, true]} />
        {/* Unfogged: at this distance the fog would erase it entirely. */}
        <meshBasicMaterial map={texture} transparent opacity={0} depthWrite={false} side={BackSide} fog={false} />
      </mesh>
    </group>
  );
}
