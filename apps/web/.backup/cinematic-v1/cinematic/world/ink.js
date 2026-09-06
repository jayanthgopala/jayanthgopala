import {
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RawShaderMaterial,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  LinearFilter,
  LinearSRGBColorSpace,
} from 'three';

/**
 * The ink pass — one fullscreen shader that does most of the art direction.
 *
 * A plain 3D render of a figure in a hall reads as somebody's WebGL demo. The
 * same render pushed through a rotated halftone screen, remapped onto two flat
 * colours and grained reads as printed illustration. This file is worth more to
 * the look than everything else in the directory put together.
 *
 * Written against a render target and a fullscreen quad rather than three's
 * EffectComposer, which drags in four example modules to run a single pass.
 *
 * Four things here are load-bearing, and three of them are load-bearing because
 * getting them wrong produces a black screen with no error:
 *
 *  1. NO DERIVATIVE FUNCTIONS. A RawShaderMaterial compiles as GLSL ES 1.00,
 *     where fwidth needs an extension pragma that three no longer emits. The
 *     shader fails to link and the canvas goes black. The halftone edge width
 *     is derived from the known cell size instead, which is exact anyway.
 *
 *  2. THE PASS ENCODES sRGB ITSELF. three only appends its output-colourspace
 *     conversion to materials it generates. A raw shader writes exactly what it
 *     is told, so without the transfer below, linear values reach an sRGB
 *     display and every midtone collapses toward black.
 *
 *  3. CHROMA SURVIVES THE DUOTONE. Naively remapping luminance onto two colours
 *     flattens the signal-coloured rim light and the disc along with the
 *     neutrals. Saturated pixels are restored from the source, so exactly the
 *     elements meant to carry colour keep it.
 *
 *  4. THE HALFTONE GRID IS IN DEVICE PIXELS, not UV. A grid measured in UV
 *     rescales with the viewport, so the print gets coarser as the window
 *     widens — which reads immediately as a bug.
 */

/* No backticks inside these two strings. They are template literals, and a
   backtick in a GLSL comment terminates the literal mid-shader — which fails
   as a JavaScript syntax error at import time, nowhere near the shader. */

const VERT = /* glsl */ `
precision highp float;

attribute vec3 position;
varying vec2 vUv;

void main() {
  // The geometry is a 2x2 plane, so its own coordinates are already clip
  // space. No projection matrix is involved, which is the entire reason this
  // is a RawShaderMaterial rather than a ShaderMaterial.
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform sampler2D tScene;
uniform vec2  uRes;
uniform vec3  uDark;
uniform vec3  uLight;
uniform float uHalftone;
uniform float uInvert;
uniform float uBlack;
uniform float uWhite;
uniform float uDot;
uniform float uGrain;
uniform float uTime;
uniform float uVignette;

varying vec2 vUv;

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec3 src = texture2D(tScene, vUv).rgb;
  float l = clamp(luma(src), 0.0, 1.0);

  // --- Levels --------------------------------------------------------------
  // A lit 3D scene occupies a narrow band around mid-grey, and mapping that
  // band straight onto two colours produces a uniformly grey image with no
  // blacks and no whites — which is exactly what a duotone must not look like.
  // Pinning the black and white points first is what gives the print its bite.
  l = clamp((l - uBlack) / max(0.001, uWhite - uBlack), 0.0, 1.0);

  // --- Halftone ------------------------------------------------------------
  // Screen-space dot grid at 27 degrees, the angle single-colour halftones
  // traditionally use because it is least likely to beat against horizontal
  // and vertical edges in the artwork. Dot radius tracks luminance, so dark
  // areas grow solid and light areas open up.
  vec2 px = vUv * uRes;
  const float A = 0.4712;
  vec2 rp = vec2(px.x * cos(A) - px.y * sin(A), px.x * sin(A) + px.y * cos(A));
  vec2 cell = fract(rp / uDot) - 0.5;
  float d = length(cell) * 2.0;

  // Dot radius grows as the source gets DARKER, so ink pools in the shadows
  // and the highlights open up. Thresholding on l rather than on 1.0 - l
  // inverts the whole screen — black areas come back white — and because the
  // duotone then maps that inversion onto two mid-tones, the result is not an
  // obviously broken image but a uniformly grey one, which is far harder to
  // spot as a bug.
  float radius = 1.0 - l;

  // Edge width, computed rather than sampled. We know the field exactly: d
  // spans 0..1 across half a cell of uDot device pixels, so it moves by
  // 2/uDot per pixel. See note 1 in the header.
  float aa = 1.5 / uDot;
  float screened = smoothstep(radius - aa, radius + aa, d);

  float shade = mix(l, screened, uHalftone);

  // --- The inversion -------------------------------------------------------
  // This is how the ink-to-paper cut happens, and why the scene is lit exactly
  // once for the whole sequence. Flipping luminance turns one rim-lit setup
  // into two complete worlds: a dark figure in a bright hall is the same
  // render as a bright figure in a dark one. Two lighting rigs that both had
  // to look good was the obvious approach and a considerably worse one.
  shade = mix(shade, 1.0 - shade, uInvert);

  // --- Duotone -------------------------------------------------------------
  vec3 duo = mix(uDark, uLight, clamp(shade, 0.0, 1.0));

  float mx = max(max(src.r, src.g), src.b);
  float mn = min(min(src.r, src.g), src.b);
  float sat = mx - mn;
  vec3 col = mix(duo, src, smoothstep(0.10, 0.42, sat));

  // --- Grain ---------------------------------------------------------------
  // Animated and deliberately coarse. Static grain looks like a dirty lens;
  // moving grain reads as film.
  float g = hash(px + fract(uTime) * 91.7) - 0.5;
  col += g * uGrain;

  // --- Vignette ------------------------------------------------------------
  vec2 v = vUv - 0.5;
  col = mix(col, uDark, clamp(dot(v, v) * uVignette, 0.0, 1.0));

  // --- sRGB ----------------------------------------------------------------
  // See note 2 in the header. Without this the whole world looks unlit.
  col = clamp(col, 0.0, 1.0);
  col = mix(
    col * 12.92,
    1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055,
    step(0.0031308, col)
  );

  gl_FragColor = vec4(col, 1.0);
}
`;

export class InkPass {
  constructor(renderer) {
    this.renderer = renderer;

    const size = renderer.getDrawingBufferSize(new Vector2());
    this.target = new WebGLRenderTarget(size.x, size.y, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      // Explicit: the pass does its own sRGB encode on the way out, so the
      // intermediate has to stay linear or the transfer is applied twice.
      colorSpace: LinearSRGBColorSpace,
    });
    this.target.texture.generateMipmaps = false;

    this.scene = new Scene();
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // A 2x2 plane spans exactly the clip volume. Normals and UVs are dead
    // weight — the vertex shader derives the UV from position.
    const geometry = new PlaneGeometry(2, 2);
    geometry.deleteAttribute('normal');
    geometry.deleteAttribute('uv');

    this.material = new RawShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: this.target.texture },
        uRes: { value: new Vector2(size.x, size.y) },
        uDark: { value: new Vector3(0.043, 0.043, 0.047) },
        uLight: { value: new Vector3(0.96, 0.96, 0.97) },
        uHalftone: { value: 0.28 },
        uInvert: { value: 0 },
        // Black and white points, in source luminance. Tuned against the
        // flooded hall: below 0.04 is solid ink, above 0.52 is bare paper.
        uBlack: { value: 0.04 },
        uWhite: { value: 0.52 },
        // Screen ruling in device pixels. Below about 3 the pattern aliases
        // into moire on any high-frequency geometry; above about 9 it stops
        // reading as print and starts reading as a mosaic filter.
        uDot: { value: 3.1 },
        uGrain: { value: 0.022 },
        uTime: { value: 0 },
        uVignette: { value: 0.55 },
      },
    });

    this.quad = new Mesh(geometry, this.material);
    // The quad ignores the camera entirely, so three has no basis on which to
    // decide it is in frustum — and culling it blanks the screen.
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  get uniforms() {
    return this.material.uniforms;
  }

  setSize(width, height) {
    const dpr = this.renderer.getPixelRatio();
    const w = Math.max(1, Math.floor(width * dpr));
    const h = Math.max(1, Math.floor(height * dpr));
    this.target.setSize(w, h);
    this.material.uniforms.uRes.value.set(w, h);
  }

  render(scene, camera, time) {
    const { renderer } = this;
    this.material.uniforms.uTime.value = time;

    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);

    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
