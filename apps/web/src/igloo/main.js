import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadIgloo } from './Igloo.js';
import { BlockPhysics } from './BlockPhysics.js';
import { IglooInteraction } from './IglooInteraction.js';

/**
 * Scene, camera, light and the frame loop.
 *
 * The camera does not orbit. Dragging a scene around is a 3D-viewer gesture and
 * it puts the user in the position of operating a model; the pointer here
 * belongs to the igloo, and the camera only leans toward it. That single
 * decision is most of the difference between this reading as a product shot and
 * reading as a WebGL toy.
 */

const canvas = document.getElementById('scene');
const overlay = document.getElementById('overlay');
const hint = document.getElementById('hint');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  alpha: false,
});
/* Capped at 2. A 3x phone screen costs nine times the fragments of a 1x one to
   resolve detail that is already below the pixel pitch. */
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
/*
 * 0.82, DOWN FROM 1.05, AND THE LIGHTS CAME DOWN WITH IT.
 *
 * Snow is the hardest thing to light because its albedo is already near the
 * top of the range: the baked basecolor peaks at 234-255 per channel, so any
 * light rig that would look correct on a mid-grey subject drives it straight
 * into clipping, and clipped white is flat white. The first pass did exactly
 * that and the dome came out as a silhouette with no surface at all.
 *
 * The relief in this model is geometric (the normal map is nearly flat --
 * measured stdev 6.8 on the blue channel), which means it is *shading* that
 * has to reveal it. Shading needs headroom above the albedo to work in, and
 * that is what pulling the whole rig down buys.
 */
renderer.toneMappingExposure = 0.82;
renderer.shadowMap.enabled = true;
/* PCFSoft is deprecated in r185 and silently falls back to PCF anyway, which
   is what the warning in the console was about. Asking for what we actually
   get keeps the log clean and the result identical. */
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0a0c11');

const camera = new THREE.PerspectiveCamera(32, 1, 1, 600);
const target = new THREE.Vector3();
const camBase = new THREE.Vector3();
const camWanted = new THREE.Vector3();

/* Image-based light from a procedural room. It costs one render into a small
   cube target at startup and no download, and it is what puts the soft
   gradient across the curve of the dome that a bare directional light cannot:
   snow is almost entirely diffuse bounce, so with punctual lights alone the
   unlit side goes flat black and the whole thing reads as plastic. */
const pmrem = new THREE.PMREMGenerator(renderer);
const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
scene.environment = envRT.texture;
pmrem.dispose();

const key = new THREE.DirectionalLight('#eaf2ff', 1.35);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0012;
key.shadow.normalBias = 0.35;
scene.add(key, key.target);

/* Cool rim from behind and below the far side. Snow against a dark ground
   needs a separating edge or the silhouette dissolves into the background. */
const rim = new THREE.DirectionalLight('#5f8dd6', 0.72);
scene.add(rim);

const fill = new THREE.HemisphereLight('#9fc0ef', '#161a22', 0.26);
scene.add(fill);

/* Shadow catcher. ShadowMaterial draws nothing but the shadow, so the ground
   stays the background colour and the dome sits on a soft contact patch rather
   than on a visible slab. */
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.ShadowMaterial({ opacity: 0.42 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

let igloo = null;
let physics = null;
let interaction = null;

/* Empty frame left around the model, as a multiple of its own size. These can
   be modest because the fit below is exact rather than approximate. */
const V_MARGIN = 1.14;
const H_MARGIN = 1.10;

/**
 * Distance at which every corner of the model is inside the frame.
 *
 * TWO EARLIER VERSIONS OF THIS WERE WRONG, IN DIFFERENT WAYS, AND BOTH CROPPED
 * THE PORCH:
 *
 *   1. Scaling a hand-set distance by aspect. A laptop window is short, not
 *      narrow, so the vertical field of view is what binds — but a factor keyed
 *      on aspect only pulled back as the window got *narrow*, which is when
 *      there was already room.
 *
 *   2. Solving height and radius against the field of view directly. That
 *      treats the model as if it were flat at z = 0. It is not: the entrance
 *      porch reaches 28.5 units toward the camera, so at a camera distance of
 *      73 it sits at an effective 44.5 and is magnified by nearly two thirds
 *      relative to the dome behind it. It ran off the bottom of the frame while
 *      the arithmetic said there were five units to spare.
 *
 * So the constraint is applied per corner, at that corner's own depth. For a
 * point to be inside the frame vertically:
 *
 *      |y - targetY| / (dist - z)  <=  tan(fov/2) / margin
 *
 * which rearranges to a minimum distance for that corner, and the answer is
 * the largest such minimum over all eight. Horizontal is the same with the
 * aspect ratio folded in. Exact, and it self-corrects if the model changes.
 */
function fitDistance(bounds, targetY) {
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const kV = V_MARGIN / tan;
  const kH = H_MARGIN / (tan * camera.aspect);

  let dist = 0;
  for (let c = 0; c < 8; c++) {
    const x = (c & 1 ? bounds.max : bounds.min)[0];
    const y = (c & 2 ? bounds.max : bounds.min)[1];
    const z = (c & 4 ? bounds.max : bounds.min)[2];
    dist = Math.max(dist, z + Math.abs(y - targetY) * kV, z + Math.abs(x) * kH);
  }
  return dist;
}

function frameCamera(radius, height, bounds) {
  /* Aim at the dome's own middle. Aiming lower pushes the object up the frame
     and eats the bottom margin, which is exactly what cropped the porch. */
  target.set(0, height * 0.50, 0);
  camBase.set(0, height * 0.56, fitDistance(bounds, target.y));
  key.position.set(-radius * 1.5, radius * 2.5, radius * 1.9);
  key.target.position.copy(target);
  key.target.updateMatrixWorld();

  const d = key.shadow.camera;
  d.left = -radius * 1.9; d.right = radius * 1.9;
  d.top = radius * 2.2; d.bottom = -radius * 0.6;
  d.near = radius * 0.5; d.far = radius * 7;
  d.updateProjectionMatrix();

  rim.position.set(radius * 1.7, radius * 0.85, -radius * 2.1);

  ground.scale.set(radius * 14, radius * 14, 1);
  camera.far = radius * 14;
  camera.updateProjectionMatrix();
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  if (!igloo) return;
  /* Re-solve rather than scale: the fit depends on the aspect that was just
     set, and on a phone rotating to portrait the horizontal term takes over
     from the vertical one entirely. */
  camBase.z = fitDistance(igloo.bounds, target.y);
  camera.position.z = camBase.z;
}

const timer = new THREE.Timer();
let running = true;

/**
 * One frame.
 *
 * Deliberately separate from the rAF callback that normally drives it. A page
 * that only advances from inside requestAnimationFrame cannot be checked
 * without a foreground tab — rAF does not fire in a backgrounded one — so the
 * whole interaction would be unverifiable in any headless or automated run.
 * Splitting it means the loop can be stepped with a known dt and the result
 * inspected, and the stepped path is the same one the browser drives.
 */
function tick(dt) {
  interaction.update(dt);
  physics.step(dt);
  physics.writeTo(igloo.mesh);

  /* Parallax: a shallow lean, and the vertical half of the horizontal one so
     the horizon stays roughly level. */
  const p = interaction.parallax;
  const r = igloo.radius;
  camWanted.set(
    camBase.x + p.x * r * 0.30,
    camBase.y + p.y * r * 0.13,
    camera.position.z
  );
  camera.position.x += (camWanted.x - camera.position.x) * (1 - Math.exp(-4 * dt));
  camera.position.y += (camWanted.y - camera.position.y) * (1 - Math.exp(-4 * dt));
  camera.lookAt(target);

  renderer.render(scene, camera);
}

function loop() {
  requestAnimationFrame(loop);
  if (!running || !physics) return;
  timer.update();
  tick(timer.getDelta());
}

/* Nothing to draw while the tab is hidden, and a backgrounded tab that keeps
   asking for frames is what drains a laptop sitting on a landing page. */
document.addEventListener('visibilitychange', () => {
  running = !document.hidden;
  if (running) timer.update(); // discard the gap
});

window.addEventListener('resize', resize);

(async () => {
  try {
    igloo = await loadIgloo({ base: '/igloo/', renderer });
    scene.add(igloo.mesh);

    physics = new BlockPhysics(igloo.blocks, { radius: igloo.radius });
    interaction = new IglooInteraction({
      dom: renderer.domElement,
      camera,
      mesh: igloo.mesh,
      blocks: igloo.blocks,
      physics,
    });

    frameCamera(igloo.radius, igloo.height, igloo.bounds);
    camera.position.copy(camBase);
    resize();

    physics.writeTo(igloo.mesh);
    renderer.render(scene, camera);

    overlay.classList.add('gone');
    hint.classList.add('show');
    setTimeout(() => hint.classList.remove('show'), 6000);

    /* Exposed for the smoke test in the browser console, and genuinely useful
       when tuning: window.igloo.physics.cfg is live. */
    window.igloo = { scene, camera, renderer, ...igloo, physics, interaction, tick };

    loop();
  } catch (err) {
    console.error('[igloo] failed to start', err);
    overlay.textContent = 'Could not load the igloo — ' + err.message;
    overlay.classList.add('error');
  }
})();
