/**
 * THE WORLD'S SOUND, SYNTHESIZED.
 *
 * Six voices, all made in the browser out of noise and sine waves. Nothing is
 * downloaded and nothing is sampled, for the same reason the textures and the
 * geometry are generated: the assets in this scene are original.
 *
 *   air    a calm breeze. Pink noise through a dark bandpass that wanders on
 *          two slow oscillators, with a third, slower still, swelling the
 *          whole thing in and out over about twenty seconds.
 *   pad    the score, and it plays in both rooms. Pairs of slightly detuned
 *          voices drifting against each other behind a filter that opens and
 *          closes, over a sub that breathes every seven seconds. It swells and
 *          falls but never to nothing, and it steps back rather than stopping
 *          when the work page arrives.
 *   notes  single soft notes off the same scale, through the delay, seconds
 *          apart: further apart and quieter out in the world, closer and
 *          fuller on the page.
 *   link   the igloo's answer: DATA. A burst of ten to sixteen grains a
 *          hundredth of a second long, each one either a noise tick or a
 *          digital blip, jumping about with no ladder and no tail.
 *   glass  the Minimal button: two detuned sines with a slow vibrato — a wet
 *          finger on a rim — and a liquid bloop when pressed.
 *   cut    the scroll: a whoosh whose band sweeps up as the wipe crosses, and
 *          a low swell as the page lands.
 *   music  the work page: single soft notes from the same pentatonic, seconds
 *          apart, with long tails. Sparse on purpose.
 *
 * WHY THE IGLOO IS NOT A TONE, AND THIS IS THE THIRD ATTEMPT. It was grinding
 * ice (removed: it doubled the pings), then a bright sine ping with a fifth
 * over it, then a square stepping a fixed ladder. Both of those read as
 * TOUCHING GLASS, because anything with a pitch you can hum is an instrument,
 * and a narrow band around a square is still a pitch. What reads as data is
 * switching: very short grains, half of them noise, pitches that jump without
 * a pattern, and NO reverb — a tail is what makes a sound musical. The room
 * send is deliberately absent from this voice alone.
 *
 * THE WORLD FALLS SILENT ON THE PAGE. Air, pad and data stop as the cut
 * completes; the page's notes take their place. Two rooms, one scale.
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
 * The igloo, as data being read.
 *
 * GRAINS, AND HALF OF THEM NOISE. Anything with a steady pitch reads as an
 * instrument — that is what made the two earlier versions sound like glass.
 * Ten-millisecond switching, wide unpatterned jumps and a dry output are what
 * read as a machine.
 */
const LINK = 0.022;
const LINK_GRAIN = 0.018; //  seconds per grain, gate included
const LINK_LOW = 600; //      the range the blips jump about in — kept low,
const LINK_HIGH = 2200; //    because everything above it is where "sharp" is
/*
 * The least time between two bursts, borrowed from the reference's own rule
 * (its beeps carry minTimeBetweenPlays: 0.4). Five lines can join within a
 * frame of each other; without this they fire as one smear and the effect
 * reads as a malfunction rather than as a reading being taken.
 */
const LINK_GAP = 0.4;

/*
 * THE IGLOO: ONE SHORT SCI-FI HIT, AND IT IS OVER AT ONCE.
 *
 * The sustained version this replaces followed the hold — and a noise band
 * held open is exactly what sounded sharp, because hiss has no end to it. A
 * hit has an end built in. A triangle falling fast with a little metal on it,
 * behind a lowpass so nothing up top can bite, done inside a fifth of a
 * second: that is science fiction, and it finishes the moment it lands.
 *
 * Fired ONCE as the shell is taken hold of, not every frame it is held.
 */
const HIT = 0.045;
const HIT_FROM = 1100; //     where the glide starts…
const HIT_TO = 380; //        …and where it lands
const HIT_GLIDE = 0.08;
const HIT_TAIL = 0.19; //     silent by here
const HIT_TONE = 2000; //     lowpass: the sharpness comes off above this

/*
 * Calm music under the world.
 *
 * THE SWELL HAS A FLOOR, and it needs one. Taken all the way to silence
 * between phrases — and started at the bottom of its own cycle — the music
 * was inaudible for the first half minute after the sound was switched on,
 * which reads as no music at all rather than as a quiet passage. It now
 * breathes between a third and full, and starts part-way up.
 */
const PAD = 0.05;
const PAD_HZ = 0.024; //      one swell every ~40 s
const PAD_FLOOR = 0.34;
const PAD_PHASE = 0.3; //     where in the swell it begins
const PAD_CUTOFF = [300, 1200];
/*
 * The shimmer, and it is what makes the pad sound like a synthesiser rather
 * than like an organ: a second set of voices a few cents off the first, with
 * the offset itself drifting. Two nearly-identical pitches beat against each
 * other, and a beat that changes speed is the whole character of wide analogue
 * pad. Slow enough that no single sweep is ever audible as an event.
 */
const PAD_DETUNE = 9; //      cents at the top of the drift
const PAD_DRIFT_HZ = 0.043;

/* The sub: one long breath under everything, felt more than heard. */
const PULSE = 0.05;
const PULSE_HZ = 0.14; //     about seven seconds a breath

/* The glass button. */
const GLASS_TONE = 0.035;
const GLASS_HZ = 742;
const BLOOP = 0.06;

/* The scroll cut. */
const CUT_WHOOSH = 0.07;
const CUT_SWELL = 0.05;

/* One scale for both rooms: a minor pentatonic on a low root. Cool, and no
   interval in it can land wrong against another, so notes may be chosen at
   random and the pad can hold any of them underneath. */
const ROOT = 220;
const STEPS = [0, 3, 5, 7, 10, 12, 15];
const MUSIC = 0.05;
const MUSIC_GAP = [3.5, 9]; //  seconds of silence between notes

let ctx = null;
let master = null;
let voices = null;
let noise = null;
let on = false;
let suspendTimer = 0;
let musicTimer = 0;
/** 0..1 — how far the world has given way to the work page. */
let page = 0;
/* Latches, so the one-shots fire on a crossing rather than every frame. */
let landed = false;
let holding = false;

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
 * The world's music: a low chord that breathes.
 *
 * Three sines — root, fifth, octave — under a lowpass that opens and closes on
 * its own slow oscillator, so the timbre moves without anything being played.
 * A second, slower oscillator on the gain takes it away to nothing between
 * swells: the silences are what keep it from becoming a bed you stop hearing.
 */
function buildPad() {
  const gain = ctx.createGain();
  gain.gain.value = 0;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = PAD_CUTOFF[0];
  filter.Q.value = 0.7;

  const sweep = ctx.createOscillator();
  sweep.frequency.value = PAD_HZ * 1.7;
  const sweepAmount = ctx.createGain();
  sweepAmount.gain.value = (PAD_CUTOFF[1] - PAD_CUTOFF[0]) / 2;
  sweep.connect(sweepAmount).connect(filter.frequency);
  filter.frequency.value = (PAD_CUTOFF[0] + PAD_CUTOFF[1]) / 2;
  sweep.start();

  /*
   * A drift shared by every detuned voice: one slow oscillator on their detune
   * parameter, so the beating between the pairs speeds up and slows down
   * together instead of each wandering on its own.
   */
  const drift = ctx.createOscillator();
  drift.frequency.value = PAD_DRIFT_HZ;
  const driftAmount = ctx.createGain();
  driftAmount.gain.value = PAD_DETUNE;
  drift.start();

  /* Root, fifth, octave — the pentatonic's own spine, half an octave below the
     notes the page sings, so the two never crowd each other. Each is a PAIR:
     one steady, one drifting against it. */
  for (const [ratio, level] of [
    [0.5, 1],
    [0.75, 0.55],
    [1, 0.4],
  ]) {
    const voice = ctx.createGain();
    voice.gain.value = level;
    voice.connect(filter);

    const steady = ctx.createOscillator();
    steady.type = 'sine';
    steady.frequency.value = ROOT * ratio;
    steady.connect(voice);
    steady.start();

    const shimmer = ctx.createOscillator();
    /* Triangle against the sine: a little more upper harmonic in the beating,
       which is what carries across a noisy room. */
    shimmer.type = 'triangle';
    shimmer.frequency.value = ROOT * ratio;
    const shimmerLevel = ctx.createGain();
    shimmerLevel.gain.value = 0.5;
    driftAmount.connect(shimmer.detune);
    shimmer.connect(shimmerLevel).connect(voice);
    shimmer.start();
  }

  /*
   * THE SUB, and it does not go through the filter. The pad's lowpass closes
   * to 300 Hz at the bottom of its sweep, which would take the breath with it;
   * this should be constant, because it is the floor everything else stands
   * on. Its own slow oscillator shapes it, offset so it never reaches zero.
   */
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = ROOT / 4;
  const subGain = ctx.createGain();
  subGain.gain.value = PULSE * 0.5;
  const breath = ctx.createOscillator();
  breath.frequency.value = PULSE_HZ;
  const breathAmount = ctx.createGain();
  breathAmount.gain.value = PULSE * 0.45;
  breath.connect(breathAmount).connect(subGain.gain);
  sub.connect(subGain).connect(gain);
  sub.start();
  breath.start();

  filter.connect(gain).connect(master);
  return { gain, filter };
}

function buildGlass() {
  const a = ctx.createOscillator();
  a.type = 'sine';
  a.frequency.value = GLASS_HZ;
  const b = ctx.createOscillator();
  b.type = 'sine';
  /* Seven hertz apart: they beat slowly against each other, which is what
     stops a pure sine reading as a test tone. */
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

/**
 * A shared tail for the page's notes. A single delay with light feedback: a
 * room for a tenth of the cost of a convolver, and no impulse file to ship.
 *
 * THE DATA BURSTS DO NOT GO THROUGH IT. A tail is most of what makes a sound
 * musical, and the igloo's voice must not be musical.
 */
function buildSpace() {
  const input = ctx.createGain();
  const delay = ctx.createDelay(1.2);
  delay.delayTime.value = 0.34;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.34;
  const damp = ctx.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = 1800;
  const level = ctx.createGain();
  level.gain.value = 0.5;

  input.connect(delay);
  delay.connect(damp).connect(feedback).connect(delay);
  delay.connect(level).connect(master);
  return input;
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
    glass: buildGlass(),
    cut: buildCut(),
    space: buildSpace(),
  };
  return true;
}

/* ── One-shots. Built, played and thrown away; each is a few nodes. ────── */

/**
 * A line reaching its node: a burst of data being read.
 *
 * Ten to sixteen grains of under two hundredths of a second, gated open and
 * shut with two-millisecond ramps. Each grain is a coin toss: a blip from a
 * square oscillator at a pitch picked anywhere in a wide range, or a tick of
 * noise through a high band. The pitches do NOT walk a ladder and the burst
 * does NOT go to the room send — both of those are what made the earlier
 * versions sound like an instrument being touched.
 */
function dataBurst() {
  const now = ctx.currentTime;
  const grains = 6 + Math.floor(Math.random() * 5);

  const out = ctx.createGain();
  out.gain.value = 1;
  out.connect(master);

  /* Two sources, gated in turn, so a burst is a mix of tone and tick. */
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
  hissBand.frequency.value = 3000;
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
 * Taking hold of the shell: a short sci-fi hit.
 *
 * A triangle — not a square, which is where the last version's edge came from
 * — falling from HIT_FROM to HIT_TO in eighty milliseconds, with a modulator
 * two and a half times its pitch giving it a brief metallic ring that dies
 * first. Everything goes through a lowpass, and the whole thing is silent
 * inside a fifth of a second. No noise, and no room send: both are what made
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

/* ── The page's music: one note, then silence, then another. ───────────── */

function note(level = MUSIC) {
  const now = ctx.currentTime;
  const step = STEPS[Math.floor(Math.random() * STEPS.length)];
  const hz = ROOT * Math.pow(2, step / 12);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  /* Slow in, slower out: nothing here should have an onset you can point at. */
  gain.gain.exponentialRampToValueAtTime(level, now + 0.9);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 4.2);
  gain.connect(master);
  gain.connect(voices.space);

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = hz;
  /* A quiet octave over it, for air rather than for harmony. */
  const over = ctx.createOscillator();
  over.type = 'sine';
  over.frequency.value = hz * 2;
  const overGain = ctx.createGain();
  overGain.gain.value = 0.18;

  osc.connect(gain);
  over.connect(overGain).connect(gain);
  osc.start(now);
  over.start(now);
  osc.stop(now + 4.4);
  over.stop(now + 4.4);
}

function nextNote() {
  const [min, max] = MUSIC_GAP;
  /* Further apart out in the world, where the breeze and the igloo are already
     saying something; closer together on the page, where the notes are the
     only thing there is. */
  const gap = (min + Math.random() * (max - min)) * (page < 0.5 ? 1.5 : 1);
  musicTimer = setTimeout(() => {
    if (!on) {
      musicTimer = 0;
      return;
    }
    fired.notes += 1;
    /* Quieter against the world, fuller on the page. */
    note(page < 0.5 ? MUSIC * 0.55 : MUSIC);
    nextNote();
  }, gap * 1000);
}

function musicOn() {
  if (musicTimer || !ctx) return;
  nextNote();
}

function musicOff() {
  clearTimeout(musicTimer);
  musicTimer = 0;
}

/* Dev only: the last raw signal each voice was handed, so the constants above
   can be set from measurements rather than guessed at, and a tally of the
   one-shots — a burst and a note leave no level to read, so they are counted. */
const raw = { drive: 0, force: 0, flight: 0, progress: 0, rate: 0, strength: 0 };
const fired = { hits: 0, bursts: 0, notes: 0 };
/** When the last data burst went out, for the gap rule. */
let lastBurst = -1;

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
    /* The score runs in both rooms now — see nextNote. */
    musicOn();
  },

  stop() {
    if (!ctx || !on) return;
    on = false;
    musicOff();
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
    musicOff();
    on = false;
    ctx?.close().catch(() => {});
    ctx = null;
    master = null;
    voices = null;
    noise = null;
  },

  /**
   * The world's ambience: the breeze, and the music under it.
   *
   * Both are fed from here because both belong to the world rather than to any
   * one thing in it, and both are gone once the work page has arrived.
   */
  air(force = 0, flight = 0) {
    raw.force = force;
    raw.flight = flight;
    if (!on) return;
    const outside = 1 - page;
    at(voices.air.gain.gain, AIR_BED * (1 + 0.45 * force + 0.35 * flight) * outside, 0.6);
    at(voices.air.band.frequency, BAND_HZ + 180 * force + 120 * flight, 0.6);

    /*
     * The pad's own swell, on the clock rather than on an oscillator, so it
     * can be ducked by the page in the same breath. Raised to a cosine so it
     * spends longer near silence than near full — phrases with space around
     * them rather than a level that wanders.
     */
    const phase = (PAD_PHASE + ctx.currentTime * PAD_HZ) % 1;
    const breathe = Math.pow(0.5 - 0.5 * Math.cos(phase * Math.PI * 2), 1.4);
    const swell = PAD_FLOOR + (1 - PAD_FLOOR) * breathe;
    /* The music CROSSES the cut, unlike the breeze: it only steps back a
       little on the page so the notes there have room. Two rooms, one score. */
    at(voices.pad.gain.gain, PAD * swell * (1 - 0.3 * page), 1.2);
  },

  /**
   * A measurement line reaching a node — the igloo's whole voice.
   *
   * IglooBlocks only grows that network while the pointer is actually on the
   * dome, so this is already "only when touched" without a gate of its own.
   */
  link() {
    if (!on || page >= 0.5) return;
    /* One burst per LINK_GAP at most — see the note on the constant. */
    if (ctx.currentTime - lastBurst < LINK_GAP) return;
    lastBurst = ctx.currentTime;
    fired.bursts += 1;
    dataBurst();
  },

  /**
   * The igloo, held: 0..1 of how hard the interaction has hold of the shell.
   *
   * IglooBlocks passes its interaction strength, which is zero whenever nobody
   * is touching the dome — so the voice is "only when touched" by its own
   * nature, and the idle sweep that keeps the blocks drifting stays silent.
   */
  igloo(strength = 0) {
    raw.strength = strength;
    if (!on || page >= 0.5) return;

    /* The hit lands as the shell is TAKEN HOLD OF. Re-armed only once the
       interaction has let go properly, so a cursor wandering across a joint
       cannot retrigger it. */
    if (!holding && strength > 0.15) {
      holding = true;
      fired.hits += 1;
      sciFiHit();
    } else if (holding && strength < 0.05) {
      holding = false;
    }
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
    /* Tracked even while muted, so switching sound on inside the page starts
       the music rather than the breeze. */
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

/* Dev only: the voices are inaudible to an automated browser, so their levels
   are readable instead. Same channel as __worldGl. */
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__sound = {
    state: () => ({
      on,
      context: ctx?.state ?? 'none',
      page,
      music: Boolean(musicTimer),
      master: master?.gain.value ?? 0,
      air: voices?.air.gain.gain.value ?? 0,
      pad: voices?.pad.gain.gain.value ?? 0,
      glass: voices?.glass.gain.gain.value ?? 0,
      cut: voices?.cut.gain.gain.value ?? 0,
      raw: { ...raw },
      fired: { ...fired },
    }),
  };
}
