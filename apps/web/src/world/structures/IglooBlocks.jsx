import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { BufferAttribute, BufferGeometry, Color, Vector3 } from 'three';
import { heightAt } from '../lib/terrain.js';
import { loadIgloo } from '../../igloo/Igloo.js';
import { BlockPhysics } from '../../igloo/BlockPhysics.js';
import { IglooInteraction } from '../../igloo/IglooInteraction.js';
import { LOOK } from '../lib/lighting.js';
import { sound } from '../lib/sound.js';

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

function seatHeight(ax, az) {
  let top = -Infinity;
  for (let b = 0; b < SEAT_BANDS; b += 1) {
    const r = FOOTPRINT * (0.72 + (0.28 * b) / (SEAT_BANDS - 1));
    for (let a = 0; a < SEAT_ARC; a += 1) {
      const t = (a / SEAT_ARC) * Math.PI * 2;
      const h = heightAt(ax + Math.cos(t) * r, az + Math.sin(t) * r);
      if (h > top) top = h;
    }
  }
  return top;
}

const worldVec = new Vector3();
const projA = new Vector3();
const projB = new Vector3();

// Custom ice shader customization: edge bevels, settled snow, sun facing, and internal illumination
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
          'vec3 skyward = inverseTransformDirection( normalize( vNormal ), viewMatrix );',
          'float collects = smoothstep( 0.22, 0.66, skyward.y );',
          'float bare = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );',
          'float drift = mix( 0.35, 1.0, smoothstep( 0.30, 0.68, bare ) );',
          'float lying = collects * drift;',
          'diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.940, 0.965, 0.995 ), lying * 0.65 );',
          'float edgeFrost = smoothstep( 0.80, 0.98, vEdge );',
          'diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.94, 0.97, 1.00 ), edgeFrost * 0.35 );',
          'roughnessFactor = mix( roughnessFactor, 0.95, lying * 0.85 );',
          'float glossEdge = smoothstep( 0.86, 1.00, vEdge );',
          'roughnessFactor = mix( roughnessFactor, 0.72, glossEdge * 0.35 );',
          'float bevel = smoothstep( 0.55, 1.00, vEdge );',
          'normal = normalize( mix( normal, vCorner, bevel * 0.75 ) );',
          'vec3 sunDir = vec3( 0.3722, 0.6464, -0.6660 );',
          'vec3 wNrm = inverseTransformDirection( normalize( vNormal ), viewMatrix );',
          'float sunDot = dot( wNrm, sunDir );',
          'float sunFace = clamp( sunDot, 0.0, 1.0 );',
          'diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.98, 0.99, 1.00 ), smoothstep( 0.25, 0.85, sunFace ) * 0.45 );',
          'diffuseColor.rgb *= mix( 0.68, 1.0, smoothstep( -0.45, 0.30, sunDot ) );',
        ].join('\n')
      )
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          'float innerFace = smoothstep( -0.30, -0.70, vFacing );',
          'float atJoint = 0.55 + 0.45 * smoothstep( 0.15, 0.95, vEdge );',
          'totalEmissiveRadiance += vec3( 1.00, 0.80, 0.48 ) * 3.60 * innerFace * atJoint;',
          'float archGlow = ( 0.70 + 0.30 * vExcite ) * vEntrance;',
          'float archRim = smoothstep( 0.84, 1.00, vEdge ) * archGlow;',
          'totalEmissiveRadiance += vec3( 1.00, 0.84, 0.52 ) * 4.60 * archRim;',
        ].join('\n')
      );
};

// Applies environment lighting and shader injections to igloo material
function gradeForWorld(material, tint) {
  material.color = new Color(tint);
  material.roughness = 0.8;
  material.envMapIntensity = 0.45;
  material.onBeforeCompile = iceShader;
  material.needsUpdate = true;
}

export default function IglooBlocks({
  at = [-30, 252],
  yaw = 1.24,
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
          click: false,
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

      {/* Interior dome warm light */}
      <pointLight
        position={[0, 12.5, -3.5]}
        intensity={LOOK.igloo.lamp.intensity}
        distance={70}
        decay={2}
        color={LOOK.igloo.lamp.color}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-near={0.4}
        shadow-camera-far={48}
        shadow-normalBias={0.4}
      />

      {/* Entrance porch illumination */}
      <pointLight
        position={[0, 4.6, 25.4]}
        intensity={LOOK.igloo.porch.intensity}
        distance={46}
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
