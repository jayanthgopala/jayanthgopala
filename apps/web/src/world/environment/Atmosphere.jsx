import { useMemo } from 'react';
import { Environment } from '@react-three/drei';
import { makeWinterSkyEnv } from './Sky.jsx';
import { LOOK } from '../lib/lighting.js';

export const HORIZON = LOOK.ambient.color;
export const FOG_COLOR = LOOK.fog.color;

export default function Atmosphere() {
  const skyEnv = useMemo(() => makeWinterSkyEnv(), []);

  return (
    <>
      {/* Exponential distance fog */}
      <fogExp2 attach="fog" args={[FOG_COLOR, LOOK.fog.density]} />

      {/* Ambient base lighting */}
      <ambientLight intensity={LOOK.ambient.intensity} color={HORIZON} />

      {/* Hemispherical skylight fill and ground bounce */}
      <hemisphereLight args={[LOOK.hemi.sky, LOOK.hemi.ground, LOOK.hemi.intensity]} />

      {/* Main directional sun/moon key light */}
      <directionalLight
        castShadow
        position={LOOK.key.position}
        intensity={LOOK.key.intensity}
        color={LOOK.key.color}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.00025}
        shadow-normalBias={0.85}
        shadow-radius={4}
        shadow-camera-near={1}
        shadow-camera-far={620}
        shadow-camera-left={-430}
        shadow-camera-right={430}
        shadow-camera-top={430}
        shadow-camera-bottom={-430}
      />

      {/* Procedural environment map */}
      <Environment map={skyEnv} />
    </>
  );
}
