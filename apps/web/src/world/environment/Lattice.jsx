import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry } from 'three';
import { heightAt } from '../lib/terrain.js';
import { useWorldScroll } from '../scroll/ScrollProvider.jsx';

// A web of white survey lines over the world, which clears as the camera comes down.
// Real positions in the world rather than a screen overlay, so it parallaxes as the camera falls through it.
// A screen-space graphic would sit on the glass and read as dirt on the lens during the descent.
// Heights are quantised to the grid spacing, which is the whole trick, continuous heights give diagonals and a blocky world has none.
// Every link is drawn as an L, out level then up or down, and that staircase is the silhouette the effect rests on.

// Sized against the igloo's masonry. A course block is 9.3 units along the wall by 5.9 tall and this sits between them.
// Driving it from a size rather than a post count means changing the span no longer silently changes the grain.
const CELL_SIZE = 7.4;

const SPAN_X = 700;
const SPAN_Z = 700;

const CELLS = Math.round(SPAN_X / CELL_SIZE);

// Has to clear the igloo, which stands about 31 units on a pad at 15.7, or the scaffold threads through the subject.
const RISE = 46;

// How much of the terrain's shape the grid follows. At 1 it's a busy contour map, at 0 a flat ceiling saying nothing.
const FOLLOW = 0.55;

function buildLattice(at) {
  const [ax, az] = at;

  const stepX = SPAN_X / CELLS;
  const stepZ = SPAN_Z / CELLS;
  // one quantum for the vertical too, so a riser is as tall as a cell is wide and the steps come out cubic
  const stepY = stepX;

  // computed up front because every link needs both endpoints and half of them belong to the next post along
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

  // level to the far post's column, then vertical to meet it. Skipping the riser on level pairs saves a lot of vertices.
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
      // full strength while the loader is up, so the web is there in the first frame rather than fading in after it
      mesh.material.opacity = 0.55;
      return;
    }

    // The same intro clock CameraRig runs, so when a scroll hurries the descent the web clears with it.
    const k = Math.min(1, intro.current / seconds);

    // Squared, so most of the fade lands in the first half of the move. A linear fade leaves faint lines on screen
    // as the shot settles, which reads as something that failed to finish.
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
      {/* depthTest stays on, so lines behind the dome are hidden by it and the web sits in the world rather than pasted over it */}
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
