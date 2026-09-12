import { Texture } from 'three';
import { applyIceSettings, tagIceMaps, makeIceMaps } from './ice-texture.js';
import { ICE_SETS, ICE_MAPS } from './ice-sets.js';
import { setBakedField } from './terrain.js';

// The baked world, fetched once before anything is built from it. scripts/bake-world.mjs is the other half.
// Starting this scene cost 16.9s of blocked main thread recomputing what a fixed seed had already determined.
// The call sites are all synchronous, terrain vertices, scree scatter, igloo footing and camera clearance all ask from inside
// useMemo and useFrame where there's nowhere to await, so the fetch happens strictly before any of them exist.
// Every part degrades on its own, a missing manifest or a failed image falls back to generating that piece the old way.

const BASE = '/baked';

// name -> { roughnessMap, normalMap, colorMap, aoMap, reliefStops, patchStops }
const cache = new Map();
let loaded = false;
// A boolean alone isn't enough, loaded is only set once everything arrives so two callers would both fetch the whole set.
// StrictMode mounts effects twice in dev and was measured doing exactly that, 36 requests for 18 files.
let inFlight = null;

// createImageBitmap decodes off the main thread in compiled code, so four sets decode in parallel.
// That's the axis the generate-on-load path failed on, a slow phone is much worse at a noise loop and barely worse at a PNG.
// premultiplyAlpha would scale colour by a constant 255 alpha, not worth trusting for maps carrying normals and roughness.
// colorSpaceConversion none, these files carry no profile so a transform should do nothing and this means it can't.
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
  tex.needsUpdate = true; // a Texture built round an existing image never uploads without this
  return tex;
}

// The heightfield back from 16-bit into the units the terrain thinks in.
// It's a raw array not a PNG because canvas silently truncates 16-bit PNGs to 8.
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

// Resolves either way. A rejection would only be handled into the same fallback this already does.
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

    // A 200 is not proof the file is there, any SPA host answers an unknown path with index.html and a 200.
    // So a missing bake arrives as a successful response containing a web page, seen here as Unexpected token '<'.
    // The JSON parse above already throws on that, this is so the next failure of this shape says what's actually wrong.
    if (manifest?.version !== 1) {
      throw new Error(`manifest is not a v1 bake (got ${JSON.stringify(manifest?.version)}), run: npm run bake`);
    }

    // All of it at once, seventeen sequential fetches would serialise seventeen round trips.
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
    inFlight = null; // cleared so a later mount can retry, this is as likely to be a flaky connection as a missing file
    return false;
  }
}

// The maps for one surface, from the bake if it loaded and generated if not.
// repeat is applied here rather than baked, it's how the texture maps onto its surface rather than part of the texture.
// The textures are shared not copied, which is right while each set is used once. Two repeats would need a clone.
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
