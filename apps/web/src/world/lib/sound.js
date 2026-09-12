// Synthesized audio engine using Web Audio API (ambient air, pad, and interaction SFX).

// Master compressor settings
const MASTER = 0.9;
const FADE = 1.4;

// Ambient air breeze synthesis parameters
const BAND_HZ = 300;
const BAND_SWING = 170;
const BAND_Q = 0.5;
const ROLLOFF_HZ = 620;
const AIR_BED = 0.03;
const AIR_BREATH = 0.018;
const AIR_BREATH_HZ = 0.055;

const BUFFER_SECONDS = 8;

// Ambient music track parameters
const MUSIC_PATH = '/audio/pad.mp3';
const MUSIC_VOLUME = 0.55;
const MUSIC_STEP = 1 / 24; // Volume ramp tick, in seconds.

// Igloo interaction SFX parameters
const LINK = 0.022;
const LINK_GRAIN = 0.018;
const LINK_LOW = 600;
const LINK_HIGH = 2200;
const LINK_GAP = 0.4; // Minimum seconds between sound triggers

const HIT = 0.045;
const HIT_FROM = 1100;
const HIT_TO = 380;
const HIT_GLIDE = 0.08;
const HIT_TAIL = 0.19;
const HIT_TONE = 2000;

// Glass button UI sounds
const GLASS_TONE = 0.035;
const GLASS_HZ = 742;
const BLOOP = 0.06;

// Transition cut sounds
const CUT_WHOOSH = 0.07;
const CUT_SWELL = 0.05;

let ctx = null;
let master = null;
let voices = null;
let noise = null;
let musicEl = null;
let musicTarget = 0;
let musicTimer = 0;
let on = false;
let suspendTimer = 0;
let page = 0; // Transition progress (0 to 1)
let landed = false;
let holding = false;
let lastBurst = -1;

// Pink noise generation with wrapped tail for seamless looping
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

// Looping noise source from shared buffer
function noiseSource() {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  src.start();
  return src;
}

// Smoothly glides an AudioParam to target value
function at(param, value, tau = 0.12) {
  param.setTargetAtTime(value, ctx.currentTime, tau);
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ramp = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function buildAir() {
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = BAND_HZ;
  band.Q.value = BAND_Q;

  const rolloff = ctx.createBiquadFilter();
  rolloff.type = 'lowpass';
  rolloff.frequency.value = ROLLOFF_HZ;

  const gain = ctx.createGain();
  gain.gain.value = AIR_BED;

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

  const breath = ctx.createOscillator();
  breath.frequency.value = AIR_BREATH_HZ;
  const breathAmount = ctx.createGain();
  breathAmount.gain.value = AIR_BREATH;
  breath.connect(breathAmount).connect(gain.gain);
  breath.start();

  noiseSource().connect(band).connect(rolloff).connect(gain).connect(master);
  return { gain, band };
}

function getMusic() {
  if (!musicEl && typeof Audio !== 'undefined') {
    musicEl = new Audio();
    musicEl.loop = true;
    musicEl.preload = 'auto';
    musicEl.volume = 0;
    musicEl.src = MUSIC_PATH;
    musicEl.addEventListener('error', () => {
      console.warn('[sound] pad track failed to load:', MUSIC_PATH, musicEl?.error);
    });
    musicEl.load();
  }
  return musicEl;
}

// Warms the pad track so the first toggle plays instead of waiting on the download.
function preloadMusic() {
  getMusic();
}

// Glides the element volume toward its target; the pad is pre-mastered, so it
// needs a level envelope rather than a place in the synth graph.
function musicTick() {
  if (!musicEl) {
    clearInterval(musicTimer);
    musicTimer = 0;
    return;
  }

  const step = MUSIC_STEP / Math.max(MUSIC_STEP, FADE);
  const delta = musicTarget - musicEl.volume;

  if (Math.abs(delta) <= step) {
    musicEl.volume = musicTarget;
    clearInterval(musicTimer);
    musicTimer = 0;
    if (musicTarget === 0) musicEl.pause();
    return;
  }

  musicEl.volume = Math.min(1, Math.max(0, musicEl.volume + Math.sign(delta) * step));
}

function musicTo(target, immediate = false) {
  musicTarget = Math.min(1, Math.max(0, target));
  const audio = getMusic();
  if (!audio) return;

  if (immediate) {
    clearInterval(musicTimer);
    musicTimer = 0;
    audio.volume = musicTarget;
    return;
  }

  // air() retargets every frame, so settle silently rather than respawning the timer.
  if (!musicTimer && audio.volume !== musicTarget) {
    musicTimer = setInterval(musicTick, MUSIC_STEP * 1000);
  }
}

function buildGlass() {
  const a = ctx.createOscillator();
  a.type = 'sine';
  a.frequency.value = GLASS_HZ;
  const b = ctx.createOscillator();
  b.type = 'sine';
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

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -18;
  limiter.knee.value = 12;
  limiter.ratio.value = 6;
  limiter.attack.value = 0.008;
  limiter.release.value = 0.25;

  master.connect(limiter).connect(ctx.destination);

  voices = {
    air: buildAir(),
    glass: buildGlass(),
    cut: buildCut(),
  };
  return true;
}

// Short transient hit sound when grabbing igloo blocks
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

// Data burst sound effect for measuring lines
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

// A drop falling into water. The pitch rising as it decays is what reads as a
// cavity closing over, which is the part the ear recognises as "water" rather
// than as a generic blip.
function plip(power = 1) {
  const now = ctx.currentTime;
  const level = 0.055 * Math.min(1, Math.max(0.2, power));

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(420 + Math.random() * 180, now);
  osc.frequency.exponentialRampToValueAtTime(1500 + Math.random() * 500, now + 0.085);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(level, now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

  osc.connect(gain).connect(master);
  osc.start(now);
  osc.stop(now + 0.2);
}

// The body of liquid moving past, for a change of object. Filtered noise with
// the band sweeping up and away again, so it passes rather than arrives.
function passBy() {
  const now = ctx.currentTime;

  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 1.1;
  band.frequency.setValueAtTime(260, now);
  band.frequency.exponentialRampToValueAtTime(1400, now + 0.34);
  band.frequency.exponentialRampToValueAtTime(300, now + 0.8);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(0.05, now + 0.18);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);

  const source = noiseSource();
  source.connect(band).connect(gain).connect(master);
  source.stop(now + 0.9);
}

// A note for an object arriving.
//
// Pitched from a pentatonic scale rather than a chromatic one: the reader
// controls the order and the timing by scrolling, so any two notes have to sit
// together whichever way they are played. A pentatonic has no semitones in it,
// which is what makes that true.
const SCALE = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3];
const ROOT = 294; // D4, low enough to sit under the pad rather than over it.

function chime(step = 0) {
  const now = ctx.currentTime;
  const octave = Math.floor(step / SCALE.length);
  const hz = ROOT * SCALE[((step % SCALE.length) + SCALE.length) % SCALE.length] * 2 ** octave;

  const soft = ctx.createBiquadFilter();
  soft.type = 'lowpass';
  soft.frequency.setValueAtTime(2600, now);
  soft.frequency.exponentialRampToValueAtTime(900, now + 1.6);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.05, now + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);
  soft.connect(gain).connect(master);

  // Fundamental plus a fifth above it, detuned a little so the pair beats
  // slowly instead of sounding like a synthesiser holding one note.
  for (const [ratio, level, detune] of [[1, 1, 0], [1.5, 0.42, 4], [2, 0.2, -6]]) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = hz * ratio;
    osc.detune.value = detune;

    const voice = ctx.createGain();
    voice.gain.value = level;
    osc.connect(voice).connect(soft);
    osc.start(now);
    osc.stop(now + 2.3);
  }
}

// Telemetry and diagnostics counters
const raw = { drive: 0, force: 0, flight: 0, progress: 0, rate: 0, strength: 0 };
const fired = { hits: 0, bursts: 0 };

export const sound = {
  get enabled() {
    return on;
  },

  // Begins buffering the pad track ahead of the first toggle.
  preload() {
    preloadMusic();
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

    const audio = getMusic();
    if (audio) {
      musicTo(MUSIC_VOLUME);
      audio.play().catch((err) => {
        console.warn('[sound] pad playback was blocked:', err?.name, err?.message);
      });
    }
  },

  stop() {
    if (!ctx || !on) return;
    on = false;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(0, now + FADE);

    musicTo(0);

    clearTimeout(suspendTimer);
    suspendTimer = setTimeout(() => {
      if (!on) ctx?.suspend().catch(() => {});
    }, (FADE + 0.2) * 1000);
  },

  dispose() {
    clearTimeout(suspendTimer);
    clearInterval(musicTimer);
    musicTimer = 0;
    musicTarget = 0;
    on = false;
    if (musicEl) {
      musicEl.pause();
      musicEl.removeAttribute('src');
      musicEl.load();
      musicEl = null;
    }
    ctx?.close().catch(() => {});
    ctx = null;
    master = null;
    voices = null;
    noise = null;
  },

  // Updates air breeze sound based on cursor velocity and travel speed
  air(force = 0, flight = 0) {
    raw.force = force;
    raw.flight = flight;
    if (!on) return;
    const outside = 1 - page;
    at(voices.air.gain.gain, AIR_BED * (1 + 0.45 * force + 0.35 * flight) * outside, 0.6);
    at(voices.air.band.frequency, BAND_HZ + 180 * force + 120 * flight, 0.6);
    musicTo(MUSIC_VOLUME * (1 - 0.35 * page));
  },

  // Igloo block interaction sound
  igloo(strength = 0) {
    raw.strength = strength;
    if (!on || page >= 0.5) return;

    if (!holding && strength > 0.15) {
      holding = true;
      fired.hits += 1;
      sciFiHit();
    } else if (holding && strength < 0.05) {
      holding = false;
    }
  },

  // Line measurement connection sound
  link() {
    if (!on || page >= 0.5) return;
    if (ctx.currentTime - lastBurst < LINK_GAP) return;
    lastBurst = ctx.currentTime;
    fired.bursts += 1;
    dataBurst();
  },

  // Glass button hover/bend sound
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

  /** A touch landing on the object. */
  drop(power = 1) {
    if (!on) return;
    plip(power);
  },

  /** One project giving way to the next. */
  pass() {
    if (!on) return;
    passBy();
  },

  /** An object settling into view, given its own note. */
  arrive(step = 0) {
    if (!on) return;
    chime(step);
  },

  // Scroll transition sound
  cut(progress = 0, rate = 0) {
    raw.progress = progress;
    raw.rate = rate;
    page = ramp(0.55, 0.95, progress);
    if (!on) return;

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
