import * as THREE from 'three';

/**
 * Pointer -> raycaster -> BatchedMesh -> batchId -> block -> physics.
 *
 * POINTER EVENTS THROUGHOUT, not mouse events. One code path covers mouse,
 * touch and pen; `pointerdown` fires on a tap without the 300 ms delay or the
 * synthetic-mouse-event duplication that touch handlers bring, and
 * `pointerType` is there when the two genuinely need to differ — which, here,
 * is only that a finger has no hover state to give.
 *
 * RAYCASTING HAPPENS ONCE PER FRAME, NOT ONCE PER EVENT. A moving pointer
 * emits events considerably faster than the display refreshes (coalesced moves
 * on a 120 Hz digitiser arrive in bursts), and casting on each one does the
 * same work several times for a single rendered frame. The handler stores
 * where the pointer is; `update()` asks what is under it. That also keeps the
 * cast correct while the blocks are moving and the pointer is still.
 */

/*
 * HOW FAST THE HOVER TAKES HOLD, AND HOW SLOWLY IT LETS GO.
 *
 * Deliberately very different numbers, and the asymmetry is the whole fix for
 * the flicker. A ray cast at a dome made of separate blocks MISSES constantly:
 * between two blocks, through an opened joint, along the silhouette. Each of
 * those frames used to apply nothing at all, so the pressure collapsed and the
 * shell slammed shut, and the next frame — which hit again — threw it straight
 * back open. At sixty frames a second that is a rattle, not a hover.
 *
 * Ramping instead of switching means a one-frame miss costs about three per
 * cent of the strength and is invisible, while genuinely leaving the igloo
 * still fades all the way out. Rise is quick enough to feel immediate.
 *
 * FALL IS DOWN FROM 2.0, which released in about a second and a half and still
 * read as the shell being let go of rather than settling. These blocks weigh
 * something — they are half a metre of ice in the fiction — and the slowest
 * thing in the interaction should be them coming to rest. At 0.9 the dome
 * takes three and a half seconds to close, so the cursor can leave and the
 * movement it caused outlives it, which is what makes the shell feel heavy
 * rather than sprung.
 *
 * Only the release changed. Rise is untouched, so it still takes hold the
 * instant the cursor arrives — the asymmetry is the point, and widening it
 * makes the object read as heavier without making it feel unresponsive.
 */
const HOVER_RISE = 11;
const HOVER_FALL = 0.9;
/*
 * How long the ray may miss before the hover starts letting go at all.
 *
 * Easing down instead of switching off already made a dropped frame cheap, but
 * not free: at HOVER_FALL it still cost about three per cent, and the misses
 * that matter come in bursts as the cursor tracks along a joint. Refusing to
 * decay for the first ninety milliseconds makes an isolated miss cost exactly
 * nothing, while a cursor that has genuinely left the igloo starts fading
 * within a couple of frames of the eye noticing.
 *
 * It is a deadband, not a delay: a real departure is not slowed down by it,
 * because the fade that follows is a second and a half long anyway.
 */
const MISS_GRACE = 0.09;

export class IglooInteraction {
  /**
   * @param {object}  opts
   * @param {boolean} [opts.click=true]
   *   Whether a press knocks a block loose. The standalone page wants it; the
   *   world does not — there the igloo answers the cursor and nothing else, so
   *   the pointerdown listener is never attached rather than being attached
   *   and then ignored. Physics.launch() is untouched either way, so this is a
   *   wiring switch and not a removal.
   * @param {string}  [opts.hoverCursor]
   *   Defaults to 'pointer' when clicking is on and 'crosshair' when it is
   *   off, because a pointer cursor over something that cannot be pressed is a
   *   promise the page does not keep.
   * @param {boolean} [opts.touchHover=false]
   *   Whether a finger held on the screen stands in for the hover a mouse
   *   gives. Off by default, which is the standalone page's behaviour: there a
   *   tap knocks a block and that is all a finger does. The world turns it on,
   *   because with clicking off a touchscreen would otherwise get no answer
   *   from the igloo at all.
   */
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
    /* Scratch for the world -> model conversion in _strike. */
    this._local = new THREE.Vector3();
    /*
     * The last place the ray actually landed, in model space, and how much of
     * the hover is currently applied. Kept across misses so the field has
     * somewhere to stay while the cursor crosses a joint.
     */
    this._lastHit = new THREE.Vector3();
    this._haveHit = false;
    /** Seconds the ray has been missing without a break. */
    this._missTime = 0;
    /** 0..1, eased. Read by the world rig to decide when to show its readout. */
    this.strength = 0;
    /* Padded world-space bounds, for the cheap reject in _cast. */
    this._sphere = new THREE.Sphere();
    /* Smoothed, -1..1, for the camera parallax. Kept here because it is the
       same pointer; the camera decides what to do with it. */
    this.parallax = new THREE.Vector2();
    this.parallaxTarget = new THREE.Vector2();

    this.hovered = -1;
    this.inside = false;
    this.hasPointer = false;
    this.touch = false;
    /** A finger is currently down — only tracked with touchHover. */
    this.pressed = false;

    this._hits = [];
    this._onMove = this._onMove.bind(this);
    this._onDown = this._onDown.bind(this);
    this._onLeave = this._onLeave.bind(this);
    this._onUp = this._onUp.bind(this);

    dom.addEventListener('pointermove', this._onMove, { passive: true });
    /* Passive either way, so a press is never swallowed or prevented — with
       clicking off, a mouse press still passes straight through. */
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
    /* Recentre the parallax when the pointer leaves, or the camera stays
       leaning at whatever angle it was abandoned at. */
    this.parallaxTarget.set(0, 0);
    this.dom.style.cursor = '';
  }

  /* A finger lifting is the touch version of the cursor leaving. A vertical
     swipe arrives as pointercancel instead — the browser takes it for scrolling
     — and that already routes to _onLeave. */
  _onUp(e) {
    if (e.pointerType === 'touch') this._onLeave();
  }

  _onDown(e) {
    /* With touchHover, a finger put down is the hover starting: from here
       until it lifts, update() casts under it exactly as it would under a
       cursor, and a sideways drag carries the disturbance along with it. */
    if (this.touchHover && e.pointerType === 'touch') {
      this._track(e);
      this.pressed = true;
    }
    if (!this.click) return;
    this._track(e);
    /* Cast immediately rather than waiting for the next frame: on a tap the
       pointer arrives and the finger lifts inside a frame or two, and hitting
       the block the user actually touched matters more than the saved cast. */
    const hit = this._cast();
    if (hit) this._strike(hit);
  }

  /**
   * The igloo's bounds in world space, padded.
   *
   * Recomputed only when the mesh has none. The shell is static at rest and a
   * knocked block travels a few units at most, so a padded sphere built once
   * stays a correct conservative bound for the whole session — which is the
   * point, since recomputing it per frame would cost more than the cast it is
   * there to avoid.
   */
  _bounds() {
    const { mesh } = this;
    if (!mesh.boundingSphere) mesh.computeBoundingSphere();
    if (!mesh.boundingSphere) return null;
    this._sphere.copy(mesh.boundingSphere).applyMatrix4(mesh.matrixWorld);
    this._sphere.radius *= 1.35; // room for blocks that are currently out
    return this._sphere;
  }

  _cast() {
    this.raycaster.setFromCamera(this.ndc, this.camera);

    /*
     * A RAY-VERSUS-SPHERE REJECT BEFORE THE REAL CAST, and it matters far more
     * here than it did on the standalone page.
     *
     * There, the igloo filled a canvas that was the whole point of the page.
     * In the world the canvas is the entire viewport and the dome occupies a
     * fraction of it, while update() still casts every frame the pointer is
     * inside the canvas — which is essentially always. Without this, every
     * frame pays for per-block bounds tests and triangle intersections against
     * 74 blocks to discover the cursor is out over the mountains.
     *
     * A few multiplies answers that instead, and the full cast only runs when
     * the ray actually enters the dome's neighbourhood.
     */
    const bounds = this._bounds();
    if (bounds && !this.raycaster.ray.intersectsSphere(bounds)) return null;

    this._hits.length = 0;
    this.raycaster.intersectObject(this.mesh, false, this._hits);
    /* intersectObject returns hits sorted near-to-far, so the first is the
       block whose front face the ray reached first. batchId is BatchedMesh's
       equivalent of instanceId. */
    const h = this._hits[0];
    return h && h.batchId !== undefined ? h : null;
  }

  _strike(hit) {
    const id = hit.batchId;
    const block = this.blocks[id];
    if (!block) return;

    /*
     * THE IMPACT POINT HAS TO BE IN THE MODEL'S OWN COORDINATES.
     *
     * A raycast reports where it hit in WORLD space, and the physics stores
     * every block's rest position in the coordinates the model was baked in.
     * On the standalone page the mesh sits at the origin unrotated, so the two
     * are the same and the distinction never showed. Inside the world the
     * igloo is translated onto the terrain and yawed, and feeding a world
     * point straight in makes "away from the impact" point off toward the
     * scene origin instead — every block leaves in the same wrong direction,
     * regardless of where it was clicked.
     */
    const local = this._local.copy(hit.point);
    this.mesh.worldToLocal(local);

    this.physics.launch(id, local, 1);

    /* The neighbours shrug. Falloff by list order rather than by distance: the
       list is already sorted nearest-first, and an index-based falloff gives
       an even response whether the block sits in the wide base course or the
       tight crown. */
    const { neighbourFalloff } = this.physics.cfg;
    block.neighbours.forEach((nid, rank) => {
      this.physics.nudge(nid, local, neighbourFalloff / (1 + rank * 0.5));
    });
  }

  /** Called once per frame, before the physics step. */
  update(dt) {
    /* Ease the parallax rather than following the pointer exactly. The lag is
       the effect: an instantaneous camera reads as a jitter, a trailing one
       reads as weight. Frame-rate independent, so it feels the same at 30 and
       144 fps. */
    const k = 1 - Math.exp(-3.2 * dt);
    this.parallax.x += (this.parallaxTarget.x - this.parallax.x) * k;
    this.parallax.y += (this.parallaxTarget.y - this.parallax.y) * k;

    /*
     * A finger has no hover: on touch the only interaction is the tap, which
     * pointerdown already handled. Casting anyway would leave the last-touched
     * block lit up permanently after the finger lifts. Same for a pointer that
     * has left the canvas — in both cases we stop casting but keep easing, so
     * the shell closes gradually instead of dropping.
     *
     * With touchHover a finger that is still DOWN is the exception: it is a
     * hover for as long as it stays there, and lifting it hands the shell to
     * the same slow release a departing cursor gets.
     */
    const looking = this.hasPointer && this.inside && (!this.touch || this.pressed);
    const hit = looking ? this._cast() : null;
    const id = hit ? hit.batchId : -1;

    if (hit) {
      /* Model space, because that is what rest[] is in — see _strike. */
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
    /*
     * The cursor follows the eased strength, not the raw hit. Keying it on the
     * cast made it blink between pointer and default on every missed frame,
     * which is the same flicker in a different channel.
     */
    const want = this.strength > 0.2 ? this.hoverCursor : '';
    if (this.dom.style.cursor !== want) this.dom.style.cursor = want;

    if (!this._haveHit || this.strength <= 0) return;

    /*
     * A DISC AROUND THE IMPACT POINT, not a block and its neighbour list.
     *
     * The list version disturbs exactly seven blocks, chosen by centroid
     * proximity and ranked, which has two visible faults against the
     * reference: the response is the same size wherever on a block you point,
     * because it is keyed to the block rather than to the hit; and it stops
     * dead at the seventh, so the disturbed patch has a border.
     *
     * A field keyed on the actual intersection has neither. Pointing at the
     * edge of a block spreads the response into whatever is on that side, and
     * it fades out instead of ending. The block under the cursor still gets
     * very nearly full strength, because it is the nearest thing to the point
     * the ray hit it at.
     *
     * batchId is still what tells us the pointer is ON the igloo at all, and
     * still what sets the cursor.
     */
    if (this.physics.cfg.hoverReach > 0) {
      /* _lastHit, not the current hit: on a missed frame there is no current
         one, and holding the last is exactly what stops the shell slamming. */
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
