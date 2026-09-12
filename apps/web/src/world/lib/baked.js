import { Texture } from 'three';
import { applyIceSettings, tagIceMaps, makeIceMaps } from './ice-texture.js';
import { ICE_SETS, ICE_MAPS } from './ice-sets.js';
import { setBakedField } from './terrain.js';

// Pre-baked world textures and heightfield; falls back to runtime generation if unavailable.
const BASE = '/baked';

// name -> { roughnessMap, normalMap, colorMap, aoMap, reliefStops, patchStops }
const cache = new Map();
let loaded = false;
let inFlight = null; // Prevent duplicate concurrent fetches

// Decode bitmap off the main thread without color transform
async function fetchBitmap(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return createImageBitmap(await res.blob(), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
}

function textureFrom(bitmap) {
  const tex = new Texture(bitmap);
  tex.needsUpdate = true;
  return tex;
}

// Unpack 16-bit raw heightfield data into world units.
async function loadHeightfield(meta) {
  const res = await fetch(`${BASE}/heightfield.bin`);
  if (!res.ok) throw new Error(`heightfield -> ${res.status}`);
  const quantised = new Uint16Array(await res.arrayBuffer());

  const expected = meta.n * meta.n;
  if (quantised.length !== expected) {
    throw new Error(`heightfield is ${quantised.length} samples, expected ${expected}`);
  }

  const span = meta.max - meta.min;
  const data = new Float32Array(quantised.length);
  for (let i = 0; i < quantised.length; i += 1) {
    data[i] = meta.min + (quantised[i] / 65535) * span;
  }
  setBakedField(data);
}

// Load all baked assets with fallback
export async function loadBakedWorld() {
  if (loaded) return true;
  if (inFlight) return inFlight;
  inFlight = fetchEverything();
  return inFlight;
}

async function fetchEverything() {
  try {
    const res = await fetch(`${BASE}/manifest.json`);
    if (!res.ok) throw new Error(`manifest -> ${res.status}`);
    const manifest = await res.json();

    if (manifest?.version !== 1) {
      throw new Error(`manifest is not a v1 bake (got ${JSON.stringify(manifest?.version)}), run: npm run bake`);
    }

    // Fetch all texture sets in parallel
    const sets = await Promise.all(
      Object.keys(ICE_SETS).map(async (name) => {
        const meta = manifest.sets[name];
        if (!meta) throw new Error(`manifest has no set "${name}"`);

        const bitmaps = await Promise.all(
          ICE_MAPS.map(({ key }) => fetchBitmap(`${BASE}/${name}-${key}.png`))
        );
        const [rough, color, normal, ao] = bitmaps.map(textureFrom);
        return [name, { rough, color, normal, ao, meta }];
      })
    );

    await loadHeightfield(manifest.heightfield);

    for (const [name, entry] of sets) cache.set(name, entry);
    loaded = true;
    return true;
  } catch (error) {
    console.warn('[world] baked assets unavailable, generating at runtime:', error.message);
    inFlight = null;
    return false;
  }
}

// Returns texture maps from cache or generates them on demand.
export function iceMapsFor(name, repeat = 1) {
  const entry = cache.get(name);
  if (!entry) return makeIceMaps({ ...ICE_SETS[name], repeat });

  applyIceSettings(entry.rough, repeat);
  applyIceSettings(entry.color, repeat);
  applyIceSettings(entry.normal, repeat);
  applyIceSettings(entry.ao, repeat);

  return tagIceMaps({
    roughnessMap: entry.rough,
    normalMap: entry.normal,
    colorMap: entry.color,
    aoMap: entry.ao,
    reliefStops: entry.meta.reliefStops,
    patchStops: entry.meta.patchStops,
  });
}
