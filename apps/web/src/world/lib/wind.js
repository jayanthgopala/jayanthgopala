/**
 * The wind, synthesised.
 *
 * NO AUDIO FILE, FOR THE SAME REASONS THE TEXTURES AND THE SKY ARE GENERATED.
 * A wind loop good enough for this is a megabyte or two of someone else's
 * recording, it needs a licence, and — the part that actually decides it — a
 * loop repeats. Wind that comes round again every twelve seconds is worse than
 * no wind at all, because the ear locks onto the period and then cannot let go
 * of it. Noise shaped by filters never repeats, costs nothing to ship, and
 * every value in it is ours to tune.
 *
 * The construction is the standard one for moving air:
 *
 *   pink noise -> a bandpass that sweeps -> a lowpass -> gain
 *
 * PINK RATHER THAN WHITE. White noise is flat per hertz, so it is dominated by
 * the top of the spectrum and reads as hiss or static. Pink falls at 3 dB per
 * octave, which is roughly how broadband natural sound is distributed, and it
 * is the difference between a radio between stations and air.
 *
 * THE SWEEP IS THE GUST. A fixed bandpass gives a constant shhh; moving its
 * centre frequency slowly is what makes the wind rise and fall. Two LFOs at
 * incommensurable rates, so the pattern does not resolve into a cycle — the
 * same reason the terrain warps its noise rather than tiling it.
 */

/** Where the gusting bandpass sits, and how far it wanders. */
const BAND_HZ = 380;
const BAND_SWING = 300;
const BAND_Q = 0.55;

/** Everything above this is hiss rather than wind. */
const ROLLOFF_HZ = 1100;

/** Loudness when on. Deliberately low: this is a room tone, not an effect. */
const LEVEL = 0.055;

/** Seconds to fade in or out. Long enough that toggling never clicks. */
const FADE = 1.4;

/** Seconds of noise in the loop buffer. Long, so its own period is inaudible
 *  underneath the filter movement that is doing the real work. */
const BUFFER_SECONDS = 8;

/**
 * Pink noise via the Voss-McCartney style filter bank.
 *
 * Cheaper and steadier than summing octaves of random, and it is generated once
 * into a buffer rather than per sample at playback, so it costs nothing while
 * running.
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

  /*
   * Cross-fade the seam. The buffer loops, and a discontinuity between its last
   * sample and its first is a click once a cycle — the one artefact that would
   * make the period audible however long the buffer is.
   */
  const blend = Math.min(2000, Math.floor(data.length / 8));
  for (let i = 0; i < blend; i += 1) {
    const k = i / blend;
    const tail = data[data.length - blend + i];
    data[i] = data[i] * k + tail * (1 - k);
  }
}

/**
 * A wind that can be switched on and off.
 *
 * NOTHING IS BUILT UNTIL IT IS FIRST STARTED. An AudioContext created on page
 * load begins life suspended under every browser's autoplay policy and stays
 * that way until a gesture, so building one eagerly buys nothing and leaves a
 * suspended context running for every visitor who never touches the control.
 *
 * @returns {{ start: () => Promise<void>, stop: () => void, dispose: () => void }}
 */
export function createWind() {
  let ctx = null;
  let gain = null;
  let stopped = true;

  function build() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;

    ctx = new Ctx();

    const buffer = ctx.createBuffer(1, ctx.sampleRate * BUFFER_SECONDS, ctx.sampleRate);
    fillPink(buffer.getChannelData(0));

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = BAND_HZ;
    band.Q.value = BAND_Q;

    const rolloff = ctx.createBiquadFilter();
    rolloff.type = 'lowpass';
    rolloff.frequency.value = ROLLOFF_HZ;

    gain = ctx.createGain();
    gain.gain.value = 0;

    /*
     * Two gusts at rates with no common factor, so they drift in and out of
     * phase for minutes rather than lining up on a bar. 0.037 Hz is a swell
     * roughly every twenty-seven seconds; 0.011 Hz is the slower weather over
     * the top of it.
     */
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

    source.connect(band).connect(rolloff).connect(gain).connect(ctx.destination);

    source.start();
    gustA.start();
    gustB.start();
    return true;
  }

  return {
    async start() {
      if (!ctx && !build()) return;
      /* A context created before a gesture starts suspended; resume needs the
         gesture, which is why start() is only ever called from the control. */
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch {
          return;
        }
      }
      stopped = false;
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(LEVEL, now + FADE);
    },

    stop() {
      if (!ctx || stopped) return;
      stopped = true;
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + FADE);
      /* The graph keeps running at zero rather than being torn down: rebuilding
         it on every toggle would re-generate the buffer and re-fade from
         silence, and the context is a few hundred kilobytes at most. */
    },

    dispose() {
      if (!ctx) return;
      ctx.close().catch(() => {});
      ctx = null;
      gain = null;
    },
  };
}
