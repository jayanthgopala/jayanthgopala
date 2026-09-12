import { useLayoutEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { LOOK } from '../lib/lighting.js';
import {
  CanvasTexture,
  SRGBColorSpace,
  LinearFilter,
  EquirectangularReflectionMapping,
} from 'three';

// Sky gradient stops from lighting config
const ZENITH = LOOK.sky.zenith;
const AZURE = LOOK.sky.azure;
const HAZE = LOOK.sky.haze;

// Sun direction in equirectangular coordinates [u, v]
const SUN = LOOK.sun || [0.38, 0.74];

// Unit gradient vector generator for 2D noise
const gradient = (x, y) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  const a = (n - Math.floor(n)) * 6.2831853;
  return [Math.cos(a), Math.sin(a)];
};

// 2D Perlin noise with quintic interpolation
const perlin = (x, y) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);

  const dot = (cx, cy, dx, dy) => {
    const g = gradient(cx, cy);
    return g[0] * dx + g[1] * dy;
  };

  const n00 = dot(ix, iy, fx, fy);
  const n10 = dot(ix + 1, iy, fx - 1, fy);
  const n01 = dot(ix, iy + 1, fx, fy - 1);
  const n11 = dot(ix + 1, iy + 1, fx - 1, fy - 1);

  const a = n00 + (n10 - n00) * ux;
  const b = n01 + (n11 - n01) * ux;
  return (a + (b - a) * uy) * 1.4142;
};

// Feature point offsets for cellular noise
const cellPoint = (x, y) => {
  const a = Math.sin(x * 269.5 + y * 183.3) * 43758.5453;
  const b = Math.sin(x * 113.5 + y * 271.9) * 43758.5453;
  return [a - Math.floor(a), b - Math.floor(b)];
};

// Worley cellular distance noise
const worley = (x, y) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  let best = 8;
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      const p = cellPoint(ix + ox, iy + oy);
      const dx = ox + p[0] - fx;
      const dy = oy + p[1] - fy;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
  }
  return Math.min(1, Math.sqrt(best));
};

// Multi-octave Perlin FBM
const fbm = (x, y, octaves) => {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += perlin(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (e0, e1, v) => {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const remap = (v, lo, hi, nlo, nhi) =>
  nlo + ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (nhi - nlo);

// Cloud layer configurations (high cirrus and lower horizon band)
const LAYERS = [
  {
    scale: 6.5,
    stretch: 7.4,
    coverage: 0.54,
    erosion: 0.44,
    billow: 0.1,
    opacity: 0.6,
    top: 0.46,
    fade: 0.18,
    bottom: 1.06,
  },
  {
    scale: 15.0,
    stretch: 3.4,
    coverage: 0.42,
    erosion: 0.62,
    billow: 0.42,
    opacity: 0.44,
    top: 0.58,
    fade: 0.14,
    bottom: 1.02,
  },
];

const FBM_SPREAD = 1.9;
const FIELD_W = 320;
const FIELD_H = 160;

// Precomputes low-resolution procedural cloud density map
const buildCloudField = () => {
  const field = new Float32Array(FIELD_W * FIELD_H);

  for (let y = 0; y < FIELD_H; y += 1) {
    const v = y / (FIELD_H - 1);
    for (let x = 0; x < FIELD_W; x += 1) {
      const u = x / (FIELD_W - 1);
      let total = 0;

      for (let l = 0; l < LAYERS.length; l += 1) {
        const L = LAYERS[l];
        const band =
          smoothstep(L.top, L.top + L.fade, v) *
          (1 - smoothstep(L.bottom - 0.14, L.bottom, v));
        if (band <= 0.001) continue;

        const sx = u * L.scale + l * 31.7;
        const sy = v * L.scale * L.stretch - l * 17.3;

        const shape = clamp01(fbm(sx, sy, 4) * FBM_SPREAD * 0.5 + 0.5);
        const billow = 1 - worley(sx * 0.85, sy * 0.85);
        const base = shape * (1 - L.billow) + billow * L.billow;

        let d = remap(base, 1 - L.coverage, 1, 0, 1);
        if (d <= 0) continue;

        const detail = clamp01(fbm(sx * 3.1 + 41.2, sy * 3.1 - 9.4, 3) * FBM_SPREAD * 0.5 + 0.5);
        d = Math.max(0, d - detail * L.erosion * (1 - d));

        total += d * band * L.opacity;
      }

      field[y * FIELD_W + x] = clamp01(total);
    }
  }

  return field;
};

// Bilinear interpolation lookup in cloud density field
const sampleField = (field, u, v) => {
  const fx = clamp01(u) * (FIELD_W - 1);
  const fy = clamp01(v) * (FIELD_H - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(FIELD_W - 1, x0 + 1);
  const y1 = Math.min(FIELD_H - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;

  const a = field[y0 * FIELD_W + x0];
  const b = field[y0 * FIELD_W + x1];
  const c = field[y1 * FIELD_W + x0];
  const d = field[y1 * FIELD_W + x1];

  const top = a + (b - a) * tx;
  const bot = c + (d - c) * tx;
  return top + (bot - top) * ty;
};

// Evaluates vertical sky gradient from zenith down to horizon
const skyRamp = (t) => {
  const k = Math.pow(t, 3.4);
  if (k < 0.55) {
    const u = k / 0.55;
    return ZENITH.map((z, i) => z + (AZURE[i] - z) * u);
  }
  const u = (k - 0.55) / 0.45;
  return AZURE.map((a, i) => a + (HAZE[i] - a) * u);
};

const CLOUD_WHITE = LOOK.paintedCloud.color;
const AUR = LOOK.aurora;

// Harmonic sine waves for vertical aurora curtains
const auroraShafts = (u) => {
  const a = Math.sin(2 * Math.PI * (u * 7 + 0.13));
  const b = Math.sin(2 * Math.PI * (u * 13 + 0.71));
  const c = Math.sin(2 * Math.PI * (u * 23 + 0.37));
  const s = 0.55 * a + 0.3 * b + 0.15 * c;
  if (s <= 0) return 0;
  return Math.pow(s, 2.2);
};

// Aurora intensity calculation based on bearing and elevation
const auroraAt = (u, vs) => {
  if (!AUR.enabled) return 0;

  const h = 1 - vs;
  if (h <= AUR.base || h >= AUR.top) return 0;

  const t = (h - AUR.base) / (AUR.top - AUR.base);
  const vert = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.55)), 1.4);
  const wash = Math.pow(Math.max(0, 1 - h / 0.26), 2.0) * 0.55;
  const bias = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (u * 3 + 0.2)));

  return Math.min(1, (auroraShafts(u) * 0.85 + wash) * vert * bias * AUR.strength);
};

// Sun disc, inner corona, and atmospheric halo bloom
const sunBloomAt = (u, vs) => {
  if (!SUN) return 0;
  let du = Math.abs(u - SUN[0]);
  if (du > 0.5) du = 1.0 - du;
  const degX = du * 360;
  const degY = (vs - SUN[1]) * 90;
  const d = Math.sqrt((degX / 1.25) * (degX / 1.25) + degY * degY);
  const disc = Math.exp(-Math.pow(d / 3.4, 2.5)) * 0.50;
  const corona = Math.exp(-Math.pow(d / 9.0, 1.8)) * 0.35;
  const wash = Math.exp(-Math.pow(d / 24.0, 1.2)) * 0.20;
  return Math.min(1.0, disc + corona + wash);
};

export default function Sky() {
  const { scene } = useThree();

  const texture = useMemo(() => {
    const W = 1024;
    const H = 512;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(W, H);

    const clouds = buildCloudField();

    for (let y = 0; y < H; y += 1) {
      const v = Math.min(1, y / (H - 1) / 0.5);
      const base = skyRamp(v);

      for (let x = 0; x < W; x += 1) {
        const u = x / (W - 1);
        const i = (y * W + x) * 4;

        const c = [base[0], base[1], base[2]];
        const aur = auroraAt(u, v);
        const cloud = LOOK.paintedCloud.enabled ? sampleField(clouds, u, v) : 0;

        const lit = Math.pow(cloud, 0.7);
        for (let k = 0; k < 3; k += 1) {
          c[k] += (CLOUD_WHITE[k] - c[k]) * lit * 0.95;
        }

        if (aur > 0) {
          const mixK = Math.min(1, aur * 1.5);
          for (let k = 0; k < 3; k += 1) {
            const tint = AUR.deep[k] + (AUR.core[k] - AUR.deep[k]) * mixK;
            c[k] += tint * aur;
          }
        }

        const sun = sunBloomAt(u, v);
        if (sun > 0) {
          const SUN_COLOR = [255, 250, 240];
          for (let k = 0; k < 3; k += 1) {
            c[k] += (SUN_COLOR[k] - c[k]) * sun * 0.55;
          }
        }

        const jitter = (((y + x) & 1) - 0.5) * 1.2;
        image.data[i] = Math.min(255, Math.max(0, c[0] + jitter));
        image.data[i + 1] = Math.min(255, Math.max(0, c[1] + jitter));
        image.data[i + 2] = Math.min(255, Math.max(0, c[2] + jitter));
        image.data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);

    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.mapping = EquirectangularReflectionMapping;
    t.flipY = true;
    t.minFilter = LinearFilter;
    t.magFilter = LinearFilter;
    t.generateMipmaps = false;
    return t;
  }, []);

  useLayoutEffect(() => {
    scene.background = texture;
    return () => {
      scene.background = null;
    };
  }, [scene, texture]);

  useLayoutEffect(() => () => texture.dispose(), [texture]);

  return null;
}

// Generates low-resolution equirectangular environment probe for IBL
export function makeWinterSkyEnv() {
  const W = 256;
  const H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const GROUND = LOOK.env.ground;

  for (let y = 0; y < H; y += 1) {
    const v = y / (H - 1);
    for (let x = 0; x < W; x += 1) {
      const u = x / (W - 1);
      let c;

      if (v < 0.5) {
        c = skyRamp(v / 0.5);

        const aur = auroraAt(u, v / 0.5);
        if (aur > 0) {
          const mixK = Math.min(1, aur * 1.5);
          const g = aur * AUR.envGain;
          c = c.map((n, k) => n + (AUR.deep[k] + (AUR.core[k] - AUR.deep[k]) * mixK) * g);
        }

        const sun = sunBloomAt(u, v / 0.5);
        if (sun > 0) {
          const SUN_COLOR = [255, 250, 240];
          for (let k = 0; k < 3; k += 1) {
            c[k] += (SUN_COLOR[k] - c[k]) * sun * 0.55;
          }
        }
      } else {
        const t = (v - 0.5) / 0.5;
        c = GROUND.map((g) => g * (1 - t * 0.22));
      }

      const o = (y * W + x) * 4;
      img.data[o] = Math.min(255, c[0]);
      img.data[o + 1] = Math.min(255, c[1]);
      img.data[o + 2] = Math.min(255, c[2]);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const t = new CanvasTexture(canvas);
  t.mapping = EquirectangularReflectionMapping;
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = false;
  return t;
}
