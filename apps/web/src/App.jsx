import { useEffect, useState, useCallback } from 'react';
import { fetchSite, fetchStatus, EMPTY_SITE } from './lib/api.js';
import { useThemeMode } from './lib/theme.jsx';
import Backdrop from './components/Backdrop.jsx';
import Nav from './components/Nav.jsx';
import Hero from './components/Hero.jsx';
import CinematicHero from './components/CinematicHero.jsx';
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
      {isCinematic && <Preloader content={site.content} ready={!loading} />}

      {/* The ambient blobs belong to the minimal theme; behind a full-bleed
          character they only add haze. */}
      {!isCinematic && <Backdrop />}

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
        {isCinematic ? (
          <>
            <CinematicHero profile={site.profile} content={site.content} />
            {/* Its own band rather than inside the hero: the flanking headline
                already owns both edges, and overlaying the card on the right
                column buried half the text. */}
            <div className="cine-status-band">
              <div className="container">{statusCard}</div>
            </div>
          </>
        ) : (
          <Hero profile={site.profile} loading={loading}>
            {statusCard}
          </Hero>
        )}

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
