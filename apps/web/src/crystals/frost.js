import { CanvasTexture, NoColorSpace, RepeatWrapping } from 'three';
import { makeNoise2D, makeFbm } from '../world/lib/noise.js';
import { smoothstep } from './util.js';

/** Generates procedural frost roughness and normal maps for crystal materials. */

const S = 256;
let cache = null;

export function getFrost() {
  if (cache) return cache;

  const noise = makeNoise2D(4417);
  const broad = makeFbm(noise, { octaves: 4, lacunarity: 2.1, persistence: 0.5 });
  const fine = makeFbm(noise, { octaves: 3, lacunarity: 2.3, persistence: 0.45 });

  const height = new Float32Array(S * S);
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = roughCanvas.height = S;
  const rctx = roughCanvas.getContext('2d');
  const rimg = rctx.createImageData(S, S);

  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      const u = x / S;
      const v = y / S;
      const b = broad(u * 3.2, v * 3.2);
      const f = fine(u * 15 + 7.1, v * 15 + 3.4);
      /* Frost mask based on broad noise field */
      const frost = smoothstep(0.12, 0.45, b);
      const i = y * S + x;
      height[i] = f * (0.2 + frost * 0.8) + b * 0.25;
      const r = Math.min(1, 0.03 + frost * 0.42 + (f * 0.5 + 0.5) * 0.08 * frost);
      const g = Math.round(r * 255);
      const o = i * 4;
      rimg.data[o] = g;
      rimg.data[o + 1] = g;
      rimg.data[o + 2] = g;
      rimg.data[o + 3] = 255;
    }
  }
  rctx.putImageData(rimg, 0, 0);

  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = normalCanvas.height = S;
  const nctx = normalCanvas.getContext('2d');
  const nimg = nctx.createImageData(S, S);
  const at = (x, y) => height[((y + S) % S) * S + ((x + S) % S)];
  const K = 3.2;
  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * K;
      const dy = (at(x, y - 1) - at(x, y + 1)) * K;
      const len = Math.hypot(dx, dy, 1);
      const o = (y * S + x) * 4;
      nimg.data[o] = Math.round((dx / len * 0.5 + 0.5) * 255);
      nimg.data[o + 1] = Math.round((dy / len * 0.5 + 0.5) * 255);
      nimg.data[o + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      nimg.data[o + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);

  const make = (canvas) => {
    const t = new CanvasTexture(canvas);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.colorSpace = NoColorSpace;
    t.anisotropy = 4;
    return t;
  };

  cache = { rough: make(roughCanvas), normal: make(normalCanvas) };
  return cache;
}
