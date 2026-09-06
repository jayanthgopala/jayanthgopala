import { useEffect, useState } from 'react';
import { copy } from '../lib/api.js';
import { ambient, rememberedSound, rememberSound } from './lib/audio.js';

/**
 * The fixed furniture: a progress rail and a shot counter that hold still while
 * the acts travel behind them.
 *
 * This is the cheapest thing that separates a long page from a sequence.
 * Without persistent chrome a scroll story reads as sections; with it, the
 * frame stays put and the world moves through it, which is what a camera does.
 *
 * Both stay live under reduced motion. In a document with no visible chapters
 * they are orientation aids, not decoration.
 */

export function ProgressRail({ acts, active }) {
  return (
    <div className="cx-rail" aria-hidden="true">
      <span className="cx-rail-line">
        {/* --doc is written to the root element by useDocumentProgress, so the
            fill costs one custom-property write per frame and no render. */}
        <span className="cx-rail-fill" />
      </span>

      <ol className="cx-rail-ticks">
        {acts.map((act, index) => (
          <li
            key={act.id}
            className="cx-rail-tick"
            data-active={index === active || undefined}
            data-passed={index < active || undefined}
          />
        ))}
      </ol>
    </div>
  );
}

export function ShotCounter({ acts, active }) {
  const act = acts[active] || acts[0];
  const pad = (n) => String(n + 1).padStart(2, '0');

  return (
    <div className="cx-counter">
      <span className="cx-counter-index" aria-hidden="true">
        {pad(active)}
        <span className="cx-counter-total">/{pad(acts.length - 1)}</span>
      </span>
      {/* Announced rather than silent: to a screen reader the acts are just
          headings, and saying the act name on arrival is the equivalent of the
          visual counter ticking over. */}
      <span className="cx-counter-name" aria-live="polite">
        {act?.label}
      </span>
    </div>
  );
}

/**
 * Scroll hint under the opening shot. Fades out over the first fifth of the
 * scene — a hint that keeps insisting after it has been obeyed is nagging.
 */
export function ScrollHint({ content }) {
  return (
    <div className="cx-hint" aria-hidden="true">
      <span className="cx-hint-label">{copy(content, 'cine.scroll', 'Scroll')}</span>
      <span className="cx-hint-line" />
    </div>
  );
}

/**
 * The audio meter, bottom right, exactly where the reference puts it.
 *
 * Rendered as five bars that animate only while sound is on, so the control
 * reports its own state without a label — muted is five flat bars, playing is
 * five moving ones. That is the entire affordance, and it is why the reference
 * gets away with no text next to it.
 *
 * The context is built on the first click and not before. Browsers require a
 * user gesture anyway, and constructing one speculatively leaves a suspended
 * AudioContext in memory for every visitor who never wanted sound.
 */
export function SoundToggle({ content }) {
  const [on, setOn] = useState(false);

  // Restore a choice made earlier in the session — but only to `on`, and only
  // by driving the same code path a click would. Session storage is not a user
  // gesture, so this can still be refused, which is why the state is set from
  // the result rather than assumed.
  useEffect(() => {
    if (!rememberedSound()) return;
    let cancelled = false;
    ambient()
      .on()
      .then((ok) => {
        if (!cancelled && ok) setOn(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Stop the drone when the component goes away — switching to minimal mode
  // unmounts this, and sound with no visible control is the worst possible
  // state to leave someone in.
  useEffect(() => () => ambient().off(), []);

  const toggle = async () => {
    const sound = ambient();
    if (on) {
      sound.off();
      setOn(false);
      rememberSound(false);
      return;
    }
    const ok = await sound.on();
    if (!ok) return;
    setOn(true);
    rememberSound(true);
  };

  const label = on
    ? copy(content, 'cine.soundOff', 'Mute sound')
    : copy(content, 'cine.soundOn', 'Play sound');

  return (
    <button
      type="button"
      className="cx-sound"
      onClick={toggle}
      aria-pressed={on}
      aria-label={label}
      title={label}
    >
      <span className="cx-sound-bars" data-on={on || undefined} aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} style={{ '--i': i }} />
        ))}
      </span>
    </button>
  );
}
