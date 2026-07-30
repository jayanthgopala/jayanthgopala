import { useState } from 'react';
import { api } from '../lib/api.js';
import { useResource } from '../lib/hooks.js';
import { Button, Empty, Field, Input, Range, Select, useToast } from '../components/ui.jsx';

const CATEGORIES = ['Language', 'Frontend', 'Backend', 'Platform', 'Data', 'Tooling', 'Other'];

export default function StackPage() {
  const toast = useToast();
  const { data, setData, loading, reload } = useResource(api.getStack);
  const [adding, setAdding] = useState({ name: '', category: 'Language', level: 80 });
  const [busy, setBusy] = useState(false);

  const items = data || [];

  async function add() {
    if (!adding.name.trim()) return;
    setBusy(true);
    try {
      await api.createStack(adding);
      setAdding({ name: '', category: adding.category, level: 80 });
      toast.success('Added.');
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  /** Inline edits save on blur — a Save button per row would be noise. */
  async function patch(item, changes) {
    setData((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...changes } : i)));
    try {
      await api.updateStack(item.id, changes);
    } catch (err) {
      toast.error(err);
      reload();
    }
  }

  async function remove(item) {
    try {
      await api.deleteStack(item.id);
      setData((prev) => prev.filter((i) => i.id !== item.id));
    } catch (err) {
      toast.error(err);
    }
  }

  if (loading) return <span className="spinner" />;

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Tech stack</h1>
          <p className="dim">Grouped by category on the site and in the README.</p>
        </div>
      </header>

      <section className="panel">
        <div className="panel-head">
          <h2 style={{ fontSize: '1rem' }}>Add technology</h2>
        </div>

        <div className="grid-2">
          <Field label="Name">
            <Input
              value={adding.name}
              onChange={(v) => setAdding((p) => ({ ...p, name: v }))}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder="TypeScript"
            />
          </Field>

          <Field label="Category">
            <Select
              value={adding.category}
              onChange={(v) => setAdding((p) => ({ ...p, category: v }))}
              options={CATEGORIES}
            />
          </Field>

          <Field label="Proficiency" full>
            <Range value={adding.level} onChange={(v) => setAdding((p) => ({ ...p, level: v }))} />
          </Field>
        </div>

        <div style={{ marginTop: 'var(--s-4)' }}>
          <Button variant="primary" onClick={add} loading={busy} disabled={!adding.name.trim()}>
            Add
          </Button>
        </div>
      </section>

      <section className="panel">
        {items.length === 0 ? (
          <Empty>No technologies yet.</Empty>
        ) : (
          <ul>
            {items.map((item) => (
              <li key={item.id} className="row">
                <div className="row-main" style={{ display: 'grid', gap: 6 }}>
                  <Input
                    value={item.name}
                    onChange={(v) =>
                      setData((prev) =>
                        prev.map((i) => (i.id === item.id ? { ...i, name: v } : i))
                      )
                    }
                    onBlur={() => patch(item, { name: item.name })}
                  />
                </div>

                <div style={{ width: 150 }}>
                  <Select
                    value={item.category}
                    onChange={(v) => patch(item, { category: v })}
                    options={CATEGORIES}
                  />
                </div>

                <div style={{ width: 180 }}>
                  <Range value={item.level} onChange={(v) => patch(item, { level: v })} />
                </div>

                <div className="row-actions">
                  <Button size="sm" variant="danger" onClick={() => remove(item)}>
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
