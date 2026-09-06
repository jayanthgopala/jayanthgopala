import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, CanvasTexture } from 'three';
import { MOUND_AT } from '../lib/terrain.js';

/**
 * Weather: drifting ground mist and very light snowfall.
 *
 * BOTH ARE THE ONLY THINGS IN THE SCENE THAT MOVE, which makes them worth more
 * than their pixel count. A still frame of a landscape reads as a photograph;
 * the moment something drifts across it, the world is alive. It also means both
 * have to be gentle — anything quick here reads as a screensaver, and anything
 * dense reads as weather rather than as air.
 */

/* -------------------------------------------------------------------------
   SNOW
   ---------------------------------------------------------------------- */

/** How many flakes. Deliberately low — this is "light snow", not a blizzard. */
const FLAKES = 420;
/** The volume flakes live in, centred on the camera's view. */
const SPREAD_X = 420;
const SPREAD_Y = 150;
const SPREAD_Z = 520;
const FIELD_CENTRE = [0, 60, 120];

/**
 * A soft round dot, drawn once.
 *
 * A point sprite with no texture is a hard-edged square, which at this size
 * reads as digital noise rather than as snow. A radial falloff costs one small
 * texture and is the whole difference.
 */
function makeFlakeTexture() {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

function Snowfall() {
  const pointsRef = useRef(null);

  const { geometry, texture, speeds } = useMemo(() => {
    const positions = new Float32Array(FLAKES * 3);
    /* Per-flake fall rate and sway phase, so they do not descend as a sheet. */
    const rates = new Float32Array(FLAKES * 3);

    for (let i = 0; i < FLAKES; i += 1) {
      positions[i * 3] = FIELD_CENTRE[0] + (Math.random() - 0.5) * SPREAD_X;
      positions[i * 3 + 1] = FIELD_CENTRE[1] + (Math.random() - 0.5) * SPREAD_Y;
      positions[i * 3 + 2] = FIELD_CENTRE[2] + (Math.random() - 0.5) * SPREAD_Z;

      rates[i * 3] = 1.6 + Math.random() * 2.4; // fall speed
      rates[i * 3 + 1] = Math.random() * Math.PI * 2; // sway phase
      rates[i * 3 + 2] = 0.4 + Math.random() * 0.9; // sway width
    }

    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    return { geometry: g, texture: makeFlakeTexture(), speeds: rates };
  }, []);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const pos = geometry.attributes.position;
    const arr = pos.array;
    const t = state.clock.elapsedTime;

    const floor = FIELD_CENTRE[1] - SPREAD_Y / 2;
    const ceiling = FIELD_CENTRE[1] + SPREAD_Y / 2;

    for (let i = 0; i < FLAKES; i += 1) {
      const y = i * 3 + 1;
      arr[y] -= speeds[i * 3] * dt;

      /*
       * Sway, evaluated from the clock rather than accumulated. Adding a
       * per-frame delta to x would let rounding drift the flakes sideways out
       * of the volume over a long session; a sine of absolute time cannot.
       */
      arr[i * 3] += Math.sin(t * 0.5 + speeds[y]) * speeds[i * 3 + 2] * dt;

      /* Recycle to the top rather than respawning, so density stays constant. */
      if (arr[y] < floor) {
        arr[y] = ceiling;
        arr[i * 3] = FIELD_CENTRE[0] + (Math.random() - 0.5) * SPREAD_X;
        arr[i * 3 + 2] = FIELD_CENTRE[2] + (Math.random() - 0.5) * SPREAD_Z;
      }
    }
    pos.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry} frustumCulled={false}>
      {/*
        sizeAttenuation so distant flakes shrink; without it the far ones are
        the same size as the near ones and the field reads as a flat overlay
        stuck to the lens instead of as snow inside the world.

        Not additive: additive white on a pale sky turns the whole upper frame
        milky. Normal blending with a soft alpha keeps flakes readable against
        both the dark hills and the bright sky.
      */}
      <pointsMaterial
        map={texture}
        size={0.85}
        sizeAttenuation
        transparent
        opacity={0.75}
        depthWrite={false}
        color="#ffffff"
      />
    </points>
  );
}

/* -------------------------------------------------------------------------
   MIST — REMOVED, AND THE NOTE BELOW WAS ACTED ON
   ----------------------------------------------------------------------

   Drifting cloud cards used to live here. Two versions were tried: flat sheets
   seen edge-on, which drew hard horizontal streaks because a plane edge-on is a
   line, and upright camera-facing cards, which read as translucent billboards
   sitting in front of the landscape rather than as air within it.

   The honest limitation is that a card cannot be fog. Fog is a property of the
   volume between the camera and everything else, and the scene already models
   that correctly with exponential-squared fog in Atmosphere — density there is
   the real control. Anything layered on top is a picture of fog placed at one
   depth, and at some point the eye finds its edges.

   If drifting air is wanted later, the thing that actually works is modulating
   the existing fog density and colour over time, or a raymarched pass — not
   more geometry.

   THAT IS WHERE THE WISPS LIVE NOW: Terrain.jsx marches a second, shallow,
   fast-moving medium through the volume, and the moving air in this scene is
   that pass rather than anything in this file. Spindrift below is the other
   half of the same wind and is deliberately NOT a substitute for it — points
   are the one thing a volumetric pass cannot afford, because the step size sets
   a floor on how fine its detail can be before it aliases. Coarse air there,
   fine grains here.
*/

/* -------------------------------------------------------------------------
   SPINDRIFT — the fine grains the wind is actually carrying
   ---------------------------------------------------------------------- */

/**
 * A SECOND POINT CLOUD RATHER THAN MORE FLAKES IN THE FIRST, because the two
 * are different weather doing different things. Snowfall is gravity: slow, and
 * essentially vertical. Spindrift is transport — grains already on the ground,
 * picked up and driven horizontally, an order of magnitude faster and staying
 * low. Merging them would mean one velocity model trying to be both, and the
 * compromise reads as neither.
 *
 * It is also the only element in the frame with hard, resolvable detail moving
 * quickly, which is what actually communicates SPEED. The volumetric wisps in
 * Terrain give the air mass and shape, and a soft mass moving fast is hard to
 * read as fast — there is no edge to track it by. These grains supply the edge.
 */

/** Enough to read as a stream, few enough to stay a suggestion. One draw. */
/*
 * RAISED FROM 1100, WITH THE HAZE GONE.
 *
 * 1100 was a density set against foggy air, where a grain only had to be one of
 * a few visible things. In clear air the grains ARE the fine detail of the wind
 * — there is nothing else at that scale — and at the old count they read as
 * occasional specks rather than as a stream. Spread over a slab this size, 1100
 * is roughly one grain per twenty thousand cubic units, which is nothing.
 *
 * Still one draw call and still one Float32Array walked per frame; the cost of
 * this is linear and small, and points are the cheapest geometry there is.
 */
const GRAINS = 2600;

/**
 * The slab the grains live in.
 *
 * LOW AND WIDE, WHICH IS THE WHOLE POINT. Blown snow is a boundary-layer
 * phenomenon: it is dense at the surface and thins out fast with height,
 * because what holds a grain up is turbulence near the ground and there is less
 * of it further up. So this is 66 units tall over a 900-unit fetch, and the
 * spawn is biased downward on top of that.
 *
 * Centred behind and around the igloo at z 252 rather than on the camera. The
 * brief for this shot is that the movement should be legible against the darker
 * mountain background, and that means putting the grains in the open ground the
 * mountains are behind — a field centred on the lens would put most of them in
 * the empty air to the sides where nothing is looking.
 */
const GRAIN_SPAN_X = 900;
const GRAIN_SPAN_Y = 66;
const GRAIN_SPAN_Z = 420;
const GRAIN_CENTRE = [-30, 44, 210];

/**
 * How fast the wind drives them, in world units per second.
 *
 * MUST AGREE WITH FOG_WISP_DRIFT IN Terrain.jsx, which is 34 on X. This is the
 * same wind, and the one thing that would give the whole effect away is grains
 * crossing the frame at a visibly different rate from the air they are supposed
 * to be suspended in. The spread around it is the point though: a stream in
 * which every grain moves at exactly the medium's speed has no shear in it, and
 * shear is what tells you this is a fluid rather than a texture being panned.
 *
 * Biased slightly FAST, because the small stuff outruns the mass — the brief
 * asks for the fine snow to accelerate with the wind while the banks lag.
 */
const GRAIN_SPEED_MIN = 26;
const GRAIN_SPEED_MAX = 48;

/**
 * The eddy round the mound — the same one Terrain's flow field applies to the
 * fog, at the same radius, so the grains curl where the wisps curl.
 *
 * Kept in step by hand rather than shared through a module: these are two
 * different representations of one flow (a domain warp on the GPU, a velocity
 * on the CPU) and there is no single quantity both could import. If one moves
 * the other has to.
 */
const EDDY_RADIUS = 120;
const EDDY_STRENGTH = 16;

/**
 * A finer, dimmer grain than a snowflake.
 *
 * Spindrift is not falling crystals, it is broken ones — smaller, more of them,
 * and individually almost invisible. The falloff is tighter than the flake's so
 * the dot has a defined core; at this size a wide gradient is just a grey
 * smudge and the stream loses its grain.
 */
function makeGrainTexture() {
  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

function Spindrift() {
  const { geometry, texture, drift } = useMemo(() => {
    const positions = new Float32Array(GRAINS * 3);
    /* Per-grain: downwind speed, turbulence phase, turbulence amplitude. */
    const rates = new Float32Array(GRAINS * 3);

    for (let i = 0; i < GRAINS; i += 1) {
      /*
       * Height biased toward the surface by squaring a uniform sample. A flat
       * distribution puts as many grains at the top of the slab as at the
       * bottom, which reads as a suspended cloud rather than as snow being
       * scoured off the ground.
       */
      const lift = Math.random() ** 2;

      positions[i * 3] = GRAIN_CENTRE[0] + (Math.random() - 0.5) * GRAIN_SPAN_X;
      positions[i * 3 + 1] =
        GRAIN_CENTRE[1] - GRAIN_SPAN_Y / 2 + lift * GRAIN_SPAN_Y;
      positions[i * 3 + 2] = GRAIN_CENTRE[2] + (Math.random() - 0.5) * GRAIN_SPAN_Z;

      rates[i * 3] = GRAIN_SPEED_MIN + Math.random() * (GRAIN_SPEED_MAX - GRAIN_SPEED_MIN);
      rates[i * 3 + 1] = Math.random() * Math.PI * 2;
      rates[i * 3 + 2] = 0.6 + Math.random() * 1.8;
    }

    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    return { geometry: g, texture: makeGrainTexture(), drift: rates };
  }, []);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const pos = geometry.attributes.position;
    const arr = pos.array;
    const t = state.clock.elapsedTime;

    const left = GRAIN_CENTRE[0] - GRAIN_SPAN_X / 2;
    const right = GRAIN_CENTRE[0] + GRAIN_SPAN_X / 2;
    const floor = GRAIN_CENTRE[1] - GRAIN_SPAN_Y / 2;
    const ceiling = GRAIN_CENTRE[1] + GRAIN_SPAN_Y / 2;

    for (let i = 0; i < GRAINS; i += 1) {
      const ix = i * 3;
      const iy = ix + 1;
      const iz = ix + 2;

      const speed = drift[ix];
      const phase = drift[ix + 1];
      const swing = drift[ix + 2];

      let vx = speed;
      let vy = 0;
      let vz = 0;

      /*
       * Turbulence, read off the clock rather than accumulated. Two sines at
       * incommensurate rates on the two free axes, out of phase per grain, so
       * the stream frays instead of translating as a sheet. Accumulating a
       * per-frame delta instead would let rounding walk grains out of the slab
       * over a long session; a sine of absolute time cannot.
       */
      vy += Math.sin(t * 1.7 + phase) * swing * 1.5;
      vz += Math.sin(t * 1.1 + phase * 1.7) * swing * 2.6;

      /* A slow settle, so grains sink through the stream and get picked up
         again at the upwind edge. Without it the slab never mixes vertically
         and the height distribution it was seeded with is the one it keeps. */
      vy -= 1.4;

      /*
       * THE EDDY. A tangential velocity round the mound, decaying with radius
       * — grains passing the dome are swept around it instead of through it.
       * The vertical kick is the wake: air deflected upward over an obstacle,
       * which is where real spindrift plumes come from.
       */
      const rx = arr[ix] - MOUND_AT[0];
      const rz = arr[iz] - MOUND_AT[1];
      const rd = Math.hypot(rx, rz);
      if (rd < EDDY_RADIUS * 3) {
        const curl = Math.exp(-rd / EDDY_RADIUS) * EDDY_STRENGTH;
        const inv = 1 / Math.max(rd, 1);
        vx += -rz * inv * curl;
        vz += rx * inv * curl;
        vy += curl * 0.35;
      }

      arr[ix] += vx * dt;
      arr[iy] += vy * dt;
      arr[iz] += vz * dt;

      /* Recycle downwind to upwind, so density stays constant and nothing
         appears in the middle of frame. Y and Z are re-rolled at the same time
         so the stream does not settle into fixed lanes. */
      if (arr[ix] > right) {
        arr[ix] = left;
        arr[iy] = floor + Math.random() ** 2 * GRAIN_SPAN_Y;
        arr[iz] = GRAIN_CENTRE[2] + (Math.random() - 0.5) * GRAIN_SPAN_Z;
      }
      if (arr[iy] < floor) arr[iy] = floor + Math.random() * 6;
      if (arr[iy] > ceiling) arr[iy] = ceiling;
    }
    pos.needsUpdate = true;
  });

  return (
    <points geometry={geometry} frustumCulled={false}>
      {/*
        Smaller and fainter than the snowfall, and normal-blended for the same
        reason: additive white on a pale sky milks the whole upper frame, and
        this stream crosses the bright horizon band constantly.

        The opacity is low enough that no single grain is really visible. That
        is correct — what should be visible is the STREAM, and a grain you can
        pick out individually is a grain the eye tracks instead of the flow.
      */}
      <pointsMaterial
        map={texture}
        size={0.62}
        sizeAttenuation
        transparent
        opacity={0.42}
        depthWrite={false}
        color="#eef3f8"
      />
    </points>
  );
}

export default function Weather() {
  return (
    <>
      <Snowfall />
      <Spindrift />
    </>
  );
}
