import { useState } from 'react';
import { api } from '../lib/api.js';
import { useResource } from '../lib/hooks.js';
import { Button, Empty, Field, Input, Select, Switch, Textarea, useToast } from '../components/ui.jsx';

/**
 * Shared editor for Education and Experience.
 *
 * Both are ordered lists of dated cards with the same lifecycle, so the page is
 * driven by a field spec rather than written twice. Adding a column to either
 * table means adding one line here.
 */
function Editor({ fields, initial, onCancel, onSaved, save }) {
  const toast = useToast();
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setDraft((p) => ({ ...p, [k]: v }));

  async function submit() {
    const missing = fields.find((f) => f.required && !String(draft[f.key] || '').trim());
    if (missing) {
      toast.error(`${missing.label} is required.`);
      return;
    }
    setBusy(true);
    try {
      await save(draft);
      toast.success(draft.id ? 'Updated.' : 'Added.');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 style={{ fontSize: '1rem' }}>{draft.id ? 'Edit entry' : 'New entry'}</h2>
        <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy}>Save</Button>
        </div>
      </div>

      <div className="grid-2">
        {fields.map((f) => {
          const Control = f.options ? Select : f.multiline ? Textarea : Input;
          return (
            <Field key={f.key} label={f.label} hint={f.hint} full={f.full || f.multiline}>
              <Control
                value={f.list ? (draft[f.key] || []).join(', ') : draft[f.key] ?? ''}
                onChange={(v) =>
                  set(f.key, f.list ? v.split(',').map((s) => s.trim()).filter(Boolean) : v)
                }
                options={f.options}
                rows={f.multiline ? 3 : undefined}
                placeholder={f.placeholder}
              />
            </Field>
          );
        })}

        <div className="field" style={{ justifyContent: 'flex-end' }}>
          <Switch
            checked={draft.published ?? true}
            onChange={(v) => set('published', v)}
            label="Published"
          />
        </div>
      </div>
    </section>
  );
}

function TimelineManager({ title, blurb, fields, blank, resource, summary }) {
  const toast = useToast();
  const { data, setData, loading, reload } = useResource(resource.list);
  const [editing, setEditing] = useState(null);
  const items = data || [];

  async function remove(item) {
    if (!window.confirm(`Delete "${summary(item).title}"? This cannot be undone.`)) return;
    try {
      await resource.remove(item.id);
      setData((prev) => prev.filter((x) => x.id !== item.id));
      toast.success('Deleted.');
    } catch (err) {
      toast.error(err);
    }
  }

  async function move(index, delta) {
    const next = [...items];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setData(next);
    try {
      await resource.reorder(next.map((x) => x.id));
    } catch (err) {
      toast.error(err);
      reload();
    }
  }

  if (loading) return <span className="spinner" />;

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="dim">{blurb}</p>
        </div>
        {!editing && (
          <Button variant="primary" onClick={() => setEditing({ ...blank })}>
            New entry
          </Button>
        )}
      </header>

      {editing && (
        <Editor
          fields={fields}
          initial={editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
          save={(d) => (d.id ? resource.update(d.id, d) : resource.create(d))}
        />
      )}

      <section className="panel">
        {items.length === 0 ? (
          <Empty>Nothing here yet. The section stays hidden on your site until you add one.</Empty>
        ) : (
          <ul>
            {items.map((item, i) => {
              const s = summary(item);
              return (
                <li key={item.id} className="row">
                  {/* Arrows rather than drag: these lists are short, and a
                      keyboard-reachable control beats a drag target here. */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0}>↑</Button>
                    <Button size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === items.length - 1}>↓</Button>
                  </div>

                  <div className="row-main">
                    <div className="row-title">{s.title}</div>
                    <div className="row-sub">{s.sub}</div>
                  </div>

                  <div className="row-actions">
                    {!item.published && <span className="pill">Draft</span>}
                    <Button size="sm" variant="ghost" onClick={() => setEditing(item)}>Edit</Button>
                    <Button size="sm" variant="danger" onClick={() => remove(item)}>Delete</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

export function EducationPage() {
  return (
    <TimelineManager
      title="Education"
      blurb="Shown as a timeline on your site, and feeds the Education row on your GitHub banner."
      blank={{ institution: '', qualification: '', field: '', period: '', location: '', grade: '', description: '', published: true }}
      resource={{
        list: api.getEducation,
        create: api.createEducation,
        update: api.updateEducation,
        remove: api.deleteEducation,
        reorder: api.reorderEducation,
      }}
      summary={(e) => ({
        title: [e.qualification, e.field].filter(Boolean).join(' · ') || e.institution,
        sub: [e.institution, e.period, e.grade].filter(Boolean).join(' · '),
      })}
      fields={[
        { key: 'institution', label: 'Institution', required: true, placeholder: 'Anna University' },
        { key: 'qualification', label: 'Qualification', placeholder: 'B.E.' },
        { key: 'field', label: 'Field of study', placeholder: 'Computer Science' },
        { key: 'period', label: 'Period', placeholder: '2021 — 2025', hint: 'Free text, shown as typed' },
        { key: 'location', label: 'Location' },
        { key: 'grade', label: 'Grade', placeholder: 'CGPA 8.7', hint: 'Optional' },
        { key: 'description', label: 'Description', multiline: true },
      ]}
    />
  );
}

export function ExperiencePage() {
  return (
    <TimelineManager
      title="Experience & Achievements"
      blurb="Roles and awards share one timeline. Achievements get a badge so they read differently."
      blank={{ kind: 'work', title: '', organisation: '', period: '', location: '', description: '', url: '', tech: [], published: true }}
      resource={{
        list: api.getExperience,
        create: api.createExperience,
        update: api.updateExperience,
        remove: api.deleteExperience,
        reorder: api.reorderExperience,
      }}
      summary={(x) => ({
        title: x.title,
        sub: [x.kind === 'achievement' ? 'Achievement' : 'Role', x.organisation, x.period]
          .filter(Boolean)
          .join(' · '),
      })}
      fields={[
        { key: 'kind', label: 'Type', options: [{ value: 'work', label: 'Role' }, { value: 'achievement', label: 'Achievement' }] },
        { key: 'title', label: 'Title', required: true, placeholder: 'Backend Engineer' },
        { key: 'organisation', label: 'Organisation' },
        { key: 'period', label: 'Period', placeholder: '2024 — present' },
        { key: 'location', label: 'Location' },
        { key: 'url', label: 'Link', placeholder: 'Certificate, article or proof', hint: 'Optional' },
        { key: 'description', label: 'Description', multiline: true },
        { key: 'tech', label: 'Technologies', list: true, full: true, hint: 'Comma separated' },
      ]}
    />
  );
}
