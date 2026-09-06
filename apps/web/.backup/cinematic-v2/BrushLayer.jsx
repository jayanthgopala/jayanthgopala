/**
 * Bold dry-brush sweeps across a near-black ground.
 *
 * Four earlier versions failed, and the failures bracket the answer neatly.
 * Fractal noise gave hundreds of even streaks (brushed metal). Hairline bundles
 * gave scratches. Broad blurred masses gave fog. Each fix over-corrected the
 * last, and the thing they all missed is that a dry brush mark is neither a
 * line nor a cloud: it is a BAND with visible bristle streaks inside it and a
 * ragged, torn end.
 *
 * So each sweep is a stack of six to ten medium-weight strokes riding the same
 * curve, close enough to overlap into one mark and separate enough that the
 * gaps between them read as bristle streaks. Widths run 6–28 in a 700-unit
 * frame — an order of magnitude above the hairline version that looked
 * scribbled, and an order of magnitude below the blurred version that vanished.
 *
 * Three things carry it:
 *
 *   OPACITY YOU CAN ACTUALLY SEE. Strokes sit around 40–90% against a ground
 *   only a few steps darker. The mist version ran at 6% and disappeared; the
 *   contrast here comes from the colours being close, not from the paint being
 *   faint.
 *
 *   RAGGED ENDS. Displacement at scale 22 with a coarse turbulence field tears
 *   the ends and edges. Without it every mark stops dead in a rounded cap and
 *   the whole field reads as vector art.
 *
 *   STAGGERED LENGTHS. Bristles start and stop at different points along the
 *   curve, so the band thins out at both ends by itself — SVG cannot taper a
 *   stroke, and this is what stands in for it.
 *
 * The viewBox is a fixed 1200x700 stretched to fit, which keeps the filter
 * surface small and constant however wide the window is. Sizing it to the
 * viewport is what previously pushed past the browser's cap on filter surfaces
 * and left the right-hand side of wide screens unpainted.
 */

/**
 * Deterministic pseudo-random, seeded from the indices.
 *
 * Math.random() would reshuffle the composition on every hot reload and could
 * deal a genuinely bad layout in production with no way to reproduce it.
 */
const rand = (a, b) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * One swell, shaped like a wave rather than a straight sweep.
 *
 * The crest sits off-centre and the profile is asymmetric — steep in front,
 * long and shallow behind — because symmetry reads as a maths curve. The
 * control points either side of the crest sit at nearly its own height, which
 * rounds the top into an arc instead of a point.
 *
 * `from` and `to` are 0..1 along the span, so a bristle can cover any part of
 * the curve without the shape of the curve changing.
 */
function sweepPath(y, amp, crestAt, tilt, from = 0, to = 1) {
  const spanX0 = -280;
  const spanX1 = 1480;
  const w = spanX1 - spanX0;

  const crestX = spanX0 + w * crestAt;
  const crestY = y - amp;
  const endY = y + tilt;

  // Sample the two-segment curve, then emit only the requested slice. Cutting
  // the path rather than shortening the curve keeps every bristle on exactly
  // the same arc.
  const at = (t) => {
    if (t <= crestAt) {
      const u = crestAt <= 0 ? 0 : t / crestAt;
      const v = 1 - u;
      const p0 = { x: spanX0, y };
      const p1 = { x: spanX0 + w * 0.16, y: y + amp * 0.14 };
      const p2 = { x: crestX - w * 0.16, y: crestY + amp * 0.06 };
      const p3 = { x: crestX, y: crestY };
      return {
        x: v * v * v * p0.x + 3 * v * v * u * p1.x + 3 * v * u * u * p2.x + u * u * u * p3.x,
        y: v * v * v * p0.y + 3 * v * v * u * p1.y + 3 * v * u * u * p2.y + u * u * u * p3.y,
      };
    }
    const u = (t - crestAt) / (1 - crestAt);
    const v = 1 - u;
    const p0 = { x: crestX, y: crestY };
    const p1 = { x: crestX + w * 0.13, y: crestY + amp * 0.08 };
    const p2 = { x: crestX + w * 0.26, y: endY + amp * 0.55 };
    const p3 = { x: spanX1, y: endY };
    return {
      x: v * v * v * p0.x + 3 * v * v * u * p1.x + 3 * v * u * u * p2.x + u * u * u * p3.x,
      y: v * v * v * p0.y + 3 * v * v * u * p1.y + 3 * v * u * u * p2.y + u * u * u * p3.y,
    };
  };

  const steps = 26;
  const parts = [];

  for (let i = 0; i <= steps; i += 1) {
    const t = from + ((to - from) * i) / steps;
    const p = at(t);
    parts.push(`${i === 0 ? 'M' : 'L'} ${p.x.toFixed(0)} ${p.y.toFixed(1)}`);
  }

  return parts.join(' ');
}

function build({ seed, count, band, weight }) {
  const [top, bottom] = band;
  const sweeps = [];

  for (let i = 0; i < count; i += 1) {
    const k = i + seed * 100;
    const y = top + ((i + rand(k, 1) * 0.75) / count) * (bottom - top);
    const amp = 60 + rand(k, 2) * 130;
    const crestAt = 0.28 + rand(k, 8) * 0.4;
    const tilt = (rand(k, 3) - 0.4) * 130;

    // A quarter of the marks are darker than the ground. Paint on a dark board
    // pushes both ways, and highlights alone read as a screen effect.
    const dark = rand(k, 4) > 0.74;
    const bristleCount = 6 + Math.floor(rand(k, 9) * 5);

    const bristles = [];

    for (let j = 0; j < bristleCount; j += 1) {
      const t = bristleCount === 1 ? 0.5 : j / (bristleCount - 1);
      const edge = Math.abs(t - 0.5) * 2;

      // Ends stagger toward the middle of the band, so the mark thins at both
      // ends without any per-stroke tapering.
      const from = edge * (0.06 + rand(k, 20 + j) * 0.22);
      const to = 1 - edge * (0.06 + rand(k, 50 + j) * 0.24);
      if (to - from < 0.28) continue;

      bristles.push({
        d: sweepPath(
          y + (t - 0.5) * (34 + rand(k, 80 + j) * 44),
          amp,
          crestAt,
          tilt,
          from,
          to
        ),
        width: (6 + rand(k, 110 + j) * 22).toFixed(1),
        opacity: (((dark ? 0.5 : 0.62) * (1 - edge * 0.5)) * weight).toFixed(3),
      });
    }

    sweeps.push({ dark, depth: (0.3 + rand(k, 5) * 1.7).toFixed(2), bristles });
  }

  return sweeps;
}

/**
 * Cached per configuration. The geometry is pure and there are only ever a
 * handful of distinct configurations on a page, so rebuilding it on every
 * render of a scrolling document is pure waste.
 */
const CACHE = new Map();

function layerFor(config) {
  const key = `${config.seed}|${config.count}|${config.band.join(',')}|${config.weight}`;
  if (!CACHE.has(key)) CACHE.set(key, build(config));
  return CACHE.get(key);
}

export default function BrushLayer({
  seed = 1,
  count = 9,
  band = [-60, 760],
  /** Global opacity multiplier. Section dividers want far less than the hero. */
  weight = 1,
  className = '',
}) {
  const sweeps = layerFor({ seed, count, band, weight });
  const filterId = `cx-dry-${seed}`;

  return (
    <svg
      className={`cx-brush ${className}`.trim()}
      viewBox="0 0 1200 700"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* Coarse and lopsided: a low frequency across the frame against a high
            one down it wobbles along the length of a mark rather than chopping
            it into segments. No blur — the ends need to stay torn, and blurring
            is what turned an earlier version into fog. */}
        <filter id={filterId} x="-15%" y="-40%" width="130%" height="180%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.005 0.055"
            numOctaves="4"
            seed={17 + seed}
            result="turb"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="turb"
            scale="22"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>

      <g filter={`url(#${filterId})`}>
        {sweeps.map((sweep, i) => (
          <g
            key={i}
            className="cx-bundle"
            /* Close to the ground, not far above it. The contrast in the
               reference comes from the colours being a few steps apart, which
               is why these are greys rather than white. */
            stroke={sweep.dark ? '#0C0C0D' : '#3C3C41'}
            fill="none"
            strokeLinecap="butt"
            style={{ '--depth': sweep.depth }}
          >
            {sweep.bristles.map((b, j) => (
              <path key={j} d={b.d} strokeWidth={b.width} opacity={b.opacity} />
            ))}
          </g>
        ))}
      </g>
    </svg>
  );
}
