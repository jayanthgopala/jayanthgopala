import {
  CylinderGeometry,
  IcosahedronGeometry,
  Matrix4,
  OctahedronGeometry,
  Quaternion,
  SphereGeometry,
  TorusKnotGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRng } from './util.js';
import { randomUnit } from './crystal-geometry.js';

/** Generates procedural 3D sculpture forms frozen inside crystal hulls. */

const UP = new Vector3(0, 1, 0);
const RADIUS = 0.42;

function normalise(geo) {
  geo.computeBoundingSphere();
  const { center, radius } = geo.boundingSphere;
  geo.translate(-center.x, -center.y, -center.z);
  geo.scale(RADIUS / radius, RADIUS / radius, RADIUS / radius);
  geo.computeBoundingSphere();
  return geo;
}

/* Elongated shards radiating from one point — a frozen burst. */
function shardCluster(rand) {
  const parts = [];
  const count = 6 + Math.floor(rand() * 4);
  const dir = new Vector3();
  const q = new Quaternion();
  const m = new Matrix4();
  for (let i = 0; i < count; i += 1) {
    const g = new OctahedronGeometry(1, 0);
    const len = 0.45 + rand() * 0.35;
    const w = 0.1 + rand() * 0.08;
    g.scale(w, len, w * (0.7 + rand() * 0.5));
    g.translate(0, len * 0.72, 0);
    randomUnit(rand, dir);
    dir.y = Math.abs(dir.y) * 0.6 + 0.25;
    dir.normalize();
    q.setFromUnitVectors(UP, dir);
    g.applyMatrix4(m.makeRotationFromQuaternion(q));
    parts.push(g);
  }
  return mergeGeometries(parts);
}

/* A torus knot with seeded winding numbers. */
function knot(rand) {
  const windings = [[2, 3], [3, 2], [2, 5], [3, 4], [3, 5]];
  const [p, qn] = windings[Math.floor(rand() * windings.length)];
  return new TorusKnotGeometry(0.5, 0.12 + rand() * 0.05, 200, 18, p, qn);
}

/* Strut lattice structure */
function lattice(rand) {
  const parts = [];
  const q = new Quaternion();
  const m = new Matrix4();
  const dir = new Vector3();

  const addCage = (source, scale, strut, node) => {
    const pos = source.attributes.position;
    const verts = [];
    const keyOf = (v) => `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    const index = new Map();
    const vid = (i) => {
      const v = new Vector3().fromBufferAttribute(pos, i).multiplyScalar(scale);
      const k = keyOf(v);
      if (!index.has(k)) {
        index.set(k, verts.length);
        verts.push(v);
      }
      return index.get(k);
    };
    const edges = new Set();
    for (let t = 0; t < pos.count; t += 3) {
      const a = vid(t);
      const b = vid(t + 1);
      const c = vid(t + 2);
      [[a, b], [b, c], [c, a]].forEach(([x, y]) => edges.add(x < y ? `${x}-${y}` : `${y}-${x}`));
    }
    edges.forEach((e) => {
      const [i, j] = e.split('-').map(Number);
      const A = verts[i];
      const B = verts[j];
      const len = A.distanceTo(B);
      const g = new CylinderGeometry(strut, strut, len, 6, 1);
      dir.subVectors(B, A).normalize();
      q.setFromUnitVectors(UP, dir);
      g.applyMatrix4(m.makeRotationFromQuaternion(q));
      g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
      parts.push(g);
    });
    verts.forEach((v) => {
      const g = new SphereGeometry(node, 10, 8);
      g.translate(v.x, v.y, v.z);
      parts.push(g);
    });
  };

  const outer = rand() < 0.5 ? new IcosahedronGeometry(1, 0) : new OctahedronGeometry(1, 0);
  addCage(outer, 0.6, 0.032, 0.07);
  const inner = new OctahedronGeometry(1, 0);
  inner.rotateY(rand() * Math.PI);
  inner.rotateX(rand() * Math.PI);
  addCage(inner, 0.28, 0.024, 0.05);
  return mergeGeometries(parts);
}

export function makeEmblemGeometry(seed) {
  const rand = makeRng(seed ^ 0x9e3779b9);
  const family = Math.floor(rand() * 3);
  const geo = family === 0 ? shardCluster(rand) : family === 1 ? knot(rand) : lattice(rand);
  return normalise(geo);
}
