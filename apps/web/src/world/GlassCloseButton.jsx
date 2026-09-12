import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { sound } from './lib/sound.js';

// Interactive ice pill button with dynamic vertex displacement and SVG lens filter
const MARGIN = 14;
const POINTS = 48;
const STEP = 1 / 240;

// Surface spring physics constants
const SPRING = 380;
const COUPLE = 900;
const DAMP = 16;
const REACH = 34;
const FLOW = 2400;
const FLOW_SPEED = 420;
const ENTER_KICK = 240;
const PRESS_DENT = 620;

// Text distortion lens parameters
const LENS = 'w-glass-lens-close';
const LENS_R = 32;
const LENS_FLOW = 4200;
const LENS_SPRING = 320;
const LENS_DAMP = 12;
const LENS_ENTER = 170;
const LENS_PRESS = 420;

const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Generates perimeter sample points along a pill shape
function pill(w, h, n) {
  const r = h / 2;
  const straight = Math.max(0, w - h);
  const arc = Math.PI * r;
  const total = 2 * straight + 2 * arc;
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    let s = (i / n) * total;
    let x;
    let y;
    let nx;
    let ny;
    if (s < straight) {
      x = r + s; y = 0; nx = 0; ny = -1;
    } else if ((s -= straight) < arc) {
      const t = -Math.PI / 2 + s / r;
      x = w - r + r * Math.cos(t); y = r + r * Math.sin(t); nx = Math.cos(t); ny = Math.sin(t);
    } else if ((s -= arc) < straight) {
      x = w - r - s; y = h; nx = 0; ny = 1;
    } else {
      s -= straight;
      const t = Math.PI / 2 + s / r;
      x = r + r * Math.cos(t); y = r + r * Math.sin(t); nx = Math.cos(t); ny = Math.sin(t);
    }
    pts.push({ x: x + MARGIN, y: y + MARGIN, nx, ny });
  }
  return pts;
}

const f = (v) => v.toFixed(2);

// Smooth Catmull-Rom closed SVG path from displaced points
function outline(rest, off) {
  const n = rest.length;
  const xs = new Array(n);
  const ys = new Array(n);
  for (let i = 0; i < n; i += 1) {
    xs[i] = rest[i].x + rest[i].nx * off[i];
    ys[i] = rest[i].y + rest[i].ny * off[i];
  }
  let d = `M${f(xs[0])} ${f(ys[0])}`;
  for (let i = 0; i < n; i += 1) {
    const a = (i - 1 + n) % n;
    const b = (i + 1) % n;
    const c = (i + 2) % n;
    d +=
      `C${f(xs[i] + (xs[b] - xs[a]) / 6)} ${f(ys[i] + (ys[b] - ys[a]) / 6)} ` +
      `${f(xs[b] - (xs[c] - xs[i]) / 6)} ${f(ys[b] - (ys[c] - ys[i]) / 6)} ` +
      `${f(xs[b])} ${f(ys[b])}`;
  }
  return `${d}Z`;
}

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

const GlassCloseButton = forwardRef(function GlassCloseButton(
  { label = 'Close', onClick },
  forwardedRef
) {
  const buttonRef = useRef(null);
  const frostRef = useRef(null);
  const paneRef = useRef(null);
  const sheenRef = useRef(null);
  const labelRef = useRef(null);
  const lensImg = useRef(null);
  const lensDisp = useRef(null);

  useImperativeHandle(forwardedRef, () => buttonRef.current);

  const sim = useRef({
    rest: [],
    off: new Float32Array(POINTS),
    vel: new Float32Array(POINTS),
    ax: 0,
    ay: 0,
    lx: 0,
    ly: 0,
    inside: false,
    speed: 0,
    lastMove: 0,
    lens: 0,
    lensV: 0,
    frame: 0,
    last: 0,
    acc: 0,
  });

  const draw = () => {
    const s = sim.current;
    if (!s.rest.length) return;
    const d = outline(s.rest, s.off);
    paneRef.current?.setAttribute('d', d);
    sheenRef.current?.setAttribute('d', d);
    if (frostRef.current) frostRef.current.style.clipPath = `path('${d}')`;

    const img = lensImg.current;
    if (img) {
      img.setAttribute('x', f(s.ax - s.lx - LENS_R));
      img.setAttribute('y', f(s.ay - s.ly - LENS_R));
      img.setAttribute('width', String(LENS_R * 2));
      img.setAttribute('height', String(LENS_R * 2));
    }
    lensDisp.current?.setAttribute('scale', f(s.lens));
  };

  const lens = (on) => {
    if (labelRef.current) labelRef.current.style.filter = on ? `url(#${LENS})` : '';
  };

  useLayoutEffect(() => {
    const el = buttonRef.current;
    if (!el) return undefined;
    const measure = () => {
      sim.current.rest = pill(el.offsetWidth, el.offsetHeight, POINTS);
      draw();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    lensImg.current?.setAttribute('href', lensMap());
    return () => {
      if (sim.current.frame) cancelAnimationFrame(sim.current.frame);
    };
  }, []);

  const dent = (amount, reach) => {
    const s = sim.current;
    const px = s.ax + MARGIN;
    const py = s.ay + MARGIN;
    const spread = 2 * reach * reach;
    for (let i = 0; i < POINTS; i += 1) {
      const dx = s.rest[i].x - px;
      const dy = s.rest[i].y - py;
      s.vel[i] -= amount * Math.exp(-(dx * dx + dy * dy) / spread);
    }
  };

  const step = (dt) => {
    const s = sim.current;
    s.speed *= Math.exp(-dt * 8);
    const drive = s.inside ? Math.min(1, s.speed / FLOW_SPEED) : 0;
    s.drive = drive;

    const px = s.ax + MARGIN;
    const py = s.ay + MARGIN;
    const spread = 2 * REACH * REACH;

    s.acc += dt;
    while (s.acc >= STEP) {
      s.acc -= STEP;
      for (let i = 0; i < POINTS; i += 1) {
        const p = s.rest[i];
        const dx = p.x - px;
        const dy = p.y - py;
        const push = drive > 0.001 ? -FLOW * drive * Math.exp(-(dx * dx + dy * dy) / spread) : 0;
        const o = s.off[i];
        const neighbours = s.off[(i + POINTS - 1) % POINTS] + s.off[(i + 1) % POINTS] - 2 * o;
        s.vel[i] += (push - SPRING * o + COUPLE * neighbours - DAMP * s.vel[i]) * STEP;
      }
      for (let i = 0; i < POINTS; i += 1) {
        s.off[i] = Math.max(-14, Math.min(8, s.off[i] + s.vel[i] * STEP));
      }
      s.lensV += (-LENS_FLOW * drive - LENS_SPRING * s.lens - LENS_DAMP * s.lensV) * STEP;
      s.lens += s.lensV * STEP;
    }
  };

  const settled = () => {
    const s = sim.current;
    if (s.inside && s.speed > 5) return false;
    if (Math.abs(s.lens) > 0.03 || Math.abs(s.lensV) > 0.3) return false;
    for (let i = 0; i < POINTS; i += 1) {
      if (Math.abs(s.off[i]) > 0.02 || Math.abs(s.vel[i]) > 0.3) return false;
    }
    return true;
  };

  const tick = (now) => {
    const s = sim.current;
    const dt = Math.min(0.05, (now - s.last) / 1000);
    s.last = now;
    step(dt);
    draw();
    sound.glass(s.drive, s.lens);
    if (settled()) {
      s.off.fill(0);
      s.vel.fill(0);
      s.lens = 0;
      s.lensV = 0;
      s.drive = 0;
      draw();
      sound.glass(0, 0);
      lens(false);
      s.frame = 0;
      return;
    }
    s.frame = requestAnimationFrame(tick);
  };

  const start = () => {
    const s = sim.current;
    lens(true);
    if (s.frame) return;
    s.last = performance.now();
    s.acc = 0;
    s.frame = requestAnimationFrame(tick);
  };

  const locate = (event) => {
    const s = sim.current;
    const box = buttonRef.current.getBoundingClientRect();
    const lab = labelRef.current.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const now = performance.now();
    if (s.inside && s.lastMove) {
      const dt = Math.max(1, now - s.lastMove) / 1000;
      s.speed = Math.hypot(x - s.ax, y - s.ay) / dt;
    }
    s.lastMove = now;
    s.ax = x;
    s.ay = y;
    s.lx = lab.left - box.left;
    s.ly = lab.top - box.top;
  };

  const onEnter = (event) => {
    if (reduced()) return;
    locate(event);
    const s = sim.current;
    s.inside = true;
    dent(ENTER_KICK, REACH);
    s.lensV -= LENS_ENTER;
    start();
  };

  const onMove = (event) => {
    if (reduced()) return;
    locate(event);
    sim.current.inside = true;
    start();
  };

  const onDown = (event) => {
    if (reduced()) return;
    locate(event);
    const s = sim.current;
    s.inside = true;
    dent(PRESS_DENT, REACH * 1.4);
    s.lensV -= LENS_PRESS;
    sound.glassPress();
    start();
  };

  const onLeave = () => {
    const s = sim.current;
    s.inside = false;
    s.speed = 0;
    if (!reduced()) start();
  };

  const reach = {
    left: -MARGIN,
    top: -MARGIN,
    width: `calc(100% + ${MARGIN * 2}px)`,
    height: `calc(100% + ${MARGIN * 2}px)`,
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      className="w-glass w-detail-glass-close"
      aria-label="Close project"
      onPointerEnter={onEnter}
      onPointerMove={onMove}
      onPointerDown={onDown}
      onPointerLeave={onLeave}
      onClick={onClick}
    >
      <span ref={frostRef} className="w-glass-frost" style={reach} aria-hidden="true" />
      <svg className="w-glass-shape" style={reach} aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="w-glass-fill-close" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.46" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.14" />
          </linearGradient>
          <linearGradient id="w-glass-rim-close" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.4" />
          </linearGradient>
          <filter
            id={LENS}
            x="-30%"
            y="-80%"
            width="160%"
            height="260%"
            colorInterpolationFilters="sRGB"
          >
            <feFlood floodColor="rgb(128,128,128)" result="flat" />
            <feImage ref={lensImg} x="0" y="0" width="0" height="0" preserveAspectRatio="none" result="bump" />
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
        <path
          ref={paneRef}
          className="w-glass-pane"
          style={{ fill: 'url(#w-glass-fill-close)', stroke: 'url(#w-glass-rim-close)' }}
        />
        <path ref={sheenRef} className="w-glass-sheen" />
      </svg>
      <span ref={labelRef} className="w-glass-label" aria-hidden="true">
        <span>✕</span>
        <span>{label}</span>
      </span>
    </button>
  );
});

export default GlassCloseButton;
