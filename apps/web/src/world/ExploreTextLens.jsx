import { useEffect, useRef } from 'react';
import { sound } from './lib/sound.js';

// SVG lens distortion filter and spring physics applied to explore text on cursor movement,
// matching the interaction in MinimalLink.

const LENS = 'w-explore-text-lens';
const LENS_R = 48;
const LENS_FLOW = 4200;
const LENS_SPRING = 320;
const LENS_DAMP = 12;
const LENS_ENTER = 180;
const FLOW_SPEED = 420;
const STEP = 1 / 240;

const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Procedural radial displacement map for SVG feDisplacementMap
let lensUrl = '';
function lensMap() {
  if (lensUrl) return lensUrl;
  const size = 96;
  const half = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x + 0.5 - half) / half;
      const dy = (y + 0.5 - half) / half;
      const d = Math.hypot(dx, dy);
      let vx = 0;
      let vy = 0;
      if (d > 0 && d < 1) {
        const m = (d * (1 - d) * (1 - d)) / 0.148;
        vx = (dx / d) * m;
        vy = (dy / d) * m;
      }
      const i = (y * size + x) * 4;
      img.data[i] = Math.round(128 + vx * 127);
      img.data[i + 1] = Math.round(128 + vy * 127);
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  lensUrl = canvas.toDataURL('image/png');
  return lensUrl;
}

export default function ExploreTextLens({ panelRef }) {
  const lensImg = useRef(null);
  const lensDisp = useRef(null);

  const sim = useRef({
    x: -9999,
    y: -9999,
    speed: 0,
    lastMove: 0,
    lens: 0,
    lensV: 0,
    inside: false,
    drive: 0,
    frame: 0,
    last: 0,
    acc: 0,
  });

  const draw = () => {
    const s = sim.current;
    const img = lensImg.current;
    if (img) {
      img.setAttribute('x', (s.x - LENS_R).toFixed(1));
      img.setAttribute('y', (s.y - LENS_R).toFixed(1));
      img.setAttribute('width', String(LENS_R * 2));
      img.setAttribute('height', String(LENS_R * 2));
    }
    lensDisp.current?.setAttribute('scale', s.lens.toFixed(2));
  };

  const setFilter = (on) => {
    if (panelRef.current) {
      panelRef.current.style.filter = on ? `url(#${LENS})` : '';
    }
  };

  useEffect(() => {
    lensImg.current?.setAttribute('href', lensMap());
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;

    const step = (dt) => {
      const s = sim.current;
      s.speed *= Math.exp(-dt * 8);
      const drive = s.inside ? Math.min(1, s.speed / FLOW_SPEED) : 0;
      s.drive = drive;

      s.acc += dt;
      while (s.acc >= STEP) {
        s.acc -= STEP;
        s.lensV += (-LENS_FLOW * drive - LENS_SPRING * s.lens - LENS_DAMP * s.lensV) * STEP;
        s.lens += s.lensV * STEP;
      }
    };

    const settled = () => {
      const s = sim.current;
      if (s.inside && s.speed > 5) return false;
      return Math.abs(s.lens) <= 0.03 && Math.abs(s.lensV) <= 0.3;
    };

    const tick = (now) => {
      const s = sim.current;
      const dt = Math.min(0.05, (now - s.last) / 1000);
      s.last = now;
      step(dt);
      draw();
      sound.glass(s.drive, s.lens);

      if (settled()) {
        s.lens = 0;
        s.lensV = 0;
        s.drive = 0;
        draw();
        sound.glass(0, 0);
        setFilter(false);
        s.frame = 0;
        return;
      }
      s.frame = requestAnimationFrame(tick);
    };

    const start = () => {
      const s = sim.current;
      setFilter(true);
      if (s.frame) return;
      s.last = performance.now();
      s.acc = 0;
      s.frame = requestAnimationFrame(tick);
    };

    const onEnter = (e) => {
      if (reduced()) return;
      const rect = panel.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const s = sim.current;
      s.inside = true;
      s.x = x;
      s.y = y;
      s.lastMove = performance.now();
      s.lensV -= LENS_ENTER;
      start();
    };

    const onMove = (e) => {
      if (reduced()) return;
      const rect = panel.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const now = performance.now();
      const s = sim.current;
      if (s.inside && s.lastMove) {
        const dt = Math.max(1, now - s.lastMove) / 1000;
        s.speed = Math.hypot(x - s.x, y - s.y) / dt;
      }
      s.lastMove = now;
      s.x = x;
      s.y = y;
      s.inside = true;
      start();
    };

    const onLeave = () => {
      const s = sim.current;
      s.inside = false;
      s.speed = 0;
      if (!reduced()) start();
    };

    panel.addEventListener('pointerenter', onEnter);
    panel.addEventListener('pointermove', onMove);
    panel.addEventListener('pointerleave', onLeave);

    return () => {
      panel.removeEventListener('pointerenter', onEnter);
      panel.removeEventListener('pointermove', onMove);
      panel.removeEventListener('pointerleave', onLeave);
      if (sim.current.frame) cancelAnimationFrame(sim.current.frame);
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
          x="-10%"
          y="-10%"
          width="120%"
          height="120%"
          primitiveUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodColor="rgb(128,128,128)" result="flat" />
          <feImage
            ref={lensImg}
            x="-9999"
            y="-9999"
            width="0"
            height="0"
            preserveAspectRatio="none"
            result="bump"
          />
          <feComposite in="bump" in2="flat" operator="over" result="map" />
          <feDisplacementMap
            ref={lensDisp}
            in="SourceGraphic"
            in2="map"
            scale="0"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}
