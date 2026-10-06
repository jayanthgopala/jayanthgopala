import { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { fetchSite, EMPTY_SITE } from './lib/api.js';
import { useThemeMode } from './lib/theme.jsx';
import InkSite from './ink/InkSite.jsx';
import ErrorBanner from './components/ErrorBanner.jsx';
import { recordVisit } from './lib/visit.js';

// Lazy load 3D world bundle to keep initial main bundle light
const WorldSite = lazy(() => import('./world/WorldSite.jsx'));

// Path-based route check for /world or /igloo
const IS_WORLD =
  typeof window !== 'undefined' &&
  (/^\/(world|igloo)\/?$/.test(window.location.pathname));

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

  return (
    <>
      <InkSite site={site} loading={loading} />
      {error && <ErrorBanner message={error} onRetry={() => load()} />}
    </>
  );
}
