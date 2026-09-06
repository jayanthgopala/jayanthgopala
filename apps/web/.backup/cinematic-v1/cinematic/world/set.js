import {
  Group,
  Mesh,
  InstancedMesh,
  BoxGeometry,
  CircleGeometry,
  RingGeometry,
  PlaneGeometry,
  MeshStandardMaterial,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  BufferGeometry,
  BufferAttribute,
  Object3D,
  DoubleSide,
} from 'three';

/**
 * The set: a colonnade the figure walks down, and a lit aperture at the end of
 * it that never quite arrives.
 *
 * Everything is procedural, which is not a compromise — it is what lets the
 * whole world ship inside the JS bundle with no model to download, no texture
 * to decode and nothing that can 404. After the ink pass the difference between
 * this and hand-drawn artwork is far smaller than it has any right to be.
 *
 * TWO THINGS MOVE WITH THE WALK.
 *
 * The colonnade is a TREADMILL. The figure covers sixty metres, and building
 * sixty metres of hall would mean most of it off-screen most of the time. A
 * fixed ring of columns recycled behind the walker gives an endless hall for
 * the cost of twenty-eight instances, and because the spacing is regular
 * nobody can tell it is the same eight columns going past again.
 *
 * The aperture is kept AHEAD of them at a fixed distance, so it reads as the
 * thing they are walking toward rather than a landmark they pass and leave
 * behind. It is the only saturated element in the world and the reason the ink
 * pass bothers preserving chroma at all.
 */

const COLUMN_SPACING = 5;
const COLUMN_PAIRS = 14;
const COLUMN_X = 6.2;
/** The full length of the recycling loop. */
const LOOP = COLUMN_SPACING * COLUMN_PAIRS;

/**
 * The aperture is PINNED in world space, not held at a fixed distance ahead.
 *
 * It used to travel with the walker, which guaranteed it stayed in frame and
 * also meant it could never be reached: the figure walked toward a light that
 * retreated at exactly his own speed. Good metaphor, bad scene. Fixed, he
 * actually arrives, and the console stands underneath it.
 */
export const APERTURE_Z = -25;

export class Stage {
  constructor() {
    this.root = new Group();

    this.stone = new MeshStandardMaterial({
      // Mid-grey, not light. The columns are scenery: brighter than this and
      // they compete with the figure for the eye, which in a shot built on
      // silhouette is the one thing that cannot happen.
      color: 0x5e5e68,
      roughness: 0.95,
      metalness: 0,
    });

    this.floorMaterial = new MeshStandardMaterial({
      color: 0x3a3a44,
      roughness: 0.82,
      metalness: 0.05,
    });

    // Long enough to outrun the walk, so the floor never ends in mid-air.
    const floor = new Mesh(new PlaneGeometry(120, 260), this.floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.z = -100;
    this.root.add(floor);

    this.columns = this.buildColumns();
    this.root.add(this.columns);

    this.apertureGroup = new Group();
    this.root.add(this.apertureGroup);

    this.discMaterial = new MeshBasicMaterial({ color: 0x3fe0e8, side: DoubleSide });
    // Deliberately large. In the reference the circle is the dominant shape in
    // the frame, and a modest one reads as a light fitting rather than as the
    // destination.
    const disc = new Mesh(new CircleGeometry(6.6, 72), this.discMaterial);
    disc.position.set(0, 4, 0);
    this.apertureGroup.add(disc);

    // A heavy ring outside it. This is what stops the disc reading as a lens
    // flare and makes it read as an opening cut into the wall.
    this.ringMaterial = new MeshBasicMaterial({ color: 0xf4f4f6, side: DoubleSide });
    const ring = new Mesh(new RingGeometry(6.6, 7.25, 72), this.ringMaterial);
    ring.position.copy(disc.position);
    this.apertureGroup.add(ring);

    /*
     * The wall the aperture is cut into, in four pieces around the hole.
     *
     * The opening has to clear the disc on every side or the circle is squared
     * off into a rectangle — which is what the first pass did, and the result
     * read as a lit doorway rather than as the round aperture the whole
     * composition is built on. The disc spans x +/-6.6 and y -2.6 to 10.6, so
     * the inner edges below sit at +/-8, y=13 and y=-3.5 with room to spare.
     */
    const wallMaterial = this.stone;
    for (const [w, h, x, y] of [
      [64, 24, 0, 25],
      [64, 9, 0, -8],
      [24, 34, -20, 6],
      [24, 34, 20, 6],
    ]) {
      const piece = new Mesh(new PlaneGeometry(w, h), wallMaterial);
      piece.position.set(x, y, -0.4);
      this.apertureGroup.add(piece);
    }

    this.dust = this.buildDust();
    this.root.add(this.dust);
  }

  buildColumns() {
    /*
     * One InstancedMesh. The draw-call saving is secondary — the real reason is
     * that recycling positions means rewriting matrices every frame, and doing
     * that on twenty-eight separate meshes would mean twenty-eight world-matrix
     * updates instead of one buffer upload.
     */
    const geometry = new BoxGeometry(0.9, 13, 0.9);
    const mesh = new InstancedMesh(geometry, this.stone, COLUMN_PAIRS * 2);
    mesh.frustumCulled = false;
    this.dummy = new Object3D();
    return mesh;
  }

  buildDust() {
    /*
     * Motes earn their place here. In a scene made of large flat surfaces there
     * is nothing at close range for the eye to parallax against, and without
     * them a camera move reads as the world scaling rather than as travel.
     */
    const count = 500;
    const positions = new Float32Array(count * 3);

    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * 30;
      positions[i * 3 + 1] = Math.random() * 10;
      positions[i * 3 + 2] = -Math.random() * LOOP;
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));

    const points = new Points(
      geometry,
      new PointsMaterial({
        size: 0.045,
        color: 0xffffff,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        sizeAttenuation: true,
      })
    );
    points.frustumCulled = false;
    return points;
  }

  /**
   * Recycles the colonnade and moves the aperture, given how far the figure has
   * walked.
   *
   * The modulo is the whole trick: each column sits at a fixed offset within a
   * loop, and the loop slides with the walker. A column that falls behind
   * reappears at the far end in the same frame, and because the spacing is
   * uniform there is no moment where the recycle is visible.
   */
  setHorizon(travelled) {
    const base = -Math.floor(travelled / COLUMN_SPACING) * COLUMN_SPACING;
    const { dummy } = this;
    let i = 0;

    for (let pair = 0; pair < COLUMN_PAIRS; pair += 1) {
      // Two thirds of the loop ahead of the walker, one third behind — the
      // ones behind still matter, because they are what the Act V side track
      // and the Act VI receding shot look past.
      const z = base - pair * COLUMN_SPACING + LOOP / 3;

      for (const side of [-1, 1]) {
        dummy.position.set(side * COLUMN_X, 6.5, z);
        // Deterministic variation from the absolute position, not the instance
        // index — tied to the index, a column would change height every time it
        // recycled, which reads as flickering.
        const key = Math.abs(Math.round(z / COLUMN_SPACING)) % 7;
        dummy.scale.set(1, 1 + key / 26, 1);
        dummy.rotation.y = key * 0.06;
        dummy.updateMatrix();
        this.columns.setMatrixAt(i, dummy.matrix);
        i += 1;
      }
    }

    this.columns.instanceMatrix.needsUpdate = true;
    this.apertureGroup.position.z = APERTURE_Z;
    this.dust.position.z = base;
  }

  update(time) {
    // Rotating the whole cloud makes near motes move faster than far ones with
    // no per-particle work.
    this.dust.rotation.y = time * 0.01;
    this.dust.position.y = Math.sin(time * 0.12) * 0.4;
  }

  /** Recolours the aperture when the palette cuts. */
  setSignal(hex) {
    this.discMaterial.color.setHex(hex);
  }

  dispose() {
    this.root.traverse((child) => {
      if (child.isMesh || child.isPoints) child.geometry?.dispose();
    });
    this.stone.dispose();
    this.floorMaterial.dispose();
    this.discMaterial.dispose();
    this.ringMaterial.dispose();
    this.dust.material.dispose();
  }
}
