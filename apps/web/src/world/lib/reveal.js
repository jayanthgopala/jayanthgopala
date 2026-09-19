import { MOUND_AT } from './terrain.js';
import { INTRO } from '../chapters.js';

// The opening reveal: the world is uncovered outward from the igloo in square
// blocks while the camera descends. Everything standing on the ground shares
// the one frontier, so the water and the floes arrive with the snow under
// them instead of ahead of it.

export const SLAB_HALF = 34;
const REVEAL_CELL = 2.5;

/** Reveal progress (0..1) from the intro clock, as Terrain drives it. */
export const revealAt = (introSeconds) => Math.min(1, introSeconds / INTRO.tail);

/**
 * GLSL block that discards fragments beyond the frontier. `world` names a vec3
 * holding the fragment's world position; `uniform float uReveal;` must be
 * declared by the caller.
 */
export const revealDiscard = (world) => `
  {
    float k = uReveal * uReveal;
    vec2 d = abs( ${world}.xz - vec2( ${MOUND_AT[0].toFixed(1)}, ${MOUND_AT[1].toFixed(1)} ) );

    // Quantized block frontier
    float cellSize = ${REVEAL_CELL.toFixed(1)};
    vec2 cell = floor( d / cellSize );
    vec2 cc = ( cell + 0.5 ) * cellSize;
    float reach = length( cc );

    float jitter = fract( sin( dot( cell, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
    float front = mix( ${SLAB_HALF.toFixed(1)}, 4200.0, k );
    float outside = reach - front * ( 0.96 + 0.07 * jitter );

    if ( outside > 0.0 ) discard;
  }
`;

/**
 * Set while a planar reflection is being drawn, so costly screen-space work
 * (the terrain's raymarched ground mist) can be skipped in the mirror, where
 * the ripples hide it anyway.
 */
export const reflectPass = { value: 0 };

/**
 * Patches a built-in material's shaders so it takes part in the reveal. Call
 * from onBeforeCompile; `uniform` is the shared { value } the caller drives.
 */
export function withReveal(shader, uniform) {
  shader.uniforms.uReveal = uniform;
  shader.vertexShader = `varying vec3 vRevealWorld;\n${shader.vertexShader}`.replace(
    '#include <worldpos_vertex>',
    `#include <worldpos_vertex>
     {
       vec4 revealAt = vec4( transformed, 1.0 );
       #ifdef USE_INSTANCING
         revealAt = instanceMatrix * revealAt;
       #endif
       vRevealWorld = ( modelMatrix * revealAt ).xyz;
     }`
  );
  shader.fragmentShader = `uniform float uReveal;\nvarying vec3 vRevealWorld;\n${shader.fragmentShader}`.replace(
    'void main() {',
    `void main() {\n${revealDiscard('vRevealWorld')}`
  );
}
