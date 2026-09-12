import { useEffect, useRef } from 'react';
import { ICE_PAGE } from './lib/ice-page.js';

// Renders the exact same drifting cloud smear ('smerge') and ice dot grid
// as the project page backdrop, adapted for the explore page.

const VERT = /* glsl */ `
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform vec2 uViewport;
uniform float uDpr;
uniform float uTime;
uniform float uSmear;
uniform float uScroll;
uniform vec4 uGlaze[4];

uniform vec3 uIceBase;
uniform vec4 uIceDot;
uniform vec2 uIceDotSize;
uniform vec4 uGlowCentre;
uniform vec4 uGlowEdge;
uniform vec4 uWashTop;
uniform vec4 uWashBottom;
uniform float uWashClear;

vec3 overGradient(vec4 a, vec4 b, float t, vec3 below) {
  vec3 pm = mix(a.rgb * a.a, b.rgb * b.a, t);
  return pm + below * (1.0 - mix(a.a, b.a, t));
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float fbm(vec2 p) {
  return vnoise(p) * 0.55 + vnoise(p * 2.1) * 0.28 + vnoise(p * 4.3) * 0.17;
}

float smear(vec2 p, float t) {
  vec2 warp = vec2(
    fbm(p * 0.42 + vec2(t * 0.055, t * -0.038)),
    fbm(p * 0.51 + vec2(t * -0.047, t * 0.031))
  );

  vec2 q = p + (warp - 0.5) * 2.6;
  vec2 stretched = vec2(q.x * 0.42, q.y * 1.35);
  return fbm(stretched + vec2(t * 0.085, t * 0.012));
}

void main() {
  vec2 css = gl_FragCoord.xy / max(uDpr, 0.0001);
  vec2 px = vec2(css.x, uViewport.y - css.y);
  vec2 screen = clamp(css / max(uViewport, vec2(1.0)), 0.0, 1.0);
  float aspect = uViewport.x / max(uViewport.y, 1.0);

  vec3 c = uIceBase;

  vec2 cell = px - uIceDotSize.y * floor(px / uIceDotSize.y + 0.5);
  float dotMask = 1.0 - smoothstep(uIceDotSize.x - 0.5, uIceDotSize.x + 0.5, length(cell));
  c = mix(c, uIceDot.rgb, uIceDot.a * dotMask);

  vec2 halfSize = uViewport * 0.5;
  float r = clamp(length(px - halfSize) / length(halfSize), 0.0, 1.0);
  c = overGradient(uGlowCentre, uGlowEdge, r, c);

  float y = clamp(px.y / uViewport.y, 0.0, 1.0);
  c = y < uWashClear
    ? overGradient(uWashTop, vec4(0.0), y / uWashClear, c)
    : overGradient(vec4(0.0), uWashBottom, (y - uWashClear) / (1.0 - uWashClear), c);

  vec2 field = vec2(screen.x * aspect, screen.y - uScroll) * 0.95;
  float haze = smear(field, uTime);
  float shade = clamp((haze - 0.63) * 3.0, -1.0, 1.0);
  c -= shade * uSmear;

  for (int i = 0; i < 4; i++) {
    vec4 frost = uGlaze[i];
    if (frost.w <= 0.0) continue;

    vec2 delta = (screen - frost.xy) * vec2(aspect, 1.0);
    float fall = 1.0 - smoothstep(frost.z * 0.35, frost.z, length(delta));
    if (fall <= 0.0) continue;

    float grain = fbm(delta * 34.0 + frost.xy * 40.0);
    float veil = fall * frost.w * (0.6 + grain * 0.4);
    c = mix(c, vec3(dot(c, vec3(0.3333))), veil * 0.3);
  }

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('[DetailBackdrop] Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export default function DetailBackdrop({ scrollRef }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    if (!gl) return undefined;

    const vs = createShader(gl, gl.VERTEX_SHADER, VERT);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return undefined;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('[DetailBackdrop] Program link error:', gl.getProgramInfoLog(program));
      return undefined;
    }

    gl.useProgram(program);

    // Full-screen quad
    const quad = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1,
    ]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

    const aPosition = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    // Uniform locations
    const uViewportLoc = gl.getUniformLocation(program, 'uViewport');
    const uDprLoc = gl.getUniformLocation(program, 'uDpr');
    const uTimeLoc = gl.getUniformLocation(program, 'uTime');
    const uSmearLoc = gl.getUniformLocation(program, 'uSmear');
    const uScrollLoc = gl.getUniformLocation(program, 'uScroll');
    const uIceBaseLoc = gl.getUniformLocation(program, 'uIceBase');
    const uIceDotLoc = gl.getUniformLocation(program, 'uIceDot');
    const uIceDotSizeLoc = gl.getUniformLocation(program, 'uIceDotSize');
    const uGlowCentreLoc = gl.getUniformLocation(program, 'uGlowCentre');
    const uGlowEdgeLoc = gl.getUniformLocation(program, 'uGlowEdge');
    const uWashTopLoc = gl.getUniformLocation(program, 'uWashTop');
    const uWashBottomLoc = gl.getUniformLocation(program, 'uWashBottom');
    const uWashClearLoc = gl.getUniformLocation(program, 'uWashClear');

    const glazeLocs = [];
    for (let i = 0; i < 4; i += 1) {
      glazeLocs.push(gl.getUniformLocation(program, `uGlaze[${i}]`));
    }

    // Set static uniforms
    gl.uniform3f(
      uIceBaseLoc,
      ICE_PAGE.base[0] / 255,
      ICE_PAGE.base[1] / 255,
      ICE_PAGE.base[2] / 255
    );
    gl.uniform4f(
      uIceDotLoc,
      ICE_PAGE.dot.color[0] / 255,
      ICE_PAGE.dot.color[1] / 255,
      ICE_PAGE.dot.color[2] / 255,
      ICE_PAGE.dot.alpha
    );
    gl.uniform2f(uIceDotSizeLoc, ICE_PAGE.dot.radius, ICE_PAGE.dot.spacing);
    gl.uniform4f(
      uGlowCentreLoc,
      ICE_PAGE.glow.centre[0] / 255,
      ICE_PAGE.glow.centre[1] / 255,
      ICE_PAGE.glow.centre[2] / 255,
      ICE_PAGE.glow.centre[3]
    );
    gl.uniform4f(
      uGlowEdgeLoc,
      ICE_PAGE.glow.edge[0] / 255,
      ICE_PAGE.glow.edge[1] / 255,
      ICE_PAGE.glow.edge[2] / 255,
      ICE_PAGE.glow.edge[3]
    );
    gl.uniform4f(
      uWashTopLoc,
      ICE_PAGE.wash.top[0] / 255,
      ICE_PAGE.wash.top[1] / 255,
      ICE_PAGE.wash.top[2] / 255,
      ICE_PAGE.wash.top[3]
    );
    gl.uniform4f(
      uWashBottomLoc,
      ICE_PAGE.wash.bottom[0] / 255,
      ICE_PAGE.wash.bottom[1] / 255,
      ICE_PAGE.wash.bottom[2] / 255,
      ICE_PAGE.wash.bottom[3]
    );
    gl.uniform1f(uWashClearLoc, ICE_PAGE.wash.clearAt);
    gl.uniform1f(uSmearLoc, 0.11);

    // Frost glaze patches
    const patches = Array.from({ length: 4 }, () => ({
      x: Math.random(),
      y: Math.random(),
      radius: 0.16 + Math.random() * 0.22,
      life: 7 + Math.random() * 7,
      age: Math.random() * 6,
    }));

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let animFrame = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uViewportLoc, width, height);
      gl.uniform1f(uDprLoc, dpr);
    };

    resize();
    window.addEventListener('resize', resize);

    let last = performance.now();
    let time = 0;

    const render = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      time += dt;

      gl.uniform1f(uTimeLoc, time);
      if (uScrollLoc) {
        const st = scrollRef?.current
          ? scrollRef.current.scrollTop / Math.max(1, window.innerHeight)
          : 0;
        gl.uniform1f(uScrollLoc, st * 0.5);
      }

      for (let i = 0; i < 4; i += 1) {
        const patch = patches[i];
        patch.age += dt;
        if (patch.age > patch.life) {
          patch.age = 0;
          patch.x = Math.random();
          patch.y = Math.random();
          patch.radius = 0.16 + Math.random() * 0.22;
          patch.life = 7 + Math.random() * 7;
        }
        const t = Math.min(1, Math.max(0, patch.age / patch.life));
        const strength = Math.sin(Math.PI * t) ** 1.6;
        gl.uniform4f(glazeLocs[i], patch.x, patch.y, patch.radius, strength);
      }

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      if (!reduced) {
        animFrame = requestAnimationFrame(render);
      }
    };

    if (reduced) {
      render(performance.now());
    } else {
      animFrame = requestAnimationFrame(render);
    }

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animFrame);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [scrollRef]);

  return (
    <canvas
      ref={canvasRef}
      className="w-detail-bg"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 0,
        display: 'block',
      }}
      aria-hidden="true"
    />
  );
}
