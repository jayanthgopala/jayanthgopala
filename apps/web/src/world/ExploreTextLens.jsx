import { useEffect, useRef } from 'react';
import { sound } from './lib/sound.js';

// Renders an active trail of propagating ripple waves along the trajectory
// where the cursor has moved across the text, curing smoothly over time.

const LENS = 'w-explore-text-lens';
const WAVES_MAX = 14;
const BASE_SCALE = 22; // Wave ripple displacement intensity
const SPAWN_DIST = 18; // Pixels between new wave spawns

const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Procedural multi-ring wave ripple template (128x128)
let waveTemplateImg = null;
function getWaveTemplate() {
  if (waveTemplateImg) return waveTemplateImg;
  const size = 128;
  const half = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - half) / half;
      const dy = (y + 0.5 - half) / half;
      const d = Math.hypot(dx, dy);
      const i = (y * size + x) * 4;

      if (d > 0 && d < 1) {
        // Multi-ripple harmonic wave packet (crest, trough, crest)
        const envelope = Math.sin(d * Math.PI); // smooth bell envelope
        const wave = Math.sin(d * Math.PI * 3.5); // 2 distinct ripple rings
        const m = (wave * envelope) / 0.85;
        const vx = (dx / d) * m;
        const vy = (dy / d) * m;

        imgData.data[i] = Math.round(128 + Math.max(-1, Math.min(1, vx)) * 127);
        imgData.data[i + 1] = Math.round(128 + Math.max(-1, Math.min(1, vy)) * 127);
        imgData.data[i + 2] = 128;
        imgData.data[i + 3] = Math.round(envelope * 255);
      } else {
        imgData.data[i] = 128;
        imgData.data[i + 1] = 128;
        imgData.data[i + 2] = 128;
        imgData.data[i + 3] = 0;
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const img = new Image();
  img.src = canvas.toDataURL();
  waveTemplateImg = img;
  return img;
}

export default function ExploreTextLens({ panelRef }) {
  const lensImg = useRef(null);
  const lensDisp = useRef(null);

  // Dynamic displacement canvas
  const canvasRef = useRef(null);

  // Ring buffer of propagating waves along the cursor path
  const waves = useRef(
    Array.from({ length: WAVES_MAX }, () => ({
      active: false,
      x: 0,
      y: 0,
      age: 0,
      maxLife: 0.9,
      startR: 16,
      endR: 56,
    }))
  );

  const state = useRef({
    nextIdx: 0,
    lastSpawnX: -9999,
    lastSpawnY: -9999,
    lastSpawnTime: 0,
    lastX: 0,
    lastY: 0,
    speed: 0,
    normX: 0.5,
    inside: false,
    frame: 0,
    lastTime: 0,
  });

  const setFilter = (on) => {
    if (panelRef.current) {
      panelRef.current.style.filter = on ? `url(#${LENS})` : '';
    }
  };

  useEffect(() => {
    if (!canvasRef.current && typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = 280;
      c.height = 420;
      canvasRef.current = c;
    }
    getWaveTemplate();
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;

    const spawnWave = (cx, cy, nx) => {
      const wList = waves.current;
      const s = state.current;
      const w = wList[s.nextIdx];
      w.active = true;
      w.x = cx;
      w.y = cy;
      w.age = 0;
      w.maxLife = 0.9;
      w.startR = 14;
      w.endR = 56;
      s.nextIdx = (s.nextIdx + 1) % WAVES_MAX;
      s.lastSpawnX = cx;
      s.lastSpawnY = cy;
      s.lastSpawnTime = performance.now();
      sound.wavePulse?.(nx);
    };

    const tick = (now) => {
      const s = state.current;
      const dt = Math.min(0.05, (now - s.lastTime) / 1000);
      s.lastTime = now;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const waveImg = getWaveTemplate();

      // Clear with neutral gray (zero displacement)
      ctx.fillStyle = 'rgb(128, 128, 128)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      let activeCount = 0;
      const wList = waves.current;

      for (let i = 0; i < WAVES_MAX; i++) {
        const w = wList[i];
        if (!w.active) continue;

        w.age += dt;
        const progress = w.age / w.maxLife;

        if (progress >= 1) {
          w.active = false;
        } else {
          activeCount++;
          // Wave expands outward where the cursor was
          const r = w.startR + (w.endR - w.startR) * progress;
          // Smooth curing decay over time
          const cure = Math.pow(1 - progress, 1.4);

          ctx.globalAlpha = cure;
          ctx.drawImage(waveImg, w.x - r, w.y - r, r * 2, r * 2);
        }
      }

      ctx.globalAlpha = 1.0;

      // Update SVG filter with rendered wave trail map
      if (lensImg.current) {
        lensImg.current.setAttribute('href', canvas.toDataURL('image/png'));
      }
      lensDisp.current?.setAttribute('scale', String(BASE_SCALE));

      // Continuous futuristic sound sweeps with active waves and speed
      sound.textLens?.(Math.min(1, activeCount / 3.5), s.normX, s.speed);

      // Settle check: all waves have cured to flat rest
      if (activeCount === 0) {
        sound.textLens?.(0, 0.5, 0);
        setFilter(false);
        s.frame = 0;
        return;
      }

      s.frame = requestAnimationFrame(tick);
    };

    const start = () => {
      const s = state.current;
      setFilter(true);
      if (s.frame) return;
      s.lastTime = performance.now();
      s.frame = requestAnimationFrame(tick);
    };

    const onEnter = (e) => {
      if (reduced()) return;
      const rect = panel.getBoundingClientRect();
      const canvas = canvasRef.current;
      if (!canvas) return;

      const targetH = Math.max(280, Math.min(840, Math.round(280 * (rect.height / Math.max(1, rect.width)))));
      if (canvas.height !== targetH) canvas.height = targetH;

      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const nx = Math.max(0, Math.min(1, px / Math.max(1, rect.width)));
      const ny = Math.max(0, Math.min(1, py / Math.max(1, rect.height)));
      const cx = nx * canvas.width;
      const cy = ny * canvas.height;

      const s = state.current;
      s.inside = true;
      s.normX = nx;
      s.lastX = cx;
      s.lastY = cy;
      spawnWave(cx, cy, nx);
      start();
    };

    const onMove = (e) => {
      if (reduced()) return;
      const rect = panel.getBoundingClientRect();
      const canvas = canvasRef.current;
      if (!canvas) return;

      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const nx = Math.max(0, Math.min(1, px / Math.max(1, rect.width)));
      const ny = Math.max(0, Math.min(1, py / Math.max(1, rect.height)));
      const cx = nx * canvas.width;
      const cy = ny * canvas.height;

      const s = state.current;
      s.inside = true;
      s.normX = nx;

      const dist = Math.hypot(cx - s.lastSpawnX, cy - s.lastSpawnY);
      const now = performance.now();
      s.speed = Math.hypot(cx - s.lastX, cy - s.lastY) / Math.max(0.001, (now - s.lastTime) / 1000);
      s.lastX = cx;
      s.lastY = cy;

      // Create waves along the path where the cursor has moved before
      if (dist >= SPAWN_DIST || (dist > 8 && now - s.lastSpawnTime > 75)) {
        spawnWave(cx, cy, nx);
      }

      start();
    };

    const onLeave = () => {
      state.current.inside = false;
      state.current.speed = 0;
    };

    panel.addEventListener('pointerenter', onEnter);
    panel.addEventListener('pointermove', onMove);
    panel.addEventListener('pointerleave', onLeave);

    return () => {
      panel.removeEventListener('pointerenter', onEnter);
      panel.removeEventListener('pointermove', onMove);
      panel.removeEventListener('pointerleave', onLeave);
      if (state.current.frame) cancelAnimationFrame(state.current.frame);
      setFilter(false);
    };
  }, [panelRef]);

  return (
    <svg
      style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <filter
          id={LENS}
          x="0%"
          y="0%"
          width="100%"
          height="100%"
          primitiveUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feImage
            ref={lensImg}
            x="0"
            y="0"
            width="100%"
            height="100%"
            preserveAspectRatio="none"
            result="bump"
          />
          <feDisplacementMap
            ref={lensDisp}
            in="SourceGraphic"
            in2="bump"
            scale="0"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}
