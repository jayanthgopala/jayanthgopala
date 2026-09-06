import {
  Group,
  Mesh,
  MeshStandardMaterial,
  LatheGeometry,
  SphereGeometry,
  CapsuleGeometry,
  Vector2,
  MathUtils,
  AnimationMixer,
  LoopRepeat,
  Box3,
} from 'three';

/**
 * The figure — the thing that actually moves.
 *
 * Two implementations behind one interface, and the site is finished either
 * way:
 *
 *   ROBED SILHOUETTE (default). Built here from a lathe and a sphere. This is
 *   not a placeholder waiting for a real model. A cloaked figure read purely as
 *   silhouette is the single most reliable shot in this whole visual language —
 *   it has no texture to look cheap, no likeness to fall into the uncanny
 *   valley, and it reads at any size. It costs about 200 vertices.
 *
 *   RIGGED AVATAR (optional). Set the cine.avatarUrl copy field to a .glb — a
 *   Ready Player Me export is the two-minute path — and it is loaded instead,
 *   with any animation clips it carries driven by an AnimationMixer. GLTFLoader
 *   is dynamically imported, so nobody without an avatar pays for it.
 *
 * Both expose the same three controls: update, lookAt for the pointer, and walk
 * for the exit in the final act.
 */

/**
 * Profile of the robe as (radius, height) pairs from the floor to the neck.
 *
 * The flare matters more than it looks. A straight column reads as a bollard;
 * it is the widening skirt against narrow shoulders that makes a viewer see a
 * person at a hundred metres of virtual distance.
 */
const ROBE_PROFILE = [
  [0.0, 0.0],
  [0.54, 0.0],
  [0.52, 0.06],
  [0.44, 0.3],
  [0.37, 0.62],
  [0.33, 0.92],
  [0.31, 1.14],
  [0.33, 1.3],
  [0.27, 1.4],
  [0.15, 1.46],
  [0.11, 1.5],
];

function robeGeometry() {
  const geometry = new LatheGeometry(
    ROBE_PROFILE.map(([r, y]) => new Vector2(r, y)),
    44
  );

  /*
   * Break the symmetry.
   *
   * A perfect solid of revolution is unmistakably a vase. Pushing each ring
   * off-axis by a small amount that varies with height gives the cloth a hang
   * and a drape, and the silhouette stops being a bell curve.
   *
   * Baked into the geometry once rather than done in a vertex shader, because
   * it never changes — and baking it keeps the material an ordinary
   * MeshStandardMaterial that the scene's lighting simply works on.
   */
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    // Falls off toward the neck so the shoulders stay clean.
    const weight = Math.max(0, 1 - y / 1.5) ** 1.4;
    const theta = Math.atan2(z, x);
    const fold =
      Math.sin(theta * 5 + y * 2.1) * 0.028 + Math.sin(theta * 9 - y * 1.3) * 0.014;
    const lean = Math.sin(y * 1.9) * 0.03;
    const scale = 1 + fold * weight;

    pos.setX(i, x * scale + lean * weight);
    pos.setZ(i, z * scale);
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function buildSilhouette(material) {
  const group = new Group();

  group.add(new Mesh(robeGeometry(), material));

  // Slightly prolate. A plain sphere reads as a ball, and the vertical stretch
  // is the whole difference between a figure and a snowman.
  const head = new Mesh(new SphereGeometry(0.125, 24, 18), material);
  head.position.set(0, 1.6, 0);
  head.scale.set(1, 1.2, 0.96);
  group.add(head);

  // Shoulders. They do almost nothing head-on and everything in the Act V side
  // track, where an unbroken lathe suddenly looks like a traffic cone.
  const shoulder = new CapsuleGeometry(0.075, 0.2, 4, 10);
  for (const side of [-1, 1]) {
    const mesh = new Mesh(shoulder, material);
    mesh.position.set(side * 0.16, 1.4, 0);
    mesh.rotation.z = side * 0.95;
    group.add(mesh);
  }

  return { group, head };
}

export class Figure {
  constructor() {
    this.root = new Group();

    this.material = new MeshStandardMaterial({
      /*
       * Almost no albedo. The hall is deliberately flooded with light, and the
       * only reason the figure stays black under it is that it reflects about
       * four percent of what lands on it. Raise this and the silhouette turns
       * grey; drop it to pure #000 and the contour light has nothing to catch.
       */
      color: 0x050608,
      roughness: 0.96,
      metalness: 0,
    });

    const { group, head } = buildSilhouette(this.material);
    this.body = group;
    this.head = head;
    this.root.add(group);

    this.mixer = null;
    this.look = { x: 0, y: 0 };
    this.target = { x: 0, y: 0 };
    this.distance = 0;
    this.attention = 0;
    this.attentionEased = 0;

    /*
     * Faces -Z, which is the direction of travel — so the opening act, where
     * the camera sits behind them, is a back view of someone walking away.
     * That shot is the single most recognisable image in this whole visual
     * language, and it only exists if the figure is oriented before anything
     * else touches it.
     */
    this.root.rotation.y = Math.PI;
  }

  /**
   * Swap the silhouette for a rigged avatar.
   *
   * Resolves false rather than rejecting on any failure. A missing or malformed
   * .glb is a content problem, and it has to leave a working scene behind
   * rather than a hole where the figure was.
   */
  async loadAvatar(url) {
    if (!url) return false;

    try {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader().loadAsync(url);
      const model = gltf.scene;

      /*
       * Normalise the import. Avatar exporters disagree about units and about
       * where the origin sits, and a rig that arrives a hundred times too large
       * is indistinguishable from a broken scene. Measuring it and fitting it
       * to the silhouette's height makes any source usable.
       */
      const box = new Box3().setFromObject(model);
      const height = box.max.y - box.min.y;
      if (height > 0) {
        const scale = 1.72 / height;
        model.scale.setScalar(scale);
        model.position.y = -box.min.y * scale;
      }

      model.traverse((child) => {
        if (!child.isMesh) return;
        // The ink pass reduces everything to luminance, so a textured avatar
        // mostly contributes noise. Overriding to the silhouette's material
        // keeps it in the same visual language as the rest of the set, and
        // means it still reads under Act I's extreme backlight.
        child.material = this.material;
      });

      this.root.remove(this.body);
      this.body = model;
      this.root.add(model);

      // Head bone for the pointer look-at, by the glTF humanoid naming that
      // Ready Player Me and Mixamo both follow.
      this.head =
        model.getObjectByName('Head') || model.getObjectByName('mixamorigHead') || null;

      if (gltf.animations?.length) {
        this.mixer = new AnimationMixer(model);
        const action = this.mixer.clipAction(gltf.animations[0]);
        action.setLoop(LoopRepeat, Infinity);
        action.play();
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * 0..1 - how much he is attending to something in front of him rather than
   * walking. Tips the head and leans the body in.
   */
  setAttention(value) {
    this.attention = value;
  }

  /** Pointer position, both -1..1. Drives the head, and only the head. */
  lookAt(x, y) {
    this.target.x = x;
    this.target.y = y;
  }

  /**
   * How far down the hall they have walked, in metres.
   *
   * A distance rather than a normalised progress, and set from scroll rather
   * than integrated over time, so scrolling back walks back. An animation
   * played forward on a trigger would desync the moment anyone scrolled up —
   * and this is the element the eye is locked onto.
   */
  setDistance(metres) {
    this.distance = metres;
  }

  update(time, delta) {
    if (this.mixer) this.mixer.update(delta);

    // Ease toward the pointer rather than tracking it. A head that snaps to the
    // cursor reads as a security camera; one that follows a beat late reads as
    // attention.
    this.look.x = MathUtils.lerp(this.look.x, this.target.x, 0.045);
    this.look.y = MathUtils.lerp(this.look.y, this.target.y, 0.045);

    if (this.head) {
      this.head.rotation.y = this.look.x * 0.42 * (1 - this.attentionEased);
      // Tips down toward the table as he arrives at it.
      this.head.rotation.x = -this.look.y * 0.2 + this.attentionEased * 0.42;
    }

    this.root.position.z = -this.distance;

    /*
     * The gait.
     *
     * Phase comes from DISTANCE, not from elapsed time. That is what couples
     * the walk to the scroll: stop scrolling and they stop mid-stride, scroll
     * back and the stride reverses. Driving it from a clock would leave the
     * figure marching on the spot whenever the page was still, which reads
     * instantly as a looping animation playing behind a website.
     *
     * 0.78 metres per step is roughly a real stride length, so the cadence
     * matches the speed the world is going past.
     */
    const step = this.distance / 0.82;

    /*
     * Amplitudes deliberately small, and faded out when he stops.
     *
     * The first pass ran the bob at 0.045 and the roll at 0.035, which on a
     * robed silhouette reads as a limp rather than a stride: there are no legs
     * to carry the motion, so anything the eye can clearly see becomes a
     * wobble of the whole shape. Holding a stride cycle on a figure that is
     * standing still was the other half of why the walk looked broken.
     */
    this.attentionEased = MathUtils.lerp(this.attentionEased, this.attention, 0.05);
    const moving = 1 - this.attentionEased;

    const bob = Math.abs(Math.sin(step * Math.PI)) * 0.022 * moving;
    const roll = Math.sin(step * Math.PI) * 0.016 * moving;
    const swing = Math.sin(step * Math.PI * 2) * 0.009 * moving;

    // A slow idle drift on top, so a figure held still by a stationary scroll
    // is still breathing rather than frozen.
    const idle = Math.sin(time * 0.34) * 0.03 + Math.sin(time * 0.11) * 0.02;

    this.root.position.y = bob;
    this.root.rotation.y = Math.PI + roll + idle + this.look.x * 0.1;
    // A slight lean in toward whatever he is looking at.
    this.root.rotation.x = this.attentionEased * 0.07;
    this.root.rotation.z = swing;
  }

  dispose() {
    this.material.dispose();
    this.root.traverse((child) => {
      if (child.isMesh) child.geometry?.dispose();
    });
  }
}
