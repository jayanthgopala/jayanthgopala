import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { BufferAttribute, BufferGeometry, Color, Vector3 } from 'three';
import { heightAt } from '../lib/terrain.js';
import { loadIgloo } from '../../igloo/Igloo.js';
import { BlockPhysics } from '../../igloo/BlockPhysics.js';
import { IglooInteraction } from '../../igloo/IglooInteraction.js';
import { LOOK, SUN_DIR } from '../lib/lighting.js';
import { sound } from '../lib/sound.js';

/** Where the igloo stands in the world, and which way its entrance faces. */
export const IGLOO_AT = [-30, 252];
export const IGLOO_YAW = 1.24;

// Assembly, kept for a future arrival: each block waits its turn (lowest
// courses first), then takes this much of the build to fly in from its scattered
// start. Nothing drives it now that the site ends in the contact room.
const ASSEMBLE_SPAN = 0.4;
const ASSEMBLE_STAGGER = 0.6;

/**
 * Scattered starts for the assembly: every block somewhere above and outside
 * its place, tumbling, with a turn that follows its height in the dome.
 */
function assemblyPlan(physics, radius) {
  const n = physics.count;
  const start = new Float32Array(n * 3);
  const spin = new Float32Array(n * 3);
  const delay = new Float32Array(n);
  let seed = 7919;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const y = physics.rest[i * 3 + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  for (let i = 0; i < n; i += 1) {
    const o = i * 3;
    const level = (physics.rest[o + 1] - minY) / Math.max(1e-3, maxY - minY);
    delay[i] = ASSEMBLE_STAGGER * (level * 0.8 + rand() * 0.2);
    const out = radius * (0.5 + rand());
    // Offsets from the block's own place.
    start[o] = physics.outward[o] * out + (rand() - 0.5) * radius * 0.8;
    start[o + 1] = radius * (0.9 + rand() * 1.6);
    start[o + 2] = physics.outward[o + 2] * out + (rand() - 0.5) * radius * 0.8;
    for (let k = 0; k < 3; k += 1) spin[o + k] = (rand() - 0.5) * 6;
  }
  return { start, spin, delay };
}

/** Places every block along its flight home for a build progress of 0..1. */
function placeAssembly(physics, plan, building) {
  const { start, spin, delay } = plan;
  for (let i = 0; i < physics.count; i += 1) {
    const o = i * 3;
    const t = Math.min(1, Math.max(0, (building - delay[i]) / ASSEMBLE_SPAN));
    // Fast out of the scatter, settling gently into place.
    const away = (1 - t) ** 3;
    for (let k = 0; k < 3; k += 1) {
      physics.offset[o + k] = start[o + k] * away;
      physics.rot[o + k] = spin[o + k] * away;
      physics.vel[o + k] = 0;
      physics.rotVel[o + k] = 0;
    }
    physics.push[i] = 0;
  }
}

// Interactive measurement network nodes and thresholds
const MAX_NODES = 5;
const LINE_VERTICES = MAX_NODES + 1;
const NODE_FLOOR = 0.42;

let linkedNodes = 0;

// Base course blocks below this altitude remain pinned to the ground
const BASE_COURSE_Y = 5;

// Idle sweep wave parameters across dome blocks
const SWEEP_STROKE = 2.6;
const SWEEP_PASSES = 2;
const SWEEP_PAUSE = 3.4;
const SWEEP_CYCLE = SWEEP_STROKE * SWEEP_PASSES + SWEEP_PAUSE;
const SWEEP_REACH = 1.45;
const SWEEP_WIDTH = 0.34;
const SWEEP_AMOUNT = 0.112;

// Seating footprint calculation on terrain
const FOOTPRINT = 30;
const SEAT_ARC = 24;
const SEAT_BANDS = 4;

export function seatHeight(ax, az) {
  return 0.0;
}

const worldVec = new Vector3();
const projA = new Vector3();
const projB = new Vector3();

// Ice light terms in linear RGB for frosted snow-ice blocks and glowing seams
const iceTerms = () => ({
  through: '0.04, 0.08, 0.14',
  rim: '0.28, 0.45, 0.65',
  seam: '0.0, 0.0, 0.0',
  roughness: 1.0,
  env: 0.0,
});
const ICE = iceTerms();

const IG_NOISE_GLSL = `
float igHash( vec3 p ) {
  vec3 q = fract( p * 0.1031 );
  q += dot( q, q.yzx + 33.33 );
  return fract( ( q.x + q.y ) * q.z );
}
float igNoise( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( mix( igHash( i ), igHash( i + vec3( 1, 0, 0 ) ), f.x ),
         mix( igHash( i + vec3( 0, 1, 0 ) ), igHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
    mix( mix( igHash( i + vec3( 0, 0, 1 ) ), igHash( i + vec3( 1, 0, 1 ) ), f.x ),
         mix( igHash( i + vec3( 0, 1, 1 ) ), igHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ),
    f.z );
}
`;

const IDLE_SWEEP = false;

// Custom ice shader: clean frosted translucent snow/ice blocks with warm interior hearth illumination
const iceShader = (shader) => {
  shader.vertexShader =
    IG_NOISE_GLSL +
    'varying vec3 vRefWorld;\n' +
    'attribute float aEdge;\nattribute float aEntrance;\nvarying float vEdge;\nvarying float vEntrance;\nvarying float vFacing;\nvarying float vExcite;\nvarying vec3 vCorner;\nvarying vec3 vLocal;\nvarying float vBlock;\n' +
    shader.vertexShader.replace(
      '#include <project_vertex>',
      [
        '#include <project_vertex>',
        '  vec4 refWp = vec4( transformed, 1.0 );',
        '  #ifdef USE_BATCHING',
        '    refWp = batchingMatrix * refWp;',
        '  #endif',
        '  vRefWorld = ( modelMatrix * refWp ).xyz;',
      ].join('\n')
    ).replace(
      '#include <begin_vertex>',
      [
        '#include <begin_vertex>',
        '  vEdge = aEdge;',
        '  vLocal = transformed;',
        // Hand-cut, chipped edges: the rounded edge band pushed in and out a
        // little, unevenly, so no edge runs dead straight. Faces stay flat.
        '  float igChip = igNoise( transformed * 0.32 + 2.0 ) - 0.5;',
        '  transformed += objectNormal * igChip * 0.34 * smoothstep( 0.55, 1.0, aEdge );',
        '  vEntrance = aEntrance;',
        '  #ifdef USE_BATCHING',
        '    mat4 bMat = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );',
        '    vec3 bPos = ( bMat * vec4( transformed, 1.0 ) ).xyz;',
        '    vec3 bNor = normalize( mat3( bMat ) * objectNormal );',
        '    vec3 domeOut = length( bPos ) > 0.001 ? normalize( bPos ) : vec3( 0.0, 1.0, 0.0 );',
        '    vFacing = dot( bNor, domeOut );',
        // One number per block, taken from where the block sits: every block
        // was cut by hand, so no two share a tone or a roughness.
        '    vec3 bOrg = ( bMat * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;',
        '    vBlock = fract( sin( dot( floor( bOrg * 4.0 ), vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 );',
        '  #else',
        '    vFacing = 1.0;',
        '    vBlock = 0.5;',
        '  #endif',
        '  #ifdef USE_BATCHING_COLOR',
        '    vec4 bCol = getBatchingColor( getIndirectIndex( gl_DrawID ) );',
        '    vExcite = clamp( ( bCol.b - 1.0 ) / 0.52, 0.0, 1.0 );',
        '  #else',
        '    vExcite = 0.0;',
        '  #endif',
        '  vCorner = normalize( normalMatrix * ( mat3( bMat ) * normalize( transformed + vec3( 1e-5 ) ) ) );',
      ].join('\n')
    );

  shader.fragmentShader =
    'varying vec3 vRefWorld;\n' +
    'varying float vEdge;\nvarying float vEntrance;\nvarying float vFacing;\nvarying float vExcite;\nvarying vec3 vCorner;\nvarying vec3 vLocal;\nvarying float vBlock;\n' +
    IG_NOISE_GLSL +
    shader.fragmentShader
      .replace(
        '#include <normal_fragment_maps>',
        [
          '#include <normal_fragment_maps>',
          // Packed snow, not marble: only a trace of the colour map's
          // blotches survives, on a bright white base.
          'float igMapL = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );',
          // The same snow as the ground in front of it: its cool white, its grain.
          'diffuseColor.rgb = vec3( 2.2, 2.14, 2.06 );',
          // Crystal grain, cut-block scrapes and pits, in each block's own
          // coordinates so it never swims as blocks move.
          'float igCoarse = igNoise( vLocal * 0.22 + 4.1 );',
          'float igChisel0 = 1.0 - abs( igNoise( vLocal * 0.45 + 7.0 ) * 2.0 - 1.0 );',
          'float igGrain = igNoise( vLocal * 0.55 ) * 0.55 + igNoise( vLocal * 1.6 ) * 0.3 + igNoise( vLocal * 3.0 ) * 0.15;',
          'diffuseColor.rgb *= mix( 0.8, 1.06, igGrain ) * mix( 0.86, 1.0, igChisel0 );',
          // Fine crystals, as on the ground: a speckle of lighter and darker grains.
          'float igCrystal = igNoise( vLocal * 2.4 ) * 0.6 + igNoise( vLocal * 5.0 ) * 0.4;',
          'diffuseColor.rgb *= mix( 0.88, 1.06, igCrystal );',
          // Chiselled tooth: fine, even tone variation, as cut ice shows, with no bump to catch the lamps.
          'float igTooth = igNoise( vLocal * 2.2 + 5.0 ) * 0.4 + igNoise( vLocal * 4.6 ) * 0.35 + igNoise( vLocal * 8.5 ) * 0.25;',
          'diffuseColor.rgb *= mix( 0.52, 1.1, igTooth );',
          // Block to block: a hand-cut wall is never one even white.
          'diffuseColor.rgb *= mix( 0.96, 1.02, vBlock );',
          // Edges crumble unevenly: the rounding reaches further in where the
          // block has chipped.
          'float bevel = smoothstep( 0.62 - 0.3 * igCoarse, 1.00, vEdge );',
          // Light the rounded edges as the flat slab they belong to: left to
          // their own normals, each edge catches the sky on one side and
          // goes blue-dark on the other, a smudge down every joint.
          'vec3 igFlat = normalize( cross( dFdx( -vViewPosition ), dFdy( -vViewPosition ) ) );',
          'igFlat = faceforward( igFlat, -vViewPosition, igFlat );',
          'normal = normalize( mix( normal, igFlat, bevel * 0.9 ) );',
          // The rounded edge is crumbled snow, so it takes a little less light
          // than the cut face. Without this every block wears a bright outline
          // and the wall reads as a row of inflated cushions.
          'diffuseColor.rgb *= mix( 1.0, 0.97, bevel );',
          // Bump from the grain, strongest on the worn edges.
          // Broad chisel cuts (ridged noise) under the finer packed-snow grain.
          'float igChisel = 1.0 - abs( igNoise( vLocal * 0.3 + 7.0 ) * 2.0 - 1.0 );',
          // Bump from the noise's own gradient, taken per pixel. (Screen-space
          // derivatives are constant over each 2x2 quad and printed squares.)
          'float igBw = 0.6 + 1.2 * bevel;',
          '#define IGH( q ) ( ( igNoise( ( q ) * 0.5 ) * 0.7 + igNoise( ( q ) * 1.3 ) * 0.3 ) * igBw + igNoise( ( q ) * 2.6 ) * 0.14 )',
          'float igH0 = IGH( vLocal );',
          'vec3 igG = vec3( IGH( vLocal + vec3( 0.12, 0.0, 0.0 ) ) - igH0, IGH( vLocal + vec3( 0.0, 0.12, 0.0 ) ) - igH0, IGH( vLocal + vec3( 0.0, 0.0, 0.12 ) ) - igH0 );',
          'vec3 igGv = mat3( viewMatrix ) * igG;',
          'igGv -= normal * dot( normal, igGv );',
          'normal = normalize( normal - igGv * 9.0 );',
          // Joints sit a shade darker: packed with loose snow, in shadow.
          // The joint is a groove packed with loose snow: a wider, deeper
          // band of shade, which is what separates one block from the next.
          'diffuseColor.rgb *= mix( 1.0, 0.8, smoothstep( 0.88, 1.0, vEdge ) );',
          'roughnessFactor = 1.0;',
          // Crystals in the packed face catching the light, the sparkle the
          // snow around it already has.
          'float igSpark = igNoise( vLocal * 7.5 + 13.0 );',
          '',
          `vec3 sunDir = vec3( ${SUN_DIR.map((c) => c.toFixed(4)).join(', ')} );`,
          'vec3 wNrm = inverseTransformDirection( normalize( vNormal ), viewMatrix );',
          'float sunDot = dot( wNrm, sunDir );',
          'float sunFace = clamp( sunDot, 0.0, 1.0 );',
          'diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.96, 0.98, 1.00 ), smoothstep( 0.25, 0.85, sunFace ) * 0.08 * ( 1.0 - smoothstep( 0.8, 0.95, vEdge ) ) );',
          // Sides turned from the sun take the snow's blue shade, not grey.
          'float igJoint = smoothstep( 0.8, 0.95, vEdge );',
          'float igGSun = mix( dot( wNrm, normalize( vec3( 0.35, 0.50, -0.80 ) ) ), 0.15, igJoint );',
          'diffuseColor.rgb *= mix( vec3( 0.90, 0.93, 0.98 ), vec3( 1.07, 1.06, 1.04 ), clamp( smoothstep( -0.1, 0.8, igGSun ) * 0.8 + 0.2, 0.0, 1.0 ) );',
          // Marble in the block, as in the reference: bright white with soft grey veins
          // running through it, a different pattern in every block.
          'vec3 igVp = vLocal * 0.42 + vec3( vBlock * 37.0 );',
          'float igVein = 1.0 - abs( igNoise( igVp ) * 2.0 - 1.0 );',
          'float igVein2 = 1.0 - abs( igNoise( igVp * 2.3 + 11.0 ) * 2.0 - 1.0 );',
          'float igVeins = pow( igVein, 7.0 ) * 0.9 + pow( igVein2, 9.0 ) * 0.5;',
          'float igCloud = smoothstep( 0.35, 0.75, igNoise( vLocal * 0.7 + vBlock * 19.0 ) );',
          'diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.80, 0.84, 0.91 ), 0.0 * ( 1.0 - igJoint ) );',
          // Blocks darken toward their joints and soften with broad drift-like patches, as the hills do.
          'diffuseColor.rgb *= mix( 1.0, 0.95, smoothstep( 0.7, 0.96, vEdge ) );',
          'diffuseColor.rgb *= mix( vec3( 0.93, 0.96, 1.0 ), vec3( 1.02, 1.01, 1.0 ), igNoise( vLocal * 0.09 + 21.0 ) );',
          // Snow resting on whatever faces the sky: the dome's crown and the
          // tops of the blocks.
          'float igSettled = smoothstep( 0.5, 0.85, wNrm.y ) * smoothstep( 0.2, 0.6, igNoise( vLocal * 0.35 + 9.0 ) + 0.25 ) * ( 1.0 - igJoint );',
          'diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.93, 0.95, 0.98 ) * mix( 0.8, 1.0, igGrain ), igSettled * 0.6 );',
        ].join('\n')
      )
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          'float innerFace = smoothstep( 0.20, -0.55, vFacing );',
          // Seen from outside the walls are solid: no hearth light shows through the gaps.
          'innerFace *= 1.0 - smoothstep( 22.0, 28.0, length( cameraPosition.xz - vec2( -30.0, 252.0 ) ) );',
          // Warm golden hearth glow on all interior block surfaces
          'totalEmissiveRadiance += vec3( 1.00, 0.76, 0.38 ) * 1.1 * innerFace;',
          // Translucent light scattering through ice blocks from inside
          'vec3 domeOut = normalize( vec3( vNormal.x, max(0.12, vNormal.y), vNormal.z ) );',
          'float scatter = clamp( dot( -normalize( vViewPosition ), domeOut ), 0.0, 1.0 );',
          'float seamLeak = smoothstep( 0.30, 0.95, vEdge );',
          'totalEmissiveRadiance += vec3( 1.00, 0.70, 0.28 ) * 0.4 * smoothstep( 0.85, 1.0, vEdge ) * ( 0.35 + 0.65 * scatter ) * innerFace;',
          // The joints between blocks: thin lines of the hearth light showing
          // through. Constant; nothing here responds to the scroll.
          'float seamLine = smoothstep( 0.86, 0.99, vEdge );',
          'float seamLeakage = smoothstep( 0.3, 0.75, igNoise( vLocal * 0.18 + 3.1 ) );',
          'totalEmissiveRadiance += vec3( 1.00, 0.76, 0.40 ) * seamLine * 0.0;',
          'totalEmissiveRadiance += vec3( 1.00, 0.66, 0.30 ) * smoothstep( 0.55, 0.97, vEdge ) * 0.0;',
          // Entrance arch glow radiating warm amber illumination
          'float insideArch = smoothstep( 0.35, -0.35, vFacing );',
          'float archGlow = ( 0.55 + 0.15 * vExcite ) * vEntrance;',
          'float archRim = smoothstep( 0.75, 1.00, vEdge ) * archGlow;',
          'totalEmissiveRadiance += vec3( 1.00, 0.82, 0.46 ) * ( 1.3 * insideArch + 0.5 * archRim ) * archGlow;',
          // The doorway's light catching the porch blocks' edges.
          'totalEmissiveRadiance += vec3( 1.0, 0.66, 0.3 ) * 0.55 * vEntrance * smoothstep( 0.7, 1.0, vEdge ) * ( 1.0 - innerFace );',
          // Subtle daylight rim on outer dome contours
          'float nv = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );',
          'float rim = pow( 1.0 - nv, 2.6 );',
          'totalEmissiveRadiance += vec3( 0.20, 0.38, 0.60 ) * rim * ( 1.0 - innerFace ) * 0.0;',
          // Overcast fill: the block faces read clean white, as in the reference.
          'totalEmissiveRadiance += vec3( 0.84, 0.89, 0.96 ) * 0.07 * ( 1.0 - innerFace );',
        ].join('\n')
      )
      // At the opening frame the igloo wears the reference's own igloo,
      // projected from that camera; as the lens moves off it is our blocks.
      .replace(
        '#include <dithering_fragment>',
        [
          '#include <dithering_fragment>',
        ].join('\n')
      );
};

// Applies environment lighting and shader injections to igloo material
function gradeForWorld(material, tint) {
  material.color = new Color(tint);
  material.roughness = ICE.roughness;
  material.envMapIntensity = ICE.env;
  // The baked normal map's broad dents shade every block in grey blotches,
  // which read as marble; keep only a hint of it under the snow grain.
  material.normalScale.set(0.3, 0.3);
  // Dropped altogether: its dents rendered as dark smudges along every joint.
  // The shader's own grain and chisel bump give the blocks their texture.
  material.normalMap?.dispose();
  material.normalMap = null;
  material.side = 2; // DoubleSide
  material.onBeforeCompile = iceShader;
  material.needsUpdate = true;
}

export default function IglooBlocks({
  at = IGLOO_AT,
  yaw = IGLOO_YAW,
  tint = '#c2d6ea',
  lift = 0,
  onReady,
}) {
  const { camera, gl, size } = useThree();

  const groupRef = useRef(null);
  const lineRef = useRef(null);
  const anchorRefs = useRef([]);
  const nodeRefs = useRef([]);
  const valueRefs = useRef([]);

  const [rig, setRig] = useState(null);

  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  const origin = useMemo(() => {
    const [ax, az] = at;
    return [ax, seatHeight(ax, az) + lift, az];
  }, [at, lift]);

  const lineGeometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(LINE_VERTICES * 3), 3));
    return g;
  }, []);

  // Initializes model mesh, block physics, and interactive pointer handlers
  useEffect(() => {
    let live = true;
    let built = null;

    loadIgloo({ base: '/igloo/', renderer: gl })
      .then((igloo) => {
        if (!live) {
          igloo.dispose();
          return;
        }

        gradeForWorld(igloo.mesh.material, tint);
        // The wall takes no shadow from its own blocks: with the sun behind the
        // igloo they only smudge the joints. It still casts onto the snow.
        igloo.mesh.receiveShadow = false;
        igloo.mesh.frustumCulled = false;

        const physics = new BlockPhysics(igloo.blocks, {
          radius: igloo.radius,
          config: {
            hoverPush: igloo.radius * 0.4,
            hoverTilt: 0.52,
            hoverReach: igloo.radius * 0.82,
            neighbourFalloff: 0.28,
            returnFreq: 0.62,
            returnDamping: 1.0,
          },
        });

        // Pin ground course blocks in place
        for (const b of igloo.blocks) {
          if (b.centroid[1] < BASE_COURSE_Y) physics.frozen[b.id] = 1;
        }

        physics.writeTo(igloo.mesh);

        // Hover only: blocks lift and settle back under the pointer (or a
        // finger), and a click never knocks them out.
        const interaction = new IglooInteraction({
          click: false,
          hoverCursor: 'default',
          touchHover: true,
          dom: gl.domElement,
          camera,
          mesh: igloo.mesh,
          blocks: igloo.blocks,
          physics,
        });

        built = { igloo, physics, interaction };
        setRig(built);
        onReadyRef.current?.();
      })
      .catch((err) => {
        console.error('[world] igloo failed to load', err);
        if (import.meta.env.DEV) {
          document.documentElement.dataset.worldError = `igloo: ${err.message}`;
        }
        onReadyRef.current?.();
      });

    return () => {
      live = false;
      if (built) {
        built.interaction.dispose();
        built.igloo.dispose();
      }
      setRig(null);
    };
  }, [camera, gl, tint]);

  // Physics stepping, idle sweep, and measurement line overlays
  useFrame((state, delta) => {
    if (!rig) return;
    const { igloo, physics, interaction } = rig;

    const dt = Math.min(delta, 1 / 20);

    // Periodic ambient idle sweep wave across blocks
    const phase = state.clock.elapsedTime % SWEEP_CYCLE;
    const moving = phase < SWEEP_STROKE * SWEEP_PASSES;
    const front = moving
      ? -SWEEP_REACH + ((phase % SWEEP_STROKE) / SWEEP_STROKE) * SWEEP_REACH * 2
      : null;

    // The idle sweep is off: blocks move only under the pointer.
    if (IDLE_SWEEP && front !== null) {
      for (let i = 0; i < physics.count; i += 1) {
        if (physics.frozen[i]) continue;
        const u = physics.rest[i * 3] / igloo.radius;
        const d = (u - front) / SWEEP_WIDTH;
        const amount = Math.exp(-d * d) * SWEEP_AMOUNT;
        if (amount > 0.01) physics.applyHover(i, amount);
      }
    }

    interaction.update(dt);
    physics.step(dt);
    physics.writeTo(igloo.mesh);

    sound.igloo(interaction.strength);

    // Measurement network overlay
    const group = groupRef.current;
    const nodes = [];
    const live = interaction.strength > 0.12;

    for (let i = 0; live && i < physics.count; i += 1) {
      const amount = physics.push[i];
      if (amount < NODE_FLOOR) continue;
      const o = i * 3;
      nodes.push({
        amount,
        x: physics.rest[o] + physics.offset[o],
        y: physics.rest[o + 1] + physics.offset[o + 1],
        z: physics.rest[o + 2] + physics.offset[o + 2],
      });
    }

    nodes.sort((a, b) => b.amount - a.amount);
    const chain = nodes.slice(0, MAX_NODES);

    if (chain.length > linkedNodes) {
      for (let n = linkedNodes; n < chain.length; n += 1) sound.link(n);
    }
    linkedNodes = chain.length;

    // Wind nodes by angle about centroid
    if (chain.length > 2) {
      let cx = 0;
      let cy = 0;
      for (const nd of chain) {
        cx += nd.x;
        cy += nd.y;
      }
      cx /= chain.length;
      cy /= chain.length;
      chain.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    }

    for (let n = 0; n < MAX_NODES; n += 1) {
      const node = chain[n];
      const nodeEl = nodeRefs.current[n];
      const label = valueRefs.current[n];
      const anchor = anchorRefs.current[n];

      if (!node) {
        if (nodeEl) nodeEl.style.opacity = '0';
        if (anchor) anchor.position.set(0, -9999, 0);
        continue;
      }

      if (anchor) anchor.position.set(node.x, node.y, node.z);

      const next = chain[(n + 1) % chain.length];
      if (label && next && group) {
        worldVec.set(node.x, node.y, node.z);
        projA.copy(group.localToWorld(worldVec)).project(camera);
        worldVec.set(next.x, next.y, next.z);
        projB.copy(group.localToWorld(worldVec)).project(camera);

        const px = Math.hypot(
          ((projB.x - projA.x) * size.width) / 2,
          ((projB.y - projA.y) * size.height) / 2
        );
        label.textContent = String(Math.round(px)).padStart(2, '0');
      }

      if (nodeEl) nodeEl.style.opacity = String(Math.min(1, node.amount * 2.2));
    }

    const linePos = lineGeometry.attributes.position;
    if (chain.length > 1) {
      for (let n = 0; n < chain.length; n += 1) {
        linePos.setXYZ(n, chain[n].x, chain[n].y, chain[n].z);
      }
      for (let n = chain.length; n < LINE_VERTICES; n += 1) {
        linePos.setXYZ(n, chain[0].x, chain[0].y, chain[0].z);
      }
      linePos.needsUpdate = true;
      if (lineRef.current) lineRef.current.visible = true;
    } else if (lineRef.current) {
      lineRef.current.visible = false;
    }
  });

  return (
    <group ref={groupRef} position={origin} rotation={[0, yaw, 0]}>
      {rig && <primitive object={rig.igloo.mesh} dispose={null} />}

      {/* Interior dome warm hearth light */}
      <pointLight
        position={[0, 11.5, -2.0]}
        intensity={LOOK.igloo.lamp.intensity}
        distance={26}
        decay={2}
        color={LOOK.igloo.lamp.color}
      />

      {/* Entrance archway warm illumination */}
      <pointLight
        position={[0, 2.6, 19.0]}
        intensity={LOOK.igloo.porch.intensity}
        distance={24}
        decay={2}
        color={LOOK.igloo.porch.color}
      />

      {/* The doorway's light spilling over the snow in front of it: low and
          wide, so it warms the drift without touching the igloo's shape. */}
      <pointLight position={[7, 1.0, 34]} intensity={150} distance={26} decay={2} color="#ffb869" />

      <line ref={lineRef} geometry={lineGeometry} frustumCulled={false} visible={false}>
        <lineBasicMaterial color="#ffffff" transparent opacity={0.85} depthTest={false} />
      </line>

      {Array.from({ length: MAX_NODES }, (_, i) => (
        <group
          key={i}
          ref={(el) => {
            anchorRefs.current[i] = el;
          }}
        >
          <Html center zIndexRange={[10, 0]} wrapperClass="w-measure-wrap">
            <span
              className="w-node"
              ref={(el) => {
                nodeRefs.current[i] = el;
              }}
            >
              <span className="w-node-cross">+</span>
              <span
                className="w-node-value"
                ref={(el) => {
                  valueRefs.current[i] = el;
                }}
              />
            </span>
          </Html>
        </group>
      ))}
    </group>
  );
}
