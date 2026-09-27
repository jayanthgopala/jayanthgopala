import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, ShaderMaterial } from 'three';
import { MOUND_AT, heightAt } from '../lib/terrain.js';
import { SLAB_HALF, revealAt } from '../lib/reveal.js';
import { MIST_LAYER } from './Weather.jsx';
import { useWorldScroll } from '../scroll/ScrollProvider.jsx';

// Spatial wireframe lattice survey grid that dissolves during camera descent

const OPACITY = 0.5;

// Grid cell sizing
const CELL_SIZE = 7.4;

const SPAN_X = 700;
const SPAN_Z = 700;

const CELLS = Math.round(SPAN_X / CELL_SIZE);

// Height offset clearing the igloo dome
const RISE = 46;

// Terrain contour following weight
const FOLLOW = 0.55;

function buildLattice(at) {
  const [ax, az] = at;

  const stepX = SPAN_X / CELLS;
  const stepZ = SPAN_Z / CELLS;
  // one quantum for the vertical too, so a riser is as tall as a cell is wide and the steps come out cubic
  const stepY = stepX;

  // Precompute elevation field
  const y = [];
  for (let i = 0; i <= CELLS; i += 1) {
    y.push([]);
    for (let j = 0; j <= CELLS; j += 1) {
      const px = ax - SPAN_X / 2 + i * stepX;
      const pz = az - SPAN_Z / 2 + j * stepZ;
      const ground = heightAt(px, pz);
      y[i].push(Math.round((ground * FOLLOW + RISE) / stepY) * stepY);
    }
  }

  const verts = [];
  const px = (i) => ax - SPAN_X / 2 + i * stepX;
  const pz = (j) => az - SPAN_Z / 2 + j * stepZ;

  // Staircase step link
  const link = (x0, y0, z0, x1, y1, z1) => {
    verts.push(x0, y0, z0, x1, y0, z1);
    if (y1 !== y0) verts.push(x1, y0, z1, x1, y1, z1);
  };

  for (let i = 0; i <= CELLS; i += 1) {
    for (let j = 0; j <= CELLS; j += 1) {
      if (i < CELLS) link(px(i), y[i][j], pz(j), px(i + 1), y[i + 1][j], pz(j));
      if (j < CELLS) link(px(i), y[i][j], pz(j), px(i), y[i][j + 1], pz(j + 1));
    }
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
  return g;
}

// Drawn only where the world has not arrived yet: brightest right at the
// reveal's frontier, fading out ahead of it and with distance, so the grid
// reads as the survey the world is being built onto rather than lines laid
// over the finished scene.
const LATTICE_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4( position, 1.0 );
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const LATTICE_FRAG = /* glsl */ `
  uniform float uReveal;
  uniform float uOpacity;
  varying vec3 vWorld;
  void main() {
    float k = uReveal * uReveal;
    float front = mix( ${SLAB_HALF.toFixed(1)}, 4200.0, k );
    float beyond = length( vWorld.xz - vec2( ${MOUND_AT[0].toFixed(1)}, ${MOUND_AT[1].toFixed(1)} ) ) - front;
    float ahead = smoothstep( -1.0, 5.0, beyond );
    float edge = exp( -max( beyond, 0.0 ) / 45.0 );
    float alpha = ahead * ( 0.25 + 0.75 * edge ) * uOpacity;
    if ( alpha < 0.004 ) discard;
    gl_FragColor = vec4( 0.9, 0.95, 1.0, alpha );
  }
`;

export default function Lattice({ at = [-30, 252], seconds = 3.6 }) {
  const lines = useRef(null);
  const done = useRef(false);
  const { intro } = useWorldScroll();

  const geometry = useMemo(() => buildLattice(at), [at]);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: LATTICE_VERT,
        fragmentShader: LATTICE_FRAG,
        uniforms: { uReveal: { value: 0 }, uOpacity: { value: OPACITY } },
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    []
  );

  useFrame(() => {
    const mesh = lines.current;
    if (!mesh || done.current) return;
    material.uniforms.uReveal.value = revealAt(intro.current);

    // Faded out as the intro ends, then gone for good.
    const k = Math.min(1, Math.max(0, intro.current) / seconds);
    const left = 1 - k;
    material.uniforms.uOpacity.value = OPACITY * left * left;

    if (k >= 1) {
      done.current = true;
      mesh.visible = false;
      geometry.dispose();
      material.dispose();
    }
  });

  return (
    <lineSegments
      ref={lines}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      // On the mist's layer, which the water's mirror does not draw.
      onUpdate={(mesh) => mesh.layers.set(MIST_LAYER)}
    />
  );
}
