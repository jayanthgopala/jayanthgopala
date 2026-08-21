import { useEffect, useRef, useState } from 'react';
import { clamp01, lerp, isTouch, reducedMotion } from './lib/scene.js';

/**
 * A video used as an interactive timeline rather than as playback.
 *
 * The interaction the brief asks for is not "move the mouse, play the clip". It
 * is "the pointer *is* the playhead": move a little and the shot advances a
 * little, move back and it runs backwards, stop and it holds. That distinction
 * is the entire design of this component.
 *
 *     pointer or scroll  ──►  target 0..1
 *                              │
 *                    rAF lerp toward target        (this is what gives it mass)
 *                              │
 *                    video.currentTime = t × duration
 *
 * Three things make the difference between this feeling like a camera and
 * feeling broken:
 *
 *   1. **Never map raw input straight to currentTime.** A pointermove fires far
 *      faster than the decoder can serve frames, so every event becomes a seek
 *      request, the seeks queue, and the picture judders and lags behind the
 *      cursor. Easing toward a target on a rAF loop collapses a burst of events
 *      into at most one seek per frame.
 *
 *   2. **Refuse seeks smaller than a frame.** Below ~1/30s the decoder returns
 *      the same picture, so the seek is pure cost. This is also what lets the
 *      loop park itself: once the delta is under threshold there is nothing
 *      left to do until the next input.
 *
 *   3. **Never seek while a seek is in flight.** Chrome silently drops the
 *      overlapping request; Safari serves it late and out of order, which reads
 *      as the video snapping backwards. `seeking` gates the write.
 *
 * ── No video? Then this renders the poster, and still works. ────────────────
 * The smoothed value is published as `--scrub` on the root element every frame
 * whether or not a video exists, so the poster layers can be parallaxed by the
 * exact same input in pure CSS. That is deliberate: the cinematic experience is
 * complete today with a still image, and dropping an .mp4 in later upgrades it
 * without touching a line of layout. See docs/CINEMATIC-VIDEO.md for the specs
 * of the clips this was built to receive.
 */
export default function ScrubMedia({
  src = '',
  poster = '',
  posterSrcSet = '',
  posterSizes = '',
  alt = '',
  /** 'pointer' — mouse X is the playhead. 'scroll' — the scene's own progress is. */
  driver = 'pointer',
  /** Lower is heavier. 0.06–0.12 reads as a camera; above ~0.3 reads as a cursor. */
  ease = 0.075,
  /** Restrict the clip to a slice of its own timeline, e.g. [0.1, 0.9]. */
  range = [0, 1],
  className = '',
  children,
  ...rest
}) {
  const rootRef = useRef(null);
  const videoRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Touch has no hover, and mobile decoders seek badly under rapid input — so a
  // pointer-driven clip becomes a scroll-driven one rather than dying.
  const [lo, hi] = range;
  const effectiveDriver = driver === 'pointer' && isTouch() ? 'scroll' : driver;
  const showVideo = Boolean(src) && !failed;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    // Under reduced motion the shot holds on a single representative frame and
    // nothing moves. Publishing the midpoint keeps every dependent CSS
    // expression in a sensible resting state instead of at an extreme.
    if (reducedMotion()) {
      root.style.setProperty('--scrub', '0.5');
      const video = videoRef.current;
      if (video && video.readyState >= 1) {
        video.currentTime = lerp(lo, hi, 0.5) * (video.duration || 0);
      }
      return;
    }

    let target = 0;
    let current = 0;
    let frame = 0;
    let running = false;

    const readScroll = () => {
      // The scene writes `--p`; inherit it rather than re-measuring the rect,
      // so the video and the CSS beats can never disagree about where we are.
      const raw = getComputedStyle(root).getPropertyValue('--p');
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) ? clamp01(value) : 0;
    };

    const seek = (t) => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return; // nothing decodable yet
      if (video.seeking) return; // an overlapping seek is dropped or reordered

      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;

      const next = lerp(lo, hi, t) * duration;
      // One frame at 30fps. Anything finer returns the same picture.
      if (Math.abs(next - video.currentTime) < 1 / 30) return;
      video.currentTime = next;
    };

    const tick = () => {
      if (effectiveDriver === 'scroll') target = readScroll();

      current = lerp(current, target, ease);
      root.style.setProperty('--scrub', current.toFixed(4));
      seek(current);

      // Park when settled. A scroll-driven clip re-arms from the scroll
      // listener; a pointer-driven one from pointermove.
      if (Math.abs(current - target) < 0.0004) {
        current = target;
        root.style.setProperty('--scrub', current.toFixed(4));
        seek(current);
        running = false;
        frame = 0;
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    const start = () => {
      if (running) return;
      running = true;
      frame = requestAnimationFrame(tick);
    };

    const onPointerMove = (event) => {
      target = clamp01(event.clientX / window.innerWidth);
      start();
    };

    // Returning to rest when the pointer leaves matters more than it sounds:
    // without it the shot stays frozen at whatever angle the cursor exited at,
    // and a visitor who moves to another window comes back to a crooked frame.
    const onPointerLeave = () => {
      target = 0.5;
      start();
    };

    if (effectiveDriver === 'pointer') {
      target = 0.5;
      window.addEventListener('pointermove', onPointerMove, { passive: true });
      document.addEventListener('pointerleave', onPointerLeave);
    } else {
      window.addEventListener('scroll', start, { passive: true });
      window.addEventListener('resize', start);
    }

    start();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('scroll', start);
      window.removeEventListener('resize', start);
    };
  }, [effectiveDriver, ease, lo, hi]);

  /*
   * Autoplay is never started. `pause()` on metadata is belt-and-braces for the
   * browsers that begin buffering-and-playing a muted inline video regardless
   * of the missing `autoplay` attribute — if that happens, playback and the
   * scrubber fight over currentTime and the picture stutters.
   */
  const onLoadedMetadata = (event) => {
    event.currentTarget.pause();
  };

  return (
    <div ref={rootRef} className={`scrub ${className}`.trim()} data-ready={ready || undefined} {...rest}>
      {/* The poster is not a placeholder that gets thrown away — it is the
          shot's real content until a video exists, and the video's first-frame
          cover while it buffers. It stays in the tree either way. */}
      {poster && (
        <img
          className="scrub-poster"
          src={poster}
          srcSet={posterSrcSet || undefined}
          sizes={posterSrcSet ? posterSizes || undefined : undefined}
          alt={alt}
          fetchPriority="high"
          decoding="async"
          draggable="false"
        />
      )}

      {showVideo && (
        <video
          ref={videoRef}
          className="scrub-video"
          src={src}
          poster={poster || undefined}
          // preload="auto" is the point of the whole component: seeking into an
          // unbuffered region is what produces the black flashes that make
          // scrubbed video look cheap.
          preload="auto"
          muted
          playsInline
          disablePictureInPicture
          // Decorative — the poster above already carries the alt text, and a
          // second description of the same subject just doubles it in a screen
          // reader.
          aria-hidden="true"
          tabIndex={-1}
          onLoadedMetadata={onLoadedMetadata}
          onLoadedData={() => setReady(true)}
          onError={() => setFailed(true)}
        />
      )}

      {children}
    </div>
  );
}
