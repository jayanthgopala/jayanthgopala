import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useWorldScroll } from '../scroll/ScrollProvider.jsx';
import { copy, externalUrl } from '../../lib/api.js';
import { scramble } from '../../crystals/scramble.js';
import { sound } from '../lib/sound.js';
import { sharedCutTexture } from '../lib/cut-texture.js';
import RingsStage from './RingsStage.jsx';

// The last act: past the final project, cut into the ring shaft and fall to the
// room where the contact links are. Owns when the stage mounts and renders, and
// the link switcher laid over the room.

const DEV = import.meta.env.DEV;

// Local stand-ins when the API has no socials, mirroring the seeded rows.
const DEMO_SOCIALS = [
  { label: 'GitHub', url: 'https://github.com/jayanthgopala', icon: 'github' },
  { label: 'LinkedIn', url: 'https://www.linkedin.com/in/jayanth-gopala-v/', icon: 'linkedin' },
  { label: 'Email', url: 'mailto:jayanthgopala21@gmail.com', icon: 'mail' },
];

/**
 * Longest the stage may keep preparing behind the loading screen. Normally it
 * reports back far sooner; this is only the ceiling, so a machine that cannot
 * finish never leaves the site stuck on the loader.
 */
const WARM_MS = 8000;

const pad = (n) => String(n).padStart(2, '0');

// mailto: and anything else already carrying a scheme goes through untouched.
const hrefFor = (url = '') => {
  const raw = String(url).trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : externalUrl(raw);
};

export default function RingsSection({ socials = [], content = {}, onReady }) {
  const { ringCut, ringFall, ringReady } = useWorldScroll();
  const labelRef = useRef(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // Mounted with the site and prepared behind its loading screen, rather than
  // on approach, where the work landed on frames the scroll needed.
  const mounted = true;
  const [warming, setWarming] = useState(true);
  const [cutting, setCutting] = useState(false);
  const [room, setRoom] = useState(false);
  const [index, setIndex] = useState(0);

  const reduced = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );

  const list = useMemo(() => {
    const real = (socials || []).filter((s) => s && s.url);
    if (real.length) return real;
    return DEV ? DEMO_SOCIALS : [];
  }, [socials]);

  // Build the cut mask while the page is idle, long before the cut needs it.
  useEffect(() => {
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 2000));
    const cancel = window.cancelIdleCallback || clearTimeout;
    const id = idle(() => sharedCutTexture(), { timeout: 8000 });
    return () => cancel(id);
  }, []);

  const words = useMemo(
    () => [...list.map((s) => String(s.label || '').toUpperCase()), 'CONTACT'],
    [list]
  );

  useEffect(() => {
    let frame = 0;
    let isCutting = false;
    let isRoom = false;

    const tick = () => {
      const nextCutting = ringCut.current > 0.0005;
      if (nextCutting !== isCutting) {
        isCutting = nextCutting;
        setCutting(nextCutting);
      }

      const nextRoom = ringCut.current >= 1 && ringFall.current >= 0.9;
      if (nextRoom !== isRoom) {
        isRoom = nextRoom;
        setRoom(nextRoom);
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ringCut, ringFall]);

  // Prepared: stop rendering hidden, let the scroll through to the cut, and
  // tell the loading screen this step is done.
  const handleWarm = useCallback(() => {
    if (ringReady.current) return;
    ringReady.current = true;
    setWarming(false);
    onReadyRef.current?.();
  }, [ringReady]);

  // Ceiling: even if preparation never reports back, neither the loader nor the
  // last project may stay closed.
  useEffect(() => {
    const id = setTimeout(handleWarm, WARM_MS);
    return () => clearTimeout(id);
  }, [handleWarm]);

  const step = useCallback(
    (dir) => {
      if (list.length < 2) return;
      setIndex((i) => (i + dir + list.length) % list.length);
    },
    [list.length]
  );

  useEffect(() => {
    if (!room) return undefined;
    const onKey = (event) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        step(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        step(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [room, step]);

  const current = list[index] || null;

  // Written directly rather than rendered, so the scramble never fights React
  // over the text node.
  useLayoutEffect(() => {
    const el = labelRef.current;
    if (!el || !current) return undefined;
    if (!room || reduced) {
      el.textContent = current.label;
      return undefined;
    }
    return scramble(el, current.label, {
      delay: 60,
      duration: 520,
      onTick: () => sound.decodeTick?.(),
      onDone: () => sound.decodeDone?.(),
    });
  }, [current, room, reduced]);

  return (
    <section
      className={`w-rings${cutting ? ' is-cutting' : ''}${room ? ' is-room' : ''}`}
      aria-label={copy(content, 'world.contactLabel', 'Contact')}
      inert={!room}
    >
      {mounted && (
        <RingsStage
          active={cutting || warming}
          ringCut={ringCut}
          ringFall={ringFall}
          socials={list}
          index={index}
          words={words}
          reduced={reduced}
          onWarm={handleWarm}
        />
      )}

      {current && (
        <nav className="w-rings-hud" aria-label={copy(content, 'world.contactNav', 'Links')}>
          <p className="w-rings-eyebrow">{copy(content, 'world.contactEyebrow', '/// Get in touch')}</p>

          <div className="w-rings-switch">
            {list.length > 1 && (
              <button type="button" className="w-rings-arrow is-prev" onClick={() => step(-1)} aria-label="Previous link">
                ←
              </button>
            )}

            <a
              className="w-rings-link"
              href={hrefFor(current.url)}
              target={String(current.url).startsWith('mailto:') ? undefined : '_blank'}
              rel="noreferrer noopener"
              aria-label={current.label}
            >
              <span ref={labelRef} aria-hidden="true" />
            </a>

            {list.length > 1 && (
              <button type="button" className="w-rings-arrow is-next" onClick={() => step(1)} aria-label="Next link">
                →
              </button>
            )}
          </div>

          {list.length > 1 && (
            <p className="w-rings-count">
              {pad(index + 1)} / {pad(list.length)}
            </p>
          )}
        </nav>
      )}
    </section>
  );
}
