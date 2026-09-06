import { Texture } from 'three';
import { applyIceSettings, tagIceMaps, makeIceMaps } from './ice-texture.js';
import { ICE_SETS, ICE_MAPS } from './ice-sets.js';
import { setBakedField } from './terrain.js';

/**
 * The baked world, fetched once before anything is built from it.
 *
 * WHY THIS EXISTS AT ALL is argued in scripts/bake-world.mjs: starting this
 * scene cost 16.9 seconds of blocked main thread, all of it recomputing a
 * result that a fixed seed and a pile of position functions had already
 * determined. This is the other half — the side that reads what that script
 * wrote.
 *
 * THE SHAPE OF IT IS DECIDED BY THE CALL SITES, and they are all synchronous.
 * The terrain's vertex loop, the scree scatter, the igloo's footing and the
 * camera rig's ground clearance all ask for heights and maps from inside
 * useMemo and useFrame, where there is nowhere to await. Rewriting them to
 * suspend would push async through the entire scene graph to save a single
 * fetch, so instead the fetch happens strictly BEFORE any of them exist:
 * loadBakedWorld() runs while the loading screen is up, fills the cache below,
 * and only then does the Stage mount. Every existing call site is unchanged.
 *
 * EVERY PART OF IT DEGRADES ON ITS OWN. A missing manifest, a failed image, a
 * truncated heightfield — each falls back to generating that piece the old way.
 * A half-baked deploy is then slow, which is what it was before, rather than
 * broken.
 */

const BASE = '/baked';

/** name -> { roughnessMap, normalMap, colorMap, aoMap, reliefStops, patchStops } */
const cache = new Map();
let loaded = false;
/*
 * THE IN-FLIGHT PROMISE, AND A BOOLEAN ALONE IS NOT ENOUGH.
 *
 * `loaded` is only set once everything has arrived, so two callers that start
 * before the first finishes both see false and both fetch the whole set.
 * That is not hypothetical: React's StrictMode deliberately mounts effects
 * twice in development, and it was measured doing exactly this — 36 requests
 * for 18 files. Holding the promise means the second caller waits on the first
 * request rather than starting a second one.
 */
let inFlight = null;

/**
 * DECODED OFF THE MAIN THREAD, and this is the entire performance argument.
 *
 * createImageBitmap hands the bytes to the browser's native image pipeline,
 * which decodes on its own thread — so four sets of maps decode in parallel
 * with each other and with everything else, in compiled code, at a speed that
 * barely depends on how weak the device's single-core JavaScript performance
 * is. That is precisely the axis on which the old generate-on-load path failed:
 * a slow phone is several times worse at running a noise loop and only slightly
 * worse at decoding a PNG.
 *
 * The two options are not defaults and both matter. premultiplyAlpha would
 * scale the colour channels by an alpha that is a constant 255 here — a no-op
 * in principle, and not worth trusting for maps whose channels carry roughness
 * and surface normals rather than a picture. colorSpaceConversion would let the
 * browser apply a profile transform; these files carry no profile, so it should
 * do nothing, and 'none' means it cannot.
 */
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
  /* A Texture built around an existing image never uploads without this — the
     constructor cannot know the image is already complete. */
  tex.needsUpdate = true;
  return tex;
}

/**
 * The heightfield, back from 16-bit and into the units the terrain thinks in.
 *
 * See the bake script for why this is a raw array rather than a PNG: canvas
 * silently truncates 16-bit PNGs to 8, which would halve the precision here
 * with nothing to show for it.
 */
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

/**
 * Fetch everything, or report honestly that it could not.
 *
 * Resolves either way. A rejection here would have to be handled by the caller
 * into exactly the same fallback this already performs, and the site is not
 * broken by the bake being absent — only slower, in the way it always was.
 */
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

    /*
     * A 200 IS NOT PROOF THE FILE IS THERE.
     *
     * Any single-page host — the dev server included — answers an unknown path
     * with index.html and a 200, because that is how client-side routing has to
     * work. So a missing bake does not arrive as a 404; it arrives as a
     * perfectly successful response containing a web page. Observed exactly
     * that while testing this path: `Unexpected token '<'`.
     *
     * The JSON parse above already throws on the HTML, so this is not load
     * bearing for correctness — it is here so the NEXT failure of this shape
     * reports what is actually wrong instead of a parser's opinion of it.
     */
    if (manifest?.version !== 1) {
      throw new Error(`manifest is not a v1 bake (got ${JSON.stringify(manifest?.version)}) — run: npm run bake`);
    }

    /*
     * ALL OF IT AT ONCE. Seventeen files fetched in sequence would serialise
     * seventeen round trips; in parallel the browser pipelines them over one
     * connection and the whole set costs about as long as the slowest of them.
     */
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
    /* Deliberately a warning and not a throw: see the note on the return. */
    console.warn('[world] baked assets unavailable, generating at runtime:', error.message);
    /* Cleared so a later mount can retry — a failure here is as likely to be a
       flaky connection as a missing file, and the fallback is expensive. */
    inFlight = null;
    return false;
  }
}

/**
 * The maps for one surface — from the bake if it loaded, generated if not.
 *
 * `repeat` is applied here rather than baked because it is a property of how
 * the texture is mapped onto its surface, not of the texture: the ground's is
 * derived from the terrain's world size and the others are 1. See ice-sets.js.
 *
 * THE TEXTURES ARE SHARED, NOT COPIED. Two call sites asking for the same set
 * get the same GPU upload, which is the correct behaviour for every set here —
 * each is used once. If one is ever wanted at two different repeats, this has
 * to clone rather than mutate, because repeat lives on the texture.
 */
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
