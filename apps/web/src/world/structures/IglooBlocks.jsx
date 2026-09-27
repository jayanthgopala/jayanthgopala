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
  roughness: 0.85,
  env: 0.35,
});
const ICE = iceTerms();

// Custom ice shader: clean frosted translucent snow/ice blocks with warm interior hearth illumination
const iceShader = (shader) => {
  shader.vertexShader =
    'attribute float aEdge;\nattribute float aEntrance;\nvarying float vEdge;\nvarying float vEntrance;\nvarying float vFacing;\nvarying float vExcite;\nvarying vec3 vCorner;\n' +
    shader.vertexShader.replace(
      '#include <begin_vertex>',
      [
        '#include <begin_vertex>',
        '  vEdge = aEdge;',
        '  vEntrance = aEntrance;',
        '  #ifdef USE_BATCHING',
        '    mat4 bMat = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );',
        '    vec3 bPos = ( bMat * vec4( transformed, 1.0 ) ).xyz;',
        '    vec3 bNor = normalize( mat3( bMat ) * objectNormal );',
        '    vec3 domeOut = length( bPos ) > 0.001 ? normalize( bPos ) : vec3( 0.0, 1.0, 0.0 );',
        '    vFacing = dot( bNor, domeOut );',
        '  #else',
        '    vFacing = 1.0;',
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
    'varying float vEdge;\nvarying float vEntrance;\nvarying float vFacing;\nvarying float vExcite;\nvarying vec3 vCorner;\n' +
    shader.fragmentShader
      .replace(
        '#include <normal_fragment_maps>',
        [
          '#include <normal_fragment_maps>',
          'float glossEdge = smoothstep( 0.86, 1.00, vEdge );',
          'roughnessFactor = mix( roughnessFactor, 0.74, glossEdge * 0.30 );',
          'float bevel = smoothstep( 0.55, 1.00, vEdge );',
          'normal = normalize( mix( normal, vCorner, bevel * 0.75 ) );',
          `vec3 sunDir = vec3( ${SUN_DIR.map((c) => c.toFixed(4)).join(', ')} );`,
          'vec3 wNrm = inverseTransformDirection( normalize( vNormal ), viewMatrix );',
          'float sunDot = dot( wNrm, sunDir );',
          'float sunFace = clamp( sunDot, 0.0, 1.0 );',
          'diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.96, 0.98, 1.00 ), smoothstep( 0.25, 0.85, sunFace ) * 0.35 );',
          'diffuseColor.rgb *= mix( 0.76, 1.0, smoothstep( -0.45, 0.30, sunDot ) );',
        ].join('\n')
      )
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          'float innerFace = smoothstep( 0.20, -0.55, vFacing );',
          // Warm golden hearth glow on all interior block surfaces
          'totalEmissiveRadiance += vec3( 1.00, 0.76, 0.38 ) * 4.2 * innerFace;',
          // Translucent light scattering through ice blocks from inside
          'vec3 domeOut = normalize( vec3( vNormal.x, max(0.12, vNormal.y), vNormal.z ) );',
          'float scatter = clamp( dot( -normalize( vViewPosition ), domeOut ), 0.0, 1.0 );',
          'float seamLeak = smoothstep( 0.30, 0.95, vEdge );',
          'totalEmissiveRadiance += vec3( 1.00, 0.70, 0.28 ) * ( 0.18 + 0.65 * seamLeak ) * ( 0.35 + 0.65 * scatter );',
          // Entrance arch glow radiating warm amber illumination
          'float insideArch = smoothstep( 0.35, -0.35, vFacing );',
          'float archGlow = ( 0.80 + 0.20 * vExcite ) * vEntrance;',
          'float archRim = smoothstep( 0.75, 1.00, vEdge ) * archGlow;',
          'totalEmissiveRadiance += vec3( 1.00, 0.82, 0.46 ) * ( 3.8 * insideArch + 2.4 * archRim ) * archGlow;',
          // Subtle daylight rim on outer dome contours
          'float nv = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );',
          'float rim = pow( 1.0 - nv, 2.6 );',
          'totalEmissiveRadiance += vec3( 0.20, 0.38, 0.60 ) * rim * ( 1.0 - innerFace ) * 0.30;',
        ].join('\n')
      );
};

// Applies environment lighting and shader injections to igloo material
function gradeForWorld(material, tint) {
  material.color = new Color(tint);
  material.roughness = ICE.roughness;
  material.envMapIntensity = ICE.env;
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

        const interaction = new IglooInteraction({
          click: true,
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

    if (front !== null) {
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
        position={[0, 4.2, 24.8]}
        intensity={LOOK.igloo.porch.intensity}
        distance={14}
        decay={2}
        color={LOOK.igloo.porch.color}
      />

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
