import { BufferAttribute, BufferGeometry } from 'three';
import { drawIcon } from './geometry.js';

// A social mark as a closed, rounded body of water.
//
// The mark is drawn to a canvas and measured with an exact distance transform,
// refined to sub-pixel accuracy from the canvas's own anti-aliasing, so the
// outline is true rather than stepped. That outline is swept through depth with
// rounded edges — a pebble in the shape of the icon, with no seam or cut rim.
// Surface nets pull a mesh out of the field, a few rounds of volume-preserving
// smoothing take out the lattice's grain, and every vertex is settled back onto
// the surface, so highlights run cleanly along the edges.
//
// It carries the same `aSmooth` normal the project objects use, so it takes the
// same water material and moves with the same ripples.

/** Raster the mark is measured on. */
const S = 512;

const INF = 1e20;

/** One dimension of the exact squared Euclidean distance transform (Felzenszwalb & Huttenlocher). */
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q += 1) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k -= 1;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q += 1) {
    while (z[k + 1] < q) k += 1;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/** Squared distance from every pixel to the nearest pixel where `feature` is set. */
function squaredDistance(feature) {
  const grid = new Float64Array(S * S);
  for (let i = 0; i < S * S; i += 1) grid[i] = feature[i] ? 0 : INF;
  const f = new Float64Array(S);
  const d = new Float64Array(S);
  const v = new Int32Array(S);
  const z = new Float64Array(S + 1);
  for (let x = 0; x < S; x += 1) {
    for (let y = 0; y < S; y += 1) f[y] = grid[y * S + x];
    edt1d(f, S, d, v, z);
    for (let y = 0; y < S; y += 1) grid[y * S + x] = d[y];
  }
  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) f[x] = grid[y * S + x];
    edt1d(f, S, d, v, z);
    for (let x = 0; x < S; x += 1) grid[y * S + x] = d[x];
  }
  return grid;
}

/** Signed distance to the mark's outline per pixel, in pixels: positive inside. */
function iconField(icon, label) {
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  // Icons are drawn in a 256 box.
  g.scale(S / 256, S / 256);
  drawIcon(g, icon, label);
  const img = g.getImageData(0, 0, S, S).data;

  const inside = new Uint8Array(S * S);
  const outside = new Uint8Array(S * S);
  for (let i = 0; i < S * S; i += 1) {
    const on = img[i * 4 + 3] >= 128 ? 1 : 0;
    inside[i] = on;
    outside[i] = 1 - on;
  }
  const toOutside = squaredDistance(outside);
  const toInside = squaredDistance(inside);

  let sd = new Float32Array(S * S);
  for (let i = 0; i < S * S; i += 1) {
    const s = inside[i] ? Math.sqrt(toOutside[i]) - 0.5 : -(Math.sqrt(toInside[i]) - 0.5);
    // Right at the edge, the canvas's anti-aliased coverage places the outline
    // within the pixel.
    sd[i] = Math.abs(s) <= 0.5 ? img[i * 4 + 3] / 255 - 0.5 : s;
  }

  // A light blur for what little grain is left.
  for (let p = 0; p < 2; p += 1) {
    const out = new Float32Array(S * S);
    for (let y = 0; y < S; y += 1) {
      for (let x = 0; x < S; x += 1) {
        let sum = 0;
        let n = 0;
        for (let yy = Math.max(0, y - 1); yy <= Math.min(S - 1, y + 1); yy += 1) {
          for (let xx = Math.max(0, x - 1); xx <= Math.min(S - 1, x + 1); xx += 1) {
            sum += sd[yy * S + xx];
            n += 1;
          }
        }
        out[y * S + x] = sum / n;
      }
    }
    sd = out;
  }
  return sd;
}

// The twelve edges of a cell, as pairs of corner indices (bit 0 x, 1 y, 2 z).
const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/**
 * Volume-preserving mesh smoothing (Taubin): a shrinking pass toward each
 * vertex's neighbours, then an inflating pass, so grain goes but size stays.
 */
function taubin(positions, index, iterations) {
  const n = positions.length / 3;
  const sum = new Float32Array(n * 3);
  const count = new Uint32Array(n);
  const pass = (factor) => {
    sum.fill(0);
    count.fill(0);
    const link = (a, b) => {
      sum[a * 3] += positions[b * 3];
      sum[a * 3 + 1] += positions[b * 3 + 1];
      sum[a * 3 + 2] += positions[b * 3 + 2];
      count[a] += 1;
    };
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t];
      const b = index[t + 1];
      const c = index[t + 2];
      link(a, b);
      link(b, a);
      link(b, c);
      link(c, b);
      link(c, a);
      link(a, c);
    }
    for (let v = 0; v < n; v += 1) {
      if (!count[v]) continue;
      for (let k = 0; k < 3; k += 1) {
        const avg = sum[v * 3 + k] / count[v];
        positions[v * 3 + k] += factor * (avg - positions[v * 3 + k]);
      }
    }
  };
  for (let i = 0; i < iterations; i += 1) {
    pass(0.5);
    pass(-0.53);
  }
}

/**
 * @param {string} icon
 * @param {string} label
 * @param {{ size?: number, depth?: number, round?: number, cells?: number, smooth?: number }} options
 *   size: width of the mark; depth: half its thickness; round: edge radius;
 *   cells: surface resolution across the mark; smooth: smoothing iterations.
 */
export function iconBlob(icon, label, { size = 1.35, depth = 0.2, round = 0.15, cells = 140, smooth = 6 } = {}) {
  const sd = iconField(icon, label);
  const px = size / S;

  // Distance to the outline in world units, negative inside.
  const dist2 = (x, y) => {
    const gx = (x / size + 0.5) * S - 0.5;
    const gy = (0.5 - y / size) * S - 0.5;
    const cx = Math.min(S - 1, Math.max(0, gx));
    const cy = Math.min(S - 1, Math.max(0, gy));
    const i0 = Math.min(S - 2, Math.floor(cx));
    const j0 = Math.min(S - 2, Math.floor(cy));
    const tx = cx - i0;
    const ty = cy - j0;
    const a = sd[j0 * S + i0];
    const b = sd[j0 * S + i0 + 1];
    const c = sd[(j0 + 1) * S + i0];
    const d = sd[(j0 + 1) * S + i0 + 1];
    const s = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    return -s * px + Math.hypot(gx - cx, gy - cy) * px;
  };

  // The outline swept through the depth with rounded edges of radius R. Thin
  // strokes round into tubes rather than vanishing.
  const R = Math.min(round, depth);
  const shape = (d2, z) => {
    const wx = d2 + R;
    const wz = Math.abs(z) - (depth - R);
    return Math.min(Math.max(wx, wz), 0) + Math.hypot(Math.max(wx, 0), Math.max(wz, 0)) - R;
  };
  const sdf = (x, y, z) => shape(dist2(x, y), z);

  // Sample the field on a lattice; the outline distance is looked up once per column.
  const step = size / cells;
  const pad = step * 2;
  const x0 = -size / 2 - pad;
  const y0 = -size / 2 - pad;
  const z0 = -depth - pad;
  const nx = Math.ceil((size + 2 * pad) / step) + 1;
  const ny = nx;
  const nz = Math.ceil((2 * depth + 2 * pad) / step) + 1;
  const vals = new Float32Array(nx * ny * nz);
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const d2 = dist2(x0 + i * step, y0 + j * step);
      for (let k = 0; k < nz; k += 1) vals[i + nx * (j + ny * k)] = shape(d2, z0 + k * step);
    }
  }
  const at = (i, j, k) => vals[i + nx * (j + ny * k)];

  // Surface nets: one vertex per cell the surface crosses.
  const cnx = nx - 1;
  const cny = ny - 1;
  const cnz = nz - 1;
  const vertOf = new Int32Array(cnx * cny * cnz).fill(-1);
  const pos = [];
  const cv = new Float32Array(8);
  for (let k = 0; k < cnz; k += 1) {
    for (let j = 0; j < cny; j += 1) {
      for (let i = 0; i < cnx; i += 1) {
        let mask = 0;
        for (let c = 0; c < 8; c += 1) {
          const v = at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1));
          cv[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        for (const [a, b] of EDGES) {
          const va = cv[a];
          const vb = cv[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          sx += (a & 1) + ((b & 1) - (a & 1)) * t;
          sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
          n += 1;
        }
        vertOf[i + cnx * (j + cny * k)] = pos.length / 3;
        pos.push(x0 + (i + sx / n) * step, y0 + (j + sy / n) * step, z0 + (k + sz / n) * step);
      }
    }
  }

  const cellAt = (i, j, k) => vertOf[i + cnx * (j + cny * k)];
  const index = [];
  const quad = (a, b, c, d) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    index.push(a, b, c, a, c, d);
  };
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const inside = at(i, j, k) < 0;
        if (i < cnx && j > 0 && j < cny && k > 0 && k < cnz && inside !== at(i + 1, j, k) < 0) {
          quad(cellAt(i, j - 1, k - 1), cellAt(i, j, k - 1), cellAt(i, j, k), cellAt(i, j - 1, k));
        }
        if (j < cny && i > 0 && i < cnx && k > 0 && k < cnz && inside !== at(i, j + 1, k) < 0) {
          quad(cellAt(i - 1, j, k - 1), cellAt(i, j, k - 1), cellAt(i, j, k), cellAt(i - 1, j, k));
        }
        if (k < cnz && i > 0 && i < cnx && j > 0 && j < cny && inside !== at(i, j, k + 1) < 0) {
          quad(cellAt(i - 1, j - 1, k), cellAt(i, j - 1, k), cellAt(i, j, k), cellAt(i - 1, j, k));
        }
      }
    }
  }

  const vertCount = pos.length / 3;
  const positions = new Float32Array(pos);
  const e = step * 0.5;

  // Settle vertices onto the surface; `normals` receives the field's gradient.
  const settle = (iterations, normals) => {
    for (let v = 0; v < vertCount; v += 1) {
      let x = positions[v * 3];
      let y = positions[v * 3 + 1];
      let z = positions[v * 3 + 2];
      for (let it = 0; it < iterations; it += 1) {
        let gx = sdf(x + e, y, z) - sdf(x - e, y, z);
        let gy = sdf(x, y + e, z) - sdf(x, y - e, z);
        let gz = sdf(x, y, z + e) - sdf(x, y, z - e);
        const len = Math.hypot(gx, gy, gz) || 1;
        gx /= len;
        gy /= len;
        gz /= len;
        const d = Math.max(-step, Math.min(step, sdf(x, y, z)));
        x -= gx * d;
        y -= gy * d;
        z -= gz * d;
        if (normals && it === iterations - 1) normals.set([gx, gy, gz], v * 3);
      }
      positions[v * 3] = x;
      positions[v * 3 + 1] = y;
      positions[v * 3 + 2] = z;
    }
  };

  const fieldNormals = new Float32Array(vertCount * 3);
  settle(3, fieldNormals);

  // Wind every triangle to face out along the field's normal.
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3;
    const b = index[t + 1] * 3;
    const c = index[t + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const fx = uy * vz - uz * vy;
    const fy = uz * vx - ux * vz;
    const fz = ux * vy - uy * vx;
    const nx2 = fieldNormals[a] + fieldNormals[b] + fieldNormals[c];
    const ny2 = fieldNormals[a + 1] + fieldNormals[b + 1] + fieldNormals[c + 1];
    const nz2 = fieldNormals[a + 2] + fieldNormals[b + 2] + fieldNormals[c + 2];
    if (fx * nx2 + fy * ny2 + fz * nz2 < 0) {
      const swap = index[t + 1];
      index[t + 1] = index[t + 2];
      index[t + 2] = swap;
    }
  }

  // Take out the lattice's grain, then settle back onto the true surface.
  taubin(positions, index, smooth);
  settle(1, null);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.setAttribute('aSmooth', new BufferAttribute(geometry.attributes.normal.array.slice(), 3));
  geometry.computeBoundingSphere();
  return geometry;
}
