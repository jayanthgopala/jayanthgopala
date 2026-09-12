import { IcosahedronGeometry, Vector3 } from 'three';
import { heightAt, MOUND_AT } from './terrain.js';
import { makeNoise2D, makeFbm } from './noise.js';

// Loose stone on the ice. A texture has no silhouette, and objects breaking the outline are what give the landscape scale.
// Deterministic, baked once from a fixed seed, a field that reshuffles itself between loads isn't an authored shot.

function mulberry32(a) {
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Lobes rather than 3D noise. Noise is stationary so every part of the surface is equally busy and you get a potato.
// A few wide lobes give the block its shape and a dozen narrow ones give it knuckles.
export function makeRockGeometry({
  seed = 1,
  detail = 1,
  forms = 5,
  bumps = 14,
  // Raised from 0.66, which is what made them read as grey discs lying on the snow.
  flatten = 0.86,
} = {}) {
  const rng = mulberry32(seed * 2654435761);
  const geometry = new IcosahedronGeometry(1, detail);

  const lobes = [];
  const pushLobe = (amp, sharp) => {
    // z-then-angle, so directions are uniform on the sphere rather than clustered at the poles
    const z = rng() * 2 - 1;
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    lobes.push({
      dir: new Vector3(Math.cos(a) * r, z, Math.sin(a) * r),
      amp,
      sharp,
    });
  };

  for (let i = 0; i < forms; i += 1) pushLobe(0.16 + rng() * 0.26, 1.1 + rng() * 1.4);
  for (let i = 0; i < bumps; i += 1) pushLobe(0.04 + rng() * 0.07, 3.5 + rng() * 5.0);

  // A single shear, cheap, and most of what stops a field of these reading as the same rock rotated.
  const shearX = (rng() - 0.5) * 0.36;
  const shearZ = (rng() - 0.5) * 0.36;

  // IcosahedronGeometry is non-indexed, so displacement must depend on the original position and nothing else.
  // Bring in a vertex index or a running random and shared corners drift apart and the mesh splits at every seam.
  const pos = geometry.attributes.position;
  const n = new Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    n.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();

    let radius = 0.82;
    for (let l = 0; l < lobes.length; l += 1) {
      const lobe = lobes[l];
      const d = n.dot(lobe.dir);
      if (d <= 0) continue;
      radius += lobe.amp * Math.pow(d, lobe.sharp);
    }

    const x = n.x * radius;
    const y = n.y * radius * flatten;
    const z = n.z * radius;

    pos.setXYZ(i, x + y * shearX, y, z + y * shearZ);
  }

  // Without this every normal still points out of the sphere it started as and the stone lights as a ball.
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

// Igloo footprint, nothing is placed inside it
const KEEP_CLEAR = 27;

// Acceptance is gated on this so there are bare stretches. A constant nearest-neighbour distance reads as polka dots.
// Low frequency on purpose, one cycle is about seventy units so the camera passes bare ground then strewn ground.
const clusterFbm = makeFbm(makeNoise2D(4471), { octaves: 3, lacunarity: 2.05, persistence: 0.5 });
const clusterAt = (x, z) => Math.min(1, Math.max(0, (clusterFbm(x * 0.014, z * 0.014) + 1) * 0.5));

// Stone collects below slopes because that's where it came from. Four height reads, no new machinery.
function slopeAt(x, z) {
  const e = 2.4;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
}

// Satellites are drawn small, they're the debris of the stone they sit beside and a cluster of equals looks arranged.
function withSatellites(out, x, z, roll, rng) {
  out.push({ x, z, y: heightAt(x, z), rng: roll, scale: 1 });

  const extra = Math.floor(rng() * 3.4);
  for (let k = 0; k < extra; k += 1) {
    const a = rng() * Math.PI * 2;
    const d = 0.8 + rng() * 4.2;
    const sx = x + Math.cos(a) * d;
    const sz = z + Math.sin(a) * d;
    out.push({ x: sx, z: sz, y: heightAt(sx, sz), rng: rng(), scale: 0.34 + rng() * 0.38 });
  }
}

// bias >1 pulls the population toward the inner radius. Area grows with r^2, so an unbiased draw thins toward the middle.
export function apronPlacements({ count, inner = KEEP_CLEAR, outer = 104, bias = 2.1, seed = 7 }) {
  const rng = mulberry32(seed * 40503);
  const out = [];

  for (let i = 0; i < count; i += 1) {
    const a = rng() * Math.PI * 2;
    const r = inner + (outer - inner) * Math.pow(rng(), bias);
    const x = MOUND_AT[0] + Math.cos(a) * r;
    const z = MOUND_AT[1] + Math.sin(a) * r;
    const roll = rng();

    // Stone piled against an obstruction really is continuous, so acceptance is unconditional at the wall.
    const held = 1 - Math.min(1, Math.max(0, (r - inner) / 26));
    const gather = clusterAt(x, z) * 0.72 + Math.min(1, slopeAt(x, z) * 3.4) * 0.5;
    if (rng() > held + gather) continue;

    withSatellites(out, x, z, roll, rng);
  }
  return out;
}

// Jittered grid rather than uniform random, which clumps by chance and the eye finds the clumps.
// One stone per cell offset within it guarantees spacing, skipping cells at random keeps it off a lattice.
export function driftPlacements({
  cellsX = 13,
  cellsZ = 26,
  spanX = [-190, 190],
  spanZ = [-110, 340],
  keep = 0.52,
  seed = 19,
}) {
  const rng = mulberry32(seed * 22699);
  const out = [];
  const stepX = (spanX[1] - spanX[0]) / cellsX;
  const stepZ = (spanZ[1] - spanZ[0]) / cellsZ;

  for (let j = 0; j < cellsZ; j += 1) {
    for (let i = 0; i < cellsX; i += 1) {
      const roll = rng();
      const jx = rng();
      const jz = rng();
      const pick = rng();
      if (roll > keep) continue;

      const x = spanX[0] + (i + 0.15 + jx * 0.7) * stepX;
      const z = spanZ[0] + (j + 0.15 + jz * 0.7) * stepZ;

      // The apron owns everything near the igloo, overlapping would double the density where it's already highest.
      const d = Math.hypot(x - MOUND_AT[0], z - MOUND_AT[1]);
      if (d < 108) continue;

      // Out here clumping is the only thing placing stone, and it's harsh on purpose, most of the plain should have none.
      const gather = clusterAt(x, z) * 0.9 + Math.min(1, slopeAt(x, z) * 3.8) * 0.6;
      if (gather < 0.62) continue;

      withSatellites(out, x, z, pick, rng);
    }
  }
  return out;
}
