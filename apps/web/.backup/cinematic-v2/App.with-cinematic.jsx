import { useEffect, useState, useCallback } from 'react';
import { fetchSite, fetchStatus, EMPTY_SITE } from './lib/api.js';
import { useThemeMode } from './lib/theme.jsx';
import Backdrop from './components/Backdrop.jsx';
import Nav from './components/Nav.jsx';
import Hero from './components/Hero.jsx';
import CinematicSite from './cinematic/CinematicSite.jsx';
import CinematicNav from './cinematic/CinematicNav.jsx';
import Preloader from './components/Preloader.jsx';
import StatusCard from './components/StatusCard.jsx';
import Projects from './components/Projects.jsx';
import Stack from './components/Stack.jsx';
import { Education, Experience } from './components/Timeline.jsx';
import Contact from './components/Contact.jsx';
import Footer from './components/Footer.jsx';
import ErrorBanner from './components/ErrorBanner.jsx';
import AskWidget from './components/AskWidget.jsx';
import { recordVisit } from './lib/visit.js';

const STATUS_POLL_MS = 60_000;

export default function App() {
  const [site, setSite] = useState(EMPTY_SITE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { mode, choose, isCinematic } = useThemeMode(site.content);

  const load = useCallback(async (signal) => {
    try {
      const data = await fetchSite({ signal });
      setSite({ ...EMPTY_SITE, ...data });
      setError(null);
    } catch (err) {
      if (err.name === 'AbortError') return;
      // The page still renders — every component handles empty data. A dead
      // API degrades to a skeleton, it never blanks the site.
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Once per load. The server de-dupes by device, so a reload or a return
  // visit does not add a unique — see lib/visit.js.
  useEffect(() => {
    recordVisit();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // The status card is the only volatile part of the page, so it alone polls.
  useEffect(() => {
    const controller = new AbortController();
    const id = setInterval(async () => {
      if (document.hidden) return; // don't poll a backgrounded tab
      try {
        const status = await fetchStatus({ signal: controller.signal });
        setSite((prev) => ({ ...prev, status: { ...prev.status, ...status } }));
      } catch {
        /* transient — the next tick retries */
      }
    }, STATUS_POLL_MS);

    return () => {
      clearInterval(id);
      controller.abort();
    };
  }, []);

  // The edge middleware already put the right title in the served HTML; this
  // keeps it correct after a client-side content change without a reload.
  useEffect(() => {
    const title = site.content?.['seo.title'];
    if (title) document.title = title;

    const description = site.content?.['seo.description'];
    if (description) {
      document.querySelector('meta[name="description"]')?.setAttribute('content', description);
    }
  }, [site.content]);

  /*
   * The two modes have diverged past the point where one tree can serve both.
   * Cinematic is a sequence of acts with its own layout, its own palette and its
   * own scroll behaviour; minimal is a stack of sections. Sharing a tree meant
   * every section carrying branches for a mode it never renders in.
   *
   * So they are two returns. What they share is what should be shared: the
   * payload, the nav, the ask widget and the error banner.
   */
  if (isCinematic) {
    return (
      <>
        <Preloader content={site.content} ready={!loading} />

        {/* Its own nav rather than a restyling of the shared one: the two want
            genuinely different markup, and giving cinematic its own leaves
            minimal mode's completely untouched. */}
        <CinematicNav
          profile={site.profile}
          socials={site.socials}
          content={site.content}
          mode={mode}
          onChooseMode={choose}
          hasExperience={site.experience?.length > 0 || site.education?.length > 0}
        />

        <CinematicSite site={site} loading={loading} />

        <AskWidget content={site.content} profile={site.profile} />

        {error && <ErrorBanner message={error} onRetry={() => load()} />}
      </>
    );
  }

  const statusCard = (
    <StatusCard
      status={site.status}
      loading={loading}
      content={site.content}
      socials={site.socials}
    />
  );

  return (
    <>
      {/* The ambient blobs belong to the minimal theme; behind a full-bleed
          character they only add haze. */}
      <Backdrop />

      <Nav
        profile={site.profile}
        socials={site.socials}
        content={site.content}
        mode={mode}
        onChooseMode={choose}
        hasEducation={site.education?.length > 0}
        hasExperience={site.experience?.length > 0}
      />

      <main id="top">
        <Hero profile={site.profile} loading={loading}>
          {statusCard}
        </Hero>

        <Projects projects={site.projects} loading={loading} content={site.content} />
        <Experience experience={site.experience} content={site.content} />
        <Education education={site.education} content={site.content} />
        <Stack stack={site.stack} content={site.content} />
        <Contact profile={site.profile} socials={site.socials} content={site.content} />
      </main>

      <Footer profile={site.profile} socials={site.socials} content={site.content} />

      <AskWidget content={site.content} profile={site.profile} />

      {error && <ErrorBanner message={error} onRetry={() => load()} />}
    </>
  );
}
