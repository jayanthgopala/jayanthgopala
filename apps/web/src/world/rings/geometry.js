import { BufferAttribute, BufferGeometry } from 'three';

// Procedural shapes for the ring descent: the curved glass blocks the rings are
// built from, a seeded random source, and the solid water bodies the social
// marks are made of.

export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One curved block of a ring, centred on angle 0 (the +X axis).
 *
 * A chamfered-rectangle cross-section swept along the arc: flat faces with
 * tight rounded corners, easing in slightly at the ends. `aEdge` is 1 on the
 * bevels and 0 mid-face, so the glass shader can light its edges. Instances are
 * turned about Y into place.
 */
export function arcBlock({ radius, width, height, span, steps = 22, cornerSteps = 4, corner = 0.24 }) {
  const cr = Math.min(width, height) * corner;
  const hw = width * 0.5 - cr;
  const hh = height * 0.5 - cr;
  const centres = [
    [hw, hh],
    [-hw, hh],
    [-hw, -hh],
    [hw, -hh],
  ];

  // Counter-clockwise in (radial, y), starting on the outer face. Each corner
  // arc is followed by a mid-face point, which is what lets the edge fade out
  // across the face instead of every vertex sitting on a bevel.
  const profile = [];
  for (let q = 0; q < 4; q += 1) {
    const [cx, cy] = centres[q];
    for (let s = 0; s <= cornerSteps; s += 1) {
      const a = (q + s / cornerSteps) * Math.PI * 0.5;
      profile.push([cx + Math.cos(a) * cr, cy + Math.sin(a) * cr, 1]);
    }
    const [nx, ny] = centres[(q + 1) % 4];
    const a = (q + 1) * Math.PI * 0.5;
    profile.push([(cx + nx) * 0.5 + Math.cos(a) * cr, (cy + ny) * 0.5 + Math.sin(a) * cr, 0]);
  }
  const sides = profile.length;

  const positions = [];
  const edges = [];
  const indices = [];
  const ease = cr * 1.5;

  for (let i = 0; i <= steps; i += 1) {
    const u = i / steps;
    const theta = (u - 0.5) * span;
    // Arc length to the nearer end, against a short rounding distance.
    const t = Math.min(1, (Math.min(u, 1 - u) * span * radius) / ease);
    const scale = 0.72 + 0.28 * Math.sqrt(1 - (1 - t) * (1 - t));

    for (let k = 0; k < sides; k += 1) {
      const r = radius + profile[k][0] * scale;
      positions.push(r * Math.cos(theta), profile[k][1] * scale, -r * Math.sin(theta));
      edges.push(Math.max(profile[k][2], 1 - t));
    }
  }

  for (let i = 0; i < steps; i += 1) {
    for (let k = 0; k < sides; k += 1) {
      const a = i * sides + k;
      const b = i * sides + ((k + 1) % sides);
      const c = (i + 1) * sides + k;
      const d = (i + 1) * sides + ((k + 1) % sides);
      indices.push(a, c, b, b, c, d);
    }
  }

  // End caps, fanned from the section's centre.
  const capStart = positions.length / 3;
  const t0 = -0.5 * span;
  positions.push(radius * Math.cos(t0), 0, -radius * Math.sin(t0));
  const capEnd = capStart + 1;
  const t1 = 0.5 * span;
  positions.push(radius * Math.cos(t1), 0, -radius * Math.sin(t1));
  edges.push(0, 0);
  const last = steps * sides;
  for (let k = 0; k < sides; k += 1) {
    const n = (k + 1) % sides;
    indices.push(capStart, k, n);
    indices.push(capEnd, last + n, last + k);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('aEdge', new BufferAttribute(new Float32Array(edges), 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Drawn from primitives on a 256px canvas, white on transparent. Only the
// silhouette matters: it is sampled into points, never shown as pixels.
export function drawIcon(g, icon, label) {
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.lineJoin = 'round';

  switch (icon) {
    case 'github': {
      // The Octocat mark: a disc with the cat cut out of it — a broad head with
      // two pointed ears, a neck running out through the bottom of the disc,
      // and the tail curling up on the left.
      g.beginPath();
      g.arc(128, 128, 118, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      g.ellipse(128, 118, 62, 54, 0, 0, Math.PI * 2);
      g.fill();
      // Ears, with their tips softened by a round-joined stroke.
      g.lineWidth = 8;
      g.lineJoin = 'round';
      for (const side of [-1, 1]) {
        g.beginPath();
        g.moveTo(128 + side * 58, 104);
        g.lineTo(128 + side * 50, 50);
        g.lineTo(128 + side * 16, 72);
        g.closePath();
        g.fill();
        g.stroke();
      }
      // Neck, widening slightly as it runs out of the bottom.
      g.beginPath();
      g.moveTo(104, 160);
      g.lineTo(152, 160);
      g.lineTo(157, 256);
      g.lineTo(99, 256);
      g.closePath();
      g.fill();
      // Tail.
      g.lineWidth = 18;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(104, 206);
      g.quadraticCurveTo(66, 212, 52, 176);
      g.stroke();
      break;
    }
    case 'linkedin': {
      roundRect(g, 20, 20, 216, 216, 34);
      g.fill();
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      g.arc(78, 76, 17, 0, Math.PI * 2);
      g.fill();
      g.fillRect(62, 106, 32, 100);
      g.lineWidth = 30;
      g.lineCap = 'butt';
      g.beginPath();
      g.moveTo(129, 206);
      g.lineTo(129, 140);
      g.bezierCurveTo(129, 96, 200, 96, 200, 142);
      g.lineTo(200, 206);
      g.stroke();
      break;
    }
    case 'mail': {
      roundRect(g, 20, 56, 216, 144, 18);
      g.fill();
      g.globalCompositeOperation = 'destination-out';
      g.lineWidth = 16;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(44, 82);
      g.lineTo(128, 146);
      g.lineTo(212, 82);
      g.stroke();
      break;
    }
    case 'x': {
      g.lineCap = 'butt';
      g.lineWidth = 38;
      g.beginPath();
      g.moveTo(52, 36);
      g.lineTo(204, 220);
      g.stroke();
      g.lineWidth = 14;
      g.beginPath();
      g.moveTo(204, 36);
      g.lineTo(52, 220);
      g.stroke();
      g.globalCompositeOperation = 'destination-out';
      g.lineWidth = 12;
      g.beginPath();
      g.moveTo(58, 44);
      g.lineTo(198, 212);
      g.stroke();
      break;
    }
    case 'globe': {
      g.lineWidth = 14;
      g.beginPath();
      g.arc(128, 128, 104, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.ellipse(128, 128, 44, 104, 0, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(24, 128);
      g.lineTo(232, 128);
      g.moveTo(44, 76);
      g.lineTo(212, 76);
      g.moveTo(44, 180);
      g.lineTo(212, 180);
      g.stroke();
      break;
    }
    default: {
      g.font = '700 200px ui-monospace, Menlo, Consolas, monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(label || '?').trim().charAt(0).toUpperCase() || '?', 128, 138);
    }
  }

  g.globalCompositeOperation = 'source-over';
}

/**
 * `count` beads filling a social mark, as a slab `size` wide centred on the
 * origin. Returned as xyz triples.
 *
 * Packed on a hexagonal lattice rather than sampled at random. Random sampling
 * of the silhouette clumps in places and leaves holes in others, and at bead
 * size that reads as a lumpy approximation of the mark; a lattice with a little
 * jitter covers it evenly, so the edge comes out clean and the shape is the
 * shape rather than a suggestion of it. Three layers through the depth give the
 * slab body without softening that edge.
 */
export function iconPoints(icon, label, count, size = 1.55, seed = 1) {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  drawIcon(g, icon, label);

  const data = g.getImageData(0, 0, S, S).data;
  const inside = (x, y) => {
    const ix = x | 0;
    const iy = y | 0;
    return ix >= 0 && iy >= 0 && ix < S && iy < S && data[(iy * S + ix) * 4 + 3] > 140;
  };

  let area = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 140) area += 1;

  const rand = mulberry32(seed);
  const out = new Float32Array(count * 3);

  if (area === 0) {
    for (let i = 0; i < count; i += 1) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * size * 0.5;
      out[i * 3] = Math.cos(a) * r;
      out[i * 3 + 1] = Math.sin(a) * r;
      out[i * 3 + 2] = (rand() - 0.5) * 0.1;
    }
    return out;
  }

  // Spacing that lands close to `count` beads over the silhouette's area once
  // the layers are counted in. Floored, so a tiny mark cannot ask for a lattice
  // finer than the raster it was measured on.
  const LAYERS = 3;
  const spacing = Math.max(1.2, Math.sqrt((area * LAYERS) / count));
  const rowStep = spacing * 0.866; // equilateral rows

  const cells = [];
  let row = 0;
  for (let y = rowStep * 0.5; y < S; y += rowStep) {
    const offset = (row & 1) * spacing * 0.5;
    for (let x = spacing * 0.5 + offset; x < S; x += spacing) {
      if (inside(x, y)) cells.push(x, y);
    }
    row += 1;
  }

  const found = cells.length / 2;
  const jitter = spacing * 0.22;
  const depth = size * 0.085;

  for (let i = 0; i < count; i += 1) {
    // Each cell is filled once per layer before any is used twice, so the
    // layers stay even however the count divides.
    const cell = (i % found) * 2;
    const layer = Math.floor(i / found) % LAYERS;

    const x = cells[cell] + (rand() - 0.5) * jitter;
    const y = cells[cell + 1] + (rand() - 0.5) * jitter;

    out[i * 3] = (x / S - 0.5) * size;
    out[i * 3 + 1] = (0.5 - y / S) * size;
    out[i * 3 + 2] =
      (LAYERS === 1 ? 0 : (layer / (LAYERS - 1) - 0.5) * depth) + (rand() - 0.5) * depth * 0.22;
  }

  return out;
}
