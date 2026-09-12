import { ASCII_PORTRAIT } from './ascii.js';

// Derive metadata from live data with manual override fallback
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

  // ASCII portrait
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

  // Terminal geometry
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
