import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useResource, useUnsavedGuard } from '../lib/hooks.js';
import { Button, Field, Input, Select, Textarea, useToast } from '../components/ui.jsx';

/**
 * Editor for every fixed string on the site — section headings, nav labels,
 * status row labels, footer, SEO tags and the README headings.
 *
 * The form is generated from the rows themselves rather than hand-written, so
 * adding a key to the database surfaces a field here with no code change.
 */
export default function CopyPage() {
  const toast = useToast();
  const { data, reload } = useResource(api.getContent);

  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  // Seed the draft once the rows land.
  useEffect(() => {
    if (!data) return;
    setDraft(Object.fromEntries(data.map((row) => [row.key, row.value])));
  }, [data]);

  const dirtyKeys = useMemo(() => {
    if (!data) return [];
    return data.filter((row) => draft[row.key] !== undefined && draft[row.key] !== row.value);
  }, [data, draft]);

  const dirty = dirtyKeys.length > 0;
  useUnsavedGuard(dirty);

  // Preserve the database's group ordering instead of re-sorting alphabetically.
  const groups = useMemo(() => {
    if (!data) return [];
    const map = new Map();
    for (const row of data) {
      if (!map.has(row.group)) map.set(row.group, []);
      map.get(row.group).push(row);
    }
    return [...map.entries()];
  }, [data]);

  async function save() {
    setSaving(true);
    try {
      // Send only what changed — the endpoint updates exactly the keys it gets.
      await api.saveContent(Object.fromEntries(dirtyKeys.map((r) => [r.key, draft[r.key]])));
      toast.success('Copy saved — syncing to GitHub.');
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setDraft(Object.fromEntries(data.map((row) => [row.key, row.value])));
  }

  if (!data) return <span className="spinner" />;

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Copy</h1>
          <p className="dim">
            Every fixed string on the site. Nothing here requires a deploy.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
          {dirty && (
            <span className="pill">
              <span className="dot" data-state="degraded" />
              {dirtyKeys.length} changed
            </span>
          )}
          {dirty && (
            <Button variant="ghost" onClick={reset}>
              Discard
            </Button>
          )}
          <Button variant="primary" onClick={save} loading={saving} disabled={!dirty}>
            {dirty ? 'Save changes' : 'Saved'}
          </Button>
        </div>
      </header>

      {groups.map(([group, rows]) => (
        <section className="panel" key={group}>
          <div className="panel-head">
            <h2 style={{ fontSize: '1rem' }}>{group}</h2>
          </div>

          <div className="grid-2">
            {rows.map((row) => {
              const changed = draft[row.key] !== undefined && draft[row.key] !== row.value;
              const hasOptions = row.options?.length > 0;
              const Control = hasOptions ? Select : row.multiline ? Textarea : Input;

              return (
                <Field
                  key={row.key}
                  label={row.label}
                  hint={row.hint || row.key}
                  full={row.multiline}
                >
                  <Control
                    value={draft[row.key] ?? ''}
                    onChange={(v) => setDraft((prev) => ({ ...prev, [row.key]: v }))}
                    options={hasOptions ? row.options : undefined}
                    rows={!hasOptions && row.multiline ? 2 : undefined}
                    style={changed ? { borderColor: 'var(--iris)' } : undefined}
                  />
                </Field>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
