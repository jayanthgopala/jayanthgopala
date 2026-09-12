// Damped wave equation on a ping-pong pair of render targets.
//
// The field is the water column's surface unwrapped to UV: u runs around the
// cylinder (wrapping), v runs up it (clamped). Heights live in the red channel
// and the previous step's heights in green, which is all the integrator needs:
//
//   next = (2h - h_prev) + c * laplacian(h),  damped
//
// Stepping is fixed at 60Hz and decoupled from the display rate, so a 120Hz
// monitor does not halve the wave speed.

import {
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector4,
  WebGLRenderTarget,
} from 'three';

const STEP = 1 / 60;
const MAX_STEPS = 3; // Catch-up ceiling, so a stalled tab cannot spiral.
const MAX_IMPULSES = 8; // Per step; the queue drains over subsequent steps.

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uPrev;
uniform vec2 uTexel;
uniform float uDamp;
uniform float uSpeed;
uniform float uAspect;
uniform int uCount;
uniform vec4 uImpulse[${MAX_IMPULSES}]; // xy = uv, z = strength, w = radius

varying vec2 vUv;

void main() {
  vec4 cell = texture2D(uPrev, vUv);
  float h = cell.r;
  float prev = cell.g;

  // Wrap and clamp come from the target's own wrapS / wrapT.
  float l = texture2D(uPrev, vUv - vec2(uTexel.x, 0.0)).r;
  float r = texture2D(uPrev, vUv + vec2(uTexel.x, 0.0)).r;
  float d = texture2D(uPrev, vUv - vec2(0.0, uTexel.y)).r;
  float u = texture2D(uPrev, vUv + vec2(0.0, uTexel.y)).r;

  float laplacian = (l + r + u + d) - 4.0 * h;
  float next = (2.0 * h - prev) + uSpeed * laplacian;
  next *= uDamp;

  for (int i = 0; i < ${MAX_IMPULSES}; i++) {
    if (i >= uCount) break;
    vec4 imp = uImpulse[i];
    vec2 delta = vUv - imp.xy;
    // Shortest path around the cylinder rather than across the seam.
    delta.x -= floor(delta.x + 0.5);
    delta.x *= uAspect;
    float radius = max(imp.w, 1e-4);
    next += imp.z * exp(-dot(delta, delta) / (radius * radius));
  }

  // The integrator is unconditionally stable only while amplitudes stay bounded.
  next = clamp(next, -1.5, 1.5);

  gl_FragColor = vec4(next, h, 0.0, 1.0);
}
`;

function makeTarget(size) {
  const target = new WebGLRenderTarget(size, size, {
    type: HalfFloatType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  target.texture.wrapS = RepeatWrapping; // Around the column.
  target.texture.wrapT = ClampToEdgeWrapping; // Along it.
  return target;
}

export class RippleSim {
  constructor(size = 256) {
    this.size = size;
    this.read = makeTarget(size);
    this.write = makeTarget(size);
    this.accumulator = 0;
    this.queue = [];
    this.cleared = false;

    this.scene = new Scene();
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uPrev: { value: this.read.texture },
        uTexel: { value: new Vector2(1 / size, 1 / size) },
        uDamp: { value: 0.994 },
        uSpeed: { value: 0.22 },
        // The unwrapped sheet is wider than it is tall; without this, impulses
        // land as ellipses rather than circles.
        uAspect: { value: 1 },
        uCount: { value: 0 },
        uImpulse: {
          value: Array.from({ length: MAX_IMPULSES }, () => new Vector4()),
        },
      },
    });

    this.quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** Circumference / height of the surface being simulated. */
  setAspect(aspect) {
    this.material.uniforms.uAspect.value = aspect;
  }

  /**
   * Queues a displacement. `u` wraps, `v` is clamped to the column.
   * Drained at up to MAX_IMPULSES per fixed step.
   */
  impulse(u, v, strength, radius = 0.045) {
    if (!Number.isFinite(u) || !Number.isFinite(v)) return;
    if (this.queue.length > 64) return; // A stalled frame should not bank a flood.
    this.queue.push({ u: u - Math.floor(u), v: Math.min(1, Math.max(0, v)), strength, radius });
  }

  swap() {
    const previous = this.read;
    this.read = this.write;
    this.write = previous;
    this.material.uniforms.uPrev.value = this.read.texture;
  }

  step(renderer) {
    const uniforms = this.material.uniforms;
    const taken = this.queue.splice(0, MAX_IMPULSES);

    for (let i = 0; i < MAX_IMPULSES; i += 1) {
      const item = taken[i];
      uniforms.uImpulse.value[i].set(
        item ? item.u : 0,
        item ? item.v : 0,
        item ? item.strength : 0,
        item ? item.radius : 1
      );
    }
    uniforms.uCount.value = taken.length;

    const previousTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.write);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(previousTarget);
    this.swap();
  }

  /** Advances the simulation, returning the texture to sample this frame. */
  update(renderer, dt) {
    if (!this.cleared) {
      // Half-float targets start undefined; a wave built on garbage explodes.
      const previousTarget = renderer.getRenderTarget();
      for (const target of [this.read, this.write]) {
        renderer.setRenderTarget(target);
        renderer.clearColor();
      }
      renderer.setRenderTarget(previousTarget);
      this.cleared = true;
    }

    this.accumulator = Math.min(this.accumulator + dt, STEP * MAX_STEPS);
    let steps = 0;
    while (this.accumulator >= STEP && steps < MAX_STEPS) {
      this.accumulator -= STEP;
      steps += 1;
      this.step(renderer);
    }

    // Impulses that arrived with no step to carry them still need to land, or a
    // slow frame silently eats the click that caused them.
    if (steps === 0 && this.queue.length > 0) this.step(renderer);

    return this.read.texture;
  }

  get texture() {
    return this.read.texture;
  }

  dispose() {
    this.read.dispose();
    this.write.dispose();
    this.quad.geometry.dispose();
    this.material.dispose();
  }
}
