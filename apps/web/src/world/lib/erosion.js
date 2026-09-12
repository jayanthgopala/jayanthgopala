/*
 * Droplet-based hydraulic erosion. Vendored from https://github.com/ctkrug/erosion (src/erosion.js).
 *
 * MIT License
 * Copyright (c) 2026 Charlie Krug
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// Every noise layer in terrain.js is a function of position alone, but a valley is where material went somewhere downhill.
// Stacked octaves can't express that, which is why summed noise reads as texture rather than landscape however well tuned.
// This traces water over the surface and moves material with it, so every hollow connects to the slope that drained into it.

// Their seeded xorshift, so a seed always yields the same landscape
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
  // Cap on how much one step can change a cell. Without it a slightly deeper cell presents a larger slope to the next
  // droplet and erodes deeper still, an unbounded loop that blows the heightmap up within a few hundred droplets.
  maxChangePerStep: 0.015,
};

function clampIndex(v, size) {
  return Math.min(Math.max(v, 0), size - 1);
}

// bilinear height and gradient at a fractional grid position
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

// Spreads amount across the 4 cells using the same weights heightAndGradient reads, so erode and deposit are symmetric.
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

// One droplet's whole lifetime, mutating heightmap in place. rng picks the spawn so a seeded PRNG keeps it reproducible.
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
    // The one local change to the vendored code. Upstream dumps the whole load on one cell, which is what makes its mass
    // conservation exact, and across this many droplets it produced a field of spikes taller than the igloo.
    // Their demo hides it because its heightmap spans [0,1]. Capping costs exact conservation, timed-out sediment is discarded.
    const p2 = { ...DEFAULT_EROSION_PARAMS, ...params };
    applyDelta(heightmap, size, x, y, Math.min(sediment, p2.maxChangePerStep));
  }

  return steps;
}
