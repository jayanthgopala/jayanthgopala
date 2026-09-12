// The ten objects a project can be.
//
// Built from three's own primitives and a few lathed or extruded profiles, so
// there are no model files to fetch and nothing to keep in sync with the
// database beyond an id string.
//
// Every shape is normalised to the same bounding radius and centred on the
// origin, for the same reason the letterforms were sized on cap height: without
// it a torus knot and a shard read as two different scales rather than two
// different objects.

import { SHAPE_IDS } from '@portfolio/shapes';
import { MAX_EDGE } from './device.js';
import { TessellateModifier } from 'three/examples/jsm/modifiers/TessellateModifier.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  ExtrudeGeometry,
  IcosahedronGeometry,
  LatheGeometry,
  Shape,
  TorusGeometry,
  TorusKnotGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';

/** Bounding radius every object is scaled to. */
const RADIUS = 1.25;

/* ── Builders ──────────────────────────────────────────────────────────── */

// A profile revolved about Y. Points run bottom to top in (radius, height).
const lathe = (points, segments = 72) =>
  new LatheGeometry(points.map(([x, y]) => new Vector2(x, y)), segments);

/**
 * A surface swept from a function of two parameters.
 *
 * Lathing cannot make a flower — the radius has to vary with angle as well as
 * height — so the petalled shapes are built straight from a grid instead.
 */
function parametric(fn, uSegments, vSegments) {
  const positions = [];
  const indices = [];
  const point = new Vector3();

  for (let iv = 0; iv <= vSegments; iv += 1) {
    for (let iu = 0; iu <= uSegments; iu += 1) {
      fn(iu / uSegments, iv / vSegments, point);
      positions.push(point.x, point.y, point.z);
    }
  }

  const stride = uSegments + 1;
  for (let iv = 0; iv < vSegments; iv += 1) {
    for (let iu = 0; iu < uSegments; iu += 1) {
      const a = iv * stride + iu;
      const b = a + stride;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function waterFlower() {
  const PETALS = 6;

  return parametric(
    (u, v, out) => {
      const angle = u * Math.PI * 2;

      // Petal edge: the radius swells and pinches six times around, and the
      // pinch deepens toward the rim so the petals separate rather than staying
      // a scalloped dish.
      const lobe = Math.abs(Math.cos(angle * PETALS * 0.5)) ** 0.7;
      const reach = 0.28 + 0.86 * v;
      const radius = reach * (0.42 + 0.58 * lobe);

      // Petals lift at the tips and the centre sits low, like a bloom seen
      // slightly from above.
      const lift = v * v * 0.62 * lobe - (1 - v) * 0.22;

      out.set(Math.cos(angle) * radius, lift, Math.sin(angle) * radius);
    },
    160,
    40
  );
}

function torus() {
  return new TorusGeometry(0.74, 0.31, 44, 128);
}

function icosahedron() {
  return new IcosahedronGeometry(1, 0);
}

function roundedCube() {
  const geometry = new BoxGeometry(1.3, 1.3, 1.3, 14, 14, 14);
  const position = geometry.attributes.position;
  const point = new Vector3();

  // Pulled part way onto a sphere: flat faces for long clean reflections, with
  // edges round enough to carry a highlight.
  for (let i = 0; i < position.count; i += 1) {
    point.fromBufferAttribute(position, i);
    const flat = point.clone();
    const round = point.clone().normalize().multiplyScalar(1.12);
    point.lerpVectors(flat, round, 0.32);
    position.setXYZ(i, point.x, point.y, point.z);
  }

  position.needsUpdate = true;
  return geometry;
}

function knot() {
  return new TorusKnotGeometry(0.62, 0.2, 220, 32, 2, 3);
}

function crescent() {
  const shape = new Shape();
  const outer = 1;
  const inner = 0.74;
  const bite = 0.42; // How far the inner arc is pushed across.

  shape.absarc(0, 0, outer, Math.PI * 0.32, Math.PI * 1.68, false);
  shape.absarc(bite, 0, inner, Math.PI * 1.52, Math.PI * 0.48, true);

  return new ExtrudeGeometry(shape, {
    depth: 0.44,
    bevelEnabled: true,
    bevelThickness: 0.14,
    bevelSize: 0.12,
    bevelSegments: 6,
    curveSegments: 48,
  });
}

function mountain() {
  const shape = new Shape();
  // A ridge line rather than a single triangle: a lone peak reads as an arrow.
  shape.moveTo(-1.1, -0.62);
  shape.lineTo(-0.42, 0.16);
  shape.lineTo(-0.18, -0.06);
  shape.lineTo(0.12, 0.62);
  shape.lineTo(0.46, 0.02);
  shape.lineTo(0.72, 0.3);
  shape.lineTo(1.1, -0.62);
  shape.closePath();

  return new ExtrudeGeometry(shape, {
    depth: 0.5,
    bevelEnabled: true,
    bevelThickness: 0.16,
    bevelSize: 0.13,
    bevelSegments: 5,
  });
}

function dome() {
  const points = [];
  // The igloo: a hemisphere with a flat base, squashed slightly so it reads as
  // built rather than as half a ball.
  for (let i = 0; i <= 28; i += 1) {
    const t = i / 28;
    const angle = t * Math.PI * 0.5;
    points.push([Math.max(0.0001, Math.cos(angle) * 1.05), Math.sin(angle) * 0.82 - 0.34]);
  }
  points.unshift([0.0001, -0.34]);
  return lathe(points);
}

function shard() {
  // Six-sided and double-terminated, the way quartz grows.
  const geometry = new CylinderGeometry(0.42, 0.42, 1.15, 6, 20, false);
  const position = geometry.attributes.position;
  const point = new Vector3();

  // Draw both ends to a point by pinching the caps inward.
  for (let i = 0; i < position.count; i += 1) {
    point.fromBufferAttribute(position, i);
    const end = Math.abs(point.y) / 0.575;
    if (end > 0.999) {
      const tip = Math.sign(point.y) * 1.05;
      position.setXYZ(i, point.x * 0.06, tip, point.z * 0.06);
    }
  }

  position.needsUpdate = true;
  return geometry;
}

function liquidDna() {
  const TURNS = 2.1;
  const RISE = 1.9;
  const RADIUS = 0.42;
  const strands = [];

  // Two strands, half a turn apart.
  for (const phase of [0, Math.PI]) {
    const points = [];
    for (let i = 0; i <= 120; i += 1) {
      const t = i / 120;
      const angle = t * Math.PI * 2 * TURNS + phase;
      points.push(
        new Vector3(Math.cos(angle) * RADIUS, (t - 0.5) * RISE, Math.sin(angle) * RADIUS)
      );
    }
    strands.push(new TubeGeometry(new CatmullRomCurve3(points), 180, 0.085, 14, false));
  }

  // Rungs between them. Sparse enough to read as a ladder rather than a solid
  // ribbon, which is what the pairing has to look like to be legible.
  const rungs = [];
  for (let i = 0; i <= 13; i += 1) {
    const t = i / 13;
    const angle = t * Math.PI * 2 * TURNS;
    const y = (t - 0.5) * RISE;
    const bar = new CylinderGeometry(0.045, 0.045, RADIUS * 2, 10, 1);
    bar.rotateZ(Math.PI / 2);
    bar.rotateY(-angle);
    bar.translate(0, y, 0);
    rungs.push(bar);
  }

  return mergeGeometries([...strands, ...rungs], false);
}

/* ── Registry ──────────────────────────────────────────────────────────── */

// The catalogue itself lives in @portfolio/shapes, so the admin panel assigns
// from exactly the list the site renders. Only the builders are local, because
// only this app has three.
const BUILDERS = {
  flower: waterFlower,
  ring: torus,
  icosahedron,
  cube: roundedCube,
  knot,
  crescent,
  peak: mountain,
  dome,
  shard,
  dna: liquidDna,
};

/* ── Preparation ───────────────────────────────────────────────────────── */

/**
 * Averages normals across vertices that share a position.
 *
 * Faceted shapes keep their hard edges for shading, but displacing along a face
 * normal would pull neighbouring faces apart and open cracks the moment the
 * water moves. Displacement uses this welded normal instead, which depends only
 * on where a vertex is, so coincident vertices always move together.
 */
function weldedNormals(geometry) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const sums = new Map();
  const key = (i) =>
    `${position.getX(i).toFixed(4)},${position.getY(i).toFixed(4)},${position.getZ(i).toFixed(4)}`;

  for (let i = 0; i < position.count; i += 1) {
    const k = key(i);
    const entry = sums.get(k) || [0, 0, 0];
    entry[0] += normal.getX(i);
    entry[1] += normal.getY(i);
    entry[2] += normal.getZ(i);
    sums.set(k, entry);
  }

  const out = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) {
    const [x, y, z] = sums.get(key(i));
    const length = Math.hypot(x, y, z) || 1;
    out[i * 3] = x / length;
    out[i * 3 + 1] = y / length;
    out[i * 3 + 2] = z / length;
  }

  geometry.setAttribute('aSmooth', new BufferAttribute(out, 3));
}

// Edge length beyond which a triangle is split. The ripple field is sampled per
// vertex, so a face larger than this cannot show a wave crossing it — it can
// only move as a whole. Flat-faced shapes come out of three far too coarse for
// that, and subdividing in place keeps their facets while giving the water
// something to move. The target itself is set by device.js, since it decides
// both how much geometry there is and how long it takes to build.
// Six passes left the icosahedron at a 0.285 edge — it stopped on the iteration
// cap, not on the target — which is only about two faces across a ripple. Ten
// lets every shape actually reach MAX_EDGE.
const tessellate = new TessellateModifier(MAX_EDGE, 10);

/** Longest triangle edge in a geometry, for deciding if it needs subdividing. */
function longestEdge(geometry) {
  const position = geometry.attributes.position;
  const index = geometry.index;
  const count = index ? index.count : position.count;
  const at = (i) => (index ? index.getX(i) : i);
  let longest = 0;

  for (let i = 0; i < count; i += 3) {
    const a = at(i);
    const b = at(i + 1);
    const c = at(i + 2);
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const dx = position.getX(u) - position.getX(v);
      const dy = position.getY(u) - position.getY(v);
      const dz = position.getZ(u) - position.getZ(v);
      const d = dx * dx + dy * dy + dz * dz;
      if (d > longest) longest = d;
    }
  }

  return Math.sqrt(longest);
}

const cache = new Map();

/** Geometry for a shape id, centred, scaled to a common size, and cached. */
export function shapeGeometry(id) {
  const build = BUILDERS[id] || BUILDERS[SHAPE_IDS[0]];
  const key = BUILDERS[id] ? id : SHAPE_IDS[0];
  const hit = cache.get(key);
  if (hit) return hit;

  const geometry = build();
  geometry.center();
  geometry.computeBoundingSphere();

  const radius = geometry.boundingSphere?.radius || 1;
  geometry.scale(RADIUS / radius, RADIUS / radius, RADIUS / radius);

  if (!geometry.attributes.normal) geometry.computeVertexNormals();

  // Only the coarse shapes need subdividing. A lathe or a torus knot already
  // arrives finer than MAX_EDGE from its own segment counts, and running the
  // modifier over one is several hundred milliseconds spent to change nothing —
  // which is most of what made the first object slow to appear.
  const needsWork = longestEdge(geometry) > MAX_EDGE * 1.15;

  // Tessellation drops every attribute but position, uv and colour, so normals
  // are rebuilt afterwards rather than carried through it.
  // Some builders already hand back non-indexed geometry; three warns if asked
  // to convert one again.
  const dense = needsWork
    ? tessellate.modify(geometry.index ? geometry.toNonIndexed() : geometry)
    : geometry;
  dense.computeVertexNormals();
  weldedNormals(dense);
  dense.computeBoundingSphere();

  cache.set(key, dense);
  return dense;
}

export { SHAPES, SHAPE_IDS, shapeFor } from '@portfolio/shapes';
