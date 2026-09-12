// Ambient bubbles.
//
// Nothing to do with the splash — these are always there, drifting up past the
// letter, and they are most of what tells you the scene is underwater rather
// than a pane of glass. A transmissive sphere gives the bright rim and clear
// middle of a real bubble for free, so no texture is needed.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Object3D } from 'three';
import { PLANE } from './GlyphWater.jsx';

const COUNT = 64;
const SPAN = PLANE * 1.25;

const scratch = new Object3D();

export default function Bubbles({ calm = false }) {
  const mesh = useRef(null);

  const seeds = useMemo(
    () =>
      Array.from({ length: COUNT }, () => ({
        x: (Math.random() - 0.5) * SPAN,
        y: (Math.random() - 0.5) * SPAN,
        // Kept off the letter's own plane so they never intersect it.
        z: (Math.random() - 0.5) * 1.6 + (Math.random() < 0.5 ? -0.75 : 0.75),
        size: 0.008 + Math.random() ** 2 * 0.028,
        rise: 0.09 + Math.random() * 0.22,
        sway: 0.1 + Math.random() * 0.3,
        phase: Math.random() * Math.PI * 2,
      })),
    []
  );

  const time = useRef(0);

  useFrame((_, delta) => {
    const instanced = mesh.current;
    if (!instanced) return;

    const dt = Math.min(delta, 1 / 30);
    time.current += dt;
    const t = time.current;
    const drift = calm ? 0.35 : 1;

    for (let i = 0; i < COUNT; i += 1) {
      const b = seeds[i];
      b.y += b.rise * dt * drift;
      // Wrap rather than respawn, so the field never thins out.
      if (b.y > SPAN * 0.5) {
        b.y -= SPAN;
        b.x = (Math.random() - 0.5) * SPAN;
      }

      scratch.position.set(
        b.x + Math.sin(t * b.sway + b.phase) * 0.12,
        b.y,
        b.z
      );
      scratch.scale.setScalar(b.size);
      scratch.updateMatrix();
      instanced.setMatrixAt(i, scratch.matrix);
    }

    instanced.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, COUNT]} frustumCulled={false}>
      <sphereGeometry args={[1, 10, 8]} />
      <meshPhysicalMaterial
        color="#ffffff"
        roughness={0.02}
        metalness={0}
        transmission={1}
        thickness={0.04}
        ior={1.2}
        envMapIntensity={2.2}
        transparent
      />
    </instancedMesh>
  );
}
