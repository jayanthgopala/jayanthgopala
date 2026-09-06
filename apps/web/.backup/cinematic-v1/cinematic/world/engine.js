import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  Color,
  FogExp2,
  DirectionalLight,
  HemisphereLight,
  PointLight,
  Group,
  Vector3,
  MathUtils,
} from 'three';
import { ACTS, PALETTE, FOCUS_ACT, LEAD_IN, RUN_OUT } from './acts.js';
import { Figure } from './figure.js';
import { Stage, APERTURE_Z } from './set.js';
import { Monoliths } from './monoliths.js';
import { InkPass } from './ink.js';

/**
 * One scene, one camera, one render loop, driven entirely by scroll position.
 *
 * THE FIGURE WALKS AND THE CAMERA FOLLOWS. Scroll position maps to distance
 * travelled down the hall, and every camera keyframe is an offset from wherever
 * the figure currently is. That is the difference between a scene with a model
 * in it and a story: a static subject with a camera orbiting it always reads as
 * a turntable, because the world never goes anywhere.
 *
 * The camera rig is a Group parented at the figure's position, so following is
 * structural rather than arithmetic — the offsets in acts.js are read directly
 * as local coordinates and there is no place for the follow to drift out of
 * sync with the walk.
 *
 * Deliberately outside React. A render loop that calls setState re-reconciles a
 * tree sixty times a second to change a number nothing in the tree reads.
 */

/** Frame-rate independent easing. `rate` is the fraction closed per 60Hz frame. */
const damp = (current, target, rate, dt) =>
  MathUtils.lerp(current, target, 1 - (1 - rate) ** (dt * 60));

const smoothstep = (t) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};

export class World {
  constructor(canvas, { actIds, quality = 'high' }) {
    this.canvas = canvas;
    this.actIds = actIds;

    this.renderer = new WebGLRenderer({
      canvas,
      // The ink pass resolves edges through the halftone screen; MSAA
      // underneath is fill rate spent on detail the screen then discards.
      antialias: false,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });

    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1 : 1.5)
    );

    this.scene = new Scene();
    // Neutral mid-dark, always. The post pass decides what this becomes; all
    // that matters here is that background and fog agree, so distant geometry
    // dissolves instead of ending at a visible edge.
    this.scene.background = new Color(0x2a2e36);
    this.fog = new FogExp2(0x2a2e36, 0.03);
    this.scene.fog = this.fog;

    this.camera = new PerspectiveCamera(40, 1, 0.1, 240);

    this.stage = new Stage();
    this.scene.add(this.stage.root);

    this.figure = new Figure();
    this.scene.add(this.figure.root);


    /*
     * The rig. Parenting the camera to a group that sits at the figure's feet
     * turns "follow the subject" into a local transform rather than a running
     * sum the walk and the keyframes both have to agree about.
     */
    this.rig = new Group();
    this.rig.add(this.camera);
    this.scene.add(this.rig);

    /*
     * The console is PINNED in world space, under the aperture. It is a place
     * the character walks to, so it cannot ride the rig: a table that follows
     * him is furniture he can never reach.
     */
    this.monoliths = new Monoliths();
    this.monoliths.root.position.z = APERTURE_Z + 4.4;
    this.scene.add(this.monoliths.root);
    this.focus = -1;

    // Set by the host so the cursor and the detail panel can react to what the
    // pointer is over in the 3D scene.
    this.onHover = null;
    this.onSelect = null;
    this.hovered = -1;

    this.aim = new Vector3();
    this.aimWorld = new Vector3();
    this.currentAim = new Vector3(0, 1.5, -6);

    this.buildLights();

    this.ink = new InkPass(this.renderer);

    this.pointer = { x: 0, y: 0 };
    this.story = 0;
    // -1, not 0. The palette is written only when the act index changes, so
    // starting at 0 would leave Act I rendering with the shader's constructor
    // defaults instead of its own tone.
    this.act = -1;
    this.veil = 0;
    this.fovBias = 0;
    this.running = false;
    this.raf = 0;
    this.clock = { last: 0, elapsed: 0 };

    this.onResize = this.onResize.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onVisibility = this.onVisibility.bind(this);
    this.onClick = this.onClick.bind(this);
    this.tick = this.tick.bind(this);
  }

  buildLights() {
    /*
     * FLOOD THE HALL. The separation comes from albedo, not from lighting angle.
     *
     * The figure's material is about 4% reflectance and the set's is about 37%.
     * Under the same bright light the set climbs to near-white and the figure
     * stays near-black, which is precisely ink on paper — and it holds from
     * every camera angle, in every act, with no per-shot relighting.
     *
     * The first attempt did the opposite: a single hard rim from the far end of
     * the hall, on the theory that backlighting produces silhouettes. It does,
     * against a bright background. Here it left every camera-facing surface
     * unlit, so the figure was a dark shape on an equally dark field and the
     * only thing visible was the sliver of aperture it failed to cover.
     *
     * Lights hang off the RIG rather than the figure: the figure carries a
     * 180-degree yaw so it faces its direction of travel, and that yaw would
     * rotate its children too, swinging a light placed behind the subject
     * around to the front. The rig follows the walk and never rotates.
     */
    const anchor = new Group();
    this.rig.add(anchor);

    // The ambient bath. This is the light doing the actual work.
    this.scene.add(new HemisphereLight(0xf2f8ff, 0x6a7280, 2.6));

    // Broad key from the camera side, so the columns and floor the camera
    // actually sees are the brightest things in frame.
    const key = new DirectionalLight(0xffffff, 1.8);
    key.position.set(-4, 6, 9);
    key.target = anchor;
    this.rig.add(key);

    // A cool edge from the far end, on the same axis as the aperture. Not for
    // exposure — purely so the figure has a defined contour where it crosses
    // the bright wall behind it.
    const rim = new DirectionalLight(0xdff6ff, 2.2);
    rim.position.set(3.2, 4.2, -12);
    rim.target = anchor;
    this.rig.add(rim);

    // Sits inside the aperture and spills onto the nearest columns, which is
    // what makes it read as a light source rather than a decal.
    this.glow = new PointLight(0x3fe0e8, 55, 46, 2);
    this.scene.add(this.glow);
  }

  mount() {
    this.onResize();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    window.addEventListener('click', this.onClick);
    document.addEventListener('visibilitychange', this.onVisibility);

    this.running = true;
    this.clock.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.renderer.setSize(width, height, false);
    this.ink.setSize(width, height);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    // A portrait phone sees a much narrower slice of the hall, so the framing
    // widens or the figure fills the screen and the set disappears.
    this.fovBias = width / height < 0.85 ? 13 : 0;
  }

  onPointerMove(event) {
    this.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
  }

  /**
   * A click anywhere reports the slab under the pointer, if any.
   *
   * Listening on the window rather than the canvas is deliberate: the canvas is
   * pointer-events:none so that the page underneath stays clickable, which
   * means it never receives the event itself.
   */
  onClick() {
    if (this.hovered < 0) return;
    this.onSelect?.(this.hovered);
  }

  onVisibility() {
    if (document.hidden) {
      this.running = false;
      return;
    }
    if (this.running) return;
    this.running = true;
    // Reset the clock on the way back in, so ten minutes in a background tab is
    // not integrated into one frame and does not teleport the world.
    this.clock.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  /**
   * Where we are in the sequence, as actIndex + fractionThroughAct.
   *
   * Measured against the viewport's 45% line — the same rule useActTracker uses
   * for the DOM tone, so the world's palette cut and the text's colour change
   * land on the same frame rather than a few hundred pixels apart.
   */
  readStory() {
    const line = window.innerHeight * 0.45;
    let position = 0;

    for (let i = 0; i < this.actIds.length; i += 1) {
      const node = document.getElementById(this.actIds[i]);
      if (!node) continue;

      const rect = node.getBoundingClientRect();
      if (rect.height <= 0) continue;
      if (line < rect.top) break; // not reached yet — keep the previous value

      position = i + MathUtils.clamp((line - rect.top) / rect.height, 0, 1);
    }

    return position;
  }

  /**
   * How far the figure has walked, given where we are in the sequence.
   *
   * He walks in, then very nearly STOPS for the whole projects act — the ring
   * assembles around a stationary figure, which is what makes him the centre of
   * it rather than someone strolling through a display. A constant-rate walk
   * here pulled him out of his own ring within a couple of seconds.
   *
   * The residual drift during the act is deliberate: dead-still reads as a
   * paused video, and a few centimetres of travel keeps the gait alive.
   */
  walkDistance(index, fraction) {
    if (index < FOCUS_ACT) {
      return ((index + fraction) / FOCUS_ACT) * LEAD_IN;
    }

    if (index === FOCUS_ACT) {
      return LEAD_IN + fraction * 2.5;
    }

    const after = ACTS.length - FOCUS_ACT - 1;
    const t = (index - FOCUS_ACT - 1 + fraction) / Math.max(1, after);
    return LEAD_IN + 2.5 + t * RUN_OUT;
  }

  /** Which slab, if any, the sequence is currently holding on. */
  focusIndex(index, fraction) {
    const count = this.monoliths.items.length;
    if (index !== FOCUS_ACT || count === 0) return -1;
    return Math.min(count - 1, Math.floor(fraction * count));
  }

  applyAct(dt) {
    const index = Math.min(ACTS.length - 1, Math.max(0, Math.floor(this.story)));
    const fraction = smoothstep(this.story - index);
    const act = ACTS[index];
    const u = this.ink.uniforms;

    // --- The walk -----------------------------------------------------------
    // Distance is a direct function of scroll, so scrolling back walks back. A
    // one-way animation triggered at act boundaries would desync the moment
    // anyone scrolled up, and this is the element the eye is locked onto.
    /*
     * Damped, not applied raw.
     *
     * The gait is a function of distance, so a step change in distance is a
     * step change in the stride, and the raw value jumps whenever an act
     * boundary is crossed or the scroll is thrown. Easing the distance itself
     * is what makes the walk read as a walk rather than as a figure being
     * dragged along a line.
     */
    const wanted = this.walkDistance(index, fraction);
    this.travelled = damp(this.travelled === undefined ? wanted : this.travelled, wanted, 0.05, dt);
    const travelled = this.travelled;
    this.figure.setDistance(travelled);
    this.rig.position.set(0, 0, -travelled);

    // The aperture stays ahead of them, so it is always the thing they are
    // walking toward rather than a fixed landmark they pass.
    this.stage.setHorizon(travelled);
    this.glow.position.set(0, 3.4, -travelled - 26);

    // --- Camera -------------------------------------------------------------
    const { from, to } = act;

    // Pointer parallax on top of the keyframed offset. Small on purpose: this
    // is a camera operator's hand, not a free-look control.
    this.camera.position.x = damp(
      this.camera.position.x,
      MathUtils.lerp(from.offset[0], to.offset[0], fraction) + this.pointer.x * 0.6,
      0.045,
      dt
    );
    this.camera.position.y = damp(
      this.camera.position.y,
      MathUtils.lerp(from.offset[1], to.offset[1], fraction) - this.pointer.y * 0.22,
      0.045,
      dt
    );
    this.camera.position.z = damp(
      this.camera.position.z,
      MathUtils.lerp(from.offset[2], to.offset[2], fraction),
      0.045,
      dt
    );

    // The aim point is also rig-local, so it travels too.
    this.aim.set(
      MathUtils.lerp(from.aim[0], to.aim[0], fraction),
      MathUtils.lerp(from.aim[1], to.aim[1], fraction),
      MathUtils.lerp(from.aim[2], to.aim[2], fraction)
    );
    this.currentAim.lerp(this.aim, 1 - 0.94 ** (dt * 60));

    // lookAt wants world space, and the rig has moved — so the local aim has to
    // be lifted out of it before the camera can use it.
    this.aimWorld.copy(this.currentAim);
    this.rig.localToWorld(this.aimWorld);
    this.camera.lookAt(this.aimWorld);

    const fov = MathUtils.lerp(from.fov, to.fov, fraction) + this.fovBias;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = damp(this.camera.fov, fov, 0.045, dt);
      this.camera.updateProjectionMatrix();
    }

    // --- Tone ---------------------------------------------------------------
    // Snapped, never interpolated.
    if (index !== this.act) {
      this.act = index;
      const palette = PALETTE[act.tone];
      // Vector3 takes plain floats, so the conversion happens here and the
      // shader never has to think about colour management.
      u.uDark.value.set(...palette.dark);
      u.uLight.value.set(...palette.light);
      u.uInvert.value = palette.invert;
      this.stage.setSignal(palette.signal);
      this.glow.color.setHex(palette.signal);
    }

    // Halftone and fog do ease. They are texture rather than structure, and a
    // hard step in the screen ruling looks like a rendering fault.
    u.uHalftone.value = damp(u.uHalftone.value, act.halftone, 0.06, dt);
    this.fog.density = damp(this.fog.density, act.fog, 0.06, dt);

    this.veil = damp(this.veil, act.veil, 0.06, dt);
    document.documentElement.style.setProperty('--veil', this.veil.toFixed(3));

    // --- Projects -----------------------------------------------------------
    this.focus = this.focusIndex(index, fraction);
    this.monoliths.setFocus(this.focus);
    // Outside the projects act the ring retracts to nothing rather than being
    // hidden, so scrolling back up plays the blast in reverse.
    this.monoliths.setProgress(index === FOCUS_ACT ? fraction : index < FOCUS_ACT ? 0 : 1);
    this.monoliths.setPointer(this.pointer.x, this.pointer.y);
    this.monoliths.update(this.clock.elapsed, this.camera);
    this.monoliths.setSignal(PALETTE[act.tone].signal);

    /*
     * He looks down at the table once he reaches it. Blending on proximity
     * rather than on the act index means it starts as he arrives and releases
     * as he leaves, instead of snapping at a scroll boundary he cannot see.
     */
    const toTable = Math.abs(-travelled - (APERTURE_Z + 4.4)) - 3.2;
    this.figure.setAttention(1 - MathUtils.clamp(toTable / 6, 0, 1));

    // Report hover changes upward, not every frame — this crosses into React,
    // and a setState per frame would re-render the act sixty times a second.
    if (this.monoliths.hover !== this.hovered) {
      this.hovered = this.monoliths.hover;
      this.onHover?.(this.hovered);
    }

    this.figure.lookAt(-this.pointer.x, this.pointer.y);
  }

  tick(now) {
    if (!this.running) return;

    // Capped, so a dropped frame or a throttled tab cannot advance the world by
    // a visible jump.
    const dt = Math.min(0.05, (now - this.clock.last) / 1000);
    this.clock.last = now;
    this.clock.elapsed += dt;

    this.story = this.readStory();
    this.applyAct(dt);

    this.stage.update(this.clock.elapsed);
    this.figure.update(this.clock.elapsed, dt);

    this.ink.render(this.scene, this.camera, this.clock.elapsed);

    this.raf = requestAnimationFrame(this.tick);
  }

  /**
   * One frame, no loop. Used under prefers-reduced-motion, where the world
   * becomes a static establishing shot — the honest reading of the preference:
   * keep the picture, drop the movement.
   */
  renderStatic() {
    this.onResize();
    this.story = 0;
    // Run the damped values to rest first, or the single frame is taken while
    // the camera is still at its constructor position.
    for (let i = 0; i < 240; i += 1) this.applyAct(1 / 60);
    this.ink.uniforms.uGrain.value = 0;
    this.ink.render(this.scene, this.camera, 0);
  }

  setAvatar(url) {
    return this.figure.loadAvatar(url);
  }

  /** Called once the site payload lands. Safe to call again. */
  setProjects(projects, screenshotUrl) {
    this.monoliths.setProjects(projects, screenshotUrl);
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);

    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('click', this.onClick);
    document.removeEventListener('visibilitychange', this.onVisibility);

    document.documentElement.style.removeProperty('--veil');

    this.ink.dispose();
    this.stage.dispose();
    this.monoliths.dispose();
    this.figure.dispose();
    this.renderer.dispose();
  }
}
