/**
 * The figure, drawn as SVG and rigged so it can actually walk.
 *
 * The reference illustration was exactly that — a reference. Pasting it in gave
 * a photograph of a drawing: one fixed pose that can only ever be slid around
 * behind moving scenery. To animate a character you need the character taken
 * apart, so this is built as a joint hierarchy the way a rig is:
 *
 *   hip ─ torso ─ neck ─ head
 *    │       └─ shoulder ─ upper arm ─ elbow ─ forearm
 *    └─ thigh ─ knee ─ shin ─ foot
 *
 * Each joint is its own <g> with its transform-origin ON the joint, so rotating
 * a thigh carries its shin and foot with it — which is the whole reason the
 * hierarchy exists. Flat siblings would need every child's position recomputed
 * for every frame.
 *
 * THE GAIT IS A FUNCTION OF SCROLL, NOT TIME. `--walk` comes in as a phase in
 * radians; every limb angle is a sine of it. Scroll forward and he walks
 * forward, scroll back and he walks backward, stop and he stops mid-stride.
 * A time-driven cycle would march on the spot whenever the page was still,
 * which reads instantly as a looping GIF behind a website.
 *
 * All of it is CSS `rotate` on a handful of groups — no per-frame JavaScript,
 * no canvas, nothing to schedule. The browser interpolates the transforms on
 * the compositor.
 *
 * PROPORTION IS WHAT MAKES IT READ AS A DRAWING RATHER THAN A STICK. The first
 * pass was a realistic seven-and-a-half heads tall, and at the size this is
 * shown that collapsed into a black column with a dot on top: at 250px tall a
 * naturalistic head is sixteen pixels and simply disappears. Comic figures run
 * nearer six heads, which is why they survive being printed small — so the head
 * here is a full sixth of the height, the shoulders are wide, and the silhouette
 * is built out of shapes that stay distinguishable when they are tiny.
 *
 * The other half of that is INTERNAL SEPARATION. He is a dark figure on a light
 * ground, so the outline is free; what is not free is telling his near arm from
 * his coat. Every overlapping mass is a step apart in value — coat, near arm,
 * trousers, hair are four different darks — which does nothing at full size and
 * is the entire difference at thumbnail size.
 */

/* Four darks, close enough to read as one palette and far enough apart that the
   masses do not merge. Order here is back to front. */
const HAIR = '#0B0B0C';
const COAT = '#17171A';
const ARM = '#232327';
const TROUSER = '#0E0E10';

const SKIN = '#C89468';
const SKIN_SHADE = '#A87748';

export default function WalkingFigure({ className = '' }) {
  return (
    <svg
      className={`cx-walker ${className}`.trim()}
      viewBox="0 0 220 470"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* One rough-edge pass over the whole figure. Applied at the root
            rather than per-shape so the parts stay visually consistent with
            each other — filtering each limb separately makes the seams between
            them wobble independently, which reads as a rendering fault. */}
        <filter id="cx-walk-ink" x="-14%" y="-8%" width="128%" height="118%">
          <feTurbulence type="fractalNoise" baseFrequency="0.018 0.05" numOctaves="3" seed="5" result="t" />
          <feDisplacementMap in="SourceGraphic" in2="t" scale="2.4" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>

      {/* The shadow is OUTSIDE the bobbing group. It belongs to the ground, and
          a shadow that rises and falls with the body is a figure floating on a
          sticker rather than one walking on something. It only squashes. */}
      <ellipse
        className="cx-walk-shadow"
        cx="110"
        cy="446"
        rx="52"
        ry="9"
        fill="#141414"
        opacity="0.16"
      />

      <g className="cx-walk-body" filter="url(#cx-walk-ink)">
        {/* --- Far leg. Drawn first so it sits behind everything. ----------- */}
        <g className="cx-leg cx-leg-far">
          <g className="cx-thigh">
            <path d="M106 244 L136 246 L134 334 L108 334 Z" fill={TROUSER} />
            <g className="cx-shin">
              <path d="M108 328 L134 328 L132 412 L110 412 Z" fill={TROUSER} />
              <g className="cx-foot">
                <path d="M108 404 L134 404 L146 428 L106 430 Z" fill={HAIR} />
                <path d="M106 424 L146 423 L146 432 L106 433 Z" fill="#E9E6DE" />
              </g>
            </g>
          </g>
        </g>

        {/* --- Far arm ----------------------------------------------------- */}
        <g className="cx-arm cx-arm-far">
          <path d="M96 116 L124 114 L128 198 L100 200 Z" fill={COAT} />
          <g className="cx-forearm">
            <path d="M100 192 L126 190 L130 254 L104 256 Z" fill={COAT} />
            <ellipse cx="117" cy="264" rx="11" ry="14" fill={SKIN_SHADE} />
          </g>
        </g>

        {/* --- Body -------------------------------------------------------- */}
        <g className="cx-torso">
          {/* The coat. Wide at the shoulder, nipped at the waist, flared at the
              hem — three widths in one shape, which is what stops a torso
              reading as a rectangle. */}
          <path
            d="M110 100
               C 128 100, 146 110, 148 124
               L 152 196
               C 154 226, 150 246, 146 262
               L 74 262
               C 70 246, 66 226, 68 196
               L 72 124
               C 74 110, 92 100, 110 100 Z"
            fill={COAT}
          />

          {/* Collar: the one piece of interior drawing that earns its place.
              Without it the neck runs straight into the coat and the head looks
              stuck on. */}
          <path d="M92 102 L110 128 L128 102 L120 98 L110 112 L100 98 Z" fill="#2C2C31" />

          {/* Hem shadow, so the coat has a front and a back. */}
          <path d="M74 244 L146 244 L146 262 L74 262 Z" fill="#101013" opacity="0.55" />

          {/* Trousers, from the hem down to the hips. */}
          <path d="M76 256 L144 256 L140 282 L80 282 Z" fill={TROUSER} />

          {/* --- Neck and head ---------------------------------------------- */}
          <g className="cx-head">
            <path d="M99 78 L123 78 L123 106 L99 106 Z" fill={SKIN_SHADE} />

            {/* The skull, then the jaw. Two shapes rather than one ellipse: an
                ellipse alone is a ball, and the flat of the jaw is most of what
                makes a head look like a head in silhouette. */}
            <ellipse cx="110" cy="56" rx="31" ry="34" fill={SKIN} />

            {/*
              HAIR IS A CAP, NOT A HELMET. The first pass ran the mass down to
              the brow on every side, which left a sliver of face perhaps a
              dozen pixels tall at the size this is actually shown — and a dozen
              pixels of skin under sixty pixels of black is not a face, it is a
              smudge. This stops at the top of the skull and lets a full third
              of the head be face, which is the only reason it reads.
            */}
            <path
              d="M79 54
                 C 76 26, 92 12, 110 12
                 C 129 12, 145 26, 141 54
                 C 137 36, 126 28, 110 28
                 C 94 28, 83 36, 79 54 Z"
              fill={HAIR}
            />
            {/* The fringe, falling across one side of the brow only. Symmetry
                here reads as a bowl cut. */}
            <path d="M80 50 C 88 32, 108 26, 124 34 C 108 34, 92 40, 86 58 Z" fill={HAIR} />
            {/* A tail at the nape, so the silhouette is not a dome. */}
            <path d="M136 34 C 148 44, 148 62, 140 74 C 143 58, 141 44, 132 36 Z" fill={HAIR} />

            {/* Jaw shadow. Kept low and faint — the earlier version covered the
                whole lower face at nearly half opacity and undid the point of
                cutting the hair back. */}
            <path d="M86 76 C 92 92, 128 92, 134 76 L134 82 C 128 96, 92 96, 86 82 Z" fill={SKIN_SHADE} opacity="0.35" />

            {/* Brow and eye. Two marks. Any more and it stops being ink and
                starts being a portrait that is wrong. */}
            <path d="M92 64 L106 61 L106 66 L92 69 Z" fill="#1A1A1A" />
            <path d="M91 53 L109 50" stroke="#1A1A1A" strokeWidth="3.2" strokeLinecap="round" />
          </g>

          {/*
            The scarf.

            It does two jobs that nothing else in the drawing can. It is the one
            warm mass in a figure made of four darks, so the eye lands on the
            head instead of wandering the coat. And it is the wind: the brief
            asked for a figure walking into weather, and an earlier attempt drew
            that as speed lines over the artwork, which read as scratches on the
            glass. A cloth streaming off the neck IS the wind, and it is part of
            the character rather than an effect laid over him.

            It streams BEHIND him — the opposite way to his travel — and lifts
            on the stride.
          */}
          <g className="cx-scarf">
            <path d="M92 108 L118 106 L120 130 L94 132 Z" fill="#B8935A" />
            <path
              d="M94 126 C 74 132, 48 130, 26 118 C 44 136, 70 146, 96 142 Z"
              fill="#B8935A"
            />
            <path
              d="M92 134 C 76 144, 54 150, 34 148 C 56 158, 78 156, 94 148 Z"
              fill="#A5814A"
            />
          </g>

          {/* --- Near arm. Last inside the torso group, so it is in front. ---
              A step lighter than the coat: at thumbnail size that value step is
              the only thing separating the arm from the body it swings across. */}
          <g className="cx-arm cx-arm-near">
            <path d="M92 116 L122 114 L126 200 L96 202 Z" fill={ARM} />
            <g className="cx-forearm">
              <path d="M96 194 L126 192 L130 256 L100 258 Z" fill={ARM} />
              <ellipse cx="115" cy="266" rx="12" ry="15" fill={SKIN} />
            </g>
          </g>
        </g>

        {/* --- Near leg, in front of everything ---------------------------- */}
        <g className="cx-leg cx-leg-near">
          <g className="cx-thigh">
            <path d="M84 244 L114 244 L112 334 L86 334 Z" fill="#141417" />
            <g className="cx-shin">
              <path d="M86 328 L112 328 L110 412 L88 412 Z" fill="#141417" />
              <g className="cx-foot">
                <path d="M86 404 L112 404 L124 428 L82 430 Z" fill={HAIR} />
                <path d="M82 424 L124 423 L124 432 L82 433 Z" fill="#E9E6DE" />
              </g>
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}
