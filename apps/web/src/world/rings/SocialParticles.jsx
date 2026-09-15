import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Color, ShaderMaterial } from 'three';
import { iconPoints } from './geometry.js';
import { MODEST, SMALL } from '../water/device.js';
import { LOGO_Y } from './layout.js';

// A cloud of points holding the shape of the current social mark over the
// pedestal. Switching links throws the cloud apart and lets it settle into the
// next mark; arriving in the room gathers it in from a loose swarm.

/** Sized for the pedestal at room distance; more points only cost memory. */
const COUNT = MODEST ? 9000 : 20000;
const MORPH_SECONDS = 1.7;

const VERTEX = /* glsl */ `
  attribute vec3 aFrom;
  attribute vec4 aRand;
  uniform float uMix, uTime, uShow, uSize, uPixelRatio, uViewHeight;
  varying float vShade;
  varying float vAlpha;

  void main() {
    // Staggered per point, so the mark dissolves and re-forms in a wave.
    float d = clamp( ( uMix - aRand.w * 0.3 ) / 0.7, 0.0, 1.0 );
    d = d * d * ( 3.0 - 2.0 * d );

    vec3 dir = normalize( aRand.xyz * 2.0 - 1.0 + 1e-3 );
    vec3 p = mix( aFrom, position, d );
    float burst = sin( 3.14159 * d );
    p += dir * burst * ( 0.25 + 0.45 * aRand.w );
    p += dir * ( 1.0 - uShow ) * ( 1.2 + aRand.w );
    p += 0.01 * vec3(
      sin( uTime * 1.3 + aRand.x * 40.0 ),
      sin( uTime * 1.1 + aRand.y * 40.0 ),
      sin( uTime * 0.9 + aRand.z * 40.0 )
    );

    vec4 mv = modelViewMatrix * vec4( p, 1.0 );
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixelRatio * ( uViewHeight / 900.0 ) / max( 0.2, -mv.z );

    vShade = clamp( p.y / 1.6 + 0.5 + ( aRand.y - 0.5 ) * 0.5, 0.0, 1.0 );
    vAlpha = uShow * ( 0.55 + 0.45 * aRand.z ) * ( 1.0 - 0.45 * burst );
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uDark, uLight;
  varying float vShade;
  varying float vAlpha;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = dot( c, c );
    if ( r > 0.25 ) discard;
    vec3 col = mix( uDark, uLight, vShade * 0.8 );
    gl_FragColor = vec4( col, vAlpha * smoothstep( 0.25, 0.12, r ) );
  }
`;

// Rasterising and sampling a mark blocks the main thread, so each one is built
// in its own idle slot instead of all at once while the reader is scrolling.
function useIconTargets(socials) {
  const [targets, setTargets] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let handle = 0;
    const built = [];
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 16));
    const cancelIdle = window.cancelIdleCallback || clearTimeout;

    const step = () => {
      if (cancelled) return;
      const i = built.length;
      if (i >= socials.length) {
        setTargets(built);
        return;
      }
      built.push(iconPoints(socials[i].icon, socials[i].label, COUNT, 1.55, 101 + i * 17));
      handle = idle(step);
    };

    setTargets(null);
    handle = idle(step);
    return () => {
      cancelled = true;
      cancelIdle(handle);
    };
  }, [socials]);

  return targets;
}

export default function SocialParticles({ socials, index, levels, reduced = false }) {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const group = useRef(null);
  const points = useRef(null);
  const shown = useRef(0);

  const targets = useIconTargets(socials);

  const geometry = useMemo(() => {
    if (!targets?.length) return null;
    const g = new BufferGeometry();
    const first = targets[0];
    g.setAttribute('position', new BufferAttribute(first.slice(), 3));
    g.setAttribute('aFrom', new BufferAttribute(first.slice(), 3));
    const rand = new Float32Array(COUNT * 4);
    for (let i = 0; i < rand.length; i += 1) rand[i] = Math.random();
    g.setAttribute('aRand', new BufferAttribute(rand, 4));
    shown.current = 0;
    return g;
  }, [targets]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uMix: { value: 1 },
          uTime: { value: 0 },
          uShow: { value: 0 },
          uSize: { value: SMALL ? 8.5 : 7.5 },
          uPixelRatio: { value: 1 },
          uViewHeight: { value: 900 },
          uDark: { value: new Color('#2f3a4c') },
          uLight: { value: new Color('#dfe8f3') },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
      }),
    []
  );

  useEffect(() => () => geometry?.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    if (!targets?.length || !geometry) return;
    const next = ((index % targets.length) + targets.length) % targets.length;
    if (next === shown.current) return;

    const position = geometry.attributes.position;
    const from = geometry.attributes.aFrom;
    from.array.set(position.array);
    position.array.set(targets[next]);
    position.needsUpdate = true;
    from.needsUpdate = true;
    shown.current = next;
    material.uniforms.uMix.value = reduced ? 1 : 0;
  }, [index, targets, geometry, material, reduced]);

  useFrame(({ clock }, delta) => {
    if (!geometry) return;
    const u = material.uniforms;
    const show = levels.current.show;
    u.uTime.value = clock.elapsedTime;
    u.uShow.value = show;
    u.uMix.value = Math.min(1, u.uMix.value + Math.min(delta, 0.05) / MORPH_SECONDS);
    u.uPixelRatio.value = gl.getPixelRatio();
    u.uViewHeight.value = size.height;

    if (points.current) points.current.visible = show > 0.001;
    if (group.current) group.current.rotation.y = Math.sin(clock.elapsedTime * 0.35) * 0.35;
  });

  if (!geometry) return null;

  return (
    <group ref={group} position={[0, LOGO_Y, 0]}>
      <points ref={points} geometry={geometry} material={material} frustumCulled={false} visible={false} />
    </group>
  );
}
