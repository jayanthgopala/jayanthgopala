import { useMemo } from 'react';
import { copy } from '../lib/api.js';
import { useScrollVar } from './lib/reveal.js';
import { usePointerParallax } from './lib/pointer.js';
import EditorialHero from './EditorialHero.jsx';
import WalkScene from './WalkScene.jsx';
import ChapterRail from './ChapterRail.jsx';
import { Manifesto, StatsBand } from './Interludes.jsx';
import EditorialSection from './EditorialSection.jsx';
import ProjectShowcase from './ProjectShowcase.jsx';
import OrganicTransition from './OrganicTransition.jsx';
import BrushLayer from './BrushLayer.jsx';
import CinematicFooter from './CinematicFooter.jsx';
import { PathRail, StackColumns, ContactBlock } from './Rails.jsx';
import '../styles/cinematic.css';

/**
 * CINEMATIC MODE — the portfolio told as a sequence rather than laid out as a
 * page.
 *
 * THE STORY. A figure stands under weather. The weather comes down, parts, and
 * he is walking. He says what he is for. The world he has built comes up out of
 * the ground — the work, then the record of it, then the tools. At the end he
 * is reachable.
 *
 *   I    HORIZON     A quote, very large, under a bank of cloud.
 *   II   THE WALK    The cloud parts. The figure is revealed, mid-stride.
 *   III  STATEMENT   One sentence, read word by word as you scroll it.
 *   IV   THE WORK    The projects, as editorial spreads.
 *   V    THE RECORD  The path — roles and study on one chronology.
 *   VI   THE SYSTEM  The toolkit.
 *   VII  THE SIGNAL  The way to reach him, then the closing frame.
 *
 * Every act has an id and appears in the rail, so the sequence is navigable as
 * well as watchable — a scroll story you cannot skip through is a video, and a
 * portfolio has to survive a recruiter who wants the projects and nothing else.
 *
 * THE MOTION SYSTEM IS CUSTOM PROPERTIES AND NOTHING ELSE.
 *   --mx / --my   eased pointer, published here, read by every drifting layer
 *   --scroll      document offset in pixels
 *   --page        document progress 0..1, for the rail
 *   --t           per-scene progress, published by each scene onto itself
 *
 * All four stop being written the moment the user stops. There is no animation
 * loop and no library: a scene is a CSS expression in --t, which means the
 * whole sequence scrubs backwards as readily as forwards and holds still when
 * you stop to read something. That is the difference between a scroll story and
 * a page with animations on it.
 *
 * The tone alternates ink to paper and back, and every seam is painted rather
 * than cut, so the acts bleed into one another instead of stacking.
 *
 * Minimal mode does not import this file, and this file imports nothing from
 * minimal mode but leaf components — the icon set and the lightbox — which it
 * does not modify.
 */
export default function CinematicSite({ site, loading }) {
  const { profile, projects, stack, socials, education, experience, status, content } = site;

  const sceneRef = usePointerParallax({ ease: 0.05 });
  useScrollVar();

  const hasPath = experience.length > 0 || education.length > 0;

  /*
   * The act list, which the rail and the footer both render.
   *
   * Memoised on the things that can actually change it. ChapterRail rebuilds
   * its observer whenever this identity changes, and `content` is replaced
   * wholesale every time the status poll returns — a fresh array on every
   * render would tear down and re-create the observer once a minute forever.
   */
  const acts = useMemo(
    () =>
      [
        { id: 'cx-hero', label: copy(content, 'cine.act1', 'Horizon') },
        { id: 'cx-walk', label: copy(content, 'cine.act2', 'The walk') },
        { id: 'cx-statement', label: copy(content, 'cine.act3', 'Statement') },
        { id: 'work', label: copy(content, 'cine.act4', 'The work') },
        hasPath && { id: 'experience', label: copy(content, 'cine.act5', 'The record') },
        { id: 'stack', label: copy(content, 'cine.act6', 'The system') },
        { id: 'contact', label: copy(content, 'cine.act7', 'The signal') },
      ].filter(Boolean),
    [content, hasPath]
  );

  /*
   * The statement falls back through the profile rather than to a literal, so
   * an install that has never opened the Copy editor still gets a sentence that
   * is about this person. Only if the profile is empty too does the act drop
   * out entirely — Manifesto renders nothing for an empty string, which is the
   * right outcome: a giant blank screen is worse than one fewer act.
   */
  const statement = copy(content, 'cine.manifesto', '') || profile.headline || profile.description;

  return (
    <>
      <ChapterRail acts={acts} />

      <main id="top" className="cx" ref={sceneRef}>
        {/* --- I. Horizon ------------------------------------------------- */}
        <EditorialHero id="cx-hero" act="1" profile={profile} content={content} />

        {/* --- II. The walk ------------------------------------------------
            Opens under the bank the hero sent down, then parts it. See
            WalkScene for why the figure is rigged rather than drawn once. */}
        <WalkScene
          id="cx-walk"
          act="2"
          content={content}
          caption={copy(
            content,
            'cine.panel1',
            'Head down, into the wind. Building the things that were not there yesterday.'
          )}
        />

        {/* --- III. Statement ---------------------------------------------
            Paper back to ink. The seam is a torn edge rather than a rule, so
            the grounds bleed into one another. */}
        <OrganicTransition direction="down" seed={11} fill="var(--cx-ink)" />

        <Manifesto
          id="cx-statement"
          act="3"
          statement={statement}
          kicker={copy(content, 'cine.manifestoKicker', '')}
        />

        {/* The tally under the statement: three counts, all of them lengths of
            lists the admin panel owns. Nothing typed by hand. */}
        <section className="cx-band" data-tone="ink">
          <div className="cx-wrap">
            <StatsBand
              projects={projects}
              stack={stack}
              experience={experience}
              status={status || {}}
              content={content}
            />
          </div>
        </section>

        {/* --- IV. The work ------------------------------------------------ */}
        <OrganicTransition direction="up" seed={3} fill="var(--cx-paper)" />

        <EditorialSection
          id="work"
          act="4"
          index={1}
          tone="paper"
          eyebrow={copy(content, 'projects.eyebrow', 'Selected work')}
          title={copy(content, 'projects.title', 'The work')}
          lead={copy(content, 'projects.lead', '')}
        >
          <ProjectShowcase projects={projects} loading={loading} content={content} />
        </EditorialSection>

        {/* --- V. The record ----------------------------------------------- */}
        <OrganicTransition direction="down" seed={31} fill="var(--cx-ink)" />

        {hasPath && (
          <EditorialSection
            id="experience"
            act="5"
            index={2}
            eyebrow={copy(content, 'cine.recordEyebrow', 'Record')}
            title={copy(content, 'cine.recordTitle', 'The path')}
          >
            <PathRail experience={experience} education={education} content={content} />
          </EditorialSection>
        )}

        {/* --- VI. The system ---------------------------------------------- */}
        <EditorialSection
          id="stack"
          act="6"
          index={hasPath ? 3 : 2}
          eyebrow={copy(content, 'stack.eyebrow', 'Toolkit')}
          title={copy(content, 'stack.title', 'Built with')}
          className="cx-section-stack"
        >
          {/* One painted band drifting behind the columns. The section is
              otherwise all type and space, and it needs something to sit on. */}
          <BrushLayer className="cx-section-brush" seed={5} count={5} band={[120, 620]} weight={0.5} />
          <StackColumns stack={stack} />
        </EditorialSection>

        {/* --- VII. The signal --------------------------------------------- */}
        <EditorialSection
          id="contact"
          act="7"
          index={hasPath ? 4 : 3}
          eyebrow={copy(content, 'contact.eyebrow', 'Get in touch')}
          title={copy(content, 'contact.title', 'Have something worth building?')}
          lead={copy(content, 'contact.lead', '')}
          className="cx-section-contact"
        >
          <ContactBlock profile={profile} socials={socials} content={content} />
        </EditorialSection>

        <CinematicFooter profile={profile} socials={socials} content={content} acts={acts} />
      </main>
    </>
  );
}
