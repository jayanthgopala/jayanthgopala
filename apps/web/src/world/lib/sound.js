/**
 * THE WORLD'S SOUND, SYNTHESIZED.
 *
 * Five voices, all made in the browser out of noise and sine waves. Nothing is
 * downloaded and nothing is sampled, for the same reason the textures and the
 * geometry are generated: the assets in this scene are original.
 *
 *   air    a calm breeze. Pink noise through a dark bandpass that wanders on
 *          two slow oscillators, with a third, slower still, swelling the
 *          whole thing in and out over about twenty seconds.
 *   hit    the igloo, taken hold of: one short sci-fi hit, over inside a fifth
 *          of a second.
 *   link   a measurement line reaching a node: a burst of data grains, at most
 *          one burst every 0.4 s.
 *   glass  the Minimal button: two detuned sines with a slow vibrato — a wet
 *          finger on a rim — and a liquid bloop when pressed.
 *   cut    the scroll: a whoosh whose band sweeps up as the wipe crosses, and
 *          a low swell as the page lands.
 *
 *   pad    the music: an A major chord on seven plain sines, each breathing on
 *          its own slow cycle, with a single pentatonic note drifting over it
 *          every ten seconds or so into a small damped room. See the note on
 *          PAD_VOICES for why it is built the way it is — the bed before it
 *          detuned voices against each other over a sub and was reported as
 *          causing a headache, and every choice in this one answers that.
 *
 * WHY THE IGLOO IS NOT A TONE. It was grinding ice, then a chime, then a
 * sustained texture. Everything with a pitch you can hum read as touching
 * glass, and everything held open read as long and sharp. What it is now is an
 * event with an end built into it.
 *
 * OFF UNTIL ASKED FOR, AND THAT IS NOT A PREFERENCE. Browsers block audio until
 * a gesture, so a page that claimed to be playing would be lying on first load,
 * and sound that starts by itself is what people install blockers for. The
 * HUD's Sound button is the only switch, and the context is not even built
 * until it is pressed: a visitor who never touches it allocates nothing.
 *
 * THE SETTERS ARE CALLED EVERY FRAME. They only hand a target to
 * setTargetAtTime, which the audio thread glides to on its own — so the cost is
 * a few assignments per frame, and nothing ever steps a gain and clicks.
 */

/* Master. Under a compressor, so no pile-up of voices can ever spike. */
const MASTER = 0.9;
const FADE = 1.4;

/* The breeze. Darker and quieter than a wind: this is air, not weather. */
const BAND_HZ = 300;
const BAND_SWING = 170;
const BAND_Q = 0.5;
const ROLLOFF_HZ = 620;
const AIR_BED = 0.03;
/* Depth of the slow swell, and how long one breath takes. */
const AIR_BREATH = 0.018;
const AIR_BREATH_HZ = 0.055;

/* Seconds of noise in the loop buffer. Long, so its own period is inaudible
   underneath the filter movement that is doing the real work. */
const BUFFER_SECONDS = 8;

/*
 * THE PAD: AN A MAJOR CHORD, AND EVERY CHOICE IN IT IS A SAFEGUARD.
 *
 * The bed this replaces was reported as causing a headache, and the reasons
 * were in its construction rather than in its level:
 *
 *   it detuned pairs of voices against each other   -> beating, which IS a
 *                                                      slow vibration
 *   it held a sub tone under everything             -> sustained low energy
 *   it swept a resonant filter across the chord     -> a wobble on top
 *
 * None of those is here. Every pitch is exact, so nothing beats. The lowest
 * voice is A2, an octave and a half above where the sub sat. The filter is
 * fixed and unresonant. What moves instead is each voice's own level, on its
 * own slow cycle — five cycles that never line up, so the chord changes colour
 * without anything oscillating against anything else.
 */
const PAD = 0.065;
const PAD_CUTOFF = 1300;
/*
 * [frequency, level, seconds per breath] — A major: A, E, A, C#, E, and then
 * A and E again an octave up for air.
 *
 * THE THIRD APPEARS ONCE, LOW, AND QUIETLY. It is what makes the chord major;
 * it is also the note that tires an ear first, so the two voices above it are
 * an octave and a fifth, which cannot grate however long they are held.
 */
const PAD_VOICES = [
  [110.0, 0.9, 48],
  [164.81, 0.7, 59],
  [220.0, 0.6, 77],
  [277.18, 0.4, 34],
  [329.63, 0.35, 43],
  [440.0, 0.22, 63],
  [659.25, 0.14, 71],
];

/*
 * Single notes over the chord, and they are the only thing in the music with
 * a beginning. A major pentatonic — A, B, C#, E, F# — where no two notes can
 * clash, so they may be chosen at random and still belong to the chord
 * underneath. Sparse on purpose: a phrase you can follow becomes a tune, and a
 * tune under a page you are reading is something to switch off.
 */
const NOTE = 0.038;
const NOTE_HZ = [220.0, 246.94, 277.18, 329.63, 369.99, 440.0];
const NOTE_GAP = [8, 16]; //  seconds of silence between them

/*
 * The igloo, as data being read.
 *
 * GRAINS, AND HALF OF THEM NOISE. Anything with a steady pitch reads as an
 * instrument. Short switching, wide unpatterned jumps and a dry output are
 * what read as a machine.
 */
const LINK = 0.022;
const LINK_GRAIN = 0.018; //  seconds per grain, gate included
const LINK_LOW = 600; //      the range the blips jump about in — kept low,
const LINK_HIGH = 2200; //    because everything above it is where "sharp" is
/*
 * The least time between two bursts, borrowed from the reference's own rule
 * (its beeps carry minTimeBetweenPlays: 0.4). Five lines can join within a
 * frame of each other; without this they fire as one smear.
 */
const LINK_GAP = 0.4;

/*
 * THE IGLOO: ONE SHORT SCI-FI HIT, AND IT IS OVER AT ONCE.
 *
 * A triangle falling fast with a little metal on it, behind a lowpass so
 * nothing up top can bite, done inside a fifth of a second. Fired ONCE as the
 * shell is taken hold of, not every frame it is held.
 */
const HIT = 0.045;
const HIT_FROM = 1100; //     where the glide starts…
const HIT_TO = 380; //        …and where it lands
const HIT_GLIDE = 0.08;
const HIT_TAIL = 0.19; //     silent by here
const HIT_TONE = 2000; //     lowpass: the sharpness comes off above this

/* The glass button. */
const GLASS_TONE = 0.035;
const GLASS_HZ = 742;
const BLOOP = 0.06;

/* The scroll cut. */
const CUT_WHOOSH = 0.07;
const CUT_SWELL = 0.05;

let ctx = null;
let master = null;
let voices = null;
let noise = null;
let on = false;
let suspendTimer = 0;
/** 0..1 — how far the world has given way to the work page. */
let page = 0;
/* Latches, so the one-shots fire on a crossing rather than every frame. */
let landed = false;
let holding = false;
/** The pending note, if the music is running. */
let noteTimer = 0;
/** When the last data burst went out, for the gap rule. */
let lastBurst = -1;

/**
 * Pink noise via the Voss-McCartney style filter bank, with its own tail
 * blended into its head so the loop point is inaudible.
 */
function fillPink(data) {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;

  for (let i = 0; i < data.length; i += 1) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }

  const blend = Math.min(2000, Math.floor(data.length / 8));
  for (let i = 0; i < blend; i += 1) {
    const k = i / blend;
    const tail = data[data.length - blend + i];
    data[i] = data[i] * k + tail * (1 - k);
  }
}

/** One looping tap on the shared noise buffer. */
function noiseSource() {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  src.start();
  return src;
}

/** Hand a parameter a target; the audio thread glides to it. */
function at(param, value, tau = 0.12) {
  param.setTargetAtTime(value, ctx.currentTime, tau);
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
/** Smooth 0..1 ramp between two thresholds. */
const ramp = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function buildAir() {
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = BAND_HZ;
  band.Q.value = BAND_Q;

  /* Everything above this is hiss rather than air. Low, because a breeze has
     no edge on it — the brightness is what made the old wind sound harsh. */
  const rolloff = ctx.createBiquadFilter();
  rolloff.type = 'lowpass';
  rolloff.frequency.value = ROLLOFF_HZ;

  const gain = ctx.createGain();
  gain.gain.value = AIR_BED;

  /* Two gusts at incommensurate rates, so the band never repeats a pattern. */
  const gustA = ctx.createOscillator();
  gustA.frequency.value = 0.037;
  const gustAAmount = ctx.createGain();
  gustAAmount.gain.value = BAND_SWING;

  const gustB = ctx.createOscillator();
  gustB.frequency.value = 0.011;
  const gustBAmount = ctx.createGain();
  gustBAmount.gain.value = BAND_SWING * 0.55;

  gustA.connect(gustAAmount).connect(band.frequency);
  gustB.connect(gustBAmount).connect(band.frequency);
  gustA.start();
  gustB.start();

  /*
   * THE BREATH. An oscillator wired into the gain's own parameter ADDS to
   * whatever target the frame loop has set, so the level swells and falls by
   * itself while still following the cursor and the scroll.
   *
   * This is the one slow modulation left in the scene, and it is on NOISE
   * rather than on a pitch — which is the difference between air moving and
   * the beating that made the old music bed unpleasant.
   */
  const breath = ctx.createOscillator();
  breath.frequency.value = AIR_BREATH_HZ;
  const breathAmount = ctx.createGain();
  breathAmount.gain.value = AIR_BREATH;
  breath.connect(breathAmount).connect(gain.gain);
  breath.start();

  noiseSource().connect(band).connect(rolloff).connect(gain).connect(master);
  return { gain, band };
}

/**
 * The pad: five sines holding an A major chord, each breathing on its own.
 *
 * The breathing is done with an oscillator on each voice's GAIN, never on its
 * pitch, and the five periods are deliberately awkward numbers (48, 59, 77,
 * 34, 43 seconds) so they do not come back into step. The chord is therefore
 * never quite the same twice, while no two pitches are ever close enough to
 * beat.
 */
function buildPad() {
  const gain = ctx.createGain();
  gain.gain.value = 0;

  /* Fixed, and no resonance. A sweeping filter is a wobble, which is the
     third thing the old bed was doing wrong. */
  const soft = ctx.createBiquadFilter();
  soft.type = 'lowpass';
  soft.frequency.value = PAD_CUTOFF;
  soft.Q.value = 0.4;
  soft.connect(gain).connect(master);

  for (const [hz, level, period] of PAD_VOICES) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = hz;

    const voice = ctx.createGain();
    /* Half of the level is always there and half breathes, so a voice thins
       out rather than dropping away — a note switching off is an event, and
       there should be no events at all in this. */
    voice.gain.value = level * 0.5;

    const breath = ctx.createOscillator();
    breath.frequency.value = 1 / period;
    const depth = ctx.createGain();
    depth.gain.value = level * 0.5;
    breath.connect(depth).connect(voice.gain);
    breath.start();

    osc.connect(voice).connect(soft);
    osc.start();
  }

  return { gain };
}

/**
 * A small room for the notes, and for nothing else.
 *
 * One delay with light feedback, damped so each repeat is duller than the last
 * — a room for a tenth of the cost of a convolver, and no impulse file to
 * ship. The igloo's own voice deliberately does NOT go through it: a tail is
 * most of what makes a sound musical, and that one must not be.
 */
function buildGlow() {
  const input = ctx.createGain();
  const delay = ctx.createDelay(1.2);
  delay.delayTime.value = 0.42;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.22;
  const damp = ctx.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = 1600;
  const level = ctx.createGain();
  level.gain.value = 0.45;

  input.connect(delay);
  delay.connect(damp).connect(feedback).connect(delay);
  delay.connect(level).connect(master);
  return input;
}

function buildGlass() {
  const a = ctx.createOscillator();
  a.type = 'sine';
  a.frequency.value = GLASS_HZ;
  const b = ctx.createOscillator();
  b.type = 'sine';
  /* Seven hertz apart: they beat slowly against each other, which is what
     stops a pure sine reading as a test tone. It is only ever heard for the
     moment a pointer is crossing the button, which is why a beat is fine here
     and was not as a permanent bed. */
  b.frequency.value = GLASS_HZ + 7;

  const vibrato = ctx.createOscillator();
  vibrato.frequency.value = 5.2;
  const vibratoAmount = ctx.createGain();
  vibratoAmount.gain.value = 2.4;
  vibrato.connect(vibratoAmount);
  vibratoAmount.connect(a.frequency);
  vibratoAmount.connect(b.frequency);

  const soft = ctx.createBiquadFilter();
  soft.type = 'lowpass';
  soft.frequency.value = 2400;

  const gain = ctx.createGain();
  gain.gain.value = 0;

  a.connect(soft);
  b.connect(soft);
  soft.connect(gain).connect(master);
  a.start();
  b.start();
  vibrato.start();
  return { gain, a, b };
}

function buildCut() {
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 240;
  band.Q.value = 0.8;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  noiseSource().connect(band).connect(gain).connect(master);
  return { gain, band };
}

function build() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return false;

  ctx = new Ctx();
  noise = ctx.createBuffer(1, ctx.sampleRate * BUFFER_SECONDS, ctx.sampleRate);
  fillPink(noise.getChannelData(0));

  master = ctx.createGain();
  master.gain.value = 0;

  /* A gentle limiter. Voices that each behave on their own can still add up on
     a loud moment, and clipping is the one thing a quiet scene cannot afford. */
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -18;
  limiter.knee.value = 12;
  limiter.ratio.value = 6;
  limiter.attack.value = 0.008;
  limiter.release.value = 0.25;

  master.connect(limiter).connect(ctx.destination);

  voices = {
    air: buildAir(),
    pad: buildPad(),
    glow: buildGlow(),
    glass: buildGlass(),
    cut: buildCut(),
  };
  return true;
}

/* ── One-shots. Built, played and thrown away; each is a few nodes. ────── */

/**
 * Taking hold of the shell: a short sci-fi hit.
 *
 * A triangle falling from HIT_FROM to HIT_TO in eighty milliseconds, with a
 * modulator two and a half times its pitch giving it a brief metallic ring
 * that dies first. Everything goes through a lowpass, and the whole thing is
 * silent inside a fifth of a second. No noise, and no room: both are what made
 * the earlier attempts read as long.
 */
function sciFiHit() {
  const now = ctx.currentTime;

  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = HIT_TONE;
  tone.Q.value = 0.7;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(HIT, now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + HIT_TAIL);
  tone.connect(gain).connect(master);

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(HIT_FROM, now);
  osc.frequency.exponentialRampToValueAtTime(HIT_TO, now + HIT_GLIDE);
  osc.connect(tone);

  /* The metal: an operator at 2.5x, whose own envelope is shorter than the
     note's, so the ring is only on the attack. */
  const mod = ctx.createOscillator();
  mod.type = 'sine';
  mod.frequency.setValueAtTime(HIT_FROM * 2.5, now);
  mod.frequency.exponentialRampToValueAtTime(HIT_TO * 2.5, now + HIT_GLIDE);
  const modDepth = ctx.createGain();
  modDepth.gain.setValueAtTime(HIT_FROM * 0.6, now);
  modDepth.gain.exponentialRampToValueAtTime(1, now + 0.05);
  mod.connect(modDepth).connect(osc.frequency);

  osc.start(now);
  mod.start(now);
  osc.stop(now + HIT_TAIL + 0.02);
  mod.stop(now + HIT_TAIL + 0.02);
}

/**
 * A line reaching its node: a burst of data being read.
 *
 * Six to ten grains of under two hundredths of a second, gated open and shut
 * with two-millisecond ramps. Each grain is a coin toss: a blip from a square
 * oscillator at a pitch picked anywhere in a wide range, or a tick of noise
 * through a band. The pitches do NOT walk a ladder, and there is no room send.
 */
function dataBurst() {
  const now = ctx.currentTime;
  const grains = 6 + Math.floor(Math.random() * 5);

  const out = ctx.createGain();
  out.gain.value = 1;
  out.connect(master);

  const osc = ctx.createOscillator();
  osc.type = 'square';
  const oscBand = ctx.createBiquadFilter();
  oscBand.type = 'bandpass';
  oscBand.frequency.value = 2000;
  oscBand.Q.value = 0.9;
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.0001, now);
  osc.connect(oscBand).connect(oscGain).connect(out);

  const hiss = noiseSource();
  const hissBand = ctx.createBiquadFilter();
  hissBand.type = 'bandpass';
  hissBand.frequency.value = 1800;
  hissBand.Q.value = 1.2;
  const hissGain = ctx.createGain();
  hissGain.gain.setValueAtTime(0.0001, now);
  hiss.connect(hissBand).connect(hissGain).connect(out);

  for (let i = 0; i < grains; i += 1) {
    const t = now + i * LINK_GRAIN;
    const level = LINK * (0.45 + Math.random() * 0.55);
    const hold = LINK_GRAIN * (0.3 + Math.random() * 0.35);

    if (Math.random() < 0.5) {
      osc.frequency.setValueAtTime(LINK_LOW + Math.random() * (LINK_HIGH - LINK_LOW), t);
      oscGain.gain.linearRampToValueAtTime(level, t + 0.002);
      oscGain.gain.linearRampToValueAtTime(0.0001, t + hold);
    } else {
      hissBand.frequency.setValueAtTime(1300 + Math.random() * 1100, t);
      hissGain.gain.linearRampToValueAtTime(level * 0.9, t + 0.002);
      hissGain.gain.linearRampToValueAtTime(0.0001, t + hold);
    }
  }

  const ends = now + grains * LINK_GRAIN + 0.05;
  osc.start(now);
  osc.stop(ends);
  hiss.stop(ends);
}

/**
 * One note over the chord: a sine with a quiet octave above it, a second to
 * arrive and four to leave, into the small room.
 *
 * NO ATTACK YOU CAN POINT AT. A pluck would be an event, and events are what
 * make a listener wait for the next one; this should arrive the way a light
 * changes.
 */
function note() {
  const now = ctx.currentTime;
  const hz = NOTE_HZ[Math.floor(Math.random() * NOTE_HZ.length)];

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(NOTE, now + 1.0);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 4.5);
  gain.connect(master);
  gain.connect(voices.glow);

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = hz;

  const over = ctx.createOscillator();
  over.type = 'sine';
  over.frequency.value = hz * 2;
  const overLevel = ctx.createGain();
  overLevel.gain.value = 0.16;

  osc.connect(gain);
  over.connect(overLevel).connect(gain);
  osc.start(now);
  over.start(now);
  osc.stop(now + 4.7);
  over.stop(now + 4.7);
}

function nextNote() {
  const [min, max] = NOTE_GAP;
  noteTimer = setTimeout(
    () => {
      if (!on) {
        noteTimer = 0;
        return;
      }
      fired.notes += 1;
      note();
      nextNote();
    },
    (min + Math.random() * (max - min)) * 1000
  );
}

function bloop(power = 1) {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(520, now);
  osc.frequency.exponentialRampToValueAtTime(170, now + 0.28);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(BLOOP * Math.min(1, power), now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
  osc.connect(gain).connect(master);
  osc.start(now);
  osc.stop(now + 0.4);
}

function swell() {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(58, now);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(CUT_SWELL, now + 0.5);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
  osc.connect(gain).connect(master);
  osc.start(now);
  osc.stop(now + 1.9);
}

/* Dev only: the last raw signal each voice was handed, so the constants above
   can be set from measurements rather than guessed at, and a tally of the
   one-shots — they leave no level to read, so they are counted. */
const raw = { drive: 0, force: 0, flight: 0, progress: 0, rate: 0, strength: 0 };
const fired = { hits: 0, bursts: 0, notes: 0 };

export const sound = {
  get enabled() {
    return on;
  },

  start() {
    if (!ctx && !build()) return;
    clearTimeout(suspendTimer);
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    on = true;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(MASTER, now + FADE);
    if (!noteTimer) nextNote();
  },

  stop() {
    if (!ctx || !on) return;
    on = false;
    clearTimeout(noteTimer);
    noteTimer = 0;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(0, now + FADE);
    /* Suspended once it has faded: a silent context still costs a thread. */
    clearTimeout(suspendTimer);
    suspendTimer = setTimeout(() => {
      if (!on) ctx?.suspend().catch(() => {});
    }, (FADE + 0.2) * 1000);
  },

  dispose() {
    clearTimeout(suspendTimer);
    clearTimeout(noteTimer);
    noteTimer = 0;
    on = false;
    ctx?.close().catch(() => {});
    ctx = null;
    master = null;
    voices = null;
    noise = null;
  },

  /** The breeze: how hard the cursor stirs it, how fast the page travels. */
  air(force = 0, flight = 0) {
    raw.force = force;
    raw.flight = flight;
    if (!on) return;
    /* Gone by the time the work page has arrived. */
    const outside = 1 - page;
    at(voices.air.gain.gain, AIR_BED * (1 + 0.45 * force + 0.35 * flight) * outside, 0.6);
    at(voices.air.band.frequency, BAND_HZ + 180 * force + 120 * flight, 0.6);

    /* The chord crosses the cut rather than stopping at it — it is the one
       thing common to both rooms — but steps back on the page, where there is
       reading to do. */
    at(voices.pad.gain.gain, PAD * (1 - 0.35 * page), 1.5);
  },

  /**
   * The igloo, taken hold of: 0..1 of how hard the interaction has the shell.
   *
   * IglooBlocks passes its interaction strength, which is zero whenever nobody
   * is touching the dome — so this is "only when touched" by its own nature,
   * and the idle sweep that keeps the blocks drifting stays silent.
   */
  igloo(strength = 0) {
    raw.strength = strength;
    if (!on || page >= 0.5) return;

    /* Re-armed only once the interaction has let go properly, so a cursor
       wandering across a joint cannot retrigger it. */
    if (!holding && strength > 0.15) {
      holding = true;
      fired.hits += 1;
      sciFiHit();
    } else if (holding && strength < 0.05) {
      holding = false;
    }
  },

  /** A measurement line reaching a node. */
  link() {
    if (!on || page >= 0.5) return;
    if (ctx.currentTime - lastBurst < LINK_GAP) return;
    lastBurst = ctx.currentTime;
    fired.bursts += 1;
    dataBurst();
  },

  /** The glass button: how hard it is flowing, and which way it is bending. */
  glass(drive = 0, give = 0) {
    raw.drive = drive;
    if (!on) return;
    at(voices.glass.gain.gain, GLASS_TONE * Math.min(1, drive), 0.06);
    const bend = GLASS_HZ * (1 - Math.max(-1, Math.min(1, give * 0.02)) * 0.04);
    at(voices.glass.a.frequency, bend, 0.08);
    at(voices.glass.b.frequency, bend + 7, 0.08);
  },

  glassPress(power = 1) {
    if (!on) return;
    bloop(power);
  },

  /** The cut: where it is, and how fast it is moving (either direction). */
  cut(progress = 0, rate = 0) {
    raw.progress = progress;
    raw.rate = rate;
    page = ramp(0.55, 0.95, progress);
    if (!on) return;

    /* Loudest through the middle of the wipe, silent at both ends. */
    const bell = 4 * progress * (1 - progress);
    const speed = Math.min(1, Math.abs(rate) * 1.4);
    at(voices.cut.gain.gain, CUT_WHOOSH * bell * speed, 0.08);
    at(voices.cut.band.frequency, 240 + 1500 * progress, 0.08);

    if (!landed && progress > 0.92) {
      landed = true;
      swell();
    } else if (landed && progress < 0.6) {
      landed = false;
    }
  },
};
