/*
 * igloo.glb  ->  quantised binary + manifest + compressed textures
 *
 * The GLB ships 6.0 MB, of which 5.26 MB is two 2048 PNGs and 684 KB is
 * geometry. Neither number is acceptable for a hero object on a landing page,
 * and neither needs to be that big:
 *
 *   - Geometry is float32 position/normal/uv. Blocks are ~1.7 units across, so
 *     float32 spends 32 bits resolving a distance no eye will ever see. int16
 *     over each block's own bbox gives 2.7e-5 unit precision and halves it.
 *   - Normals go to int8 (~0.5 deg error, invisible on a bumpy snow surface).
 *   - Textures go 2048 -> 1024 WebP.
 *
 * What this script does NOT do is dedupe geometry, because it cannot: every
 * block owns a private UV island in the atlas, so no two blocks share vertex
 * data. That is also why the runtime uses BatchedMesh rather than
 * InstancedMesh -- see src/igloo/Igloo.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SRC = process.argv[2] ?? '../igloo.glb';
const OUT = process.argv[3] ?? 'apps/web/public/igloo';

/* The site's world is built at radius 22 (see world/structures/Igloo.jsx).
   The Blender model is radius 2.435, so everything scales by this and the
   model's own proportions (h/r = 1.42) are preserved rather than forced to
   the procedural version's 1.50. */
const TARGET_RADIUS = 22;

const buf = fs.readFileSync(SRC);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
const binOff = 20 + jsonLen + 8;

const COMPONENT = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function readAccessor(i) {
  const a = gltf.accessors[i];
  const bv = gltf.bufferViews[a.bufferView];
  const n = NUM[a.type];
  const base = binOff + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = bv.byteStride ?? COMPONENT[a.componentType] * n;
  const out = new Float64Array(a.count * n);
  for (let v = 0; v < a.count; v++) {
    for (let k = 0; k < n; k++) {
      const o = base + v * stride + k * COMPONENT[a.componentType];
      out[v * n + k] =
        a.componentType === 5126 ? buf.readFloatLE(o)
        : a.componentType === 5125 ? buf.readUInt32LE(o)
        : a.componentType === 5123 ? buf.readUInt16LE(o)
        : buf[o];
    }
  }
  return { data: out, count: a.count, n };
}

/* ---- gather blocks ------------------------------------------------------ */

const ringOf = (name) => {
  if (name.startsWith('Entrance')) return 0;
  const m = name.match(/^Ring(\d)/);
  return m ? Number(m[1]) : 0;
};

const raw = gltf.meshes.map((mesh, mi) => {
  const prim = mesh.primitives[0];
  const node = gltf.nodes.find((n) => n.mesh === mi);
  if (node.translation || node.rotation || node.scale) {
    throw new Error(node.name + ' has an unapplied transform');
  }
  return {
    name: node.name,
    ring: ringOf(node.name),
    pos: readAccessor(prim.attributes.POSITION),
    nor: readAccessor(prim.attributes.NORMAL),
    uv: readAccessor(prim.attributes.TEXCOORD_0),
    idx: readAccessor(prim.indices),
  };
});

/* Model bounds, so we can scale to the site's world units and sit the dome
   on y = 0 with its axis through the origin.
 *
 * RADIUS IS MEASURED OVER THE RING COURSES ONLY. The entrance porch projects
 * to z = 3.15 while the dome wall stops at 2.435, so including it measured the
 * porch instead of the dome and scaled the whole model down by a quarter
 * (6.62 rather than 9.04). Height still spans everything, since the porch
 * never rises above the crown. */
let modelMaxR = 0;
let modelMinY = Infinity;
let modelMaxY = -Infinity;
for (const b of raw) {
  const isDome = b.name.startsWith('Ring');
  for (let v = 0; v < b.pos.count; v++) {
    const x = b.pos.data[v * 3];
    const y = b.pos.data[v * 3 + 1];
    const z = b.pos.data[v * 3 + 2];
    if (isDome) modelMaxR = Math.max(modelMaxR, Math.hypot(x, z));
    modelMinY = Math.min(modelMinY, y);
    modelMaxY = Math.max(modelMaxY, y);
  }
}
const SCALE = TARGET_RADIUS / modelMaxR;

/* ---- quantise ----------------------------------------------------------- */

const posParts = [];
const norParts = [];
const uvParts = [];
const idxParts = [];
let posBytes = 0;
let norBytes = 0;
let uvBytes = 0;
let idxBytes = 0;

const blocks = raw.map((b) => {
  const n = b.pos.count;

  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < n; v++) {
    for (let k = 0; k < 3; k++) {
      const val = b.pos.data[v * 3 + k];
      if (val < lo[k]) lo[k] = val;
      if (val > hi[k]) hi[k] = val;
    }
  }

  /* Centroid is the instance origin; vertices are stored relative to it so the
     BatchedMesh matrix owns placement and the physics can move a block by
     writing one matrix rather than touching vertex data. */
  const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]].map((e) => e || 1e-6);

  const p = Buffer.alloc(n * 3 * 2);
  const nr = Buffer.alloc(n * 3);
  const uv = Buffer.alloc(n * 2 * 2);
  for (let v = 0; v < n; v++) {
    for (let k = 0; k < 3; k++) {
      const t = (b.pos.data[v * 3 + k] - c[k]) / ext[k] + 0.5; // -> 0..1
      const q = Math.max(0, Math.min(65535, Math.round(t * 65535)));
      p.writeUInt16LE(q, (v * 3 + k) * 2);
      const nq = Math.max(-127, Math.min(127, Math.round(b.nor.data[v * 3 + k] * 127)));
      nr.writeInt8(nq, v * 3 + k);
    }
    for (let k = 0; k < 2; k++) {
      const t = Math.max(0, Math.min(1, b.uv.data[v * 2 + k]));
      uv.writeUInt16LE(Math.round(t * 65535), (v * 2 + k) * 2);
    }
  }

  if (n > 65535) throw new Error(b.name + ': ' + n + ' verts exceeds uint16 indices');
  const ix = Buffer.alloc(b.idx.count * 2);
  for (let i = 0; i < b.idx.count; i++) ix.writeUInt16LE(b.idx.data[i], i * 2);

  const rec = {
    name: b.name,
    ring: b.ring,
    verts: n,
    indices: b.idx.count,
    pos: posBytes,
    nor: norBytes,
    uv: uvBytes,
    idx: idxBytes,
    /* dequantisation: local = (q / 65535 - 0.5) * extent */
    extent: ext.map((e) => +(e * SCALE).toFixed(6)),
    centroid: [c[0] * SCALE, (c[1] - modelMinY) * SCALE, c[2] * SCALE].map((v) => +v.toFixed(5)),
  };

  posParts.push(p);
  norParts.push(nr);
  uvParts.push(uv);
  idxParts.push(ix);
  posBytes += p.length;
  norBytes += nr.length;
  uvBytes += uv.length;
  idxBytes += ix.length;
  return rec;
});

/* Outward direction per block: radial in XZ, tilting to +Y as the courses
   close over the crown. Derived from where the block actually sits rather than
   authored by hand, so it stays correct if the model is re-exported. */
const apexY = Math.max(...blocks.map((b) => b.centroid[1]));
for (const b of blocks) {
  const [x, y, z] = b.centroid;
  const r = Math.hypot(x, z) || 1e-6;
  const climb = Math.min(1, Math.max(0, y / apexY));
  const ux = (x / r) * (1 - climb * 0.85);
  const uz = (z / r) * (1 - climb * 0.85);
  const uy = 0.15 + climb * 1.15;
  const len = Math.hypot(ux, uy, uz);
  b.outward = [ux / len, uy / len, uz / len].map((v) => +v.toFixed(5));
}

const bin = Buffer.concat([...posParts, ...norParts, ...uvParts, ...idxParts]);
const manifest = {
  generated: new Date().toISOString(),
  source: path.basename(SRC),
  scale: +SCALE.toFixed(6),
  radius: TARGET_RADIUS,
  height: +((modelMaxY - modelMinY) * SCALE).toFixed(3),
  layout: {
    pos: 0,
    nor: posBytes,
    uv: posBytes + norBytes,
    idx: posBytes + norBytes + uvBytes,
  },
  blocks,
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'igloo.bin'), bin);
fs.writeFileSync(path.join(OUT, 'igloo.json'), JSON.stringify(manifest));

/* ---- textures ----------------------------------------------------------- */

const images = [];
for (const im of gltf.images) {
  const bv = gltf.bufferViews[im.bufferView];
  const start = binOff + (bv.byteOffset ?? 0);
  const png = buf.subarray(start, start + bv.byteLength);
  const isNormal = /normal/i.test(im.name ?? '');
  const out = path.join(OUT, (isNormal ? 'normal' : 'basecolor') + '.webp');
  await sharp(png)
    .resize(1024, 1024, { kernel: 'lanczos3' })
    /* Normal maps carry vectors, not colour, so chroma subsampling would bend
       them. Higher quality and 4:4:4 forced for that reason. */
    .webp(isNormal
      ? { quality: 92, effort: 6, smartSubsample: false }
      : { quality: 86, effort: 6 })
    .toFile(out);
  images.push({ name: im.name, from: bv.byteLength, to: fs.statSync(out).size });
}

/* ---- report ------------------------------------------------------------- */

const kb = (b) => (b / 1024).toFixed(0).padStart(6) + ' KB';
console.log('scale ' + SCALE.toFixed(4) + '  ->  radius ' + TARGET_RADIUS + ', height ' + manifest.height);
console.log('blocks ' + blocks.length
  + '   verts ' + blocks.reduce((s, b) => s + b.verts, 0)
  + '   tris ' + blocks.reduce((s, b) => s + b.indices, 0) / 3);
console.log('\n                    before        after');
console.log('geometry       ' + kb(684 * 1024) + '   ' + kb(bin.length)
  + '   (pos ' + kb(posBytes).trim() + ', nor ' + kb(norBytes).trim()
  + ', uv ' + kb(uvBytes).trim() + ', idx ' + kb(idxBytes).trim() + ')');
for (const im of images) console.log((im.name ?? '').padEnd(15) + kb(im.from) + '   ' + kb(im.to));
const manifestBytes = JSON.stringify(manifest).length;
console.log('manifest       ' + kb(0) + '   ' + kb(manifestBytes));
const after = bin.length + images.reduce((s, i) => s + i.to, 0) + manifestBytes;
console.log('\nTOTAL          ' + kb(buf.length) + '   ' + kb(after)
  + '    ' + (buf.length / after).toFixed(1) + 'x smaller');
