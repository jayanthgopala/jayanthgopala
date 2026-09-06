import * as THREE from 'three';

/**
 * Per-block motion for the igloo.
 *
 * Every block is a damped spring anchored to where it was built, plus an
 * optional ballistic phase for the ones that have been knocked out. Nothing
 * here is a tween on a timeline: the block has a position and a velocity, and
 * forces act on them. That is what buys the difference between motion that
 * looks animated and motion that looks physical — a block that is already
 * moving when you knock it carries that momentum, and two clicks in quick
 * succession compound instead of restarting.
 *
 * Three states:
 *
 *   ATTACHED   spring to rest + whatever the pointer is pushing it by
 *   LAUNCHED   impulse, drag, gravity, tumble, land
 *   RETURNING  a slow, heavily damped spring back into the wall
 *
 * A launched block sits on the ground for RETURN_DELAY seconds before it
 * starts home, which is what lets several clicks open the shell and show the
 * inside before it heals itself. Set RETURN_DELAY to Infinity to have blocks
 * stay where they land.
 *
 * INTEGRATION IS SUBSTEPPED AND dt IS CLAMPED. A stiff spring integrated with
 * one big step on a slow frame does not slow down, it explodes — and the frame
 * after a tab regains focus can be hundreds of milliseconds. Clamping bounds
 * the worst case and substepping keeps the spring stable inside it.
 */

const ATTACHED = 0;
const LAUNCHED = 1;
const RETURNING = 2;

const MAX_STEP = 1 / 120;
const MAX_DT = 1 / 15;

export class BlockPhysics {
  constructor(blocks, { radius = 22, config = {} } = {}) {
    const n = (this.count = blocks.length);
    this.blocks = blocks;
    this.radius = radius;

    this.cfg = {
      /* Hover. Deliberately small — this is a nudge that says "this one",
         not a movement in its own right. */
      hoverPush: radius * 0.024,
      hoverFreq: 2.1,
      hoverDamping: 0.62,
      neighbourFalloff: 0.32,
      /* Radians of lean at full hover pressure. A block that only translates
         reads as sliding; the tilt is what makes it read as being lifted at
         one edge, and it is the whole difference between "nudged" and
         "picked out". Small on purpose — this is a cue, not a movement. */
      hoverTilt: 0.09,
      /*
       * THE RADIUS THE POINTER DISTURBS, and it is what makes the shell read
       * as one body rather than as a grid of separately clickable tiles.
       *
       * Observed on the reference: with the cursor on the dome, eight to
       * twelve blocks are visibly apart, in a soft disc centred on the cursor
       * and fading to nothing at its edge — not one block, and not a block
       * plus a fixed list of the six touching it. The difference is legible
       * immediately, because a fixed neighbour list has a hard boundary: the
       * seventh-nearest block does not move at all however close it is, so the
       * disturbance has an edge and the eye finds it.
       *
       * 0.68 of the dome radius is 15 units here. 0.55 was the first estimate
       * off the reference's affected area and it agreed with the value the old
       * procedural igloo in this repo had arrived at (11) — but counting the
       * result, it disturbed seven blocks against the reference's eight to
       * twelve, because this model's blocks are larger relative to its dome
       * than either of those. Set against the count rather than the area.
       */
      hoverReach: radius * 0.68,
      /*
       * HOW MUCH OF THE LIFT IS SKYWARD RATHER THAN STRAIGHT OUT.
       *
       * A block's own outward normal is the honest direction for it to leave
       * the wall, and on the upper courses it already points up and out. Down
       * the sides it points almost horizontally, so those blocks slid sideways
       * out of the wall while the crown ones rose — the disturbance read as
       * the dome bulging rather than as blocks lifting off it.
       *
       * Blending world-up into the push direction gives every block some rise
       * whatever part of the shell it sits on. Kept well under half so the
       * motion still comes off the surface it belongs to instead of the whole
       * shell levitating.
       */
      hoverLift: 0.35,
      /*
       * A LIFTED BLOCK KEEPS MOVING.
       *
       * The spring alone carries a block out and then holds it there, dead
       * still, for as long as the cursor stays put — which is the one thing
       * something hovering never does. These two put a slow breath on the
       * hover TARGET, so the block drifts out and back around where the spring
       * wants it instead of parking on it.
       *
       * On the target rather than on the position, so it is still the spring
       * doing the moving: the block eases into each drift and out of it, and
       * one that is also being knocked about stays a single object instead of
       * having a wobble added on top of it.
       */
      hoverBob: 0.22, // fraction of the lift it breathes by
      hoverBobRate: 2.6, // radians per second

      /* Click. The spread is what stops repeated clicks looking mechanical;
         the ceiling is what stops the dome coming apart. A block leaves at
         between three quarters and one and a half times the dome radius per
         second, which reads as thrown rather than exploded. */
      launchSpeedMin: radius * 0.78,
      launchSpeedMax: radius * 1.55,
      launchDrag: 1.45,
      gravity: radius * 0.62,
      spin: 3.4,
      spinDrag: 1.1,

      /* Ground. Blocks come to rest on the plane the igloo stands on rather
         than sailing off, so the frame stays composed however much you click. */
      groundY: radius * 0.045,
      bounce: 0.22,
      friction: 3.2,

      returnDelay: 7.0,
      returnFreq: 0.85,
      returnDamping: 1.0,

      ...config,
    };

    /* Structure-of-arrays. 74 blocks does not need it, but it keeps the
       per-frame loop free of property lookups and pointer chasing, and it is
       the shape this would have to be in anyway at ten times the count. */
    this.rest = new Float32Array(n * 3);
    this.outward = new Float32Array(n * 3);
    this.offset = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.rot = new Float32Array(n * 3);
    this.rotVel = new Float32Array(n * 3);
    this.push = new Float32Array(n); // 0..1, written by the interaction each frame
    this.glow = new Float32Array(n); // 0..1, drives the colour tint
    this.state = new Uint8Array(n);
    this.timer = new Float32Array(n);

    /*
     * Blocks that must not respond to anything.
     *
     * Set by the owner after construction; all-zero means every block is live,
     * so the standalone page is unaffected. This is enforced at the three
     * ENTRY POINTS rather than inside the integrator, which is the difference
     * between a block that cannot be disturbed and a block that is disturbed
     * and then has its motion suppressed — the second still accumulates
     * velocity, and releases it the moment the mask is lifted.
     */
    this.frozen = new Uint8Array(n);

    /* Axis-angle lean for each block, as a small rotation vector.
     *
     * The axis is horizontal and perpendicular to the block's own outward
     * normal, so leaning about it tips the block away from the wall rather
     * than spinning it in place. Stored as axis * angle because the rotation
     * is integrated as an XYZ Euler, and at these magnitudes the two agree.
     *
     * Crown blocks point very nearly straight up, where that cross product
     * collapses; they fall back to a fixed axis, and at a few degrees the
     * choice is not visible. */
    this.tilt = new Float32Array(n * 3);

    /*
     * The direction hover actually pushes a block, as distinct from outward.
     *
     * outward stays the truth for launch and nudge — a knocked block should
     * leave along its own normal. This is outward tilted toward the sky by
     * hoverLift, and it is precomputed because it is fixed per block and would
     * otherwise be renormalised for every block on every substep.
     */
    this.hoverDir = new Float32Array(n * 3);

    /* Seconds since construction, for the breath above. */
    this.time = 0;
    /*
     * A fixed offset into that breath per block, so neighbours are never in
     * step. Without it every lifted block rises and falls together and the
     * group reads as one object being jiggled rather than as a dozen of them
     * floating. Deterministic, so the scene looks the same on every load.
     */
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

      // cross(worldUp, outward), normalised
      let ax = -b.outward[2];
      let az = b.outward[0];
      const al = Math.hypot(ax, az);
      if (al < 1e-3) { ax = 1; az = 0; }
      else { ax /= al; az /= al; }
      this.tilt[i * 3] = ax * this.cfg.hoverTilt;
      this.tilt[i * 3 + 1] = 0;
      this.tilt[i * 3 + 2] = az * this.cfg.hoverTilt;

      // outward, leaned toward the sky
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

  /** How far this block currently sits from where it was built. */
  displacementOf(i) {
    return Math.hypot(this.offset[i * 3], this.offset[i * 3 + 1], this.offset[i * 3 + 2]);
  }

  isHome(i) {
    return this.state[i] === ATTACHED;
  }

  /**
   * Hover as a FIELD, centred on where the ray actually struck the shell.
   *
   * Takes a point in MODEL space — the same coordinates rest[] is in, so the
   * caller must convert. Falloff is quadratic in squared distance, which gives
   * a curve that leaves the centre almost flat and eases to exactly zero at the
   * reach rather than stopping on a value, so there is no boundary to see.
   *
   * Frozen blocks are skipped here as well as in applyHover: the ground course
   * must not lift even when the cursor is directly on it.
   */
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

  /** Set by the interaction every frame for the block under the cursor and,
   *  at a fraction, for its neighbours. Decays on its own if nothing sets it. */
  applyHover(i, amount) {
    if (this.frozen[i]) return;
    if (amount > this.push[i]) this.push[i] = amount;
  }

  /**
   * Knock a block out of the wall.
   *
   * The direction is the block's own outward normal blended with the vector
   * from the impact point to the block's centre, so a hit near one edge throws
   * it off at an angle while a hit dead centre pushes it straight out. Blending
   * rather than using the impact vector alone is what keeps a grazing hit from
   * driving a block *into* the dome.
   *
   * @param {number} i        block id
   * @param {THREE.Vector3} hit  world-space impact point
   * @param {number} strength 0..1, scales the impulse
   */
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

    const bias = 0.62; // toward the surface normal
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

  /** A softer shove that does not detach the block — used for neighbours of a
   *  launched block, so the shell shrugs rather than only one piece moving. */
  nudge(i, hit, strength) {
    if (this.frozen[i]) return;
    if (this.state[i] !== ATTACHED) return;
    const k = this.cfg.hoverPush * 26 * strength;
    this.vel[i * 3] += this.outward[i * 3] * k;
    this.vel[i * 3 + 1] += this.outward[i * 3 + 1] * k;
    this.vel[i * 3 + 2] += this.outward[i * 3 + 2] * k;
    this.glow[i] = Math.max(this.glow[i], strength * 0.7);
  }

  /** Send every displaced block home. */
  reset() {
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] !== ATTACHED) {
        this.state[i] = RETURNING;
        this.timer[i] = 0;
      }
    }
  }

  step(dt) {
    dt = Math.min(dt, MAX_DT);
    this.time += dt;
    const steps = Math.max(1, Math.ceil(dt / MAX_STEP));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) this._integrate(h);

    /* Hover pressure decays after integrating, so a block the pointer left
       this frame eases back instead of snapping. The interaction re-asserts it
       every frame while the cursor is still on the block. */
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

        /* Ground. Absolute height, not displacement, because a block from the
           crown starts 30 units up and one from the base starts at 1. */
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

      /* ATTACHED and RETURNING are both springs to rest; they differ in how
         fast and how hard, and in whether rotation is being unwound. */
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

      /* Rotation is the same spring as position, and it runs in BOTH states
         rather than only on the way home. Attached, it leans toward the tilt
         axis scaled by hover pressure; returning, toward zero. Sharing the
         spring is what keeps a block that is hovered, knocked and re-hovered
         from ever fighting two systems for its orientation. */
      const lean = returning ? 0 : this.push[i];
      for (let kk = 0; kk < 3; kk++) {
        const target = this.tilt[o + kk] * lean;
        this.rotVel[o + kk] += (-k * (this.rot[o + kk] - target) - d * this.rotVel[o + kk]) * h;
        this.rot[o + kk] += this.rotVel[o + kk] * h;
      }

      if (returning) {
        /* Settled: close enough to home that nothing more is visible. Snapping
           here rather than asymptoting forever is what lets the block go back
           to ATTACHED and respond to hover again. */
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

  /**
   * Push the current state into the BatchedMesh.
   *
   * Vertices were baked centroid-relative by the build script, so composing
   * rotation before translation rotates each block about its own centre —
   * which is what makes a tumbling block look like it is spinning rather than
   * orbiting the middle of the igloo.
   */
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
        /* A cool lift rather than a white one. Pushing past 1 lets the tone
           mapper roll it off, so the highlight reads as the block catching
           more light instead of as a flat colour swap. */
        col.setRGB(1 + g * 0.30, 1 + g * 0.38, 1 + g * 0.52);
        mesh.setColorAt(i, col);
      }
      this.colorsDirty = live;
    }
  }
}
