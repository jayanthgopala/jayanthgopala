import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadIgloo } from './Igloo.js';
import { BlockPhysics } from './BlockPhysics.js';
import { IglooInteraction } from './IglooInteraction.js';

// Standalone interactive 3D igloo preview
const canvas = document.getElementById('scene');
const overlay = document.getElementById('overlay');
const hint = document.getElementById('hint');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  alpha: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.82;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0a0c11');

const camera = new THREE.PerspectiveCamera(32, 1, 1, 600);
const target = new THREE.Vector3();
const camBase = new THREE.Vector3();
const camWanted = new THREE.Vector3();

// Image-based ambient lighting
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

const rim = new THREE.DirectionalLight('#5f8dd6', 0.72);
scene.add(rim);

const fill = new THREE.HemisphereLight('#9fc0ef', '#161a22', 0.26);
scene.add(fill);

// Shadow receiver plane under igloo
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

const V_MARGIN = 1.14;
const H_MARGIN = 1.10;

// Computes camera distance to enclose model bounds within frustum
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
  camBase.z = fitDistance(igloo.bounds, target.y);
  camera.position.z = camBase.z;
}

const timer = new THREE.Timer();
let running = true;

// Simulation and render update per frame
function tick(dt) {
  interaction.update(dt);
  physics.step(dt);
  physics.writeTo(igloo.mesh);

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

document.addEventListener('visibilitychange', () => {
  running = !document.hidden;
  if (running) timer.update();
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

    window.igloo = { scene, camera, renderer, ...igloo, physics, interaction, tick };
    loop();
  } catch (err) {
    console.error('[igloo] failed to start', err);
    overlay.textContent = 'Could not load the igloo — ' + err.message;
    overlay.classList.add('error');
  }
})();
