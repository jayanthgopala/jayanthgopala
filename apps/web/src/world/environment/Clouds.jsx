import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BackSide, Color, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import { LOOK } from '../lib/lighting.js';

// Procedural dynamic cloud dome shader
const CLOUD_SHADER = /* glsl */ `
  varying vec3 vDir;
  uniform float uTime;
  uniform vec3 uLit;
  uniform vec3 uShade;
  uniform vec3 uScale;
  uniform vec3 uSpeed;
  uniform float uCoverage;
  uniform float uSoftness;
  uniform float uOpacity;
  uniform float uHorizonFade;
  uniform vec3 uSunDir;

  float hash( vec2 p ) {
    return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
  }

  float vnoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix(
      mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), u.x ),
      mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), u.x ),
      u.y
    );
  }

  // four octaves, normalised so the result genuinely spans 0..1
  float fbm( vec2 p ) {
    float v = 0.0;
    float a = 0.5;
    for ( int i = 0; i < 4; i ++ ) {
      v += a * vnoise( p );
      p *= 2.03;
      a *= 0.5;
    }
    return v / 0.9375;
  }

  void main() {
    vec3 d = normalize( vDir );

    if ( d.y <= 0.0 ) discard;

    vec2 p = d.xz / max( d.y, 0.06 );

    float f = 0.0;
    f += 0.50 * fbm( p * uScale.x + uTime * uSpeed.x * vec2( 1.00,  0.22 ) );
    f += 0.32 * fbm( p * uScale.y + uTime * uSpeed.y * vec2( 0.88, -0.30 ) );
    f += 0.18 * fbm( p * uScale.z + uTime * uSpeed.z * vec2( 0.60,  0.50 ) );

    float a = smoothstep( uCoverage - uSoftness * 0.5, uCoverage + uSoftness * 0.5, f );

    vec3 col = mix( uShade, uLit, smoothstep( uCoverage * 0.85, 0.82, f ) );

    float sunDot = max( 0.0, dot( d, uSunDir ) );
    float sunAura = pow( sunDot, 12.0 );
    float sunCore = pow( sunDot, 46.0 );
    vec3 sunRimCol = vec3( 1.0, 0.97, 0.90 );
    col = mix( col, sunRimCol, ( sunAura * 0.40 + sunCore * 0.25 ) * ( 1.0 - a * 0.40 ) );

    // cloud gently veils the sun so it stays a soft atmospheric glow
    a *= mix( 1.0, 0.55, sunCore );

    a *= smoothstep( 0.0, uHorizonFade, d.y );

    gl_FragColor = vec4( col, a * uOpacity );
  }
`;

const CLOUD_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    // Local space direction vector
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

export default function Clouds() {
  const { camera } = useThree();
  const ref = useRef();
  const C = LOOK.clouds;

  const material = useMemo(() => {
    const lit = new Color(`rgb(${C.lit.join(',')})`);
    const shade = new Color(`rgb(${C.shade.join(',')})`);
    const sunPos = LOOK.sun || [0.235, 0.88];
    const sunAngle = (sunPos[0] - 0.5) * 2 * Math.PI;
    const sunElev = (1 - sunPos[1]) * (Math.PI / 2);
    const sunDir = new Vector3(
      Math.cos(sunElev) * Math.cos(sunAngle),
      Math.sin(sunElev),
      Math.cos(sunElev) * Math.sin(sunAngle)
    ).normalize();

    return new ShaderMaterial({
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_SHADER,
      uniforms: {
        uTime: { value: 0 },
        uLit: { value: lit },
        uShade: { value: shade },
        uScale: { value: new Vector3(C.scale[0], C.scale[1], C.scale[2]) },
        uSpeed: { value: new Vector3(C.speed[0], C.speed[1], C.speed[2]) },
        uCoverage: { value: C.coverage },
        uSoftness: { value: C.softness },
        uOpacity: { value: C.opacity },
        uHorizonFade: { value: C.horizonFade },
        uSunDir: { value: sunDir },
      },
      side: BackSide,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
  }, [C]);

  const geometry = useMemo(() => new SphereGeometry(2400, 32, 24), []);

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
    // Center cloud dome on camera position
    if (ref.current) ref.current.position.copy(camera.position);
  });

  return (
    <mesh
      ref={ref}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={-1}
    />
  );
}
