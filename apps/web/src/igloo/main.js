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
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#e5eef7');
scene.fog = new THREE.Fog('#e5eef7', 40, 160);

const camera = new THREE.PerspectiveCamera(32, 1, 1, 600);
const target = new THREE.Vector3();
const camBase = new THREE.Vector3();
const camWanted = new THREE.Vector3();

// Image-based ambient lighting
const pmrem = new THREE.PMREMGenerator(renderer);
const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
scene.environment = envRT.texture;
pmrem.dispose();

const key = new THREE.DirectionalLight('#ffffff', 1.6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.001;
key.shadow.normalBias = 0.35;
scene.add(key, key.target);

const rim = new THREE.DirectionalLight('#a2cbf5', 0.95);
scene.add(rim);

const fill = new THREE.HemisphereLight('#edf4fc', '#cadbe9', 0.65);
scene.add(fill);

// White snow ground plane
const whiteGround = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshStandardMaterial({ color: '#edf3fa', roughness: 0.88, metalness: 0.04 })
);
whiteGround.rotation.x = -Math.PI / 2;
whiteGround.position.y = -0.04;
whiteGround.receiveShadow = true;
scene.add(whiteGround);

// Rolling background snow hills behind igloo
const hillsGeo = new THREE.PlaneGeometry(160, 90, 72, 36);
hillsGeo.rotateX(-Math.PI / 2);
const hPos = hillsGeo.attributes.position;
for (let i = 0; i < hPos.count; i++) {
  const x = hPos.getX(i);
  const z = hPos.getZ(i);
  const dL = Math.hypot((x + 28) * 0.8, (z + 14) * 1.1);
  const hillL = 16.0 * Math.exp(-(dL * dL) / (2 * 16 * 16));
  const dR = Math.hypot((x - 25) * 0.8, (z + 12) * 1.0);
  const hillR = 17.0 * Math.exp(-(dR * dR) / (2 * 18 * 18));
  const dMnt = Math.hypot(x * 0.55, (z + 32) * 0.9);
  const mnt = 26.0 * Math.exp(-(dMnt * dMnt) / (2 * 28 * 28));
  hPos.setY(i, hillL + hillR + mnt);
}
hillsGeo.computeVertexNormals();
const hills = new THREE.Mesh(
  hillsGeo,
  new THREE.MeshStandardMaterial({ color: '#edf4fc', roughness: 0.90, metalness: 0.0 })
);
hills.position.set(0, -0.05, -12);
hills.receiveShadow = true;
scene.add(hills);

// Shadow receiver plane under igloo
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.ShadowMaterial({ opacity: 0.32 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Sculpted snow base for the igloo
const snowBase = new THREE.Mesh(
  new THREE.CylinderGeometry(1.0, 1.28, 0.06, 64),
  new THREE.MeshStandardMaterial({ color: '#edf5fd', roughness: 0.92, metalness: 0.01 })
);
snowBase.receiveShadow = true;
scene.add(snowBase);

// Entrance warm amber point light
const entranceLight = new THREE.PointLight('#ff9430', 2.8, 40);
scene.add(entranceLight);

// Interior dome warm golden hearth point light
const domeLight = new THREE.PointLight('#ff9834', 3.6, 60);
scene.add(domeLight);

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
  snowBase.scale.set(radius * 1.15, radius, radius * 1.15);
  snowBase.position.y = radius * 0.02;
  domeLight.position.set(0, height * 0.45, 0);
  entranceLight.position.set(radius * 0.45, radius * 0.16, radius * 0.85);
  whiteGround.scale.set(radius * 25, radius * 25, 1);
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
    igloo.mesh.material.color = new THREE.Color('#d8e8f5');
    igloo.mesh.material.roughness = 0.86;
    igloo.mesh.material.envMapIntensity = 0.32;
    igloo.mesh.material.onBeforeCompile = (shader) => {
      shader.vertexShader =
        'attribute float aEdge;\nattribute float aEntrance;\nvarying float vEdge;\nvarying float vEntrance;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n  vEdge = aEdge;\n  vEntrance = aEntrance;'
        );
      shader.fragmentShader =
        'varying float vEdge;\nvarying float vEntrance;\n' +
        shader.fragmentShader
          .replace(
            '#include <normal_fragment_maps>',
            [
              '#include <normal_fragment_maps>',
              'float glossEdge = smoothstep( 0.86, 1.00, vEdge );',
              'roughnessFactor = mix( roughnessFactor, 0.74, glossEdge * 0.30 );',
              'float bevel = smoothstep( 0.55, 1.00, vEdge );',
              'normal = normalize( mix( normal, vec3( 0.0, 1.0, 0.0 ), bevel * 0.20 ) );',
            ].join('\n')
          )
          .replace(
            '#include <emissivemap_fragment>',
            [
              '#include <emissivemap_fragment>',
              'float archRim = smoothstep( 0.80, 1.00, vEdge ) * vEntrance;',
              'totalEmissiveRadiance += vec3( 1.00, 0.84, 0.50 ) * ( 3.20 * vEntrance + 2.20 * archRim );',
            ].join('\n')
          );
    };
    igloo.mesh.material.needsUpdate = true;
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
