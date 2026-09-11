import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry } from 'three';
import { heightAt } from '../lib/terrain.js';
import { useWorldScroll } from '../scroll/ScrollProvider.jsx';

/**
 * The opening lattice: a web of white survey lines over the world, which
 * resolves away as the camera comes down.
 *
 * WHAT THIS IS COPYING. On the reference, the first thing on screen is not the
 * landscape — it is a scaffold laid over it: a continuous white grid
 * hanging in the air, stepping over the land in right angles, with small
 * numbers against some of it, while the ground below reads as a slab that has
 * not finished existing yet. It clears as
 * the shot settles. The read is that the world is being SURVEYED into place
 * rather than faded in, which is a much better idea than a fade because it says
 * something about the thing being built.
 *
 * WHY LINES IN THE SCENE RATHER THAN AN OVERLAY. A screen-space graphic would
 * sit on the glass: it would not move with the camera, so during a descent it
 * would read as dirt on the lens. These points are real positions in the world,
 * so the web has depth — near triangles sweep past faster than far ones, and
 * the whole thing parallaxes correctly as the camera falls through it. That
 * parallax is most of why the reference's version reads as a space and not as a
 * texture.
 *
 * It costs one draw call and no textures, and it is gone by the time the shot
 * is held, so it costs nothing at all for the rest of the session.
 */

/*
 * ONE CONNECTED STEPPED GRID — not a field of loose squares.
 *
 * This has been through three shapes. First a point cloud joined to nearest
 * neighbours, which produces TRIANGLES and read as a mesh describing a surface.
 * Then one independent square frame per cell, jittered in size and yaw, which
 * got the right shape and the wrong structure: every frame floated on its own
 * with gaps between them, so the scaffold read as scattered debris rather than
 * as one thing.
 *
 * What it should read as is a world outlining itself the way a voxel game does
 * when it streams in — a continuous grid where every line meets its neighbours,
 * stepping up and down over the landscape underneath.
 *
 * SO THE HEIGHT IS QUANTISED TO THE SAME SPACING AS THE GRID. That is the whole
 * trick, and it is why this reads as blocks rather than as a draped net: a grid
 * whose posts sit at continuous heights gives smooth diagonal lines, and
 * diagonals are the one thing a blocky world never has. Rounding each post to a
 * multiple of the cell size forces every link between two posts to be either
 * dead level or a right angle.
 *
 * AND EVERY LINK IS DRAWN AS AN L, never as a straight line between two posts:
 * out horizontally at the first post's height, then vertically up or down to
 * meet the second. That staircase is the silhouette the whole effect rests on.
 */

/**
 * ONE CELL, IN WORLD UNITS — sized against the igloo's own masonry.
 *
 * The grid was authored as a post COUNT before this (20 across a 700-unit
 * span), which worked out at 35 units a cell — nearly four times the size of a
 * block in the wall, so the scaffold read as a coarse net thrown over the
 * structure rather than as the same world measured at the same grain.
 *
 * Sampled from the bake, a course block is 9.3 units along the wall by 5.9
 * tall, so the masonry's own grain sits between those two figures — and so
 * does this. Settled by eye across three passes: 9.3 (the long edge) read
 * coarser than the blocks, because the grid hangs above the structure and so
 * sits nearer the lens, where any given world size renders slightly larger;
 * 5.9 (the short edge) over-corrected and came out finer than the masonry.
 *
 * 7.4 is between them, which is also where the block's own average edge is.
 *
 * Driving it from a size rather than a count means changing the span no longer
 * silently changes the grain — the two were coupled before, and adjusting
 * coverage quietly re-sized every cell.
 */
const CELL_SIZE = 7.4;

/** The volume they occupy, centred on the igloo. */
const SPAN_X = 700;
const SPAN_Z = 700;

const CELLS = Math.round(SPAN_X / CELL_SIZE);

/**
 * How far the grid floats above the ground it is measuring.
 *
 * It has to clear the igloo — the structure stands about 31 units tall on a
 * pad at 15.7 — or the scaffold would be threaded through the subject rather
 * than suspended over it.
 */
const RISE = 46;

/**
 * How much of the terrain's own shape the grid follows, 0..1.
 *
 * At 1 it is a contour map and every post moves, which is busy. At 0 it is a
 * flat ceiling and says nothing about the land. Part way keeps the grid
 * legible as a grid while still stepping over the big forms underneath, which
 * is what makes it look like it is measuring something.
 */
const FOLLOW = 0.55;

function buildLattice(at) {
  const [ax, az] = at;

  const stepX = SPAN_X / CELLS;
  const stepZ = SPAN_Z / CELLS;
  /* One quantum for the vertical too, so a riser is exactly as tall as a cell
     is wide and the steps come out cubic rather than squat or spindly. */
  const stepY = stepX;

  /* Post heights, quantised. Computed up front because every link needs both
     of its endpoints and half of them belong to the next post along. */
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

  /* An L-shaped link: level to the far post's column, then vertical to meet it.
     Skipping the riser when the two posts are already level keeps the geometry
     honest — a zero-length segment is a wasted vertex pair, and there are a lot
     of level pairs on flat ground. */
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

/**
 * @param {number}  seconds how long the descent takes; the web is gone by then.
 *                          Timed on the intro clock CameraRig runs, which only
 *                          starts once the loader lifts — so it is in step with
 *                          the descent without reading `begin` itself.
 */
export default function Lattice({ at = [-30, 252], seconds = 3.6 }) {
  const lines = useRef(null);
  const done = useRef(false);
  const { intro } = useWorldScroll();

  const geometry = useMemo(() => buildLattice(at), [at]);

  useFrame(() => {
    const mesh = lines.current;
    if (!mesh || done.current) return;

    if (intro.current <= 0) {
      /* Held at full strength while the loader is still up, so the web is
         already there in the first frame the visitor sees rather than fading
         in after it. */
      mesh.material.opacity = 0.55;
      return;
    }

    /*
     * On the intro clock CameraRig runs rather than one of its own. It is still
     * wall-clock time — a timeline asks how long since it started, and summing
     * frame deltas would tie its length to the frame rate — but it is the SAME
     * clock as the camera's, so when a scroll hurries the descent the web
     * clears with it instead of hanging on over a camera that has landed.
     */
    const k = Math.min(1, intro.current / seconds);

    /*
     * Cleared EARLY, on purpose. Fading it out linearly with the descent leaves
     * faint lines still on screen as the shot settles, which reads as something
     * that failed to finish. Squaring the remainder puts most of the fade in
     * the first half of the move, so the web is gone while the camera is still
     * travelling and the arrival is clean.
     */
    const left = 1 - k;
    mesh.material.opacity = 0.55 * left * left;

    if (k >= 1) {
      done.current = true;
      mesh.visible = false;
      /* Nothing else in the session needs it. */
      geometry.dispose();
    }
  });

  return (
    <lineSegments ref={lines} geometry={geometry} frustumCulled={false}>
      {/*
        depthTest stays ON. Turning it off would draw the web over the igloo and
        the hills, which is what makes this kind of overlay look pasted on; with
        it on, lines behind the dome are correctly hidden by it and the web sits
        IN the world.
      */}
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
