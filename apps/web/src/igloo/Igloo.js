import * as THREE from 'three';

// Igloo renderer: combines 74 distinct block geometries into a single BatchedMesh
const U16 = 65535;

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
        t.flipY = false;
        resolve(t);
      },
      undefined,
      () => reject(new Error(`failed to load ${url}`))
    );
  });
}

// Loads geometry buffers and textures to build the BatchedMesh
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
    normalScale: new THREE.Vector2(1.25, 1.25),
    roughness: 0.82,
    metalness: 0.0,
    envMapIntensity: 0.38,
    side: THREE.FrontSide,
    dithering: true,
  });

  const mesh = new THREE.BatchedMesh(recs.length, totalVerts, totalIndices, material);
  mesh.name = 'igloo';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
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
    const edge = new Float32Array(n);
    const entrance = new Float32Array(n);
    if (rec.name.startsWith('Entrance_')) entrance.fill(1);

    const [ex, ey, ez] = rec.extent;
    for (let v = 0; v < n; v++) {
      position[v * 3] = (qp[v * 3] / U16 - 0.5) * ex;
      position[v * 3 + 1] = (qp[v * 3 + 1] / U16 - 0.5) * ey;
      position[v * 3 + 2] = (qp[v * 3 + 2] / U16 - 0.5) * ez;

      let nx = qn[v * 3] / 127;
      let ny = qn[v * 3 + 1] / 127;
      let nz = qn[v * 3 + 2] / 127;
      const len = Math.hypot(nx, ny, nz) || 1;
      normal[v * 3] = nx / len;
      normal[v * 3 + 1] = ny / len;
      normal[v * 3 + 2] = nz / len;

      uv[v * 2] = qu[v * 2] / U16;
      uv[v * 2 + 1] = qu[v * 2 + 1] / U16;

      // Normalized distance to bounding box edge for bevel lighting
      const ax = ex > 1e-4 ? Math.min(1, Math.abs(position[v * 3]) / (ex * 0.5)) : 0;
      const ay = ey > 1e-4 ? Math.min(1, Math.abs(position[v * 3 + 1]) / (ey * 0.5)) : 0;
      const az = ez > 1e-4 ? Math.min(1, Math.abs(position[v * 3 + 2]) / (ez * 0.5)) : 0;
      const hi = Math.max(ax, ay, az);
      const lo = Math.min(ax, ay, az);
      edge[v] = ax + ay + az - hi - lo;
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

  // Compute model bounding box
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

// Finds nearest neighbor blocks for impulse transmission
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
