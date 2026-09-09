import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { BufferGeometry, BufferAttribute, Color, Object3D, Vector3, Sphere } from 'three';
import { heightAt } from '../lib/terrain.js';
import { buildShellSegment, buildVaultSegment, buildBrick } from '../lib/shell.js';
import { COURSE_BLOCKS, CROWN_BLOCKS, makeProfile, entrancePlan } from '../lib/igloo-plan.js';
import { iceMapsFor } from '../lib/baked.js';
import { openingHalfAngle, clipSpan } from '../lib/arch.js';
import { LOOK } from '../lib/lighting.js';

const IDLE_SPEED = 0.55;
const IDLE_WAVELENGTH = 0.12;
const IDLE_LIFT = 0.0;

const dummy = new Object3D();
const flyVec = new Vector3();
const worldVec = new Vector3();
const projA = new Vector3();
const projB = new Vector3();
const hitLocal = new Vector3();

const MAX_NODES = 5;
const LINE_VERTICES = MAX_NODES + 1;

const rand = (i, salt) => {
  const x = Math.sin(i * 91.7 + salt * 47.3) * 43758.5453;
  return x - Math.floor(x);
};

const SETTLED = 0.0008;

const damp = (current, target, lambda, dt) => {
  if (Math.abs(target - current) < SETTLED) return target;
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
};

const GLOW_COLOUR = LOOK.igloo.glow;
const BLOCK_DOMING = 0.16;
const GLOW_STRENGTH = LOOK.igloo.strength;

const snowOnBlocks = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <normal_fragment_maps>',
    `#include <normal_fragment_maps>

     // Settled snow on skyward surfaces (crown + upper shoulders).
     vec3 skyward = inverseTransformDirection( normalize( vNormal ), viewMatrix );
     float collects = smoothstep( 0.25, 0.68, skyward.y );
     float bare = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
     float drift = mix( 0.35, 1.0, smoothstep( 0.30, 0.68, bare ) );
     float lying = collects * drift;
     diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.65, 0.69, 0.75 ), lying * 0.60 );
     roughnessFactor = mix( roughnessFactor, 0.96, lying * 0.85 );

     // Edges: delicate tight frosted rim
     float rim = smoothstep( 0.65, 0.98, vEdge );
     diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.75, 0.80, 0.90 ), rim * 0.25 );
     roughnessFactor = mix( roughnessFactor, 0.30, rim * 0.6 );`
  );

  shader.uniforms.uGlowColour = { value: new Color(GLOW_COLOUR) };
  shader.uniforms.uGlow = { value: GLOW_STRENGTH };

  shader.vertexShader = `attribute float aDepth;
     attribute float aEdge;
     varying float vDepth;
     varying float vEdge;
     ${shader.vertexShader}`.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
     vDepth = aDepth;
     vEdge = aEdge;`
  );

  shader.fragmentShader = `uniform vec3 uGlowColour;
     uniform float uGlow;
     varying float vEdge;
     varying float vDepth;
     ${shader.fragmentShader}`.replace(
    '#include <emissivemap_fragment>',
    `#include <emissivemap_fragment>
     // Soft interior light leaking through hairline joints
     totalEmissiveRadiance += uGlowColour * uGlow * pow( clamp( vDepth, 0.0, 1.0 ), 2.6 );

     // Delicate joint rim glow
     float thin = smoothstep( 0.68, 0.98, vEdge );
     totalEmissiveRadiance += vec3( 0.40, 0.60, 0.90 ) * 0.45 * thin * thin;`
  );
};

export default function Igloo({
  at = [-30, 252],
  radius = 22,
  thickness = 2.4,
  yaw = 1.24,
  heightScale = 1.50,
  reach = 11,
}) {
  const groupRef = useRef(null);
  const meshRefs = useRef([]);
  const lineRef = useRef(null);
  const nodeRefs = useRef([]);
  const valueRefs = useRef([]);
  const anchorRefs = useRef([]);

  const hover = useRef(0);
  const targetHover = useRef(0);
  const amounts = useRef(null);

  const { camera, size } = useThree();

  /* Parameters in lib/ice-sets.js under 'igloo'. pebbles is 0 there for the
     reason that file's own note gives: at this size discrete lumps read as
     pimples on the surface. */
  const ice = useMemo(() => iceMapsFor('igloo'), []);

  const { courses, collider, total, bounds, origin, plan } = useMemo(() => {
    const [ax, az] = at;
    const ground = heightAt(ax, az);

    const height = radius * heightScale;
    const profile = makeProfile(radius, height);
    const plan = entrancePlan(radius);

    const spans = COURSE_BLOCKS.length + 1;
    const DOOR_CENTRE = Math.PI / 2;

    const out = [];
    let count = 0;

    const trimmed = new Map();
    const trimmedGeometry = (span, u0, u1) => {
      const key = `${span.toFixed(4)}|${u0.toFixed(4)}`;
      if (!trimmed.has(key)) {
        trimmed.set(
          key,
          buildShellSegment({
            profile,
            u0,
            u1,
            thickness,
            dTheta: span,
            crown: thickness * BLOCK_DOMING,
          })
        );
      }
      return trimmed.get(key);
    };

    // --- Courses -----------------------------------------------------------
    for (let ring = 0; ring < COURSE_BLOCKS.length; ring += 1) {
      const u0 = ring / spans;
      const u1 = (ring + 1) / spans;
      const midU = (u0 + u1) / 2;
      const mid = profile(midU);

      const perRing = COURSE_BLOCKS[ring];
      const dTheta = (Math.PI * 2) / perRing;

      const geometry = buildShellSegment({
        profile,
        u0,
        u1,
        thickness,
        dTheta,
        crown: thickness * BLOCK_DOMING,
      });

      const top = profile(u1);
      const openHalf = openingHalfAngle(top.y, top.r, plan.arch);

      const whole = [];
      const cuts = [];

      for (let n = 0; n < perRing; n += 1) {
        const seed = ring * 1000 + n;
        const theta =
          (n + ring * 0.37) * dTheta + (rand(seed, 28) - 0.5) * 0.01;

        const pieces = clipSpan(
          theta - dTheta / 2,
          theta + dTheta / 2,
          DOOR_CENTRE,
          openHalf
        );

        for (const [a, b] of pieces) {
          const span = b - a;
          if (span < dTheta * 0.14) continue;
          const centre = (a + b) / 2;
          const full = span > dTheta * 0.995;

          const h = 1e-3;
          const pa = profile(midU - h);
          const pb = profile(midU + h);
          const dr = pb.r - pa.r;
          const dy = pb.y - pa.y;
          const dl = Math.hypot(dr, dy) || 1;
          const nR = dy / dl;
          const nY = -dr / dl;
          const seatR = mid.r - thickness / 2;

          const block = {
            rot: [
              (rand(seed, 26) - 0.5) * 0.018,
              -centre + (rand(seed, 27) - 0.5) * 0.018,
              (rand(seed, 25) - 0.5) * 0.018,
            ],
            base: [0, 0, 0],
            pos: [
              Math.cos(centre) * seatR,
              mid.y - nY * (thickness / 2),
              Math.sin(centre) * seatR,
            ],
            normal: [nR * Math.cos(centre), nY, nR * Math.sin(centre)],
            lift: ring === 0 ? 0 : 3 + (ring / COURSE_BLOCKS.length) * 12 + rand(seed, 11) * 3,
          };

          if (full) whole.push(block);
          else cuts.push({ geometry: trimmedGeometry(span, u0, u1), block });
        }
      }

      count += whole.length;
      out.push({ geometry, blocks: whole });

      for (const c of cuts) {
        count += 1;
        out.push({ geometry: c.geometry, blocks: [c.block] });
      }
    }

    // --- Crown -------------------------------------------------------------
    {
      const u0 = COURSE_BLOCKS.length / spans;
      const dTheta = (Math.PI * 2) / CROWN_BLOCKS;
      const mid = profile((u0 + 1) / 2);
      const seatR = Math.max(0.01, mid.r - thickness / 2);

      const geometry = buildShellSegment({
        profile,
        u0,
        u1: 1,
        thickness,
        dTheta,
        crown: thickness * BLOCK_DOMING,
      });

      const blocks = [];
      for (let n = 0; n < CROWN_BLOCKS; n += 1) {
        const seed = 7000 + n;
        const theta = (n + 0.5) * dTheta;
        blocks.push({
          rot: [
            (rand(seed, 26) - 0.5) * 0.012,
            -theta,
            (rand(seed, 25) - 0.5) * 0.012,
          ],
          base: [0, 0, 0],
          pos: [Math.cos(theta) * seatR, mid.y, Math.sin(theta) * seatR],
          normal: [Math.cos(theta) * 0.35, 0.94, Math.sin(theta) * 0.35],
          lift: 16,
        });
      }

      out.push({ geometry, blocks });
      count += blocks.length;
    }

    // --- Entrance piers and arch -------------------------------------------
    {
      const {
        intrados,
        extrados,
        archThickness,
        jambBlocks,
        jambHeight,
        depth,
        z,
        voussoirs,
      } = plan;

      const jambH = jambHeight / jambBlocks;
      const jambDepth = depth;
      const jambZ = z;
      const jambGeometry = buildBrick(archThickness, jambH * 0.96, jambDepth, 0.16);
      const jambX = intrados + archThickness / 2;
      const jambs = [];

      for (const side of [-1, 1]) {
        for (let k = 0; k < jambBlocks; k += 1) {
          const seed = 8000 + (side > 0 ? 50 : 0) + k;
          jambs.push({
            rot: [0, 0, (rand(seed, 27) - 0.5) * 0.005],
            base: [side * jambX, (k + 0.5) * jambH, jambZ],
            pos: [side * jambX, (k + 0.5) * jambH, jambZ],
            normal: [side, 0, 0],
            lift: 0,
          });
        }
      }
      out.push({ geometry: jambGeometry, blocks: jambs });
      count += jambs.length;

      const dAngle = Math.PI / voussoirs;
      const voussoirGeometry = buildVaultSegment({
        radius: extrados,
        thickness: archThickness,
        dAngle,
        depth,
        crown: archThickness * 0.12,
      });

      const arch = [];
      for (let a = 0; a < voussoirs; a += 1) {
        const angle = (a + 0.5) * dAngle;
        const seed = 9000 + a;
        const midR = extrados - archThickness / 2;
        arch.push({
          rot: [0, 0, angle],
          base: [0, jambHeight, z],
          pos: [Math.cos(angle) * midR, Math.sin(angle) * midR + jambHeight, z],
          normal: [Math.cos(angle), Math.sin(angle), 0],
          lift: 0,
        });
      }
      out.push({ geometry: voussoirGeometry, blocks: arch });
      count += arch.length;
    }

    const collider = buildShellSegment({
      profile,
      u0: 0,
      u1: 1,
      thickness,
      dTheta: Math.PI * 2,
      segTheta: 48,
      segU: 24,
    });

    return {
      courses: out,
      collider,
      total: count,
      bounds: new Sphere(new Vector3(0, height * 0.45, 0), radius * 2.4),
      origin: [ax, ground, az],
      plan,
    };
  }, [at, radius, thickness, heightScale]);

  useEffect(() => {
    amounts.current = new Float32Array(total);
  }, [total]);

  const lineGeometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(LINE_VERTICES * 3), 3));
    return g;
  }, []);

  useEffect(() => {
    meshRefs.current.forEach((m) => {
      if (m) m.boundingSphere = bounds;
    });
  }, [bounds, courses]);

  useFrame((state, delta) => {
    const time = state.clock.elapsedTime;
    const amt = amounts.current;
    if (!amt) return;

    const dt = Math.min(delta, 1 / 20);
    hover.current = damp(
      hover.current,
      targetHover.current,
      targetHover.current > hover.current ? 2.2 : 1.6,
      dt
    );

    const h = hover.current;
    const reach2 = reach * reach;
    const nodes = [];
    let f = 0;

    for (let c = 0; c < courses.length; c += 1) {
      const mesh = meshRefs.current[c];
      const list = courses[c].blocks;
      if (!mesh) {
        f += list.length;
        continue;
      }

      for (let i = 0; i < list.length; i += 1, f += 1) {
        const b = list[i];

        const dx = b.pos[0] - hitLocal.x;
        const dy = b.pos[1] - hitLocal.y;
        const dz = b.pos[2] - hitLocal.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const near = d2 >= reach2 ? 0 : 1 - d2 / reach2;
        const target = h * near * near;

        amt[f] = damp(amt[f], target, target > amt[f] ? 2.4 : 1.5, dt);
        const local = amt[f];

        const travel = b.lift * local * 0.45;

        dummy.position.set(
          b.base[0] + b.normal[0] * travel,
          b.base[1] + b.normal[1] * travel,
          b.base[2] + b.normal[2] * travel
        );
        dummy.rotation.set(
          b.rot[0] + b.normal[1] * local * 0.12,
          b.rot[1],
          b.rot[2] - b.normal[0] * local * 0.12
        );
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);

        if (local > 0.10 && b.lift > 0) {
          flyVec.set(
            b.pos[0] + b.normal[0] * travel,
            b.pos[1] + b.normal[1] * travel,
            b.pos[2] + b.normal[2] * travel
          );
          nodes.push({ i: f, local, x: flyVec.x, y: flyVec.y, z: flyVec.z });
        }
      }

      mesh.instanceMatrix.needsUpdate = true;
    }

    // --- 3D Polygon Tracking Network --------------------------------------
    nodes.sort((a, b) => b.local - a.local);
    const selected = nodes.slice(0, MAX_NODES);

    if (selected.length > 2) {
      let cx = 0;
      let cy = 0;
      for (const nd of selected) {
        cx += nd.x;
        cy += nd.y;
      }
      cx /= selected.length;
      cy /= selected.length;

      selected.sort((a, b) => {
        const angleA = Math.atan2(a.y - cy, a.x - cx);
        const angleB = Math.atan2(b.y - cy, b.x - cx);
        return angleA - angleB;
      });
    }

    const chain = selected;
    const linePos = lineGeometry.attributes.position;
    const group = groupRef.current;

    for (let n = 0; n < MAX_NODES; n += 1) {
      const node = chain[n];
      const nodeEl = nodeRefs.current[n];
      const label = valueRefs.current[n];
      const anchor = anchorRefs.current[n];

      if (!node) {
        if (nodeEl) nodeEl.style.opacity = '0';
        if (anchor) anchor.position.set(0, -999, 0);
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

      if (nodeEl) nodeEl.style.opacity = String(Math.min(1, node.local * 2.2));
    }

    if (chain.length > 1) {
      for (let n = 0; n < chain.length; n += 1) {
        linePos.setXYZ(n, chain[n].x, chain[n].y, chain[n].z);
      }
      linePos.setXYZ(chain.length, chain[0].x, chain[0].y, chain[0].z);
      for (let n = chain.length + 1; n < LINE_VERTICES; n += 1) {
        linePos.setXYZ(n, chain[0].x, chain[0].y, chain[0].z);
      }
      linePos.needsUpdate = true;
      if (lineRef.current) lineRef.current.visible = true;
    } else {
      if (lineRef.current) lineRef.current.visible = false;
    }
  });

  return (
    <group ref={groupRef} position={origin} rotation={[0, yaw, 0]}>
      {/* Static collider absorbing pointer events */}
      <mesh
        geometry={collider}
        visible={false}
        onPointerOver={() => {
          targetHover.current = 1;
          document.body.style.cursor = 'crosshair';
        }}
        onPointerMove={(e) => {
          const group = groupRef.current;
          if (!group) return;
          hitLocal.copy(e.point);
          group.worldToLocal(hitLocal);
          e.stopPropagation();
        }}
        onPointerOut={() => {
          targetHover.current = 0;
          document.body.style.cursor = '';
        }}
      />

      {/* Interior lamp */}
      <pointLight
        position={[0, radius * 0.38 * heightScale, -radius * 0.16]}
        intensity={550}
        distance={radius * 3.2}
        decay={2}
        color="#eaf3ff"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-near={0.4}
        shadow-camera-far={radius * 2.2}
        shadow-normalBias={0.4}
      />

      {/* Entrance archway light fill */}
      <pointLight
        position={[0, plan.jambHeight * 0.8, plan.z - plan.depth * 0.3]}
        intensity={180}
        distance={radius * 1.4}
        decay={2}
        color="#dceeff"
      />

      {/* Floor disk closing the shell */}
      <mesh position={[0, 0.45, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[radius * 0.99, 48]} />
        <meshStandardMaterial
          color="#6b7079"
          roughness={0.95}
          metalness={0}
          roughnessMap={ice.roughnessMap}
          normalMap={ice.normalMap}
          normalScale={[0.32, 0.32]}
        />
      </mesh>

      {courses.map((course, c) => (
        <instancedMesh
          key={c}
          ref={(el) => {
            meshRefs.current[c] = el;
          }}
          args={[course.geometry, undefined, course.blocks.length]}
          castShadow
          receiveShadow
          frustumCulled={false}
        >
          <meshStandardMaterial
            color="#626a7c"
            roughness={0.68}
            metalness={0.01}
            map={ice.colorMap}
            aoMap={ice.aoMap}
            aoMapIntensity={1.2}
            roughnessMap={ice.roughnessMap}
            normalMap={ice.normalMap}
            normalScale={[0.7, 0.7]}
            emissive="#000000"
            emissiveIntensity={0}
            onBeforeCompile={snowOnBlocks}
            envMapIntensity={0.32}
            dithering
          />
        </instancedMesh>
      ))}

      {/* 3D Polyline Tracking Mesh */}
      <line ref={lineRef} geometry={lineGeometry} frustumCulled={false} visible={false}>
        <lineBasicMaterial color="#ffffff" transparent opacity={0.85} depthTest={false} />
      </line>

      {/* HTML Tracking Crosshairs & Badges */}
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