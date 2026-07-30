import { useState } from 'react';
import { api } from '../lib/api.js';
import { useResource } from '../lib/hooks.js';
import { Button, Empty, Field, Input, Select, Switch, useToast } from '../components/ui.jsx';

const ICONS = ['github', 'linkedin', 'x', 'mail', 'globe', 'link'];

export default function SocialsPage() {
  const toast = useToast();
  const { data, setData, loading, reload } = useResource(api.getSocials);
  const [adding, setAdding] = useState({ label: '', url: '', icon: 'link', showInReadme: true });
  const [busy, setBusy] = useState(false);

  const links = data || [];

  async function add() {
    if (!adding.label.trim() || !adding.url.trim()) return;
    setBusy(true);
    try {
      await api.createSocial(adding);
      setAdding({ label: '', url: '', icon: 'link', showInReadme: true });
      toast.success('Link added.');
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function patch(link, changes) {
    setData((prev) => prev.map((l) => (l.id === link.id ? { ...l, ...changes } : l)));
    try {
      await api.updateSocial(link.id, changes);
    } catch (err) {
      toast.error(err);
      reload();
    }
  }

  async function remove(link) {
    try {
      await api.deleteSocial(link.id);
      setData((prev) => prev.filter((l) => l.id !== link.id));
    } catch (err) {
      toast.error(err);
    }
  }

  if (loading) return <span className="spinner" />;

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Links</h1>
          <p className="dim">Shown in your footer, contact block and README badges.</p>
        </div>
      </header>

      <section className="panel">
        <div className="panel-head">
          <h2 style={{ fontSize: '1rem' }}>Add link</h2>
        </div>

        <div className="grid-2">
          <Field label="Label">
            <Input
              value={adding.label}
              onChange={(v) => setAdding((p) => ({ ...p, label: v }))}
              placeholder="GitHub"
            />
          </Field>

          <Field label="URL">
            <Input
              value={adding.url}
              onChange={(v) => setAdding((p) => ({ ...p, url: v }))}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder="https://github.com/…"
            />
          </Field>

          <Field label="Icon">
            <Select
              value={adding.icon}
              onChange={(v) => setAdding((p) => ({ ...p, icon: v }))}
              options={ICONS}
            />
          </Field>
        </div>

        <div style={{ marginTop: 'var(--s-4)' }}>
          <Button
            variant="primary"
            onClick={add}
            loading={busy}
            disabled={!adding.label.trim() || !adding.url.trim()}
          >
            Add
          </Button>
        </div>
      </section>

      <section className="panel">
        {links.length === 0 ? (
          <Empty>No links yet.</Empty>
        ) : (
          <ul>
            {links.map((link) => (
              <li key={link.id} className="row">
                <div className="row-main">
                  <div className="row-title">{link.label}</div>
                  <div className="row-sub mono">{link.url}</div>
                </div>

                <div style={{ width: 130 }}>
                  <Select
                    value={link.icon}
                    onChange={(v) => patch(link, { icon: v })}
                    options={ICONS}
                  />
                </div>

                <Switch
                  checked={link.showInReadme}
                  onChange={(v) => patch(link, { showInReadme: v })}
                  label="README"
                />

                <div className="row-actions">
                  <Button size="sm" variant="danger" onClick={() => remove(link)}>
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
