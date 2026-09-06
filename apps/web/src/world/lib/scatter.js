import { IcosahedronGeometry, Vector3 } from 'three';
import { heightAt, MOUND_AT } from './terrain.js';
import { makeNoise2D, makeFbm } from './noise.js';

/**
 * Loose stone on the ice: the geometry of one rock, and where the rocks go.
 *
 * WHY GEOMETRY AND NOT MORE TEXTURE. The ground already carries a rock texture
 * (see Terrain.jsx) and that is the right tool for the surface itself — but a
 * texture has no silhouette. Everything the eye uses to judge the size of a
 * landscape comes from objects that break its outline: a stone standing proud
 * of the snow tells you how far away the snow is, and a painted stone tells you
 * nothing at all. The apron of scree around the igloo is what puts the dome at
 * a believable scale, and it only works because these are real solids catching
 * the key light on one side.
 *
 * Everything here is DETERMINISTIC. The scatter is baked once at load from a
 * fixed seed, so the same stones land in the same places on every visit — the
 * shot is authored, and a field that reshuffles itself between loads is not.
 */

/** Deterministic PRNG. Same one the ice generator uses, for the same reason. */
function mulberry32(a) {
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One stone.
 *
 * LOBES, NOT NOISE. The obvious way to make a rock is to displace a sphere by
 * 3D noise, and it gives a potato: noise is stationary, so every part of the
 * surface is equally busy and the result has no dominant form. Real stone is
 * the opposite — it is a few large faces or swells meeting at edges, with finer
 * breakup riding on them, which is the same argument the ice generator makes
 * about weighting its octaves by hand.
 *
 * So the radius is built from a handful of directional lobes: each one pushes
 * the surface out in one direction with a cosine falloff, and where two lobes
 * meet they form a ridge. A few wide lobes give the block its shape; a dozen
 * narrow ones give it its knuckles.
 *
 * DISPLACEMENT IS A FUNCTION OF THE ORIGINAL POSITION ONLY. IcosahedronGeometry
 * is non-indexed, so every shared corner appears in the buffer once per face —
 * if the displacement depended on anything else (the vertex index, a running
 * random) the copies would move apart and the mesh would split at every seam.
 */
export function makeRockGeometry({
  seed = 1,
  detail = 1,
  /** Wide lobes: the stone's overall shape. */
  forms = 5,
  /** Narrow lobes: knuckles and shoulders. */
  bumps = 14,
  /**
   * How far a stone is squashed onto its own bed.
   *
   * RAISED FROM 0.66, WHICH WAS THE WHOLE REASON THEY READ AS DISCS. Flattening
   * was meant to make them look settled, and past a point it does the opposite:
   * a stone whose height is two thirds of its width still has a silhouette, and
   * one at a third has an outline instead — a grey ellipse lying on the snow,
   * which is what a scatter of them looked like from the camera. Volume is what
   * makes a rock catch the key on one side and shade on the other, and that is
   * the entire visual job these are here to do.
   */
  flatten = 0.86,
} = {}) {
  const rng = mulberry32(seed * 2654435761);
  const geometry = new IcosahedronGeometry(1, detail);

  const lobes = [];
  const pushLobe = (amp, sharp) => {
    /* Directions drawn on the sphere by the usual z-then-angle method, so they
       are uniform rather than clustered at the poles. */
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

  /* A single shear, so no stone is symmetric about any axis. Cheap, and it is
     most of what stops a field of these reading as the same rock rotated. */
  const shearX = (rng() - 0.5) * 0.36;
  const shearZ = (rng() - 0.5) * 0.36;

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

  /* Recomputed, or every normal still points out of the sphere this started as
     and the stone lights as a ball however much shape it has. */
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Where the stones lie.
 *
 * TWO POPULATIONS, and the split is the whole design. An even scatter over the
 * whole plain reads as gravel spread by a machine. Real scree collects: it
 * gathers against whatever obstructs the wind, and thins to nothing away from
 * it. So there is an APRON banked around the igloo — dense at the wall, falling
 * off with distance — and a much sparser DRIFT along the corridor the camera
 * travels, which exists only so the near ground is never empty as the shot
 * moves down it.
 *
 * BOTH ARE THEN CLUMPED, and that pass matters more than either of them.
 *
 * Measured against igloo.inc, its ground carries no evenly spaced loose stone
 * at all — what it has is dark rock grain in the SURFACE and, occasionally, a
 * gathering of stone where the landform exposes it. A scatter that is merely
 * unclustered reads as polka dots however carefully its density is tuned,
 * because a roughly constant nearest-neighbour distance is exactly the signal
 * the eye picks up as a pattern. Two things fix it, and they are both here:
 * acceptance gated on a smooth field, so there are bare stretches; and
 * satellites, so an accepted stone brings company.
 */

/** Igloo footprint. Nothing is placed inside this — the pad is swept ground. */
const KEEP_CLEAR = 27;

/**
 * The clumping field.
 *
 * Low frequency: at 0.014 one cycle is about seventy world units, so the
 * patches are tens of metres across — big enough that the camera passes through
 * a bare stretch and then a strewn one, rather than seeing an average.
 */
const clusterFbm = makeFbm(makeNoise2D(4471), { octaves: 3, lacunarity: 2.05, persistence: 0.5 });
const clusterAt = (x, z) => Math.min(1, Math.max(0, (clusterFbm(x * 0.014, z * 0.014) + 1) * 0.5));

/**
 * How steeply the ground falls here.
 *
 * STONE COLLECTS BELOW SLOPES because that is where it came from: it breaks off
 * the steep ground and stops when the ground stops tipping. Sampling the height
 * field either side of the point is the whole computation — the terrain is
 * already a bilinear lookup, so this costs four reads and no new machinery.
 *
 * It also ties the loose stone to the same signal the ground shader uses for
 * its bedrock, so scree turns up where rock is showing rather than in the
 * middle of an untouched snowfield.
 */
function slopeAt(x, z) {
  const e = 2.4;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
}

/**
 * One accepted stone, plus the ones lying against it.
 *
 * A stone that broke off something did not travel alone, and a field where
 * every stone is isolated looks placed. Satellites are drawn small — they are
 * the debris of the one they sit beside, and a cluster of equals reads as an
 * arrangement rather than as a fall.
 */
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

/**
 * @param count how many stones.
 * @param inner/outer radii of the apron, from the igloo's centre.
 * @param bias >1 pulls the population toward the inner radius. Area grows with
 *   r^2, so an unbiased radial draw actually thins toward the middle — this is
 *   what makes the apron bank against the wall rather than ring it evenly.
 */
export function apronPlacements({ count, inner = KEEP_CLEAR, outer = 104, bias = 2.1, seed = 7 }) {
  const rng = mulberry32(seed * 40503);
  const out = [];

  for (let i = 0; i < count; i += 1) {
    const a = rng() * Math.PI * 2;
    const r = inner + (outer - inner) * Math.pow(rng(), bias);
    const x = MOUND_AT[0] + Math.cos(a) * r;
    const z = MOUND_AT[1] + Math.sin(a) * r;
    const roll = rng();

    /*
     * The drift banked against the wall is an exception to the clumping, and a
     * real one: stone piled against an obstruction IS continuous, because the
     * obstruction is what gathered it. So acceptance is unconditional at the
     * foot of the igloo and increasingly conditional going out.
     */
    const held = 1 - Math.min(1, Math.max(0, (r - inner) / 26));
    const gather = clusterAt(x, z) * 0.72 + Math.min(1, slopeAt(x, z) * 3.4) * 0.5;
    if (rng() > held + gather) continue;

    withSatellites(out, x, z, roll, rng);
  }
  return out;
}

/**
 * The sparse drift down the corridor.
 *
 * JITTERED GRID, NOT UNIFORM RANDOM. Uniform placement clumps by chance and the
 * eye finds the clumps — the same failure the ice generator's stone scatter
 * documents. One stone per cell, offset within it, guarantees a minimum spacing
 * while still looking unplanned; skipping cells at random is what keeps it from
 * reading as a lattice.
 */
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

      /* The apron owns everything near the igloo; two populations overlapping
         there would double the density exactly where it is already highest. */
      const d = Math.hypot(x - MOUND_AT[0], z - MOUND_AT[1]);
      if (d < 108) continue;

      /* Out here the clumping is the ONLY thing placing stone, and it is
         deliberately harsh: most of the open plain should have none. */
      const gather = clusterAt(x, z) * 0.9 + Math.min(1, slopeAt(x, z) * 3.8) * 0.6;
      if (gather < 0.62) continue;

      withSatellites(out, x, z, pick, rng);
    }
  }
  return out;
}
