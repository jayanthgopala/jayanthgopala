import { Fragment } from 'react';
import { copy } from '../lib/api.js';
import { useProgress } from './lib/progress.js';
import { useReveal } from './lib/reveal.js';
import BrushLayer from './BrushLayer.jsx';

/**
 * The two beats that carry the story between the walk and the work.
 *
 * They share a file because they share a job — neither is a section of content,
 * both exist to change the tempo — and because splitting forty lines of the
 * same idea across two files hides that they are a pair.
 */

/**
 * ACT III — THE STATEMENT.
 *
 * One sentence, set enormous, revealed word by word as you scroll through it.
 *
 * THE SWEEP IS SCROLL POSITION, NOT AN ANIMATION. Each word's opacity is an
 * expression in `--t` and its own index: the leading edge of the sweep is at
 * `t * (n + lead)`, and a word lights as that edge passes it. Scroll slowly and
 * you read it at your own pace; scroll back and it un-reads. A timed
 * word-by-word reveal, which is the usual way this is done, plays at whatever
 * speed the author guessed and cannot be re-read without a reload.
 *
 * It costs one custom property write per frame of scrolling and nothing at all
 * when the page is still. There is no per-word JavaScript, no observer per
 * word, and no state.
 */
export function Manifesto({ id, act, statement, kicker }) {
  const ref = useProgress({ mode: 'sticky', rest: 0.85 });

  const words = String(statement || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  return (
    <section
      id={id}
      ref={ref}
      className="cx-manifesto"
      data-act={act}
      data-tone="ink"
      style={{ '--n': words.length }}
    >
      <div className="cx-manifesto-stage">
        {/* One painted mass behind the type, drifting on the pointer like every
            other brush layer. The section is otherwise a black screen with
            words on it, and it needs something underneath to sit on. */}
        <BrushLayer className="cx-manifesto-paint" seed={7} count={6} band={[-40, 720]} weight={0.65} />

        <p className="cx-manifesto-type">
          {words.map((word, i) => (
            /* The separator is an explicit text node rather than whitespace in
               the markup. Each word is an inline-block so it can be shifted as
               it lights, and inline-block siblings with no text between them
               have no space between them either. */
            <Fragment key={`${word}-${i}`}>
              {i > 0 && ' '}
              <span className="cx-manifesto-word" style={{ '--i': i }}>
                {word}
              </span>
            </Fragment>
          ))}
        </p>

        {kicker && <span className="cx-manifesto-kicker">{kicker}</span>}
      </div>
    </section>
  );
}

/**
 * The evidence. Three counts, straight off the payload.
 *
 * NOTHING HERE IS WRITTEN BY HAND. Every number is the length of a list the
 * admin panel already owns, so it cannot drift out of date and cannot claim
 * anything that is not in the database. A stats band with typed-in figures is
 * a maintenance liability the first time a project is added.
 *
 * A stat with a count of zero is not rendered. An empty portfolio should say
 * less, not proudly report a nought.
 */
export function StatsBand({ projects = [], stack = [], experience = [], status = {}, content = {} }) {
  const [ref, shown] = useReveal({ threshold: 0.4 });

  const stats = [
    { value: projects.length, label: copy(content, 'cine.statWork', 'Projects shipped') },
    { value: stack.length, label: copy(content, 'cine.statStack', 'Technologies') },
    { value: experience.length, label: copy(content, 'cine.statRoles', 'Roles held') },
  ].filter((stat) => stat.value > 0);

  const note = status.currentProject
    ? `${copy(content, 'cine.currently', 'Currently building')} — ${status.currentProject}`
    : status.availabilityNote;

  if (stats.length === 0 && !note) return null;

  return (
    <div ref={ref} className="cx-stats" data-in={shown || undefined}>
      {stats.length > 0 && (
        <dl className="cx-stats-row">
          {stats.map((stat, i) => (
            <div key={stat.label} className="cx-stat" style={{ '--i': i }}>
              {/* Padded to two digits so the row keeps a common baseline and a
                  common width as the numbers change. */}
              <dt className="cx-stat-value">{String(stat.value).padStart(2, '0')}</dt>
              <dd className="cx-stat-label">{stat.label}</dd>
            </div>
          ))}
        </dl>
      )}

      {note && <p className="cx-stats-note">{note}</p>}
    </div>
  );
}
