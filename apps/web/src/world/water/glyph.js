// Signed distance fields for letterforms, built at runtime.
//
// The water takes the shape of a project's initial, so the shape has to come
// from the project data rather than from an asset. A plain alpha mask is not
// enough: to give the letter a rounded liquid body the shader needs to know how
// far inside the glyph each point is, not merely whether it is. So the glyph is
// rasterised to a canvas and converted to a true SDF with an exact Euclidean
// distance transform, which is cheap enough to do per letter and cache.

import { ClampToEdgeWrapping, DataTexture, LinearFilter, RedFormat, UnsignedByteType } from 'three';

const SIZE = 192;
// Distance, in pixels, that the field is allowed to express either side of the
// outline. Everything beyond clamps, which is all the shader needs.
const SPREAD = 34;

const cache = new Map();

/**
 * Felzenszwalb & Huttenlocher's 1D squared-distance transform — the lower
 * envelope of a set of parabolas, in O(n).
 */
function edt1d(f, d, v, z, n) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;

  for (let q = 1; q < n; q += 1) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k -= 1;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }

  k = 0;
  for (let q = 0; q < n; q += 1) {
    while (z[k + 1] < q) k += 1;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Squared Euclidean distance to the nearest zero cell of `grid`. */
function edt2d(grid, width, height) {
  const f = new Float64Array(Math.max(width, height));
  const d = new Float64Array(Math.max(width, height));
  const v = new Int32Array(Math.max(width, height));
  const z = new Float64Array(Math.max(width, height) + 1);

  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) f[y] = grid[y * width + x];
    edt1d(f, d, v, z, height);
    for (let y = 0; y < height; y += 1) grid[y * width + x] = d[y];
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) f[x] = grid[y * width + x];
    edt1d(f, d, v, z, width);
    for (let x = 0; x < width; x += 1) grid[y * width + x] = d[x];
  }

  return grid;
}

const FACE = '700 SIZEpx "Helvetica Neue", Helvetica, Arial, sans-serif';
const face = (px) => FACE.replace('SIZE', px);

/** Ink extents of a glyph at the current font, as width and height. */
function extents(ctx, character) {
  const m = ctx.measureText(character);
  return {
    w: m.actualBoundingBoxRight + m.actualBoundingBoxLeft,
    h: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent,
    left: m.actualBoundingBoxLeft,
    right: m.actualBoundingBoxRight,
    ascent: m.actualBoundingBoxAscent,
    descent: m.actualBoundingBoxDescent,
  };
}

function rasterise(character) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#fff';
  // Measuring from the ink box rather than the em box is what makes an I and an
  // M come out the same visual size; textBaseline 'middle' would centre the
  // font's line box instead, which sits noticeably high for capitals.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const REFERENCE = 100;
  ctx.font = face(REFERENCE);
  const probe = extents(ctx, character);
  if (!(probe.w > 0) || !(probe.h > 0)) return ctx.getImageData(0, 0, SIZE, SIZE).data;

  // Caps share a cap height, so size by the glyph's height and only fall back
  // to its width when a wide letter (M, W) would otherwise run off the square.
  // The width allowance is the looser of the two for exactly that reason.
  const targetHeight = SIZE * 0.74;
  const maxWidth = SIZE * 0.86;
  const scale = Math.min(targetHeight / probe.h, maxWidth / probe.w);
  const px = Math.max(8, Math.round(REFERENCE * scale));
  ctx.font = face(px);

  const ink = extents(ctx, character);
  ctx.fillText(
    character,
    SIZE / 2 - (ink.right - ink.left) / 2,
    SIZE / 2 + (ink.ascent - ink.descent) / 2
  );

  return ctx.getImageData(0, 0, SIZE, SIZE).data;
}

/**
 * Builds an SDF texture for one character. Red channel, 0.5 on the outline,
 * above for inside and below for outside, scaled by SPREAD.
 */
export function glyphSdf(character) {
  const key = String(character || '·').toUpperCase().slice(0, 1);
  const cached = cache.get(key);
  if (cached) return cached;

  const pixels = rasterise(key);
  const count = SIZE * SIZE;

  const inside = new Float64Array(count);
  const outside = new Float64Array(count);
  const INF = 1e12;

  for (let i = 0; i < count; i += 1) {
    const solid = pixels[i * 4] > 127;
    // Distance transforms measure to the nearest zero, so each pass zeroes the
    // side it is measuring from.
    inside[i] = solid ? INF : 0;
    outside[i] = solid ? 0 : INF;
  }

  edt2d(inside, SIZE, SIZE);
  edt2d(outside, SIZE, SIZE);

  const data = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) {
    // Positive inside the glyph, negative outside.
    const signed = Math.sqrt(inside[i]) - Math.sqrt(outside[i]);
    const normalised = signed / SPREAD / 2 + 0.5;
    data[i] = Math.max(0, Math.min(255, Math.round(normalised * 255)));
  }

  const texture = new DataTexture(data, SIZE, SIZE, RedFormat, UnsignedByteType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  // getImageData returns rows top-down, but a plane’s v runs bottom-up, and a
  // DataTexture does not flip on upload the way a loaded image does. Without
  // this every letter renders upside down.
  texture.flipY = true;
  texture.needsUpdate = true;

  cache.set(key, texture);
  return texture;
}

/** How far one SDF unit reaches, for turning the field back into a thickness. */
export const SDF_SPREAD = SPREAD / SIZE;

/** First letter of a project title, falling back to something drawable. */
export function initialOf(project, index = 0) {
  const source = String(project?.title || project?.slug || '').trim();
  const letter = source.match(/[\p{L}\p{N}]/u)?.[0];
  return (letter || String((index % 9) + 1)).toUpperCase();
}
