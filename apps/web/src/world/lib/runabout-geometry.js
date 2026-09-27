import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  ClampToEdgeWrapping,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  RepeatWrapping,
  SRGBColorSpace,
  Shape,
  TubeGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BOAT_BASE, BOAT_SCALE, hullHalfWidth } from './dock.js';

// A classic Italian mahogany runabout, built from code: a low varnished hull
// and deck laid in mahogany planks (the deck's seams caulked pale maple),
// cream leather benches and sun pad, a curved windscreen, and chrome. The
// boat's frame: bow along +x, up +y, starboard +z, the waterline at y = 0.
// Each material's parts are merged into one geometry: four draw calls.

// Built at the boat's base size; Runabout.jsx scales it up to BOAT_SCALE.
const HALF_L = BOAT_BASE[0] / 2;
const baseHalf = (u) => hullHalfWidth(u) / BOAT_SCALE;
const SECTIONS = 36;

// Where each part lies in the mahogany texture (see mahoganyTexture): the
// hull's strakes, the deck's planks, and the cream of the bottom paint.
const V_HULL = [0.02, 0.44];
const V_DECK = [0.52, 0.9];
const V_BOTTOM = 0.97;

/** Height of the deck edge: low, rising a little toward the bow. */
export function sheerY(u) {
  return 1.9 + 0.55 * Math.pow(Math.max(0, u), 2);
}

/** Height of the keel: level aft, sweeping up to the foot of the stem. */
function keelY(u) {
  return -0.9 + 1.6 * Math.pow(Math.max(0, u), 2.2);
}

/** The stem rakes forward: points higher up the bow sit further ahead. */
function rake(u, y, yKeel, ySheer) {
  return 1.4 * Math.pow(Math.max(0, u), 8) * ((y - yKeel) / Math.max(0.01, ySheer - yKeel));
}

/**
 * One cross-section, port sheer → chine → keel → chine → starboard sheer, as
 * [z, y, v, joined]: v is the texture row (planked mahogany up the topsides,
 * cream below the waterline), and a point not joined to the one before
 * starts a new panel so the chines stay hard.
 */
function section(u) {
  const w = Math.max(0.03, baseHalf(u));
  const yS = sheerY(u);
  const yK = keelY(u);
  const c = w * 0.84;
  const yC = Math.min(yS - 0.15, yK + c * 0.28);
  const flare = (y) => c + (w - c) * Math.pow((y - yC) / Math.max(0.01, yS - yC), 0.75);
  const boot = Math.min(Math.max(0.12, yC + 0.01), yS - 0.05);
  const strake = (y) => V_HULL[0] + (V_HULL[1] - V_HULL[0]) * ((y - boot) / Math.max(0.01, yS - boot));

  // Starboard topside, chine up to sheer: cream to the boot line, then wood.
  const topside = [
    [c, yC, V_BOTTOM],
    [flare(boot), boot, V_BOTTOM],
    [flare(boot), boot, strake(boot)],
    [flare((boot + yS) / 2), (boot + yS) / 2, strake((boot + yS) / 2)],
    [w, yS, strake(yS)],
  ];

  const points = [];
  for (let k = topside.length - 1; k >= 0; k -= 1) {
    const [z, y, v] = topside[k];
    points.push([-z, y, v, k !== topside.length - 1]);
  }
  points.push([-c, yC, V_BOTTOM, false], [0, yK, V_BOTTOM, true], [c, yC, V_BOTTOM, true]);
  topside.forEach(([z, y, v], k) => points.push([z, y, v, k !== 0]));
  return { points, yK, yS };
}

/** The hull shell and its transom. */
function hullGeometry() {
  const positions = [];
  const uvs = [];
  const index = [];
  let columns = 0;

  for (let i = 0; i <= SECTIONS; i += 1) {
    const u = -1 + (2 * i) / SECTIONS;
    const { points, yK, yS } = section(u);
    columns = points.length;
    for (const [z, y, v] of points) {
      const x = u * HALF_L + rake(u, y, yK, yS);
      positions.push(x, y, z);
      uvs.push(x / 9, v);
    }
  }

  const { points: layout } = section(0);
  for (let i = 0; i < SECTIONS; i += 1) {
    for (let j = 0; j < columns - 1; j += 1) {
      if (!layout[j + 1][3]) continue;
      const a = i * columns + j;
      const b = a + columns;
      index.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }

  // Transom: planked like the topsides, closed with a fan wound to face aft.
  const stern = section(-1);
  const centre = positions.length / 3;
  positions.push(-HALF_L, (stern.yK + stern.yS) / 2, 0);
  uvs.push(0.5, V_HULL[1] * 0.6);
  const ring = [];
  for (const [z, y] of stern.points) {
    ring.push(positions.length / 3);
    positions.push(-HALF_L, y, z);
    uvs.push(z / 4, V_HULL[0] + (V_HULL[1] - V_HULL[0]) * Math.min(1, Math.max(0, y / stern.yS)));
  }
  for (let j = 0; j < ring.length - 1; j += 1) index.push(centre, ring[j], ring[j + 1]);
  index.push(centre, ring[ring.length - 1], ring[0]);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

// The two cockpits sunk into the deck, front and rear, as [from x, to x] in
// the boat's frame: how far across they reach (a share of the half-beam), and
// how deep the wells are below the deck.
const COCKPITS = [
  [-0.4, 2.7],
  [-4.8, -1.7],
];
const WELL_WIDTH = 0.72;
const WELL_DEPTH = 0.95;
const DECK_ACROSS = [-1, -WELL_WIDTH, -WELL_WIDTH / 2, 0, WELL_WIDTH / 2, WELL_WIDTH, 1];

const sectionX = (i) => {
  const u = -1 + (2 * i) / SECTIONS;
  return u * HALF_L + rake(u, sheerY(u), 0, sheerY(u));
};

/** Where each cockpit's opening falls on the deck's sections: [first, last]. */
function cockpitSections([x0, x1]) {
  let first = -1;
  let last = -1;
  for (let i = 0; i < SECTIONS; i += 1) {
    if (sectionX(i) >= x0 && sectionX(i + 1) <= x1) {
      if (first < 0) first = i;
      last = i + 1;
    }
  }
  return [first, last];
}

/**
 * The deck, crowned a little along the centreline, its planks following the
 * sheer so the seams sweep in toward the bow, and open over the cockpits.
 */
function deckGeometry() {
  const across = DECK_ACROSS;
  const positions = [];
  const uvs = [];
  const index = [];
  for (let i = 0; i <= SECTIONS; i += 1) {
    const u = -1 + (2 * i) / SECTIONS;
    const w = Math.max(0.03, baseHalf(u)) * 0.98;
    const x = sectionX(i);
    for (const k of across) {
      positions.push(x, sheerY(u) - 0.02 + 0.16 * (1 - k * k), k * w);
      uvs.push(x / 9, V_DECK[0] + (V_DECK[1] - V_DECK[0]) * (k + 1) / 2);
    }
  }
  const open = COCKPITS.map(cockpitSections);
  const n = across.length;
  for (let i = 0; i < SECTIONS; i += 1) {
    const inCockpit = open.some(([f, l]) => i >= f && i + 1 <= l);
    for (let j = 0; j < n - 1; j += 1) {
      // Over a cockpit only the side decks are laid.
      if (inCockpit && Math.abs(across[j]) <= WELL_WIDTH && Math.abs(across[j + 1]) <= WELL_WIDTH) continue;
      const a = i * n + j;
      const b = a + n;
      // Wound to face up.
      index.push(a, a + 1, b + 1, a, b + 1, b);
    }
  }
  const deck = new BufferGeometry();
  deck.setAttribute('position', new Float32BufferAttribute(positions, 3));
  deck.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  deck.setIndex(index);
  deck.computeVertexNormals();
  return deck;
}

/** Each cockpit well's size: its opening in x, half-width, deck and floor heights. */
function wells() {
  return COCKPITS.map((range) => {
    const [f, l] = cockpitSections(range);
    const x0 = sectionX(f);
    const x1 = sectionX(l);
    const u = (x0 + x1) / 2 / HALF_L;
    const half = baseHalf(u) * 0.98 * WELL_WIDTH;
    const deckY = sheerY(u) - 0.02 + 0.16 * (1 - WELL_WIDTH * WELL_WIDTH);
    return { x0, x1, half, deckY, floorY: deckY - WELL_DEPTH };
  });
}

/** The cockpit floors: mahogany planks laid fore and aft. */
function floorGeometry() {
  const positions = [];
  const uvs = [];
  for (const { x0, x1, half, floorY } of wells()) {
    const quad = [
      [x0, -half],
      [x1, -half],
      [x1, half],
      [x0, half],
    ];
    for (const i of [0, 3, 2, 0, 2, 1]) {
      const [x, z] = quad[i];
      positions.push(x, floorY, z);
      uvs.push(x / 9, V_DECK[0] + (V_DECK[1] - V_DECK[0]) * ((z / half) * 0.5 + 0.5));
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * Varnished mahogany: the hull's strakes with fine dark seams, the deck's
 * planks with pale maple caulking, and a band of cream bottom paint, laid out
 * down the texture as V_HULL, V_DECK and V_BOTTOM.
 */
export function mahoganyTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  // The canvas is flipped onto the texture: row 0 is v = 1.
  const row = (v) => (1 - v) * size;

  const planks = (v0, v1, count, seam, seamWidth, seed) => {
    const top = row(v1);
    const h = (row(v0) - top) / count;
    for (let p = 0; p < count; p += 1) {
      const k = ((p * 7 + seed) % 5) / 5;
      g.fillStyle = `rgb(${Math.round(96 + 22 * k)}, ${Math.round(40 + 10 * k)}, ${Math.round(20 + 6 * k)})`;
      g.fillRect(0, top + p * h, size, h);
      // Grain running the length of the plank.
      for (let s = 0; s < 14; s += 1) {
        const y = top + p * h + ((s * 13 + p * 5 + seed) % 97) / 97 * h;
        g.strokeStyle = s % 3 === 0 ? 'rgba(160, 76, 40, 0.28)' : 'rgba(58, 20, 10, 0.3)';
        g.lineWidth = s % 4 === 0 ? 1.4 : 0.7;
        g.beginPath();
        g.moveTo(0, y);
        g.bezierCurveTo(size * 0.33, y + 1.2, size * 0.66, y - 1.2, size, y);
        g.stroke();
      }
      g.fillStyle = seam;
      g.fillRect(0, top + p * h, size, seamWidth);
    }
  };
  planks(V_HULL[0], V_HULL[1], 7, 'rgba(34, 12, 6, 0.8)', 1.5, 3);
  planks(V_DECK[0], V_DECK[1], 11, 'rgba(238, 226, 196, 0.95)', 2.5, 1);
  g.fillStyle = 'rgb(236, 230, 214)';
  g.fillRect(0, 0, size, row(0.93));

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.anisotropy = 8;
  return texture;
}

/** A profile in the boat's x–y plane, given width across the beam. */
function slab(points, depth, bevel = 0.18) {
  const shape = new Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const g = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 1,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/**
 * Cream leather: the cockpits' lining, a bench in each (set down in the well,
 * its back rising just above the deck), and the sun pad over the engine aft.
 */
function cushionGeometry() {
  const deck = sheerY(0);
  const parts = [];
  for (const { x0, x1, half, deckY, floorY } of wells()) {
    const depth = deckY - floorY;
    const wall = (sx, sz, x, z) => {
      const b = new BoxGeometry(sx, depth, sz);
      b.translate(x, floorY + depth / 2, z);
      parts.push(b);
    };
    // Lining round the well.
    wall(x1 - x0, 0.1, (x0 + x1) / 2, -half);
    wall(x1 - x0, 0.1, (x0 + x1) / 2, half);
    wall(0.1, half * 2, x0, 0);
    wall(0.1, half * 2, x1, 0);
    // The bench across the aft end of the well, and its back against the
    // well's aft wall, rising a little above the deck.
    const seat = x0 + 0.15;
    const width = half * 2 - 0.3;
    parts.push(slab([[seat, floorY], [seat + 1.7, floorY], [seat + 1.7, floorY + 0.5], [seat, floorY + 0.5]], width, 0.12));
    parts.push(
      slab([[seat, floorY + 0.45], [seat + 0.45, floorY + 0.45], [seat + 0.2, deckY + 0.4], [seat - 0.05, deckY + 0.4]], width, 0.12)
    );
  }
  parts.push(slab([[-11.2, deck - 0.05], [-5.4, deck - 0.05], [-5.6, deck + 0.42], [-11.0, deck + 0.35]], 4.6, 0.26));
  return merge(parts);
}

/** The windscreen: a low curved sheet raked back ahead of the front bench. */
function windscreenPoints(t, level) {
  // t −1..1 across the beam, level 0 (foot) .. 1 (top edge).
  const x0 = 3.4;
  const w = baseHalf(x0 / HALF_L) * 0.92;
  const bend = 0.9 * (1 - t * t);
  return new Vector3(x0 + bend - level * 0.85, sheerY(x0 / HALF_L) + 0.12 + level * 0.95, t * w);
}

function glassGeometry() {
  const cols = 16;
  const positions = [];
  const uvs = [];
  const index = [];
  for (let i = 0; i <= cols; i += 1) {
    const t = -1 + (2 * i) / cols;
    for (const level of [0, 1]) {
      const p = windscreenPoints(t, level);
      positions.push(p.x, p.y, p.z);
      uvs.push(i / cols, level);
    }
  }
  for (let i = 0; i < cols; i += 1) {
    const a = i * 2;
    index.push(a, a + 2, a + 3, a, a + 3, a + 1);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** Chrome: rub rails, the windscreen frame, cleats, fairleads and the flagstaff. */
function chromeGeometry() {
  const parts = [];

  // A rub rail along each sheer.
  for (const side of [1, -1]) {
    const points = [];
    for (let i = 0; i <= 24; i += 1) {
      const u = -0.98 + 1.96 * (i / 24);
      const x = u * HALF_L + rake(u, sheerY(u), 0, sheerY(u));
      points.push(new Vector3(x, sheerY(u) - 0.06, side * (Math.max(0.03, baseHalf(u)) + 0.04)));
    }
    parts.push(new TubeGeometry(new CatmullRomCurve3(points), 64, 0.06, 5, false));
  }

  // The windscreen's top rail and its two end posts.
  const top = [];
  for (let i = 0; i <= 12; i += 1) top.push(windscreenPoints(-1 + (2 * i) / 12, 1));
  parts.push(new TubeGeometry(new CatmullRomCurve3(top), 32, 0.05, 5, false));
  for (const t of [-1, 1]) {
    parts.push(
      new TubeGeometry(new CatmullRomCurve3([windscreenPoints(t, 0), windscreenPoints(t, 1)]), 2, 0.06, 5, false)
    );
  }

  // Bow cleat, fairleads either side of it, and a stern cleat.
  const cleat = (x, z) => {
    const u = x / HALF_L;
    const b = new BoxGeometry(0.7, 0.16, 0.2);
    b.translate(x, sheerY(u) + 0.2, z);
    parts.push(b);
  };
  cleat(10.8, 0);
  cleat(-11.8, 0);
  for (const z of [-0.9, 0.9]) {
    const f = new BoxGeometry(0.4, 0.14, 0.3);
    f.translate(11.8, sheerY(11.8 / HALF_L) + 0.18, z);
    parts.push(f);
  }

  // Flagstaff on the transom.
  const staff = new CylinderGeometry(0.05, 0.06, 2.4, 6);
  staff.translate(-12.7, sheerY(-1) + 1.2, 0);
  parts.push(staff);

  return merge(parts);
}

/** Merge parts that share a material into one geometry (position, normal, uv). */
function merge(parts) {
  const flat = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    if (n !== g) g.dispose();
    for (const name of Object.keys(n.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) n.deleteAttribute(name);
    }
    if (!n.attributes.normal) n.computeVertexNormals();
    if (!n.attributes.uv) {
      n.setAttribute('uv', new Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    }
    return n;
  });
  const merged = mergeGeometries(flat, false);
  flat.forEach((g) => g.dispose());
  return merged;
}

/** Every part of the runabout, by material. */
export function runaboutGeometry() {
  return {
    wood: merge([hullGeometry(), deckGeometry(), floorGeometry()]),
    cushions: cushionGeometry(),
    glass: glassGeometry(),
    chrome: chromeGeometry(),
  };
}
