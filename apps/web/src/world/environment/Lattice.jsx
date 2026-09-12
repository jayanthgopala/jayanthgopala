import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry } from 'three';
import { heightAt } from '../lib/terrain.js';
import { useWorldScroll } from '../scroll/ScrollProvider.jsx';

// Spatial wireframe lattice survey grid that dissolves during camera descent

// Grid cell sizing
const CELL_SIZE = 7.4;

const SPAN_X = 700;
const SPAN_Z = 700;

const CELLS = Math.round(SPAN_X / CELL_SIZE);

// Height offset clearing the igloo dome
const RISE = 46;

// Terrain contour following weight
const FOLLOW = 0.55;

function buildLattice(at) {
  const [ax, az] = at;

  const stepX = SPAN_X / CELLS;
  const stepZ = SPAN_Z / CELLS;
  // one quantum for the vertical too, so a riser is as tall as a cell is wide and the steps come out cubic
  const stepY = stepX;

  // Precompute elevation field
  const y = [];
  for (let i = 0; i <= CELLS; i += 1) {
    y.push([]);
    for (let j = 0; j <= CELLS; j += 1) {
      const px = ax - SPAN_X / 2 + i * stepX;
      const pz = az - SPAN_Z / 2 + j * stepZ;
      const ground = heightAt(px, pz);
      y[i].push(Math.round((ground * FOLLOW + RISE) / stepY) * stepY);
    }
  }

  const verts = [];
  const px = (i) => ax - SPAN_X / 2 + i * stepX;
  const pz = (j) => az - SPAN_Z / 2 + j * stepZ;

  // Staircase step link
  const link = (x0, y0, z0, x1, y1, z1) => {
    verts.push(x0, y0, z0, x1, y0, z1);
    if (y1 !== y0) verts.push(x1, y0, z1, x1, y1, z1);
  };

  for (let i = 0; i <= CELLS; i += 1) {
    for (let j = 0; j <= CELLS; j += 1) {
      if (i < CELLS) link(px(i), y[i][j], pz(j), px(i + 1), y[i + 1][j], pz(j));
      if (j < CELLS) link(px(i), y[i][j], pz(j), px(i), y[i][j + 1], pz(j + 1));
    }
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
  return g;
}

export default function Lattice({ at = [-30, 252], seconds = 3.6 }) {
  const lines = useRef(null);
  const done = useRef(false);
  const { intro } = useWorldScroll();

  const geometry = useMemo(() => buildLattice(at), [at]);

  useFrame(() => {
    const mesh = lines.current;
    if (!mesh || done.current) return;

    if (intro.current <= 0) {
      mesh.material.opacity = 0.55;
      return;
    }

    // Quadratic fade synced to intro clock
    const k = Math.min(1, intro.current / seconds);
    const left = 1 - k;
    mesh.material.opacity = 0.55 * left * left;

    if (k >= 1) {
      done.current = true;
      mesh.visible = false;
      geometry.dispose();
    }
  });

  return (
    <lineSegments ref={lines} geometry={geometry} frustumCulled={false}>
      {/* Depth test enabled to occlude behind igloo structure */}
      <lineBasicMaterial
        color="#ffffff"
        transparent
        opacity={0.55}
        depthWrite={false}
        toneMapped={false}
      />
    </lineSegments>
  );
}
