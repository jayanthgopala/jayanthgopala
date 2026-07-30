import { ASCII_PORTRAIT } from './ascii.js';

/**
 * Animated GitHub profile banner, rendered as pure SVG + SMIL.
 *
 * Served live from D1, so editing content in the admin panel changes the
 * banner with no commit — the same trick the status card uses.
 *
 * Three constraints shape everything below, because GitHub serves this through
 * its camo proxy as an <img>:
 *
 *   1. No pointer events reach the document, so `:hover` is dead. Anything the
 *      brief wanted on hover is a timed loop instead.
 *   2. No external resources, so no webfonts — only system font stacks.
 *   3. No JavaScript. Every animation here is SMIL.
 *
 * `backdrop-filter` also doesn't exist in SVG, so the glass look is layered
 * translucent fills plus blurred glows rather than a real blur of the backdrop.
 */

const W = 1180;
const H = 610;

const PALETTES = {
  dark: {
    bg: '#030712',
    panel: '#0F172A',
    panelAlt: '#111C33',
    border: 'rgba(255,255,255,0.08)',
    borderStrong: 'rgba(255,255,255,0.16)',
    text: '#F8FAFC',
    muted: '#94A3B8',
    dim: '#64748B',
    a1: '#7C3AED',
    a2: '#22D3EE',
    a3: '#10B981',
    asciiFrom: '#22D3EE',
    asciiTo: '#7C3AED',
    glowOpacity: 0.55,
    blobOpacity: 0.5,
    noiseOpacity: 0.16,
    scanOpacity: 0.07,
    pillFill: 'rgba(255,255,255,0.045)',
    sheen: 'rgba(255,255,255,0.07)',
  },
  light: {
    bg: '#FFFFFF',
    panel: '#F8FAFC',
    panelAlt: '#F1F5F9',
    border: 'rgba(15,23,42,0.08)',
    borderStrong: 'rgba(15,23,42,0.16)',
    text: '#0F172A',
    muted: '#475569',
    dim: '#64748B',
    a1: '#2563EB',
    a2: '#06B6D4',
    a3: '#10B981',
    asciiFrom: '#2563EB',
    asciiTo: '#06B6D4',
    // Softer everywhere: the same glow strength that reads as depth on near
    // black reads as smudge on white.
    glowOpacity: 0.3,
    blobOpacity: 0.22,
    noiseOpacity: 0.06,
    scanOpacity: 0.035,
    pillFill: 'rgba(15,23,42,0.035)',
    sheen: 'rgba(255,255,255,0.55)',
  },
};

const esc = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const clip = (s = '', max) => {
  const str = String(s);
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
};

const round = (n) => Math.round(n * 100) / 100;

// Rough advance widths. Without a text-measuring API these are the calibration
// that keeps pills and cursors aligned; they are tuned for the stacks below.
const MONO = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const monoAdv = (size) => size * 0.6;
const sansAdv = (size) => size * 0.53;

/* --------------------------------------------------------------------------
   Typing animation

   One <animate> per element spanning the whole cycle, with explicit
   keyTimes/values. The obvious alternative — `begin` offsets with
   fill="freeze" — cannot loop as a group in SMIL without fragile
   `someId.end` chaining, so the whole sequence is expressed as one timeline.
   -------------------------------------------------------------------------- */

function buildTypingBlock({ roles, x, baseline, size, colorId, cursorColor }) {
  const CHAR = 0.055; // seconds per character
  const HOLD = 1.75; // seconds to sit on a finished phrase
  const adv = monoAdv(size);

  const spans = roles.map((r) => ({ text: r, dur: r.length * CHAR + HOLD }));
  const total = spans.reduce((sum, s) => sum + s.dur, 0);

  let cursor = 0;
  const parts = [];

  spans.forEach((span, i) => {
    const start = cursor;
    const typeDur = span.text.length * CHAR;
    cursor += span.dur;

    const t = (sec) => round(Math.min(1, Math.max(0, sec / total)));
    const EPS = 0.0008;

    // --- visibility window
    const showAt = t(start);
    const shown = round(Math.min(1, showAt + EPS));
    const hideAt = t(start + span.dur - 0.12);
    const hidden = round(Math.min(1, hideAt + EPS));

    const opacityKeys = [0, showAt, shown, hideAt, hidden, 1];
    const opacityVals = i === 0 ? [1, 1, 1, 1, 0, 0] : [0, 0, 1, 1, 0, 0];

    // --- per-character reveal
    const keyTimes = [0];
    const widths = [0];
    const cursorX = [x];
    for (let c = 1; c <= span.text.length; c++) {
      keyTimes.push(t(start + c * CHAR));
      widths.push(round(c * adv));
      cursorX.push(round(x + c * adv));
    }
    keyTimes.push(1);
    widths.push(round(span.text.length * adv));
    cursorX.push(round(x + span.text.length * adv));

    // keyTimes must be strictly non-decreasing and end at exactly 1.
    const kt = keyTimes.map((v, idx) => (idx === keyTimes.length - 1 ? 1 : Math.min(v, 0.9999)));

    const clipId = `type${i}`;
    parts.push(`
    <clipPath id="${clipId}">
      <rect x="${x}" y="${baseline - size}" height="${size * 1.5}" width="0">
        <animate attributeName="width" calcMode="discrete"
          values="${widths.join(';')}" keyTimes="${kt.join(';')}"
          dur="${round(total)}s" repeatCount="indefinite"/>
      </rect>
    </clipPath>
    <g opacity="${i === 0 ? 1 : 0}">
      <animate attributeName="opacity" values="${opacityVals.join(';')}"
        keyTimes="${opacityKeys.join(';')}" dur="${round(total)}s" repeatCount="indefinite"/>
      <text x="${x}" y="${baseline}" clip-path="url(#${clipId})"
        font-family="${MONO}" font-size="${size}" font-weight="500"
        fill="url(#${colorId})" xml:space="preserve">${esc(span.text)}</text>
      <rect y="${baseline - size + 1}" width="2" height="${size}" fill="${cursorColor}" x="${x}">
        <animate attributeName="x" calcMode="discrete"
          values="${cursorX.join(';')}" keyTimes="${kt.join(';')}"
          dur="${round(total)}s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="1;1;0;0;1" keyTimes="0;0.45;0.5;0.95;1"
          dur="1.05s" repeatCount="indefinite"/>
      </rect>
    </g>`);
  });

  return parts.join('');
}

/* --------------------------------------------------------------------------
   Skill pills — wrapped, with a staggered breathing glow standing in for the
   hover state that camo makes impossible.
   -------------------------------------------------------------------------- */

function buildPills({ items, x, y, maxWidth, palette }) {
  const size = 11.5;
  const padX = 11;
  const height = 25;
  const gapX = 7;
  const gapY = 8;

  let cx = x;
  let cy = y;
  const out = [];

  items.forEach((label, i) => {
    const w = round(label.length * sansAdv(size) + padX * 2);
    if (cx + w > x + maxWidth) {
      cx = x;
      cy += height + gapY;
    }
    const delay = round((i % 7) * 0.42);

    out.push(`
      <g opacity="0">
        <animate attributeName="opacity" from="0" to="1" begin="${round(1.1 + i * 0.07)}s"
          dur="0.45s" fill="freeze"/>
        <rect x="${round(cx)}" y="${cy}" width="${w}" height="${height}" rx="${height / 2}"
          fill="${palette.pillFill}" stroke="${palette.border}" stroke-width="1"/>
        <rect x="${round(cx)}" y="${cy}" width="${w}" height="${height}" rx="${height / 2}"
          fill="none" stroke="url(#accent)" stroke-width="1" opacity="0">
          <animate attributeName="opacity" values="0;${palette.glowOpacity};0"
            keyTimes="0;0.5;1" dur="4.2s" begin="${delay}s" repeatCount="indefinite"/>
        </rect>
        <text x="${round(cx + w / 2)}" y="${cy + height / 2 + 4}" text-anchor="middle"
          font-family="${SANS}" font-size="${size}" font-weight="500"
          fill="${palette.muted}">${esc(label)}</text>
      </g>`);

    cx += w + gapX;
  });

  return { markup: out.join(''), bottom: cy + height };
}

/* --------------------------------------------------------------------------
   Social icons — 24-unit paths, scaled down and placed on a row.
   -------------------------------------------------------------------------- */

const ICON_PATHS = {
  github:
    'M12 2C6.5 2 2 6.6 2 12.3c0 4.5 2.9 8.4 6.8 9.7.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.4-3.4-1.4-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1.1 1.5 1.1.9 1.6 2.3 1.1 2.9.9.1-.7.4-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5.1 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.3 9.3 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.3 4.8-4.6 5.1.4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10 10 0 0 0 22 12.3C22 6.6 17.5 2 12 2Z',
  linkedin:
    'M5 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9h4v12H3V9Zm7 0h3.8v1.7h.1c.5-1 1.8-2 3.7-2 4 0 4.4 2.5 4.4 5.7V21h-4v-5.6c0-1.3 0-3-1.9-3s-2.1 1.4-2.1 2.9V21h-4V9Z',
  x: 'M17.5 3h3l-6.6 7.6L21.8 21h-6.1l-4.8-6.3L5.3 21h-3l7.1-8.1L2.3 3h6.3l4.3 5.7L17.5 3Zm-1 16.2h1.7L7.1 4.7H5.3l11.2 14.5Z',
  mail: 'M2.5 6.5A2.5 2.5 0 0 1 5 4h14a2.5 2.5 0 0 1 2.5 2.5v11A2.5 2.5 0 0 1 19 20H5a2.5 2.5 0 0 1-2.5-2.5v-11Zm2.2-.3 7 4.8c.2.1.4.1.6 0l7-4.8H4.7Z',
  globe:
    'M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19Zm0 1.6c1.3 0 2.8 2.2 3.3 5.4H8.7C9.2 6.3 10.7 4.1 12 4.1ZM8.4 11.1h7.2a17 17 0 0 1 0 1.8H8.4a17 17 0 0 1 0-1.8Zm.3 3.9h6.6c-.5 3.2-2 5.4-3.3 5.4s-2.8-2.2-3.3-5.4Z',
  link: 'M10 13a4 4 0 0 0 5.7 0l3-3A4 4 0 1 0 13 4.3l-1.5 1.5m2.5 7.2a4 4 0 0 0-5.7 0l-3 3A4 4 0 1 0 11 19.7l1.5-1.5',
};

function buildSocials({ socials, x, y, palette }) {
  const size = 18;
  const gap = 30;
  const labelSize = 11;

  return socials
    .map((s, i) => {
      const path = ICON_PATHS[s.icon] || ICON_PATHS.link;
      const label = clip(s.label, 12);
      const cellW = size + 7 + label.length * sansAdv(labelSize) + gap;
      const ox = x + i * 0;
      // Lay out left-to-right, accumulating outside the map for clarity.
      return { path, label, cellW, ox };
    })
    .reduce(
      (acc, item) => {
        const cx = acc.x;
        acc.out.push(`
      <g opacity="0" transform="translate(${round(cx)} ${y})">
        <animate attributeName="opacity" from="0" to="1"
          begin="${round(2.1 + acc.i * 0.12)}s" dur="0.5s" fill="freeze"/>
        <g transform="scale(${round(size / 24)})">
          <path d="${item.path}" fill="url(#accent)" opacity="0.92"/>
        </g>
        <text x="${size + 7}" y="${size - 4}" font-family="${SANS}" font-size="${labelSize}"
          fill="${palette.muted}">${esc(item.label)}</text>
      </g>`);
        acc.x += item.cellW;
        acc.i += 1;
        return acc;
      },
      { out: [], x, i: 0 }
    ).out.join('');
}

/* --------------------------------------------------------------------------
   Background: blobs, particles, scanline, noise
   -------------------------------------------------------------------------- */

function buildAtmosphere(p) {
  const blobs = [
    { cx: 210, cy: 140, r: 230, fill: 'url(#blobA)', dur: 19, dx: 34, dy: 22 },
    { cx: 960, cy: 120, r: 260, fill: 'url(#blobB)', dur: 24, dx: -40, dy: 26 },
    { cx: 640, cy: 560, r: 250, fill: 'url(#blobC)', dur: 28, dx: 30, dy: -24 },
  ]
    .map(
      (b) => `
    <circle cx="${b.cx}" cy="${b.cy}" r="${b.r}" fill="${b.fill}" opacity="${p.blobOpacity}">
      <animateTransform attributeName="transform" type="translate"
        values="0 0; ${b.dx} ${b.dy}; 0 0" dur="${b.dur}s" repeatCount="indefinite"
        calcMode="spline" keySplines="0.4 0 0.2 1; 0.4 0 0.2 1" keyTimes="0;0.5;1"/>
    </circle>`
    )
    .join('');

  // Deterministic pseudo-random placement — a seeded loop keeps the output
  // byte-identical between renders, which matters for caching.
  const particles = Array.from({ length: 22 }, (_, i) => {
    const x = round(((i * 137.5) % 100) / 100 * (W - 80) + 40);
    const y = round(((i * 79.3) % 100) / 100 * (H - 80) + 40);
    const r = round(0.7 + ((i * 31) % 10) / 10);
    const dur = round(9 + ((i * 17) % 11));
    const rise = round(26 + ((i * 13) % 30));
    return `
    <circle cx="${x}" cy="${y}" r="${r}" fill="${p.a2}" opacity="0">
      <animate attributeName="opacity" values="0;0.55;0" dur="${dur}s"
        begin="${round((i % 9) * 0.7)}s" repeatCount="indefinite"/>
      <animateTransform attributeName="transform" type="translate"
        values="0 0; 0 -${rise}" dur="${dur}s" begin="${round((i % 9) * 0.7)}s"
        repeatCount="indefinite"/>
    </circle>`;
  }).join('');

  return `
  <g clip-path="url(#card)">
    ${blobs}
    ${particles}
    <rect width="${W}" height="${H}" fill="url(#noisePattern)" opacity="${p.noiseOpacity}"/>
    <rect x="0" y="-90" width="${W}" height="90" fill="url(#scan)" opacity="${p.scanOpacity}">
      <animate attributeName="y" from="-90" to="${H}" dur="7s" repeatCount="indefinite"/>
    </rect>
  </g>`;
}

/* --------------------------------------------------------------------------
   Main
   -------------------------------------------------------------------------- */

export function bannerSvg(site, mode = 'dark') {
  const p = PALETTES[mode] || PALETTES.dark;
  const c = site.content || {};
  const profile = site.profile || {};
  const t = (key, fallback) => c[key] || fallback;

  const roles = String(t('banner.roles', 'Full Stack Developer'))
    .split('|')
    .map((r) => r.trim())
    .filter(Boolean)
    .slice(0, 6);

  const maxSkills = Number(t('banner.skillsMax', '11')) || 11;
  const skills = (site.stack || []).slice(0, maxSkills).map((s) => s.name);
  const socials = (site.socials || []).slice(0, 4);

  /**
   * Education, Focus and Portfolio are derived from live data rather than typed
   * out again as banner copy. They were static content keys, which meant adding
   * a degree or changing the current project updated the site but left the
   * GitHub banner claiming something else. The content keys survive as manual
   * overrides for anyone who wants to word it differently.
   */
  const latestEducation = (site.education || [])[0];
  const educationValue =
    t('banner.education', '') ||
    (latestEducation
      ? [latestEducation.qualification, latestEducation.institution].filter(Boolean).join(' · ')
      : '');

  const focusValue = t('banner.focus', '') || site.status?.currentProject || '';

  const portfolioLink = (site.socials || []).find(
    (s) => s.icon === 'globe' || /portfolio|website/i.test(s.label)
  );
  const portfolioValue =
    t('banner.portfolio', '') ||
    String(portfolioLink?.url || '')
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/+$/, '');

  const meta = [
    [t('banner.label.location', 'Location'), profile.location],
    [t('banner.label.education', 'Education'), educationValue],
    [t('banner.label.focus', 'Focus'), focusValue],
    [t('banner.label.portfolio', 'Portfolio'), portfolioValue],
    [t('banner.label.email', 'Email'), profile.email],
  ].filter(([, value]) => value);

  // --- ASCII portrait
  const asciiSize = 9.6;
  const asciiLead = 10.2;
  const asciiX = 62;
  const asciiY = 62;
  const asciiLines = ASCII_PORTRAIT.map(
    (line, i) => `
      <text x="${asciiX}" y="${round(asciiY + i * asciiLead)}" opacity="0"
        xml:space="preserve">${esc(line)}<animate attributeName="opacity"
        from="0" to="0.92" begin="${round(0.25 + i * 0.035)}s" dur="0.5s" fill="freeze"/></text>`
  ).join('');

  const asciiHeight = ASCII_PORTRAIT.length * asciiLead;

  // --- Terminal geometry
  const tx = 456;
  const ty = 36;
  const tw = 696;
  const th = 538;
  const px = tx + 32;
  const innerW = tw - 64;

  const pills = buildPills({ items: skills, x: px, y: 384, maxWidth: innerW, palette: p });

  // Footer follows the pills but stays inside the panel: 486 is the lowest rule
  // that leaves room for a 20px icon row plus bottom padding.
  const dividerY = Math.min(pills.bottom + 34, 486);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"
  viewBox="0 0 ${W} ${H}" fill="none" role="img"
  aria-label="${esc(profile.name || 'Profile')} — ${esc(roles[0] || '')}">
  <defs>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${p.a1}"/>
      <stop offset="50%" stop-color="${p.a2}"/>
      <stop offset="100%" stop-color="${p.a3}"/>
      <animateTransform attributeName="gradientTransform" type="rotate"
        values="0 0.5 0.5; 360 0.5 0.5" dur="24s" repeatCount="indefinite"/>
    </linearGradient>

    <linearGradient id="ascii" x1="0" y1="0" x2="0.9" y2="1">
      <stop offset="0%" stop-color="${p.asciiFrom}">
        <animate attributeName="stop-color"
          values="${p.asciiFrom};${p.asciiTo};${p.a3};${p.asciiFrom}"
          dur="14s" repeatCount="indefinite"/>
      </stop>
      <stop offset="100%" stop-color="${p.asciiTo}">
        <animate attributeName="stop-color"
          values="${p.asciiTo};${p.a3};${p.asciiFrom};${p.asciiTo}"
          dur="14s" repeatCount="indefinite"/>
      </stop>
    </linearGradient>

    <linearGradient id="nameGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${p.text}"/>
      <stop offset="100%" stop-color="${p.a2}"/>
    </linearGradient>

    <linearGradient id="shimmer" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${p.a2}" stop-opacity="0"/>
      <stop offset="45%" stop-color="${p.a2}" stop-opacity="0.9"/>
      <stop offset="55%" stop-color="${p.a1}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${p.a1}" stop-opacity="0"/>
      <animateTransform attributeName="gradientTransform" type="translate"
        values="-1 0; 1 0" dur="5.5s" repeatCount="indefinite"/>
    </linearGradient>

    <linearGradient id="scan" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${p.a2}" stop-opacity="0"/>
      <stop offset="50%" stop-color="${p.a2}" stop-opacity="1"/>
      <stop offset="100%" stop-color="${p.a2}" stop-opacity="0"/>
    </linearGradient>

    <linearGradient id="glass" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0%" stop-color="${p.sheen}"/>
      <stop offset="55%" stop-color="${p.sheen}" stop-opacity="0"/>
    </linearGradient>

    <radialGradient id="blobA"><stop offset="0%" stop-color="${p.a1}" stop-opacity="0.42"/><stop offset="100%" stop-color="${p.a1}" stop-opacity="0"/></radialGradient>
    <radialGradient id="blobB"><stop offset="0%" stop-color="${p.a2}" stop-opacity="0.34"/><stop offset="100%" stop-color="${p.a2}" stop-opacity="0"/></radialGradient>
    <radialGradient id="blobC"><stop offset="0%" stop-color="${p.a3}" stop-opacity="0.3"/><stop offset="100%" stop-color="${p.a3}" stop-opacity="0"/></radialGradient>

    <radialGradient id="asciiGlow">
      <stop offset="0%" stop-color="${p.asciiFrom}" stop-opacity="0.3"/>
      <stop offset="55%" stop-color="${p.asciiTo}" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="${p.asciiTo}" stop-opacity="0"/>
    </radialGradient>

    <!-- Noise is generated on a 160x160 tile and repeated, not computed across
         the whole 1180x610 canvas. feTurbulence cost scales with area, and the
         full-canvas version measurably stalls the renderer. -->
    <filter id="noise" x="0" y="0" width="160" height="160" filterUnits="userSpaceOnUse">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
    </filter>
    <pattern id="noisePattern" width="160" height="160" patternUnits="userSpaceOnUse">
      <rect width="160" height="160" filter="url(#noise)"/>
    </pattern>

    <clipPath id="card"><rect width="${W}" height="${H}" rx="26"/></clipPath>
    <clipPath id="asciiClip"><rect x="26" y="40" width="412" height="${round(asciiHeight + 24)}"/></clipPath>
  </defs>

  <rect width="${W}" height="${H}" rx="26" fill="${p.bg}"/>
  ${buildAtmosphere(p)}

  <!-- Left: ASCII portrait.
       Deliberately NOT filtered. A feGaussianBlur on a group that also carries
       an animateTransform forces the browser to recompute the blur over a
       ~400x500 region every frame, which locks the renderer. The glow instead
       comes from a static radial behind the art, which costs nothing. -->
  <g clip-path="url(#asciiClip)">
    <ellipse cx="232" cy="300" rx="190" ry="240" fill="url(#asciiGlow)" opacity="${p.glowOpacity}">
      <animate attributeName="opacity" values="${p.glowOpacity};${round(p.glowOpacity * 1.5)};${p.glowOpacity}"
        dur="6.5s" repeatCount="indefinite"/>
    </ellipse>
    <g font-family="${MONO}" font-size="${asciiSize}" fill="url(#ascii)" letter-spacing="0">
      <animateTransform attributeName="transform" type="translate"
        values="0 0; 0 -7; 0 0" dur="11s" repeatCount="indefinite"
        calcMode="spline" keySplines="0.4 0 0.2 1; 0.4 0 0.2 1" keyTimes="0;0.5;1"/>
      ${asciiLines}
    </g>
  </g>

  <!-- Terminal panel -->
  <g>
    <rect x="${tx}" y="${ty}" width="${tw}" height="${th}" rx="18"
      fill="${p.panel}" fill-opacity="${mode === 'dark' ? 0.72 : 0.9}"
      stroke="${p.border}" stroke-width="1"/>
    <rect x="${tx}" y="${ty}" width="${tw}" height="${th}" rx="18" fill="url(#glass)" opacity="0.5"/>
    <rect x="${tx}" y="${ty}" width="${tw}" height="${th}" rx="18"
      fill="none" stroke="url(#shimmer)" stroke-width="1.2" opacity="0.85"/>

    <!-- title bar -->
    <path d="M${tx} ${ty + 34} h${tw}" stroke="${p.border}" stroke-width="1"/>
    <circle cx="${tx + 24}" cy="${ty + 17}" r="5" fill="#FF5F57" opacity="0.85"/>
    <circle cx="${tx + 42}" cy="${ty + 17}" r="5" fill="#FEBC2E" opacity="0.85"/>
    <circle cx="${tx + 60}" cy="${ty + 17}" r="5" fill="#28C840" opacity="0.85"/>
    <text x="${tx + tw / 2}" y="${ty + 21}" text-anchor="middle" font-family="${MONO}"
      font-size="11" fill="${p.dim}">${esc(profile.githubUser || 'profile')} — zsh</text>

    <!-- greeting -->
    <text x="${px}" y="102" font-family="${SANS}" font-size="14" fill="${p.muted}" opacity="0">
      ${esc(t('banner.greeting', "Hi 👋"))}
      <animate attributeName="opacity" from="0" to="1" begin="0.2s" dur="0.5s" fill="freeze"/>
    </text>

    <text x="${px}" y="142" font-family="${SANS}" font-size="30" font-weight="700"
      letter-spacing="-0.8" fill="url(#nameGrad)" opacity="0">
      I&apos;m ${esc(profile.name || '')}
      <animate attributeName="opacity" from="0" to="1" begin="0.4s" dur="0.6s" fill="freeze"/>
    </text>

    <!-- typing roles -->
    ${buildTypingBlock({
      roles,
      x: px,
      baseline: 178,
      size: 16,
      colorId: 'accent',
      cursorColor: p.a2,
    })}

    <path d="M${px} 200 h${innerW}" stroke="${p.border}" stroke-width="1"/>

    <!-- meta rows -->
    ${meta
      .map(
        ([label, value], i) => `
    <g opacity="0">
      <animate attributeName="opacity" from="0" to="1" begin="${round(0.8 + i * 0.14)}s"
        dur="0.5s" fill="freeze"/>
      <text x="${px}" y="${228 + i * 26}" font-family="${MONO}" font-size="11.5"
        fill="${p.dim}">${esc(label)}</text>
      <text x="${px + 104}" y="${228 + i * 26}" font-family="${SANS}" font-size="12.5"
        fill="${p.text}">${esc(clip(value, 52))}</text>
    </g>`
      )
      .join('')}

    <!-- skills -->
    <text x="${px}" y="368" font-family="${SANS}" font-size="10" font-weight="600"
      letter-spacing="1.6" fill="${p.dim}" opacity="0">
      ${esc(String(t('banner.skillsLabel', 'Stack')).toUpperCase())}
      <animate attributeName="opacity" from="0" to="1" begin="1s" dur="0.5s" fill="freeze"/>
    </text>
    ${pills.markup}

    <!-- socials — anchored to where the pills actually end, not a fixed y.
         With a short stack a fixed footer left a dead band; with a long one it
         would have collided. Clamped so it can never leave the panel. -->
    <path d="M${px} ${dividerY} h${innerW}" stroke="${p.border}" stroke-width="1" opacity="0.7"/>
    ${buildSocials({ socials, x: px, y: dividerY + 22, palette: p })}
  </g>

  <!-- outer border, drawn last so nothing overlaps it -->
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="25.5"
    fill="none" stroke="${p.borderStrong}" stroke-width="1"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="25.5"
    fill="none" stroke="url(#shimmer)" stroke-width="1.5" opacity="0.7"/>
</svg>`;
}
