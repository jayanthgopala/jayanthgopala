import { copy } from '../lib/api.js';
import { useProgress } from './lib/progress.js';
import BrushLayer from './BrushLayer.jsx';
import OrganicTransition from './OrganicTransition.jsx';

/**
 * The cinematic hero: a painted black field and one very large quote.
 *
 * The organic edge that bleeds this into the section below belongs to the page
 * rather than to the hero — every seam on the page uses the same component, and
 * owning one of them here would mean the first transition behaved differently
 * from all the others for no reason a reader could see.
 *
 * THE BACKGROUND IS GENERATED, NOT AN IMAGE — see Paint.jsx. It costs nothing
 * to ship, scales to any viewport without resampling, and cannot 404. A painted
 * JPEG would have been quicker and would also have been a megabyte, fixed at
 * one aspect ratio, and wrong on every screen it was not authored for.
 *
 * PARALLAX IS BY DEPTH. The pointer writes one pair of values and each layer
 * reads them at its own multiplier: the far brush field barely moves, the near
 * one moves more, the type moves most, and the spill moves against them all.
 * That difference is the entire illusion — moving everything by the same amount
 * reads as the page sliding, not as depth.
 *
 * The quote comes from the database and falls back to the profile headline, so
 * the largest thing on the site is editable without a deploy.
 */
/**
 * Shown until `cine.quote` exists as a row in the content table. Deliberately
 * not a fall-through to the profile headline: the headline is a sentence about
 * the work and this is a line of display type, and the two want to be different
 * lengths.
 */
const DEFAULT_QUOTE = 'Exceptional digital experiences';

/**
 * Breaks a sentence into two lines at the word boundary that leaves them most
 * equal in length. Returns one line for anything too short to be worth
 * breaking.
 */
function splitInTwo(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  // Two words cannot be split into two balanced lines without one of them
  // standing alone, which reads as a mistake. Three can.
  if (words.length < 3) return [words.join(' ')].filter(Boolean);

  const half = text.length / 2;
  let best = 1;
  let bestGap = Infinity;

  for (let i = 1; i < words.length; i += 1) {
    const left = words.slice(0, i).join(' ').length;
    const gap = Math.abs(left - half);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  }

  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

export default function EditorialHero({ profile, content = {}, id, act }) {
  /*
   * ACT I's exit is the story's first move, so the hero has to know how far
   * through leaving it is.
   *
   * 'exit' rather than 'sticky': the hero is exactly one screen tall and has no
   * spare travel to spend, so progress runs 0 while it fills the viewport to 1
   * once it has scrolled entirely past. The cloud bank hanging at the top rides
   * that number down.
   *
   * Held at 0 under reduced motion — the composed still of this act is the
   * quote with clear sky above it, not a screen half full of weather.
   */
  const heroRef = useProgress({ mode: 'exit', rest: 0 });

  /*
   * Editable from the admin Copy editor once `cine.quote` exists as a row;
   * until then this default stands. It falls through to the profile fields
   * rather than showing nothing, so an install that has never touched the key
   * still gets a hero with words in it.
   */
  const quote = copy(content, 'cine.quote', DEFAULT_QUOTE);

  /*
   * Always two lines, split as evenly as the words allow.
   *
   * Left to wrap on its own the quote broke wherever the container happened to
   * run out, which gave four ragged lines of wildly different length — fine for
   * a paragraph, wrong for something set this large, where the shape of the
   * block is as much of the design as the letterforms.
   *
   * The split walks the word boundaries and takes whichever one leaves the two
   * halves closest in length, so a short quote and a long one both come out
   * balanced. Anything under four words stays on one line: forcing a break into
   * two words looks like a mistake rather than a decision.
   */
  const lines = splitInTwo(quote);

  /*
   * Fit is now only a guard against an unusually long quote, not the main
   * sizing mechanism — the two-line split does that. Square root rather than a
   * straight ratio, because linear scaling collapses a long quote to a caption.
   */
  const fit = Math.min(1, Math.sqrt(46 / Math.max(20, quote.length)));

  return (
    <section className="cxh" id={id} ref={heroRef} data-act={act} data-tone="ink">
      {/*
        --- The weather ----------------------------------------------------
        A bank hanging from the top of the frame that descends as the hero
        leaves, and keeps descending until it has the screen. It is the hinge
        of the whole opening: act two begins packed with cloud, so the last
        thing you see here and the first thing you see there are the same mass
        of weather and the cut between two sections disappears.

        Dark, in the ground's own family rather than white. A white bank at the
        top of a black hero is a lens flare.
      */}
      <div className="cxh-sky" aria-hidden="true">
        <OrganicTransition direction="down" seed={21} fill="var(--cx-bank)" />
      </div>

      {/* Two passes over the same ground at different scales. See BrushLayer. */}
      <BrushLayer className="cxh-paint" seed={1} count={9} band={[-120, 700]} />
      <BrushLayer className="cxh-paint cxh-paint-low" seed={4} count={6} band={[-60, 560]} weight={0.8} />

      {/* --- The quote -------------------------------------------------------
          Split into lines so each can be tracked and scaled independently. The
          reference's wordmark is a drawn ligature; the nearest honest thing
          available is a high-contrast didone set very large and very tight. */}
      <div className="cxh-type" style={{ '--fit': fit.toFixed(3) }}>
        <blockquote className="cxh-quote">
          {lines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </blockquote>

        {profile.name && (
          <figcaption className="cxh-attrib">
            <span className="cxh-rule" aria-hidden="true" />
            {profile.name}
          </figcaption>
        )}
      </div>

      <span className="cxh-dots" aria-hidden="true">
        <i /><i /><i /><i />
      </span>
    </section>
  );
}
