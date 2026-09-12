import * as THREE from 'three';

// Block state constants
const ATTACHED = 0;
const LAUNCHED = 1;
const RETURNING = 2;

const MAX_STEP = 1 / 120;
const MAX_DT = 1 / 15;

// Per-block physics simulation: damped springs, ballistic impulses, and return easing
export class BlockPhysics {
  constructor(blocks, { radius = 22, config = {} } = {}) {
    const n = (this.count = blocks.length);
    this.blocks = blocks;
    this.radius = radius;

    this.cfg = {
      hoverPush: radius * 0.024,
      hoverFreq: 2.1,
      hoverDamping: 0.62,
      neighbourFalloff: 0.32,
      hoverTilt: 0.09,
      hoverReach: radius * 0.68,
      hoverLift: 0.35,
      hoverBob: 0.22,
      hoverBobRate: 2.6,

      launchSpeedMin: radius * 0.78,
      launchSpeedMax: radius * 1.55,
      launchDrag: 1.45,
      gravity: radius * 0.62,
      spin: 3.4,
      spinDrag: 1.1,

      groundY: radius * 0.045,
      bounce: 0.22,
      friction: 3.2,

      returnDelay: 7.0,
      returnFreq: 0.85,
      returnDamping: 1.0,

      ...config,
    };

    // Flat typed arrays for cache-friendly per-frame physics updates
    this.rest = new Float32Array(n * 3);
    this.outward = new Float32Array(n * 3);
    this.offset = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.rot = new Float32Array(n * 3);
    this.rotVel = new Float32Array(n * 3);
    this.push = new Float32Array(n);
    this.glow = new Float32Array(n);
    this.state = new Uint8Array(n);
    this.timer = new Float32Array(n);

    // Blocks flagged as immobile (e.g. foundation course)
    this.frozen = new Uint8Array(n);
    this.tilt = new Float32Array(n * 3);
    this.hoverDir = new Float32Array(n * 3);

    this.time = 0;
    this.phase = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      const h = Math.sin(i * 12.9898) * 43758.5453;
      this.phase[i] = (h - Math.floor(h)) * Math.PI * 2;
    }

    for (const b of blocks) {
      const i = b.id;
      this.rest[i * 3] = b.centroid[0];
      this.rest[i * 3 + 1] = b.centroid[1];
      this.rest[i * 3 + 2] = b.centroid[2];
      this.outward[i * 3] = b.outward[0];
      this.outward[i * 3 + 1] = b.outward[1];
      this.outward[i * 3 + 2] = b.outward[2];

      // Perpendicular tilt axis for outward hover lean
      let ax = -b.outward[2];
      let az = b.outward[0];
      const al = Math.hypot(ax, az);
      if (al < 1e-3) { ax = 1; az = 0; }
      else { ax /= al; az /= al; }
      this.tilt[i * 3] = ax * this.cfg.hoverTilt;
      this.tilt[i * 3 + 1] = 0;
      this.tilt[i * 3 + 2] = az * this.cfg.hoverTilt;

      // Upward-biased hover displacement direction
      const hx = b.outward[0];
      const hy = b.outward[1] + this.cfg.hoverLift;
      const hz = b.outward[2];
      const hl = Math.hypot(hx, hy, hz) || 1;
      this.hoverDir[i * 3] = hx / hl;
      this.hoverDir[i * 3 + 1] = hy / hl;
      this.hoverDir[i * 3 + 2] = hz / hl;
    }

    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3(1, 1, 1);
    this._c = new THREE.Color();
    this.colorsDirty = true;
  }

  // Distance from initial rest position
  displacementOf(i) {
    return Math.hypot(this.offset[i * 3], this.offset[i * 3 + 1], this.offset[i * 3 + 2]);
  }

  isHome(i) {
    return this.state[i] === ATTACHED;
  }

  // Radial hover field applied around pointer hit coordinate
  hoverField(p, strength = 1) {
    const reach = this.cfg.hoverReach;
    if (!(reach > 0)) return;
    const reach2 = reach * reach;

    for (let i = 0; i < this.count; i += 1) {
      if (this.frozen[i]) continue;
      const o = i * 3;
      const dx = this.rest[o] - p.x;
      const dy = this.rest[o + 1] - p.y;
      const dz = this.rest[o + 2] - p.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= reach2) continue;

      const near = 1 - d2 / reach2;
      const amount = strength * near * near;
      if (amount > this.push[i]) this.push[i] = amount;
      if (amount > this.glow[i]) {
        this.glow[i] = amount;
        this.colorsDirty = true;
      }
    }
  }

  // Apply hover force to specific block
  applyHover(i, amount) {
    if (this.frozen[i]) return;
    if (amount > this.push[i]) this.push[i] = amount;
  }

  // Launch block along outward normal and impact vector
  launch(i, hit, strength = 1) {
    if (this.frozen[i]) return;
    const cx = this.rest[i * 3] + this.offset[i * 3];
    const cy = this.rest[i * 3 + 1] + this.offset[i * 3 + 1];
    const cz = this.rest[i * 3 + 2] + this.offset[i * 3 + 2];

    let dx = cx - hit.x;
    let dy = cy - hit.y;
    let dz = cz - hit.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-4) {
      dx = this.outward[i * 3];
      dy = this.outward[i * 3 + 1];
      dz = this.outward[i * 3 + 2];
    } else {
      dx /= d; dy /= d; dz /= d;
    }

    const bias = 0.62;
    let vx = this.outward[i * 3] * bias + dx * (1 - bias);
    let vy = this.outward[i * 3 + 1] * bias + dy * (1 - bias);
    let vz = this.outward[i * 3 + 2] * bias + dz * (1 - bias);
    const vl = Math.hypot(vx, vy, vz) || 1;

    const { launchSpeedMin, launchSpeedMax, spin } = this.cfg;
    const speed = (launchSpeedMin + Math.random() * (launchSpeedMax - launchSpeedMin))
      * (0.55 + 0.45 * strength);

    this.vel[i * 3] += (vx / vl) * speed;
    this.vel[i * 3 + 1] += (vy / vl) * speed;
    this.vel[i * 3 + 2] += (vz / vl) * speed;

    for (let k = 0; k < 3; k++) {
      this.rotVel[i * 3 + k] += (Math.random() - 0.5) * 2 * spin * strength;
    }

    this.state[i] = LAUNCHED;
    this.timer[i] = 0;
    this.glow[i] = 1;
  }

  // Soft push on neighbor blocks without detaching
  nudge(i, hit, strength) {
    if (this.frozen[i]) return;
    if (this.state[i] !== ATTACHED) return;
    const k = this.cfg.hoverPush * 26 * strength;
    this.vel[i * 3] += this.outward[i * 3] * k;
    this.vel[i * 3 + 1] += this.outward[i * 3 + 1] * k;
    this.vel[i * 3 + 2] += this.outward[i * 3 + 2] * k;
    this.glow[i] = Math.max(this.glow[i], strength * 0.7);
  }

  // Return all displaced blocks back to rest
  reset() {
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] !== ATTACHED) {
        this.state[i] = RETURNING;
        this.timer[i] = 0;
      }
    }
  }

  // Advances physics with substeps for numerical stability
  step(dt) {
    dt = Math.min(dt, MAX_DT);
    this.time += dt;
    const steps = Math.max(1, Math.ceil(dt / MAX_STEP));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) this._integrate(h);

    const decay = Math.exp(-7 * dt);
    const glowDecay = Math.exp(-3.4 * dt);
    for (let i = 0; i < this.count; i++) {
      this.push[i] *= decay;
      const g = this.glow[i] * glowDecay;
      if (Math.abs(g - this.glow[i]) > 1e-4) this.colorsDirty = true;
      this.glow[i] = g;
    }
  }

  _integrate(h) {
    const c = this.cfg;
    const hoverOmega = 2 * Math.PI * c.hoverFreq;
    const returnOmega = 2 * Math.PI * c.returnFreq;

    for (let i = 0; i < this.count; i++) {
      const o = i * 3;
      const state = this.state[i];

      if (state === LAUNCHED) {
        this.vel[o + 1] -= c.gravity * h;

        const drag = Math.exp(-c.launchDrag * h);
        this.vel[o] *= drag;
        this.vel[o + 1] *= drag;
        this.vel[o + 2] *= drag;

        this.offset[o] += this.vel[o] * h;
        this.offset[o + 1] += this.vel[o + 1] * h;
        this.offset[o + 2] += this.vel[o + 2] * h;

        // Ground collision handling
        const worldY = this.rest[o + 1] + this.offset[o + 1];
        if (worldY < c.groundY) {
          this.offset[o + 1] = c.groundY - this.rest[o + 1];
          if (this.vel[o + 1] < 0) this.vel[o + 1] *= -c.bounce;
          const f = Math.exp(-c.friction * h);
          this.vel[o] *= f;
          this.vel[o + 2] *= f;
          this.rotVel[o] *= f;
          this.rotVel[o + 1] *= f;
          this.rotVel[o + 2] *= f;
        }

        const spinDrag = Math.exp(-c.spinDrag * h);
        for (let k = 0; k < 3; k++) {
          this.rotVel[o + k] *= spinDrag;
          this.rot[o + k] += this.rotVel[o + k] * h;
        }

        this.timer[i] += h;
        if (this.timer[i] > c.returnDelay) {
          this.state[i] = RETURNING;
          this.timer[i] = 0;
        }
        continue;
      }

      // Spring dynamics for ATTACHED and RETURNING states
      const returning = state === RETURNING;
      const omega = returning ? returnOmega : hoverOmega;
      const zeta = returning ? c.returnDamping : c.hoverDamping;

      const bob = 1 + Math.sin(this.time * c.hoverBobRate + this.phase[i]) * c.hoverBob;
      const amt = returning ? 0 : this.push[i] * c.hoverPush * bob;
      const tx = this.hoverDir[o] * amt;
      const ty = this.hoverDir[o + 1] * amt;
      const tz = this.hoverDir[o + 2] * amt;

      const k = omega * omega;
      const d = 2 * zeta * omega;

      this.vel[o] += (-k * (this.offset[o] - tx) - d * this.vel[o]) * h;
      this.vel[o + 1] += (-k * (this.offset[o + 1] - ty) - d * this.vel[o + 1]) * h;
      this.vel[o + 2] += (-k * (this.offset[o + 2] - tz) - d * this.vel[o + 2]) * h;

      this.offset[o] += this.vel[o] * h;
      this.offset[o + 1] += this.vel[o + 1] * h;
      this.offset[o + 2] += this.vel[o + 2] * h;

      // Rotational spring alignment
      const lean = returning ? 0 : this.push[i];
      for (let kk = 0; kk < 3; kk++) {
        const target = this.tilt[o + kk] * lean;
        this.rotVel[o + kk] += (-k * (this.rot[o + kk] - target) - d * this.rotVel[o + kk]) * h;
        this.rot[o + kk] += this.rotVel[o + kk] * h;
      }

      if (returning) {
        const near =
          Math.abs(this.offset[o]) + Math.abs(this.offset[o + 1]) + Math.abs(this.offset[o + 2]) < 0.012 &&
          Math.abs(this.rot[o]) + Math.abs(this.rot[o + 1]) + Math.abs(this.rot[o + 2]) < 0.012;
        if (near) {
          this.state[i] = ATTACHED;
          for (let kk = 0; kk < 3; kk++) {
            this.offset[o + kk] = 0;
            this.vel[o + kk] = 0;
            this.rot[o + kk] = 0;
            this.rotVel[o + kk] = 0;
          }
        }
      }
    }
  }

  // Uploads updated instance matrices and tint colors to the BatchedMesh
  writeTo(mesh) {
    const { _m: m, _p: p, _q: q, _e: e, _s: s, _c: col } = this;

    for (let i = 0; i < this.count; i++) {
      const o = i * 3;
      p.set(
        this.rest[o] + this.offset[o],
        this.rest[o + 1] + this.offset[o + 1],
        this.rest[o + 2] + this.offset[o + 2]
      );
      e.set(this.rot[o], this.rot[o + 1], this.rot[o + 2]);
      q.setFromEuler(e);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }

    if (this.colorsDirty) {
      let live = false;
      for (let i = 0; i < this.count; i++) {
        const g = this.glow[i];
        if (g > 1e-3) live = true;
        col.setRGB(1 + g * 0.30, 1 + g * 0.38, 1 + g * 0.52);
        mesh.setColorAt(i, col);
      }
      this.colorsDirty = live;
    }
  }
}
