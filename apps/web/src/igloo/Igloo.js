import * as THREE from 'three';

/**
 * The igloo, as one draw call of 74 individually addressable blocks.
 *
 * WHY BatchedMesh AND NOT InstancedMesh.
 *
 * InstancedMesh draws one geometry many times. That is the right tool when the
 * repeated thing is genuinely identical, and it is the tool this object cannot
 * use: every block in the Blender model owns a private UV island in the 2048
 * atlas, so no two blocks share vertex data. Measured on the source file,
 * deduplicating on position alone collapses 74 blocks to 58; including UVs it
 * collapses them to 74 — that is, not at all. There is no "one reusable block
 * geometry" to instance, and inventing one would mean throwing away the bake.
 *
 * BatchedMesh is the same idea generalised to geometries that differ: all 74
 * are uploaded into one shared buffer and drawn with a single multi-draw call,
 * each with its own matrix and colour, and a raycast against it reports which
 * one was hit as `intersection.batchId` — the exact analogue of `instanceId`.
 *
 * So the interaction architecture is unchanged from the instanced version:
 *
 *   pointer -> raycaster -> BatchedMesh -> batchId -> block -> spring -> flies
 *
 * and the cost is one draw call rather than 74.
 *
 * VERTEX DATA ARRIVES QUANTISED. Positions are uint16 over each block's own
 * bounding box, normals int8, UVs uint16 — see scripts/build-igloo.mjs. That
 * is a wire format, not a runtime one: it is expanded to float32 here, once,
 * at load. The point is the 6.0 MB GLB landing as 533 KB over the network, not
 * saving GPU memory.
 */

const U16 = 65535;

/** Slice rather than view: a uint16 view needs an even byteOffset and the
 *  section boundaries in the .bin are only byte-aligned. One copy at load. */
const u16At = (bin, byteOffset, count) =>
  new Uint16Array(bin.slice(byteOffset, byteOffset + count * 2));

async function fetchOk(url, as) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${res.statusText}`);
  return as === 'json' ? res.json() : res.arrayBuffer();
}

function loadTexture(url, { srgb, anisotropy }) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (t) => {
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = anisotropy;
        t.flipY = false; // glTF convention, and the UVs were baked under it
        resolve(t);
      },
      undefined,
      () => reject(new Error(`failed to load ${url}`))
    );
  });
}

/**
 * @returns {{
 *   mesh: THREE.BatchedMesh,
 *   blocks: Array<{name,ring,centroid:number[],outward:number[],neighbours:number[]}>,
 *   radius: number, height: number, dispose: () => void
 * }}
 */
export async function loadIgloo({ base = '/igloo/', renderer, onProgress } = {}) {
  const maxAniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
  const anisotropy = Math.min(8, maxAniso);

  const [manifest, bin, map, normalMap] = await Promise.all([
    fetchOk(base + 'igloo.json', 'json'),
    fetchOk(base + 'igloo.bin', 'buffer'),
    loadTexture(base + 'basecolor.webp', { srgb: true, anisotropy }),
    loadTexture(base + 'normal.webp', { srgb: false, anisotropy }),
  ]);
  onProgress?.(0.6);

  const { layout, blocks: recs } = manifest;

  const totalVerts = recs.reduce((s, b) => s + b.verts, 0);
  const totalIndices = recs.reduce((s, b) => s + b.indices, 0);

  const material = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    /* The bake already carries the fine relief, so the normal map does the
       detail work and roughness stays broad. Snow is not uniformly rough:
       wind-packed faces glint, sheltered ones do not, which is what keeps the
       dome from reading as matte plaster under a single key light. */
    normalScale: new THREE.Vector2(1.25, 1.25),
    roughness: 0.82,
    metalness: 0.0,
    envMapIntensity: 0.38,
    /* Front side only. The blocks are solid with real thickness, so back faces
       are never visible, and culling them halves fragment work and removes the
       shadow acne that double-sided geometry produces on a low-bias light. */
    side: THREE.FrontSide,
    dithering: true,
  });

  const mesh = new THREE.BatchedMesh(recs.length, totalVerts, totalIndices, material);
  mesh.name = 'igloo';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  /* Per-instance culling is a false economy here: the object is a single body
     that fills the frame, so every block is on screen essentially always, and
     the per-frame culling test costs more than it saves. */
  mesh.perObjectFrustumCulled = false;

  const identity = new THREE.Matrix4();
  const blocks = [];

  for (const rec of recs) {
    const n = rec.verts;

    const qp = u16At(bin, layout.pos + rec.pos, n * 3);
    const qn = new Int8Array(bin, layout.nor + rec.nor, n * 3);
    const qu = u16At(bin, layout.uv + rec.uv, n * 2);
    const index = u16At(bin, layout.idx + rec.idx, rec.indices);

    const position = new Float32Array(n * 3);
    const normal = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    /*
     * HOW CLOSE THIS VERTEX IS TO ONE OF ITS BLOCK'S EDGES, 0 to 1.
     *
     * The renderer needs to know where a block's edges are in order to light
     * them, and nothing in the bake says. Deriving it in the shader is not an
     * option either: a block face is smooth, so there is no normal
     * discontinuity to find, and screen-space derivatives would key on the
     * SILHOUETTE rather than on the block's own geometry.
     *
     * But the vertices arrive centroid-relative and every block ships its own
     * extent, so each vertex has an exact position inside its block's bounding
     * box — and on a box, the second largest of the three normalised axes is
     * precisely edge-ness. A point in the middle of a face is hard against one
     * axis and slack on the other two, so the second value is near zero. A
     * point on an edge is hard against two, so it is near one. A corner is
     * hard against three, and it is one as well.
     *
     * Computed once here rather than per frame, and it rides into the batch as
     * an ordinary attribute.
     */
    const edge = new Float32Array(n);

    /*
     * WHICH BLOCKS ARE THE ARCH, AS GEOMETRY RATHER THAN AS INSTANCE COLOUR.
     *
     * The renderer lights the entrance mouth and nothing else, so it needs to
     * know which six blocks those are. The obvious place to put a per-block
     * flag is the instance colour — BatchedMesh keeps it in a Float32 texture,
     * so it survives values outside 0..1 and is already used that way to carry
     * each block's excitement.
     *
     * It cannot go there. BlockPhysics rewrites all three channels of every
     * instance colour whenever the glow is dirty, so a flag parked in one of
     * them is erased the first time the cursor disturbs anything.
     *
     * A vertex attribute is immune to that and costs one float per vertex, on
     * a mesh that already ships four. It is constant across a block, which
     * looks wasteful, but a batch needs every geometry to declare the same
     * attributes anyway — so the choice is only where the number lives, not
     * whether it is stored.
     *
     * The bake names the six arch blocks Entrance_*, which is the only thing
     * distinguishing them: they are spread across rings 0 and 1 alongside dome
     * blocks, so ring cannot separate them.
     */
    const entrance = new Float32Array(n);
    if (rec.name.startsWith('Entrance_')) entrance.fill(1);

    const [ex, ey, ez] = rec.extent;
    for (let v = 0; v < n; v++) {
      position[v * 3] = (qp[v * 3] / U16 - 0.5) * ex;
      position[v * 3 + 1] = (qp[v * 3 + 1] / U16 - 0.5) * ey;
      position[v * 3 + 2] = (qp[v * 3 + 2] / U16 - 0.5) * ez;

      /* int8 quantisation denormalises the vector slightly; renormalising
         costs nothing at load and keeps the lighting from banding on the
         near-flat faces. */
      let nx = qn[v * 3] / 127;
      let ny = qn[v * 3 + 1] / 127;
      let nz = qn[v * 3 + 2] / 127;
      const len = Math.hypot(nx, ny, nz) || 1;
      normal[v * 3] = nx / len;
      normal[v * 3 + 1] = ny / len;
      normal[v * 3 + 2] = nz / len;

      uv[v * 2] = qu[v * 2] / U16;
      uv[v * 2 + 1] = qu[v * 2 + 1] / U16;

      /* Guard the divisions: a block can be almost flat on one axis, and an
         extent of zero there would make every vertex read as an edge. */
      const ax = ex > 1e-4 ? Math.min(1, Math.abs(position[v * 3]) / (ex * 0.5)) : 0;
      const ay = ey > 1e-4 ? Math.min(1, Math.abs(position[v * 3 + 1]) / (ey * 0.5)) : 0;
      const az = ez > 1e-4 ? Math.min(1, Math.abs(position[v * 3 + 2]) / (ez * 0.5)) : 0;
      const hi = Math.max(ax, ay, az);
      const lo = Math.min(ax, ay, az);
      edge[v] = ax + ay + az - hi - lo; // the middle one
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
    geometry.setAttribute('aEntrance', new THREE.BufferAttribute(entrance, 1));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));

    const geometryId = mesh.addGeometry(geometry);
    const instanceId = mesh.addInstance(geometryId);
    mesh.setMatrixAt(instanceId, identity);
    mesh.setColorAt(instanceId, new THREE.Color(1, 1, 1));

    /* The geometry is copied into the batch's shared buffer, so the standalone
       one is dead weight the moment it is added. */
    geometry.dispose();

    blocks.push({
      id: instanceId,
      name: rec.name,
      ring: rec.ring,
      centroid: rec.centroid,
      outward: rec.outward,
      neighbours: [],
    });
  }

  linkNeighbours(blocks, manifest.radius);
  onProgress?.(1);

  /* World AABB, assembled from each block's own box rather than from the dome
     radius. The camera needs it because the entrance porch reaches 28.5 units
     toward the viewer while the dome wall stops at 22 — fitting the frame to
     the radius alone puts the porch outside it. */
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const rec of recs) {
    for (let k = 0; k < 3; k++) {
      const half = rec.extent[k] / 2;
      min[k] = Math.min(min[k], rec.centroid[k] - half);
      max[k] = Math.max(max[k], rec.centroid[k] + half);
    }
  }

  return {
    mesh,
    blocks,
    bounds: { min, max },
    radius: manifest.radius,
    height: manifest.height,
    dispose() {
      mesh.dispose();
      material.dispose();
      map.dispose();
      normalMap.dispose();
    },
  };
}

/**
 * Neighbour lists for the secondary reaction — when one block is disturbed the
 * ones touching it should acknowledge it slightly, which is most of what makes
 * the shell read as masonry rather than as 74 unrelated objects.
 *
 * Proximity on centroids, capped at six. A fixed radius alone would give the
 * crown blocks (which sit close together) a dozen neighbours and the wide base
 * courses two, so the cap is what keeps the secondary motion even across the
 * dome.
 */
function linkNeighbours(blocks, radius) {
  const reach = radius * 0.42;
  const reach2 = reach * reach;

  for (const a of blocks) {
    const near = [];
    for (const b of blocks) {
      if (b === a) continue;
      const dx = a.centroid[0] - b.centroid[0];
      const dy = a.centroid[1] - b.centroid[1];
      const dz = a.centroid[2] - b.centroid[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < reach2) near.push({ id: b.id, d2 });
    }
    near.sort((p, q) => p.d2 - q.d2);
    a.neighbours = near.slice(0, 6).map((x) => x.id);
  }
}
