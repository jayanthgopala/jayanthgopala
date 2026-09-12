import * as THREE from 'three';

// Rates for hover activation and release easing
const HOVER_RISE = 11;
const HOVER_FALL = 0.9;
const MISS_GRACE = 0.09; // Grace period (seconds) before decay starts on raycast miss

// Raycasts pointer onto BatchedMesh blocks and routes forces to BlockPhysics
export class IglooInteraction {
  constructor({ dom, camera, mesh, blocks, physics, click = true, hoverCursor, touchHover = false }) {
    this.dom = dom;
    this.click = click;
    this.touchHover = touchHover;
    this.hoverCursor = hoverCursor || (click ? 'pointer' : 'crosshair');
    this.camera = camera;
    this.mesh = mesh;
    this.blocks = blocks;
    this.physics = physics;

    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this._local = new THREE.Vector3();
    this._lastHit = new THREE.Vector3();
    this._haveHit = false;
    this._missTime = 0;
    this.strength = 0; // Current smoothed hover intensity (0 to 1)
    this._sphere = new THREE.Sphere();

    // Smoothed parallax offset (-1 to 1) for camera motion
    this.parallax = new THREE.Vector2();
    this.parallaxTarget = new THREE.Vector2();

    this.hovered = -1;
    this.inside = false;
    this.hasPointer = false;
    this.touch = false;
    this.pressed = false;

    this._hits = [];
    this._onMove = this._onMove.bind(this);
    this._onDown = this._onDown.bind(this);
    this._onLeave = this._onLeave.bind(this);
    this._onUp = this._onUp.bind(this);

    dom.addEventListener('pointermove', this._onMove, { passive: true });
    if (click || touchHover) dom.addEventListener('pointerdown', this._onDown, { passive: true });
    if (touchHover) dom.addEventListener('pointerup', this._onUp, { passive: true });
    dom.addEventListener('pointerleave', this._onLeave, { passive: true });
    dom.addEventListener('pointercancel', this._onLeave, { passive: true });
  }

  dispose() {
    const { dom } = this;
    dom.removeEventListener('pointermove', this._onMove);
    dom.removeEventListener('pointerdown', this._onDown);
    dom.removeEventListener('pointerup', this._onUp);
    dom.removeEventListener('pointerleave', this._onLeave);
    dom.removeEventListener('pointercancel', this._onLeave);
    dom.style.cursor = '';
  }

  _track(e) {
    const r = this.dom.getBoundingClientRect();
    this.ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.parallaxTarget.set(this.ndc.x, this.ndc.y);
    this.inside = true;
    this.hasPointer = true;
    this.touch = e.pointerType === 'touch';
  }

  _onMove(e) {
    this._track(e);
  }

  _onLeave() {
    this.inside = false;
    this.pressed = false;
    this.parallaxTarget.set(0, 0);
    this.dom.style.cursor = '';
  }

  _onUp(e) {
    if (e.pointerType === 'touch') this._onLeave();
  }

  _onDown(e) {
    if (this.touchHover && e.pointerType === 'touch') {
      this._track(e);
      this.pressed = true;
    }
    if (!this.click) return;
    this._track(e);
    const hit = this._cast();
    if (hit) this._strike(hit);
  }

  // Cached bounding sphere in world space for broadphase raycast rejection
  _bounds() {
    const { mesh } = this;
    if (!mesh.boundingSphere) mesh.computeBoundingSphere();
    if (!mesh.boundingSphere) return null;
    this._sphere.copy(mesh.boundingSphere).applyMatrix4(mesh.matrixWorld);
    this._sphere.radius *= 1.35;
    return this._sphere;
  }

  // Raycasts against the igloo mesh with bounding sphere early-out
  _cast() {
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const bounds = this._bounds();
    if (bounds && !this.raycaster.ray.intersectsSphere(bounds)) return null;

    this._hits.length = 0;
    this.raycaster.intersectObject(this.mesh, false, this._hits);
    const h = this._hits[0];
    return h && h.batchId !== undefined ? h : null;
  }

  // Handles click/tap impact on a specific block
  _strike(hit) {
    const id = hit.batchId;
    const block = this.blocks[id];
    if (!block) return;

    // Convert world hit position into mesh local space
    const local = this._local.copy(hit.point);
    this.mesh.worldToLocal(local);

    this.physics.launch(id, local, 1);

    // Apply falloff impulse to adjacent blocks
    const { neighbourFalloff } = this.physics.cfg;
    block.neighbours.forEach((nid, rank) => {
      this.physics.nudge(nid, local, neighbourFalloff / (1 + rank * 0.5));
    });
  }

  // Updates hover intensity and passes forces to physics each frame
  update(dt) {
    const k = 1 - Math.exp(-3.2 * dt);
    this.parallax.x += (this.parallaxTarget.x - this.parallax.x) * k;
    this.parallax.y += (this.parallaxTarget.y - this.parallax.y) * k;

    const looking = this.hasPointer && this.inside && (!this.touch || this.pressed);
    const hit = looking ? this._cast() : null;
    const id = hit ? hit.batchId : -1;

    if (hit) {
      this._lastHit.copy(hit.point);
      this.mesh.worldToLocal(this._lastHit);
      this._haveHit = true;
      this._missTime = 0;
      this.strength += (1 - this.strength) * (1 - Math.exp(-HOVER_RISE * dt));
    } else {
      this._missTime += dt;
      if (this._missTime > MISS_GRACE) {
        this.strength += (0 - this.strength) * (1 - Math.exp(-HOVER_FALL * dt));
        if (this.strength < 0.002) {
          this.strength = 0;
          this._haveHit = false;
        }
      }
    }

    if (id !== this.hovered) this.hovered = id;
    const want = this.strength > 0.2 ? this.hoverCursor : '';
    if (this.dom.style.cursor !== want) this.dom.style.cursor = want;

    if (!this._haveHit || this.strength <= 0) return;

    // Apply continuous radial hover field around the hit point
    if (this.physics.cfg.hoverReach > 0) {
      this.physics.hoverField(this._lastHit, this.strength);
      return;
    }

    if (id === -1) return;
    const block = this.blocks[id];
    this.physics.applyHover(id, this.strength);
    this.physics.glow[id] = Math.max(this.physics.glow[id], this.strength);
    this.physics.colorsDirty = true;

    const { neighbourFalloff } = this.physics.cfg;
    block.neighbours.forEach((nid, rank) => {
      const amount = (neighbourFalloff / (1 + rank * 0.6)) * this.strength;
      this.physics.applyHover(nid, amount);
      this.physics.glow[nid] = Math.max(this.physics.glow[nid], amount * 0.55);
    });
  }
}
