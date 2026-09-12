import { BufferAttribute, BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { makeRng } from './util.js';

// Procedural faceted crystal geometry generation from seeded points and cleavage planes

/* Ellipsoid radii: taller than wide, shallower front to back. */
const RX = 1.0;
const RY = 1.65;
const RZ = 0.82;

export function randomUnit(rand, out = new Vector3()) {
  const z = rand() * 2 - 1;
  const t = rand() * Math.PI * 2;
  const q = Math.sqrt(1 - z * z);
  return out.set(q * Math.cos(t), z, q * Math.sin(t));
}

export function makeCrystalGeometry(seed) {
  const rand = makeRng(seed);
  const points = [];
  const N = 24;

  // Jittered Fibonacci sphere point distribution
  for (let i = 0; i < N; i += 1) {
    const y = 1 - ((i + 0.5) / N) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = i * 2.399963 + rand() * 0.7;
    const k = 0.74 + rand() * 0.32;
    points.push(new Vector3(Math.cos(th) * r * RX * k, y * RY * k, Math.sin(th) * r * RZ * k));
  }

  // Cleavage fracture planes
  const n = new Vector3();
  const cuts = 3 + Math.floor(rand() * 2);
  for (let c = 0; c < cuts; c += 1) {
    randomUnit(rand, n);
    const extent = Math.hypot(n.x * RX, n.y * RY, n.z * RZ);
    const d = extent * (0.6 + rand() * 0.2);
    for (const p of points) {
      const s = p.dot(n);
      if (s > d) p.addScaledVector(n, d - s);
    }
  }

  const geo = new ConvexGeometry(points);

  // Triplanar box-projected UV coordinates
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i += 1) {
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    let u;
    let v;
    if (ax >= ay && ax >= az) {
      u = pos.getZ(i);
      v = pos.getY(i);
    } else if (ay >= az) {
      u = pos.getX(i);
      v = pos.getZ(i);
    } else {
      u = pos.getX(i);
      v = pos.getY(i);
    }
    uv[i * 2] = u * 0.42 + 0.5;
    uv[i * 2 + 1] = v * 0.42 + 0.5;
  }
  geo.setAttribute('uv', new BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  return geo;
}

// Procedural wireframe plexus web surrounding the crystal
export function makePlexus(seed) {
  const rand = makeRng(seed ^ 0x51ed27);
  const pts = [];
  const tmp = new Vector3();
  for (let i = 0; i < 26; i += 1) {
    randomUnit(rand, tmp);
    const k = 0.86 + rand() * 0.4;
    pts.push(new Vector3(tmp.x * 1.8 * k, tmp.y * 2.45 * k, tmp.z * 1.45 * k));
  }
  pts.sort((a, b) => Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x));

  const seg = [];
  const seen = new Set();
  const push = (a, b) => seg.push(a.x, a.y, a.z, b.x, b.y, b.z);

  pts.forEach((p, i) => {
    pts
      .map((q, j) => [j, p.distanceToSquared(q)])
      .filter(([j]) => j !== i)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 2)
      .forEach(([j]) => {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (seen.has(key)) return;
        seen.add(key);
        push(p, pts[j]);
      });

    if (rand() < 0.24) {
      const s = 0.16;
      const b = p.clone().add(new Vector3(s, s * 0.35, 0));
      const c = p.clone().add(new Vector3(s * 0.3, -s, 0.04));
      push(p, b);
      push(b, c);
      push(c, p);
    }
  });

  const lines = new BufferGeometry();
  lines.setAttribute('position', new Float32BufferAttribute(seg, 3));

  const dots = new BufferGeometry();
  dots.setAttribute('position', new Float32BufferAttribute(pts.flatMap((p) => [p.x, p.y, p.z]), 3));

  return { lines, dots, segments: seg.length / 6, points: pts.length };
}
