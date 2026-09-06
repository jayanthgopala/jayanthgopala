import { BufferGeometry, BufferAttribute } from 'three';

const UV_TILE = 4;

const DEPTH_ATTR = 'aDepth';
const EDGE_ATTR = 'aEdge';

/*
 * NARROWED from 0.3. This is the fraction of a face given over to turning the
 * corner (compared against sin() across the span). At 0.3 roughly the outer
 * fifth of every face was rounding, so each block read as a cushion and the
 * joints as wide soft valleys. At 0.16 about 85% of the face is genuinely flat
 * and the turn happens in a tight rim at each edge — a sawn block with its
 * arris knocked off, which is what the reference shows.
 */
const EDGE_FILLET = 0.34;

const fillet = (x) => {
  const t = Math.min(1, Math.max(0, x / EDGE_FILLET));
  return t * t * (3 - 2 * t);
};

export function buildShellSegment({
  profile,
  u0,
  u1,
  thickness,
  dTheta,
  segTheta = 16,
  segU = 10,
  insetTheta = 0.999,
  insetU = 0.999,
  crown = 0,
}) {
  const closed = dTheta >= Math.PI * 2 - 1e-6;
  const halfT = closed ? Math.PI : (dTheta / 2) * insetTheta;

  const midU = (u0 + u1) / 2;
  const halfU = ((u1 - u0) / 2) * insetU;

  const normalAt = (u) => {
    const h = 1e-3;
    const a = profile(Math.max(0, u - h));
    const b = profile(Math.min(1, u + h));
    const dr = b.r - a.r;
    const dy = b.y - a.y;
    const len = Math.hypot(dr, dy) || 1;
    return { r: dy / len, y: -dr / len };
  };

  const positions = [];
  const uvs = [];
  const depths = [];
  const edges = [];
  const indices = [];

  const startPoint = profile(midU - halfU);
  const endPoint = profile(midU + halfU);
  const profileLength =
    Math.hypot(endPoint.r - startPoint.r, endPoint.y - startPoint.y) || 1;

  const grid = (inward, bulge, depth) => {
    const base = positions.length / 3;
    for (let j = 0; j <= segU; j += 1) {
      const u = midU - halfU + (2 * halfU * j) / segU;
      const p = profile(u);
      const n = normalAt(u);
      const ev = closed ? 1 : Math.sin(Math.PI * (j / segU));

      for (let i = 0; i <= segTheta; i += 1) {
        const theta = -halfT + (2 * halfT * i) / segTheta;
        const eu = closed ? 1 : Math.sin(Math.PI * (i / segTheta));
        const flat = fillet(eu) * fillet(ev);
        const off = -bulge * (1 - flat) - inward;
        edges.push(depth > 0.5 ? 0 : 1 - flat);
        const r = p.r + n.r * off;
        const y = p.y + n.y * off;
        positions.push(r * Math.cos(theta), y, r * Math.sin(theta));

        uvs.push(
          ((theta + halfT) * Math.max(p.r, 0.001)) / UV_TILE,
          ((j / segU) * profileLength) / UV_TILE
        );
        depths.push(depth);
      }
    }
    return base;
  };

  const outerBase = grid(0, crown, 0);
  const innerBase = grid(thickness, 0, 1);

  const at = (base, i, j) => base + j * (segTheta + 1) + i;

  for (let j = 0; j < segU; j += 1) {
    for (let i = 0; i < segTheta; i += 1) {
      const a = at(outerBase, i, j);
      const b = at(outerBase, i + 1, j);
      const c = at(outerBase, i + 1, j + 1);
      const d = at(outerBase, i, j + 1);
      indices.push(a, c, b, a, d, c);
    }
  }

  for (let j = 0; j < segU; j += 1) {
    for (let i = 0; i < segTheta; i += 1) {
      const a = at(innerBase, i, j);
      const b = at(innerBase, i + 1, j);
      const c = at(innerBase, i + 1, j + 1);
      const d = at(innerBase, i, j + 1);
      indices.push(a, b, c, a, c, d);
    }
  }

  const wall = (oA, oB, iA, iB) => indices.push(oA, iA, iB, oA, iB, oB);

  for (let i = 0; i < segTheta; i += 1) {
    wall(at(outerBase, i + 1, 0), at(outerBase, i, 0), at(innerBase, i + 1, 0), at(innerBase, i, 0));
    wall(
      at(outerBase, i, segU),
      at(outerBase, i + 1, segU),
      at(innerBase, i, segU),
      at(innerBase, i + 1, segU)
    );
  }

  for (let j = 0; j < segU; j += 1) {
    wall(at(outerBase, 0, j), at(outerBase, 0, j + 1), at(innerBase, 0, j), at(innerBase, 0, j + 1));
    wall(
      at(outerBase, segTheta, j + 1),
      at(outerBase, segTheta, j),
      at(innerBase, segTheta, j + 1),
      at(innerBase, segTheta, j)
    );
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setAttribute(DEPTH_ATTR, new BufferAttribute(new Float32Array(depths), 1));
  geometry.setAttribute(EDGE_ATTR, new BufferAttribute(new Float32Array(edges), 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * A single voussoir of the entrance arch.
 *
 * CHANGED: this now builds ONE wedge block spanning [-dAngle/2, +dAngle/2]
 * about the +X axis in the XY plane, extruded along Z for `depth`, with its
 * four side faces filleted exactly like a dome block. Previously the whole
 * arch was one ring built in a single call and placed as one piece, so along
 * the tunnel's length there were no joints at all and the entrance read as a
 * smooth barrel. Building per-voussoir (placed by rotation about Z in Igloo.jsx)
 * gives real joints between neighbouring wedges, matching the dome's coursing.
 *
 * The frosted-rim aEdge runs on all four side faces, and aDepth ramps 0 (outer
 * skin / mouth) to 1 (inner skin) so the joints glow from within like the dome.
 */
export function buildVaultSegment({
  radius,
  thickness,
  dAngle,
  depth,
  segAngle = 12,
  segZ = 6,
  inset = 0.995,
  crown = 0,
}) {
  const outer = radius;
  const inner = radius - thickness;
  const half = (dAngle / 2) * inset;
  const hz = depth / 2;
  const halfZ = hz * 0.997;

  const positions = [];
  const uvs = [];
  const depths = [];
  const edges = [];
  const indices = [];

  // A curved grid across the arch (segAngle) and along the tunnel (segZ), so
  // each voussoir has its own filleted rim on every side.
  const grid = (baseR, bulge, depth) => {
    const base = positions.length / 3;
    for (let k = 0; k <= segZ; k += 1) {
      const z = -halfZ + (2 * halfZ * k) / segZ;
      const ez = Math.sin(Math.PI * (k / segZ));
      for (let i = 0; i <= segAngle; i += 1) {
        const a = -half + (2 * half * i) / segAngle;
        const ea = Math.sin(Math.PI * (i / segAngle));
        const flat = fillet(ea) * fillet(ez);
        const rr = baseR - bulge * (1 - flat);
        positions.push(Math.cos(a) * rr, Math.sin(a) * rr, z);
        edges.push(depth > 0.5 ? 0 : 1 - flat);
        uvs.push(((a + half) * radius) / UV_TILE, (z + hz) / UV_TILE);
        depths.push(depth);
      }
    }
    return base;
  };

  const outerBase = grid(outer, crown, 0);
  const innerBase = grid(inner, 0, 1);

  const at = (base, i, k) => base + k * (segAngle + 1) + i;

  // Outer curved face (faces away from axis).
  for (let k = 0; k < segZ; k += 1) {
    for (let i = 0; i < segAngle; i += 1) {
      const a = at(outerBase, i, k);
      const b = at(outerBase, i + 1, k);
      const c = at(outerBase, i + 1, k + 1);
      const d = at(outerBase, i, k + 1);
      indices.push(a, b, c, a, c, d);
    }
  }

  // Inner curved face (the bore; faces the axis).
  for (let k = 0; k < segZ; k += 1) {
    for (let i = 0; i < segAngle; i += 1) {
      const a = at(innerBase, i, k);
      const b = at(innerBase, i + 1, k);
      const c = at(innerBase, i + 1, k + 1);
      const d = at(innerBase, i, k + 1);
      indices.push(a, c, b, a, d, c);
    }
  }

  const wall = (oA, oB, iA, iB) => indices.push(oA, iA, iB, oA, iB, oB);

  // The two radial end faces (voussoir joints) — these are what light up.
  for (let k = 0; k < segZ; k += 1) {
    wall(at(outerBase, 0, k), at(outerBase, 0, k + 1), at(innerBase, 0, k), at(innerBase, 0, k + 1));
    wall(
      at(outerBase, segAngle, k + 1),
      at(outerBase, segAngle, k),
      at(innerBase, segAngle, k + 1),
      at(innerBase, segAngle, k)
    );
  }

  // The two end caps (front mouth and buried back).
  for (let i = 0; i < segAngle; i += 1) {
    wall(at(outerBase, i + 1, 0), at(outerBase, i, 0), at(innerBase, i + 1, 0), at(innerBase, i, 0));
    wall(
      at(outerBase, i, segZ),
      at(outerBase, i + 1, segZ),
      at(innerBase, i, segZ),
      at(innerBase, i + 1, segZ)
    );
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setAttribute(DEPTH_ATTR, new BufferAttribute(new Float32Array(depths), 1));
  geometry.setAttribute(EDGE_ATTR, new BufferAttribute(new Float32Array(edges), 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function buildBrick(w, h, d, chamfer = 0.08) {
  const c = Math.min(w, h, d) * chamfer;

  const xs = [-w / 2, -w / 2 + c, w / 2 - c, w / 2];
  const ys = [-h / 2, -h / 2 + c, h / 2 - c, h / 2];
  const zs = [-d / 2, -d / 2 + c, d / 2 - c, d / 2];

  const lattice = [];
  for (let i = 0; i < 4; i += 1) {
    for (let j = 0; j < 4; j += 1) {
      for (let k = 0; k < 4; k += 1) lattice.push([xs[i], ys[j], zs[k]]);
    }
  }
  const at = (i, j, k) => lattice[i * 16 + j * 4 + k];

  const positions = [];
  const uvs = [];
  const indices = [];

  const face = (p0, p1, p2, p3, axis) => {
    const base = positions.length / 3;
    for (const p of [p0, p1, p2, p3]) {
      positions.push(p[0], p[1], p[2]);
      if (axis === 'i') uvs.push(p[2] / UV_TILE, p[1] / UV_TILE);
      else if (axis === 'j') uvs.push(p[0] / UV_TILE, p[2] / UV_TILE);
      else uvs.push(p[0] / UV_TILE, p[1] / UV_TILE);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  const faces = [
    [0, 'i'], [3, 'i'],
    [0, 'j'], [3, 'j'],
    [0, 'k'], [3, 'k'],
  ];

  for (const [layer, axis] of faces) {
    for (let a = 0; a < 3; a += 1) {
      for (let b = 0; b < 3; b += 1) {
        let p0;
        let p1;
        let p2;
        let p3;

        if (axis === 'i') {
          p0 = at(layer, a, b);
          p1 = at(layer, a + 1, b);
          p2 = at(layer, a + 1, b + 1);
          p3 = at(layer, a, b + 1);
          if (layer === 0) [p1, p3] = [p3, p1];
        } else if (axis === 'j') {
          p0 = at(a, layer, b);
          p1 = at(a + 1, layer, b);
          p2 = at(a + 1, layer, b + 1);
          p3 = at(a, layer, b + 1);
          if (layer === 3) [p1, p3] = [p3, p1];
        } else {
          p0 = at(a, b, layer);
          p1 = at(a + 1, b, layer);
          p2 = at(a + 1, b + 1, layer);
          p3 = at(a, b + 1, layer);
          if (layer === 0) [p1, p3] = [p3, p1];
        }

        face(p0, p1, p2, p3, axis);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setAttribute(
    DEPTH_ATTR,
    new BufferAttribute(new Float32Array(positions.length / 3), 1)
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}