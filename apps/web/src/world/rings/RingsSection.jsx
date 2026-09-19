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

// mailto: and anything else already carrying a scheme goes through untouched.
const hrefFor = (url = '') => {
  const raw = String(url).trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : externalUrl(raw);
};

// Opened from a click on the glass case, as the link itself would open it:
// mail in place, everything else in a new tab.
function openLink(item) {
  const href = hrefFor(item.url);
  if (href.startsWith('mailto:')) {
    window.location.href = href;
  } else {
    window.open(href, '_blank', 'noopener,noreferrer');
  }
}

export default function RingsSection({ socials = [], content = {}, onReady }) {
  const { ringCut, ringFall, ringReady } = useWorldScroll();
  const labelRef = useRef(null);
  // Written by the stage every frame: is the pointer over the glass case?
  const overCase = useRef(false);
  // -1, 0 or 1: which arrow the pointer is on, for the mark to lean toward.
  const nudge = useRef(0);
  // Whether a press is in progress, so the cursor can show the drag.
  const holding = useRef(false);
  const currentRef = useRef(null);
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
    let isOver = false;
    let wasHeld = false;

    const tick = () => {
      // Shown from the ring cut on: the room is where the site ends.
      const nextCutting = ringCut.current > 0.0005;
      if (nextCutting !== isCutting) {
        isCutting = nextCutting;
        setCutting(nextCutting);
      }

      const nextRoom = ringCut.current >= 1 && ringFall.current >= 0.9;
      if (nextRoom !== isRoom) {
        isRoom = nextRoom;
        setRoom(nextRoom);
        // The chamber settling into view, given its own note.
        if (nextRoom) sound.arrive(0);
      }

      // Over the chamber the cursor is a hand: the mark can be dragged round,
      // and a click opens the current link. Closed while a drag is under way.
      const nextOver = isRoom && overCase.current;
      const nextHeld = nextOver && holding.current;
      if (nextOver !== isOver || nextHeld !== wasHeld) {
        isOver = nextOver;
        wasHeld = nextHeld;
        document.body.style.cursor = nextOver ? (nextHeld ? 'grabbing' : 'grab') : '';
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      if (isOver) document.body.style.cursor = '';
    };
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
      sound.link();
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

  // In the room, a click inside the glass case opens the current link; a
  // click anywhere else switches link: the left half of the screen goes back,
  // the right half forward. Links and buttons keep their own clicks, and a
  // press that turned into a drag is not a click.
  useEffect(() => {
    if (!room) return undefined;
    let down = null;

    const onDown = (event) => {
      down = { x: event.clientX, y: event.clientY };
      holding.current = true;
    };

    const onUp = (event) => {
      holding.current = false;
      if (!down) return;
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      down = null;
      if (moved > 8) return;
      if (event.target instanceof Element && event.target.closest('a, button, input, [role="button"]')) return;
      if (overCase.current && currentRef.current) {
        sound.glassPress(1);
        openLink(currentRef.current);
        return;
      }
      step(event.clientX < window.innerWidth / 2 ? -1 : 1);
    };

    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
    };
  }, [room, step]);

  const current = list[index] || null;
  currentRef.current = current;
  // The neighbours either side, shown faded beside the current label.
  const prev = list.length > 1 ? list[(index - 1 + list.length) % list.length] : null;
  const next = list.length > 1 ? list[(index + 1) % list.length] : null;

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
          nudge={nudge}
          words={words}
          reduced={reduced}
          onWarm={handleWarm}
          overCase={overCase}
        />
      )}

      {current && (
        <nav className="w-rings-hud" aria-label={copy(content, 'world.contactNav', 'Links')}>
          <div className="w-rings-switch">
            {list.length > 1 && (
              <button
                type="button"
                className="w-rings-arrow is-prev"
                onClick={() => step(-1)}
                onPointerEnter={() => {
                  nudge.current = -1;
                }}
                onPointerLeave={() => {
                  nudge.current = 0;
                }}
                aria-label="Previous link"
              >
                <span className="w-rings-line" aria-hidden="true" />
                <span className="w-rings-word" aria-hidden="true">{copy(content, 'world.prev', 'Prev')}</span>
              </button>
            )}

            {prev && (
              <span className="w-rings-side" aria-hidden="true">
                {prev.label}
              </span>
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

            {next && (
              <span className="w-rings-side" aria-hidden="true">
                {next.label}
              </span>
            )}

            {list.length > 1 && (
              <button
                type="button"
                className="w-rings-arrow is-next"
                onClick={() => step(1)}
                onPointerEnter={() => {
                  nudge.current = 1;
                }}
                onPointerLeave={() => {
                  nudge.current = 0;
                }}
                aria-label="Next link"
              >
                <span className="w-rings-word" aria-hidden="true">{copy(content, 'world.next', 'Next')}</span>
                <span className="w-rings-line" aria-hidden="true" />
              </button>
            )}
          </div>
        </nav>
      )}
    </section>
  );
}
