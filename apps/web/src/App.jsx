import { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { fetchSite, fetchStatus, EMPTY_SITE } from './lib/api.js';
import { useThemeMode } from './lib/theme.jsx';
import Backdrop from './components/Backdrop.jsx';
import Nav from './components/Nav.jsx';
import Hero from './components/Hero.jsx';
import StatusCard from './components/StatusCard.jsx';
import Projects from './components/Projects.jsx';
import Stack from './components/Stack.jsx';
import { Education, Experience } from './components/Timeline.jsx';
import Contact from './components/Contact.jsx';
import Footer from './components/Footer.jsx';
import ErrorBanner from './components/ErrorBanner.jsx';
import AskWidget from './components/AskWidget.jsx';
import { recordVisit } from './lib/visit.js';

// Lazy load 3D world bundle to keep initial main bundle light
const WorldSite = lazy(() => import('./world/WorldSite.jsx'));

// Path-based route check for /world
const IS_WORLD =
  typeof window !== 'undefined' &&
  window.location.pathname.replace(/\/+$/, '') === '/world';

const STATUS_POLL_MS = 60_000;

export default function App() {
  const [site, setSite] = useState(EMPTY_SITE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  useThemeMode(site.content);

  const load = useCallback(async (signal) => {
    try {
      const data = await fetchSite({ signal });
      setSite({ ...EMPTY_SITE, ...data });
      setError(null);
    } catch (err) {
      if (err.name === 'AbortError') return;
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    recordVisit();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Poll status endpoint periodically
  useEffect(() => {
    const controller = new AbortController();
    const id = setInterval(async () => {
      if (document.hidden) return;
      try {
        const status = await fetchStatus({ signal: controller.signal });
        setSite((prev) => ({ ...prev, status: { ...prev.status, ...status } }));
      } catch {
        /* retry on next interval */
      }
    }, STATUS_POLL_MS);

    return () => {
      clearInterval(id);
      controller.abort();
    };
  }, []);

  // Scope world route styles under data-route="world"
  useEffect(() => {
    if (!IS_WORLD) return;
    document.documentElement.dataset.route = 'world';
    return () => {
      delete document.documentElement.dataset.route;
    };
  }, []);

  // Update document title and meta description
  useEffect(() => {
    const title = site.content?.['seo.title'];
    if (title) document.title = title;

    const description = site.content?.['seo.description'];
    if (description) {
      document.querySelector('meta[name="description"]')?.setAttribute('content', description);
    }
  }, [site.content]);

  // Render standalone 3D world when visiting /world
  if (IS_WORLD) {
    return (
      <Suspense fallback={null}>
        <WorldSite site={site} />
      </Suspense>
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
      <Backdrop />

      <Nav
        profile={site.profile}
        socials={site.socials}
        content={site.content}
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
