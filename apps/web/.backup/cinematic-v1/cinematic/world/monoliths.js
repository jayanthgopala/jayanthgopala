import {
  Group,
  Mesh,
  PlaneGeometry,
  BoxGeometry,
  MeshStandardMaterial,
  MeshBasicMaterial,
  TextureLoader,
  SRGBColorSpace,
  DoubleSide,
  MathUtils,
  Raycaster,
  Vector2,
} from 'three';

/**
 * The console: a table under the aperture, with the work running across it like
 * a display.
 *
 * This replaced a ring of slabs orbiting the figure. The ring surrounded him,
 * which sounded right and played badly: with the projects circling behind the
 * camera half the time, the thing you were meant to be reading was off-screen
 * as often as not, and the character had nothing to *do*. Walking up to a table
 * and looking down at it gives the scene a destination and the figure an
 * action, and it keeps every project in the same, framed, readable place.
 *
 * The display is one rail of screens sliding horizontally. Scroll advances the
 * rail; the screen at the centre is the one the DOM card is describing. That is
 * the same mechanism a carousel uses, which is exactly right — this is meant to
 * read as a screen someone is paging through, not as a gallery.
 *
 * Everything is driven by a single 0..1 from scroll, so it scrubs backwards as
 * cleanly as it plays forward. Nothing here is a triggered animation.
 *
 * SCREENSHOTS ARE OPTIONAL AND SO IS THE NETWORK. A screen with no texture is
 * still a lit panel; one whose image fails to load leaves the panel standing
 * rather than a hole in the rail.
 */

/** Screen size and spacing along the rail, in metres. */
const SCREEN_W = 3.05;
const SCREEN_H = 1.9;
const PITCH = 3.5;

export class Monoliths {
  constructor() {
    this.root = new Group();

    this.items = [];
    this.progress = 0;
    this.focus = -1;
    this.hover = -1;
    this.slide = 0;

    this.raycaster = new Raycaster();
    this.pointerNdc = new Vector2(2, 2); // off-screen until the pointer moves

    this.loader = new TextureLoader();
    // The media endpoint is a different origin in production, and a texture
    // from a tainted image cannot be uploaded to the GPU.
    this.loader.crossOrigin = 'anonymous';

    this.metal = new MeshStandardMaterial({
      color: 0x8f9199,
      roughness: 0.6,
      metalness: 0.25,
    });

    this.signalMaterial = new MeshBasicMaterial({ color: 0x2f7dff, side: DoubleSide });

    this.blankMaterial = new MeshStandardMaterial({
      color: 0xb4b6bc,
      roughness: 0.75,
      metalness: 0,
      side: DoubleSide,
    });

    this.buildTable();
  }

  buildTable() {
    const table = new Group();

    // The top, tilted back so the screens face the camera rather than the
    // ceiling. A flat console reads as a plinth from every angle the sequence
    // actually uses.
    const top = new Mesh(new BoxGeometry(11.5, 0.16, 3.4), this.metal);
    top.position.set(0, 1.02, 0);
    table.add(top);

    // A blue strip along the leading edge — the only saturated element on the
    // furniture, tying it to the aperture behind it.
    const lip = new Mesh(new PlaneGeometry(11.5, 0.07), this.signalMaterial);
    lip.position.set(0, 1.02, 1.72);
    table.add(lip);

    for (const x of [-4.9, 0, 4.9]) {
      const leg = new Mesh(new BoxGeometry(0.3, 1.02, 0.3), this.metal);
      leg.position.set(x, 0.51, 0);
      table.add(leg);
    }

    /*
     * The rail carries the screens. Tilting it here rather than tilting each
     * screen means the slide stays a single axis translation — tilt applied
     * per-screen would make every position a rotated offset and the rail would
     * drift off the table as it moved.
     */
    this.rail = new Group();
    this.rail.position.set(0, 1.72, -0.15);
    this.rail.rotation.x = -0.32;
    table.add(this.rail);

    this.table = table;
    this.root.add(table);
  }

  /**
   * Builds one screen per project. Safe to call again — a second call replaces
   * the rail rather than stacking a new one behind it.
   */
  setProjects(projects, screenshotUrl) {
    this.clear();
    if (projects.length === 0) return;

    projects.forEach((project, index) => {
      const group = new Group();

      const bezel = new Mesh(
        new BoxGeometry(SCREEN_W + 0.18, SCREEN_H + 0.18, 0.1),
        this.metal
      );
      group.add(bezel);

      const panel = new Mesh(new PlaneGeometry(SCREEN_W, SCREEN_H), this.blankMaterial);
      panel.position.z = 0.07;
      // Only the panel is raycast against. Hit-testing the bezel would make the
      // border a click target, which is not what anyone is aiming at.
      panel.userData.projectIndex = index;
      group.add(panel);

      const url = screenshotUrl(project);
      if (url) {
        this.loader.load(
          url,
          (texture) => {
            texture.colorSpace = SRGBColorSpace;
            texture.anisotropy = 4;
            // MeshBasic, not Standard: a screenshot is emissive artwork, not a
            // lit surface. Running it through the scene's lighting would push
            // it down the same ramp as the metal and it would stop reading as
            // a screen.
            panel.material = new MeshBasicMaterial({ map: texture, side: DoubleSide });
          },
          undefined,
          () => {
            // Left blank on purpose — a missing screenshot is a content gap,
            // and an empty panel is a better answer than a missing screen.
          }
        );
      }

      group.position.x = index * PITCH;
      this.items.push({ group, panel, index, hoverAmount: 0 });
      this.rail.add(group);
    });
  }

  /** 0..1 through the projects act. Drives the rail and the power-on. */
  setProgress(value) {
    this.progress = MathUtils.clamp(value, 0, 1);
  }

  setFocus(index) {
    this.focus = index;
  }

  /** Pointer in normalised device coordinates, for hit-testing. */
  setPointer(x, y) {
    this.pointerNdc.set(x, -y);
  }

  /** Which screen the pointer is over, or -1. */
  pick(camera) {
    if (this.items.length === 0 || this.progress < 0.02) return -1;

    this.raycaster.setFromCamera(this.pointerNdc, camera);
    const hits = this.raycaster.intersectObjects(
      this.items.map((item) => item.panel),
      false
    );

    return hits.length > 0 ? hits[0].object.userData.projectIndex : -1;
  }

  update(time, camera) {
    const count = this.items.length;
    if (count === 0) return;

    this.hover = this.pick(camera);

    /*
     * The rail slides so the focused screen sits at the centre of the table.
     * Eased rather than snapped, and eased quite slowly — this is the motion
     * the eye follows through the whole act, and anything faster than about
     * this reads as a UI transition rather than as a machine moving.
     */
    const target = -(this.focus >= 0 ? this.focus : 0) * PITCH;
    this.slide = MathUtils.lerp(this.slide, target, 0.045);
    this.rail.position.x = this.slide;

    // The console powers up as the act opens: screens rise into place rather
    // than being there from the first frame.
    const power = MathUtils.clamp(this.progress / 0.12, 0, 1);
    const eased = 1 - (1 - power) ** 3;

    for (const item of this.items) {
      const { group, index } = item;
      const hovered = index === this.hover;

      // Hover eases, or the rail flickers as the pointer crosses the gap
      // between two screens.
      item.hoverAmount = MathUtils.lerp(item.hoverAmount, hovered ? 1 : 0, 0.12);

      const focused = index === this.focus;
      const lift = focused ? 0.22 : 0;

      group.position.y = MathUtils.lerp(
        group.position.y,
        (eased - 1) * 1.6 + lift + item.hoverAmount * 0.1,
        0.08
      );

      // Off-centre screens turn away slightly, so the rail reads as curved and
      // the centre one is unambiguously the subject.
      const offset = index * PITCH + this.slide;
      const turn = MathUtils.clamp(offset * -0.09, -0.5, 0.5);
      group.rotation.y = MathUtils.lerp(group.rotation.y, turn, 0.08);

      const scale = eased * (1 + item.hoverAmount * 0.04 + (focused ? 0.05 : 0));
      group.scale.setScalar(MathUtils.lerp(group.scale.x, Math.max(0.001, scale), 0.1));
    }
  }

  /** Recolours the trim when the palette changes. */
  setSignal(hex) {
    this.signalMaterial.color.setHex(hex);
  }

  clear() {
    for (const item of this.items) {
      item.group.traverse((child) => {
        if (!child.isMesh) return;
        child.geometry?.dispose();
        if (child.material?.map) child.material.map.dispose();
      });
      this.rail.remove(item.group);
    }
    this.items = [];
    this.slide = 0;
  }

  dispose() {
    this.clear();
    this.metal.dispose();
    this.signalMaterial.dispose();
    this.blankMaterial.dispose();
    this.table.traverse((child) => {
      if (child.isMesh) child.geometry?.dispose();
    });
  }
}
