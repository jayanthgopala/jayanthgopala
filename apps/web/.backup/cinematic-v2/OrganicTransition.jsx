/**
 * A bank of cumulus cloud between two grounds.
 *
 * ROUND LOBES, NOT A TORN EDGE. Every previous version generated a *path* along
 * the top of the mass — smooth beziers first (which read as a stock "wave
 * divider"), then jagged facets (a mountain range), then facets with widened
 * bulges (better, still visibly angular). All three shared one wrong
 * assumption: that the silhouette is a line with variation applied to it.
 *
 * It is not. A comic cloud is drawn as a pile of overlapping circles. The
 * silhouette is whatever the union of those circles happens to be, and because
 * every boundary is an arc there is no vertex anywhere in it — no facet count
 * to tune, no jitter amplitude to get wrong, and no way for a spike to appear.
 * That is the whole idea here, and it is why this emits circles and a rectangle
 * rather than a path.
 *
 * The union is free: same fill, same group, no strokes. Overlapping shapes
 * simply cover one another.
 *
 * Two rows of lobes, because one row is a scalloped edge. Big lobes set the
 * skyline and smaller ones piled on their shoulders give the billowed look that
 * reads as weather rather than as bunting.
 *
 * They do not drift on their own — an earlier version looped sideways forever
 * and read as a scrolling banner, because the eye locks onto lateral motion and
 * follows it. They rise and fall with the cursor instead.
 */

/**
 * Deterministic pseudo-random. The two halves of the tile must agree exactly at
 * the join, so this cannot be Math.random().
 */
const rand = (a, b) => {
  const x = Math.sin(a * 91.7 + b * 47.3) * 43758.5453;
  return x - Math.floor(x);
};

const TILE = 1200;
const BOX = 360;

/**
 * The lobes along the top of a bank.
 *
 * Positions wrap on the tile, so the run repeats seamlessly across the doubled
 * viewBox and a lobe near the edge appears on both sides of the join.
 */
function lobes(seed, baseY, scale, flip) {
  const out = [];
  // Wider spacing and a much wider radius range than the first pass. Evenly
  // sized lobes at a tight pitch read as bubble wrap; real cumulus is a few
  // large masses with smaller ones crowding between them.
  const step = 62 * scale;
  const count = Math.ceil(TILE / step);

  for (let i = 0; i < count; i += 1) {
    const t = i / count;
    /*
     * A slow swell across the tile, so the bank piles up into a mound rather
     * than running flat from edge to edge. Two waves at unrelated frequencies,
     * both whole numbers of cycles per tile so the run still wraps seamlessly.
     */
    const swell =
      Math.sin(t * Math.PI * 2 + seed) * 34 * scale +
      Math.sin(t * Math.PI * 4 + seed * 1.7) * 16 * scale;

    const x = t * TILE + (rand(seed, i) - 0.5) * step * 0.6;

    // Front row: the big shapes that set the skyline.
    // Squared, so most lobes are modest and a few are genuinely large. A flat
    // distribution gives everything the same visual weight.
    const roll = rand(seed, 100 + i);
    const r = (22 + roll * roll * 78) * scale;
    // Sunk so only the top of each circle clears the baseline. A lobe sitting
    // fully above it reads as a bubble stuck to a rule.
    const lift = r * (0.3 + rand(seed, 200 + i) * 0.35);
    const top = flip ? baseY - swell : baseY + swell;
    out.push({ x, y: flip ? top - lift : top + lift, r });

    // Second row, on the shoulders of some of them. This is what turns a
    // scalloped edge into a billow.
    if (rand(seed, 300 + i) > 0.42) {
      const r2 = r * (0.5 + rand(seed, 400 + i) * 0.45);
      const dx = (rand(seed, 500 + i) - 0.5) * r * 1.1;
      const dy = r * (0.55 + rand(seed, 600 + i) * 0.4);
      out.push({
        x: x + dx,
        y: flip ? top - lift + dy : top + lift - dy,
        r: r2,
      });
    }
  }

  return out;
}

/**
 * Detached puffs floating clear of the bank.
 *
 * Circles, for the same reason the lobes are circles: any polygon at this size
 * reads as a shard, which was exactly the complaint about the version that used
 * them. A puff is two overlapping discs, so it is not a perfect dot either.
 */
function puffs(seed, baseY, flip) {
  const out = [];

  for (let i = 0; i < 9; i += 1) {
    const cx = -TILE + rand(seed, 700 + i) * TILE * 2;
    const reach = 24 + rand(seed, 800 + i) * 96;
    const cy = flip ? baseY + reach : baseY - reach;
    // Smaller the further they are thrown, the way real spatter is.
    const r = (5 + rand(seed, 900 + i) * 13) * (1 - (reach / 140) * 0.5);

    out.push({ x: cx, y: cy, r });
    out.push({
      x: cx + r * (0.5 + rand(seed, 950 + i) * 0.6),
      y: cy + r * (rand(seed, 980 + i) - 0.5) * 0.8,
      r: r * (0.55 + rand(seed, 990 + i) * 0.35),
    });
  }

  return out;
}

/*
 * `baseY` is measured DOWN from the top of the box, so smaller numbers sit the
 * bank higher in the frame. The three sit close together and the back two are
 * faint, so the mass reads as one body of cloud with depth behind it rather
 * than as three grey steps.
 */
const BANDS = [
  { d: 0, baseY: 190, scale: 1.45, opacity: 0.13, depth: 0.45 },
  { d: 1, baseY: 218, scale: 1.1, opacity: 0.3, depth: 0.85 },
  { d: 2, baseY: 246, scale: 0.85, opacity: 1, depth: 1.4 },
];

export default function OrganicTransition({
  /** 'up' — the bank rises from the bottom edge. 'down' — it hangs from the top. */
  direction = 'up',
  seed = 3,
  className = '',
  /** Any CSS colour. The ground it is bleeding *into*. */
  fill = 'var(--cx-paper)',
}) {
  const flip = direction === 'down';

  return (
    <div
      className={`cx-organic ${className}`.trim()}
      data-direction={direction}
      style={{ '--organic-fill': fill }}
      aria-hidden="true"
    >
      {BANDS.map((band) => {
        const s = seed + band.d * 7;
        const row = lobes(s, band.baseY, band.scale, flip);

        return (
          <svg
            key={band.d}
            className="cx-organic-band"
            viewBox={`-${TILE} 0 ${TILE * 2} ${BOX}`}
            /*
             * The lobes must stay ROUND. preserveAspectRatio="none" — which
             * every earlier version used, correctly, for a path-based edge —
             * stretches circles into ellipses on a wide window, and a stretched
             * cloud is the one thing that makes this device look cheap.
             * Slicing keeps the aspect and crops the overhang instead, which is
             * exactly what the doubled tile is there to provide.
             *
             * WHICH EDGE IS ANCHORED DEPENDS ON WHICH WAY THE BANK HANGS. The
             * solid body sits above the lobes when flipped and below them when
             * not, so anchoring the wrong edge crops the body away and leaves
             * the lobes floating as a row of detached circles with nothing
             * behind them.
             */
            preserveAspectRatio={flip ? 'xMidYMin slice' : 'xMidYMax slice'}
            focusable="false"
            style={{ '--depth': band.depth, opacity: band.opacity }}
          >
            {/* The solid body. Everything below the skyline is filled flat, so
                the circles only have to make the top edge. */}
            <rect
              x={-TILE}
              y={flip ? -BOX : band.baseY}
              width={TILE * 2}
              height={BOX}
            />

            {/* Two copies of the lobe run, so the tile repeats without a seam. */}
            {[-TILE, 0].map((shift) =>
              row.map((c, i) => (
                <circle key={`${shift}-${i}`} cx={shift + c.x} cy={c.y} r={c.r} />
              ))
            )}

            {/* Only the front band throws puffs. Three overlapping sets turned
                the sky above the bank into confetti. */}
            {band.d === 2 &&
              puffs(s, band.baseY, flip).map((c, i) => (
                <circle key={`p-${i}`} cx={c.x} cy={c.y} r={c.r} />
              ))}
          </svg>
        );
      })}
    </div>
  );
}
