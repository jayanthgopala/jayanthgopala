import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, Color, DoubleSide, ShaderMaterial } from 'three';
import { CASE_RADIUS, PLINTH_HEIGHT, PLINTH_RADIUS, TUBE_BOTTOM, TUBE_TOP } from './layout.js';
import { MODEST } from '../water/device.js';

// What holds the chamber: a dark plate under it, and rings of light at its foot
// and over its mouth.
//
// Light, not machinery. Turned white parts on a pale floor have nothing to
// separate them from it — the only thing in this room brighter than the walls
// is the light itself, so the rings are what read, and the plate reads because
// it is the one dark thing in the frame.
//
// Each ring is drawn twice: a thin bright core for the line, and a much wider
// additive halo for the bloom around it. There is no post-processing on this
// canvas, so the halo has to be geometry.
//
// The lights at the foot are warm and the ones over the mouth are cool. That
// split is doing most of the work in this room: a single colour of light, however
// well placed, flattens everything it falls on, and the moment the underside of
// the chamber goes amber against a blue-grey sky the whole thing gains a top and
// a bottom. It is also why the floor's spill is warm and the wall's cove is warm
// while the sky above them stays cold.
//
// Built in the mark's own frame, where the tube runs TUBE_BOTTOM to TUBE_TOP.

/** Segments round a ring. These are seen close and edge-on, so not too few. */
const ARC = MODEST ? 64 : 128;

/**
 * Warm from below, cool from above.
 *
 * A warm white, not amber. The split only has to be wide enough to read as a
 * difference in temperature — push it as far as a real colour and the room
 * stops looking lit and starts looking gelled.
 */
const WARM = '#ffeed9';
const COOL = '#dbeaff';

/**
 * A ring of light lying flat: a bright core at `radius`, falling away into a
 * broad halo either side of it.
 */
function GlowRing({ y, radius, core = 0.008, halo = 0.16, strength = 1, tint = WARM, fade }) {
  const ref = useRef(null);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uLevel: { value: 0 },
          uRadius: { value: radius },
          uCore: { value: core },
          uHalo: { value: halo },
          uStrength: { value: strength },
          uTint: { value: new Color(tint) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vLocal;
          void main() {
            vLocal = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uLevel;
          uniform float uRadius;
          uniform float uCore;
          uniform float uHalo;
          uniform float uStrength;
          uniform vec3 uTint;
          varying vec3 vLocal;

          void main() {
            // The ring lies in its own XY before it is laid flat, so the radius
            // is measured there rather than in world space.
            float r = length( vLocal.xy );
            float d = r - uRadius;

            // A hard filament with a wide, soft bloom around it. Squaring the
            // halo keeps it from turning into a flat disc of haze.
            float line = exp( -pow( d / uCore, 2.0 ) );
            float bloom = exp( -pow( d / uHalo, 2.0 ) );
            float glow = line + bloom * bloom * 0.55;

            // The filament itself burns to white; the bloom around it keeps
            // the tint, which is where the colour of the light is read from.
            vec3 col = mix( uTint, vec3( 1.0 ), line * 0.85 );
            gl_FragColor = vec4( col * glow * uStrength * uLevel, 1.0 );
          }
        `,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      }),
    [radius, core, halo, strength, tint]
  );

  useEffect(() => () => material.dispose(), [material]);

  useFrame(() => {
    material.uniforms.uLevel.value = fade.current;
  });

  return (
    <mesh
      ref={ref}
      position={[0, y, 0]}
      rotation-x={-Math.PI / 2}
      material={material}
      renderOrder={3}
      frustumCulled={false}
    >
      {/* Wide enough to carry the whole halo, not just the filament. */}
      <ringGeometry args={[Math.max(0.001, radius - halo * 2.6), radius + halo * 2.6, ARC]} />
    </mesh>
  );
}

/** The dark plate the chamber stands on, and the matching cap over its mouth. */
function Plate({ y, height, radius, fade, color = '#3f4750' }) {
  const ref = useRef(null);

  useFrame(() => {
    if (ref.current) ref.current.material.opacity = fade.current;
  });

  return (
    <mesh ref={ref} position={[0, y + height / 2, 0]} renderOrder={1} frustumCulled={false}>
      <cylinderGeometry args={[radius, radius * 1.01, height, MODEST ? 48 : 96, 1]} />
      {/* Graphite, and rough enough not to mirror the room back. It has to be
          clearly the darkest thing in frame or the rings of light lying on it
          have nothing to be bright against. */}
      <meshStandardMaterial color={color} roughness={0.42} metalness={0.15} transparent opacity={0} />
    </mesh>
  );
}

export default function TubeRig({ levels }) {
  const group = useRef(null);
  // Written every frame and read by every part, so one number drives the whole
  // rig's fade rather than each piece sampling `levels` itself.
  const fade = useRef(0);

  useFrame(() => {
    fade.current = levels.current.show;
    if (group.current) group.current.visible = fade.current > 0.001;
  });

  const base = TUBE_BOTTOM;

  return (
    <group ref={group} visible={false}>
      {/* --- the plate, the one dark thing in the room --- */}
      <Plate y={base - PLINTH_HEIGHT} height={PLINTH_HEIGHT} radius={PLINTH_RADIUS * 0.82} fade={fade} />

      {/* --- light at the foot: two rings laid on the plate and one on the
              floor outside it, each wider and softer than the last, which is
              what makes the spill read as coming from under the chamber
              rather than from a strip drawn on the floor.

              Their heights matter, and so does their order. The plate and the
              rings are both transparent, so they are sorted by distance and
              the plate was being drawn over the two lying on it; the rings
              carry a higher renderOrder to settle that, and they sit a clear
              two centimetres proud of its face rather than the two millimetres
              that depth precision at this range simply loses. --- */}
      <GlowRing y={base + 0.022} radius={CASE_RADIUS * 1.06} core={0.006} halo={0.05} strength={1.15} tint={WARM} fade={fade} />
      <GlowRing y={base + 0.018} radius={CASE_RADIUS * 1.39} core={0.009} halo={0.1} strength={1.0} tint={WARM} fade={fade} />
      <GlowRing y={base - PLINTH_HEIGHT + 0.004} radius={CASE_RADIUS * 1.74} core={0.012} halo={0.17} strength={0.72} tint={WARM} fade={fade} />

      {/* --- and over the mouth: two, tighter, cooler --- */}
      <GlowRing y={TUBE_TOP} radius={CASE_RADIUS * 1.03} core={0.006} halo={0.045} strength={1.1} tint={COOL} fade={fade} />
      <GlowRing y={TUBE_TOP + 0.06} radius={CASE_RADIUS * 1.3} core={0.009} halo={0.09} strength={0.8} tint={COOL} fade={fade} />
    </group>
  );
}
