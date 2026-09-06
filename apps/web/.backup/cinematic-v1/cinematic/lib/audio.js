/**
 * Ambient sound for the sequence, synthesised rather than downloaded.
 *
 * There is no audio file. The bed is three detuned oscillators through a slow
 * filter sweep plus a noise floor, which is about eighty lines of Web Audio and
 * zero bytes of asset — against a two-megabyte loop that would have to be
 * fetched, decoded, and would still be audibly a loop after ninety seconds.
 * Synthesis has no seam to hear.
 *
 * MUTED BY DEFAULT, ALWAYS. Every browser blocks audio until a user gesture,
 * and that policy exists because unsolicited sound on a portfolio is hostile.
 * Nothing here starts without a click on the toggle, and the AudioContext is
 * not even constructed until then — an autoplay attempt would leave a suspended
 * context sitting in memory for every visitor who never wanted sound.
 *
 * The preference is remembered for the session but never across sessions: a
 * first visit is always silent.
 */

const KEY = 'pf_sound';

/** A minor-ninth voicing. Open enough not to resolve, so it never sounds like
 *  it is about to end — which is what a drone under an indefinite scroll needs. */
const VOICES = [55, 82.5, 110, 164.81];

class Ambient {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.nodes = [];
    this.playing = false;
  }

  /** Built lazily on the first unmute, which is also the required user gesture. */
  build() {
    if (this.ctx) return;

    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;

    this.ctx = new Ctx();
    const { ctx } = this;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // A gentle low-pass over everything. Without it the stack of saws is
    // fatiguing within about a minute — the top end is what makes a drone
    // tiring, not the volume.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.6;
    filter.connect(this.master);

    // Very slow filter movement, so the bed breathes instead of sitting still.
    const sweep = ctx.createOscillator();
    const sweepDepth = ctx.createGain();
    sweep.frequency.value = 0.037; // ~27 seconds a cycle
    sweepDepth.gain.value = 180;
    sweep.connect(sweepDepth).connect(filter.frequency);
    sweep.start();
    this.nodes.push(sweep);

    for (const [i, freq] of VOICES.entries()) {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? 'sine' : 'triangle';
      osc.frequency.value = freq;
      // Detune each voice a few cents apart. Perfectly tuned unisons phase-
      // cancel into a thin single tone; a few cents of spread is what makes
      // four oscillators sound like one wide instrument.
      osc.detune.value = (i - 1.5) * 7;

      const gain = ctx.createGain();
      gain.gain.value = 0.12 / (i + 1);

      // Independent slow tremolo per voice, at rates that never line up, so the
      // texture has no audible period.
      const lfo = ctx.createOscillator();
      const lfoDepth = ctx.createGain();
      lfo.frequency.value = 0.05 + i * 0.021;
      lfoDepth.gain.value = gain.gain.value * 0.55;
      lfo.connect(lfoDepth).connect(gain.gain);
      lfo.start();

      osc.connect(gain).connect(filter);
      osc.start();
      this.nodes.push(osc, lfo);
    }

    // A whisper of noise. It sits under the tones as air, and it is what stops
    // the bed sounding synthetic.
    const noise = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      // Brown-ish noise: integrating white noise tilts it toward the low end,
      // which sits under the drone instead of hissing over it.
      last = (last + Math.random() * 2 - 1) * 0.5;
      data[i] = last * 0.6;
    }
    buffer.getChannelData(0).set(data);
    noise.buffer = buffer;
    noise.loop = true;

    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.02;
    noise.connect(noiseGain).connect(filter);
    noise.start();
    this.nodes.push(noise);
  }

  /** Fades to `value` over `seconds`. Ramps, never steps — a jump in gain
   *  on a drone is audible as a click on most hardware. */
  ramp(value, seconds = 1.6) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(value, now + seconds);
  }

  async on() {
    this.build();
    if (!this.ctx) return false;
    // Safari in particular hands back a suspended context even after a gesture.
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.playing = true;
    this.ramp(0.5, 2.2);
    return true;
  }

  off() {
    if (!this.ctx) return;
    this.playing = false;
    this.ramp(0, 0.7);
  }

  dispose() {
    if (!this.ctx) return;
    this.nodes.forEach((node) => {
      try {
        node.stop();
      } catch {
        /* already stopped */
      }
    });
    this.nodes = [];
    this.ctx.close();
    this.ctx = null;
  }
}

let instance = null;

export function ambient() {
  if (!instance) instance = new Ambient();
  return instance;
}

export const rememberedSound = () => {
  try {
    return sessionStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
};

export const rememberSound = (on) => {
  try {
    sessionStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* storage unavailable — the choice still applies for this page */
  }
};
