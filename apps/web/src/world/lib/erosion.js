/*
 * Droplet-based hydraulic erosion.
 *
 * Vendored from https://github.com/ctkrug/erosion (src/erosion.js).
 *
 *   MIT License
 *   Copyright (c) 2026 Charlie Krug
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy
 *   of this software and associated documentation files (the "Software"), to deal
 *   in the Software without restriction, including without limitation the rights
 *   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *   copies of the Software, and to permit persons to whom the Software is
 *   furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 *   SOFTWARE.
 *
 * WHY THIS AND NOT MORE NOISE. Every layer already in terrain.js is a function
 * of position alone: whatever it produces at a point, it produces without
 * reference to anything around it. Real ground is the opposite — a valley is
 * where material WENT somewhere, and that somewhere is downhill from here. No
 * amount of stacked octaves can express that, which is why summed noise always
 * reads as texture rather than landscape however well it is tuned.
 *
 * This traces water over the surface and moves material along with it, so the
 * result carries the one thing noise cannot fake: every hollow is connected to
 * the slope that drained into it.
 *
 * Their code is kept as it was, including their notes — the maxChangePerStep
 * comment in particular documents a failure mode worth not rediscovering.
 * Their noise.js and heightmap.js are not vendored; this terrain has its own
 * generator and only needed the simulation.
 */

/* Their seeded xorshift, so a given seed always yields the same landscape. */
export function createRng(seed) {
  let state = seed | 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

export const DEFAULT_EROSION_PARAMS = {
  inertia: 0.05,
  sedimentCapacityFactor: 3,
  minSedimentCapacity: 0.0001,
  erodeSpeed: 0.3,
  depositSpeed: 0.3,
  evaporateSpeed: 0.02,
  gravity: 4,
  maxLifetime: 30,
  initialWater: 1,
  initialSpeed: 1,
  maxSpeed: 5,
  // Hard cap on how much a single step can change one cell. Without this, a
  // cell that's randomly eroded slightly deeper than its neighbor presents a
  // larger local slope to the next droplet that crosses it, which erodes it
  // deeper still — an unbounded feedback loop that blows the heightmap up to
  // extreme values within a few hundred droplets. Capping the per-step delta
  // breaks that feedback while still allowing visible carving over many steps.
  maxChangePerStep: 0.015,
};

function clampIndex(v, size) {
  return Math.min(Math.max(v, 0), size - 1);
}

// Bilinear height + gradient sample at a fractional grid position.
function heightAndGradient(data, size, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;

  const cx0 = clampIndex(x0, size);
  const cy0 = clampIndex(y0, size);
  const cx1 = clampIndex(x0 + 1, size);
  const cy1 = clampIndex(y0 + 1, size);

  const h00 = data[cy0 * size + cx0];
  const h10 = data[cy0 * size + cx1];
  const h01 = data[cy1 * size + cx0];
  const h11 = data[cy1 * size + cx1];

  const gx = (h10 - h00) * (1 - fy) + (h11 - h01) * fy;
  const gy = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
  const height =
    h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;

  return { height, gx, gy };
}

// Distributes `amount` across the 4 cells surrounding (x, y) using the same
// bilinear weights heightAndGradient reads from, so erode (negative amount)
// and deposit (positive amount) touch the field symmetrically.
function applyDelta(data, size, x, y, amount) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;

  const cx0 = clampIndex(x0, size);
  const cy0 = clampIndex(y0, size);
  const cx1 = clampIndex(x0 + 1, size);
  const cy1 = clampIndex(y0 + 1, size);

  data[cy0 * size + cx0] += amount * (1 - fx) * (1 - fy);
  data[cy0 * size + cx1] += amount * fx * (1 - fy);
  data[cy1 * size + cx0] += amount * (1 - fx) * fy;
  data[cy1 * size + cx1] += amount * fx * fy;
}

// Simulates one droplet's full lifetime and mutates `heightmap` in place.
// `rng` is called to pick the spawn point, so passing a seeded PRNG keeps
// the whole simulation reproducible. Returns the number of steps taken.
export function erodeStep(heightmap, size, rng, params = {}) {
  const p = { ...DEFAULT_EROSION_PARAMS, ...params };

  let x = rng() * (size - 1);
  let y = rng() * (size - 1);
  let dirX = 0;
  let dirY = 0;
  let speed = p.initialSpeed;
  let water = p.initialWater;
  let sediment = 0;
  let steps = 0;

  for (; steps < p.maxLifetime; steps++) {
    const { gx, gy, height: oldHeight } = heightAndGradient(heightmap, size, x, y);

    dirX = dirX * p.inertia - gx * (1 - p.inertia);
    dirY = dirY * p.inertia - gy * (1 - p.inertia);
    const len = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
    dirX /= len;
    dirY /= len;

    const nextX = x + dirX;
    const nextY = y + dirY;

    if (nextX < 0 || nextX >= size - 1 || nextY < 0 || nextY >= size - 1) {
      break;
    }

    x = nextX;
    y = nextY;

    const { height: newHeight } = heightAndGradient(heightmap, size, x, y);
    const heightDiff = newHeight - oldHeight;
    const capacity = Math.max(-heightDiff * speed * water * p.sedimentCapacityFactor, p.minSedimentCapacity);

    if (heightDiff > 0 || sediment > capacity) {
      const depositAmount = Math.min(
        heightDiff > 0 ? Math.min(heightDiff, sediment) : (sediment - capacity) * p.depositSpeed,
        p.maxChangePerStep
      );
      sediment -= depositAmount;
      applyDelta(heightmap, size, x, y, depositAmount);
    } else {
      const erodeAmount = Math.min((capacity - sediment) * p.erodeSpeed, -heightDiff, p.maxChangePerStep);
      applyDelta(heightmap, size, x, y, -erodeAmount);
      sediment += erodeAmount;
    }

    speed = Math.min(Math.sqrt(Math.max(0, speed * speed - heightDiff * p.gravity)), p.maxSpeed);
    water *= 1 - p.evaporateSpeed;

    if (water < 0.01) break;
  }

  if (sediment > 0) {
    /*
     * LOCAL MODIFICATION to the vendored code — the one change made to it.
     *
     * Upstream deposits the whole remaining load in one go, which is what makes
     * their mass conservation exact. Every other path through this function is
     * capped by maxChangePerStep; this one is not, and it is the only place a
     * single cell can take a large change in a single event.
     *
     * A droplet that dies at maxLifetime rather than by running off the map is
     * still carrying close to its capacity, so it drops it all on one cell.
     * Once, that is a bump. Across the droplet count this terrain needs it is a
     * field of spikes taller than the igloo — which is exactly what the first
     * run produced. Their demo hides it because its heightmap spans [0, 1],
     * where the same dump is a fraction of the total relief; scaled to a
     * landscape in world units it is catastrophic.
     *
     * Capping it costs their exact-conservation property: sediment still in
     * transit when a droplet times out is now discarded rather than banked. It
     * is a real trade and worth stating plainly — but the alternative is a
     * conserved landscape that cannot be looked at.
     */
    const p2 = { ...DEFAULT_EROSION_PARAMS, ...params };
    applyDelta(heightmap, size, x, y, Math.min(sediment, p2.maxChangePerStep));
  }

  return steps;
}
