// Splash spray.
//
// A fixed pool of instanced droplets, recycled oldest-first. Simulated on the
// CPU because the count is small and the behaviour — thrown off the letter,
// pulled down, gone — is easier to read here than in a shader.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Matrix4, Object3D, Vector3 } from 'three';
import { PLANE } from './GlyphWater.jsx';

const COUNT = 320;
const GRAVITY = -7.4;
const LIFE = [0.5, 1.15];
const DRAG = 0.86;

const scratch = new Object3D();
const hidden = new Matrix4().makeScale(0, 0, 0);

function makeDroplets() {
  return Array.from({ length: COUNT }, () => ({
    position: new Vector3(),
    velocity: new Vector3(),
    life: 0,
    span: 1,
    size: 1,
  }));
}

export default function Droplets({ api }) {
  const mesh = useRef(null);
  const pool = useMemo(makeDroplets, []);
  const cursor = useRef(0);

  // The stage hands out the emitter so the pointer handlers can fire a burst
  // without this component needing to know anything about input.
  useEffect(() => {
    if (!api) return undefined;

    api.current = (origin, normal, power = 1) => {
      const bursts = Math.round(26 + 30 * power);

      for (let i = 0; i < bursts; i += 1) {
        const drop = pool[cursor.current];
        cursor.current = (cursor.current + 1) % COUNT;

        drop.position.copy(origin);

        // Cone around the surface normal, widened by how hard it was hit.
        const spread = 0.9 + 0.8 * power;
        drop.velocity
          .copy(normal)
          .multiplyScalar(0.9 + 1.9 * power * Math.random())
          .add(
            new Vector3(
              (Math.random() - 0.5) * spread,
              Math.random() * (1.3 + 1.9 * power),
              (Math.random() - 0.5) * spread * 0.5
            )
          );

        drop.span = LIFE[0] + Math.random() * (LIFE[1] - LIFE[0]);
        drop.life = drop.span;
        drop.size = 0.012 + Math.random() * 0.026;
      }
    };

    return () => {
      api.current = null;
    };
  }, [api, pool]);

  useFrame((_, delta) => {
    const instanced = mesh.current;
    if (!instanced) return;

    const dt = Math.min(delta, 1 / 30);
    // Generous box around the letter; a droplet that reaches it is offscreen or
    // about to be, so it is cheaper to retire it than to keep integrating it.
    const bound = PLANE;

    for (let i = 0; i < COUNT; i += 1) {
      const drop = pool[i];

      if (drop.life <= 0) {
        instanced.setMatrixAt(i, hidden);
        continue;
      }

      drop.life -= dt;
      drop.velocity.y += GRAVITY * dt;
      drop.velocity.multiplyScalar(1 - (1 - DRAG) * dt * 60 * 0.016);
      drop.position.addScaledVector(drop.velocity, dt);

      if (
        Math.abs(drop.position.x) > bound
        || Math.abs(drop.position.y) > bound
        || Math.abs(drop.position.z) > bound
      ) {
        drop.life = 0;
        instanced.setMatrixAt(i, hidden);
        continue;
      }

      const fade = Math.min(1, drop.life / (drop.span * 0.45));
      scratch.position.copy(drop.position);
      scratch.scale.setScalar(drop.size * fade);
      scratch.rotation.set(0, 0, 0);
      scratch.updateMatrix();
      instanced.setMatrixAt(i, scratch.matrix);
    }

    instanced.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, COUNT]}
      frustumCulled={false}
    >
      <sphereGeometry args={[1, 8, 6]} />
      <meshPhysicalMaterial
        color="#f2f9ff"
        roughness={0.06}
        metalness={0}
        transmission={0.85}
        thickness={0.12}
        ior={1.33}
        transparent
      />
    </instancedMesh>
  );
}
