import { useCallback, useEffect, useState } from 'react';

// Data fetching and reload hook for admin pages
export function useResource(loader, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loader());
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, setData, loading, error, reload };
}

// Form draft state with dirty tracking
export function useDraft(source) {
  const [draft, setDraft] = useState(source ?? {});
  const [baseline, setBaseline] = useState(source ?? {});

  useEffect(() => {
    if (!source) return;
    setDraft(source);
    setBaseline(source);
  }, [source]);

  const set = useCallback((key, value) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const commit = useCallback((saved) => {
    const next = saved ?? draft;
    setDraft(next);
    setBaseline(next);
  }, [draft]);

  const reset = useCallback(() => setDraft(baseline), [baseline]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);

  return { draft, set, setDraft, dirty, commit, reset };
}

/** Warn before losing unsaved edits to a browser navigation. */
export function useUnsavedGuard(dirty) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}
