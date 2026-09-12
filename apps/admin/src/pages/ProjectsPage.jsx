import { useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useResource } from '../lib/hooks.js';
import {
  Button, Empty, Field, Input, Select, Switch, Textarea, useToast,
} from '../components/ui.jsx';
import ImageUploadField from '../components/ImageUploadField.jsx';
import {
  SHAPES, availableShapes, labelOf, nextShape, roundProgress,
} from '@portfolio/shapes';

const ACCENTS = ['iris', 'violet', 'mint', 'amber', 'rose'];

const BLANK = {
  title: '', slug: '', summary: '', description: '', screenshot: '',
  tech: [], liveUrl: '', repoUrl: '', accent: 'iris', shape: '', featured: true, published: true,
};

// Project editor form
function Editor({ initial, projects, onSaved, onCancel }) {
  const toast = useToast();
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setDraft((prev) => ({ ...prev, [key]: value }));

  // Shapes still free this round, ignoring whatever this project itself holds
  // so editing without changing the shape is never blocked by its own choice.
  const free = availableShapes(projects, draft.id ?? null);
  const progress = roundProgress(projects);

  const options = SHAPES.map((shape) => {
    const open = free.includes(shape.id);
    const mine = shape.id === draft.shape;
    return {
      value: shape.id,
      label: open || mine ? shape.label : `${shape.label} — taken`,
      disabled: !open && !mine,
    };
  });

  async function save() {
    if (!draft.title?.trim()) {
      toast.error('A title is required.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: draft.title,
        slug: draft.slug,
        summary: draft.summary,
        description: draft.description,
        screenshot: draft.screenshot,
        tech: draft.tech,
        liveUrl: draft.liveUrl,
        repoUrl: draft.repoUrl,
        accent: draft.accent,
        shape: draft.shape,
        featured: draft.featured,
        published: draft.published,
      };
      const saved = draft.id
        ? await api.updateProject(draft.id, payload)
        : await api.createProject(payload);
      toast.success(draft.id ? 'Project updated.' : 'Project created.');
      onSaved(saved);
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 style={{ fontSize: '1rem' }}>{draft.id ? 'Edit project' : 'New project'}</h2>
        <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={saving}>
            Save
          </Button>
        </div>
      </div>

      <div className="grid-2">
        <Field label="Title">
          <Input value={draft.title} onChange={(v) => set('title', v)} />
        </Field>

        <Field label="Slug" hint="Leave blank to generate from the title.">
          <Input value={draft.slug} onChange={(v) => set('slug', v)} placeholder="auto" />
        </Field>

        <Field label="Summary" full hint="One line. Used on the card and in the README table.">
          <Input value={draft.summary} onChange={(v) => set('summary', v)} />
        </Field>

        <Field label="Description" full>
          <Textarea value={draft.description} onChange={(v) => set('description', v)} rows={3} />
        </Field>

        <ImageUploadField
          label="Screenshot"
          value={draft.screenshot}
          onChange={(v) => set('screenshot', v)}
        />

        <Field label="Technologies" full hint="Comma separated.">
          <Input
            value={(draft.tech || []).join(', ')}
            onChange={(v) =>
              set(
                'tech',
                v.split(',').map((t) => t.trim()).filter(Boolean)
              )
            }
            placeholder="React, Cloudflare Workers, D1"
          />
        </Field>

        <Field label="Live URL">
          <Input value={draft.liveUrl} onChange={(v) => set('liveUrl', v)} placeholder="https://" />
        </Field>

        <Field label="Repository URL">
          <Input value={draft.repoUrl} onChange={(v) => set('repoUrl', v)} placeholder="https://" />
        </Field>

        <Field label="Accent" hint="Tints the card's gradient border.">
          <Select value={draft.accent} onChange={(v) => set('accent', v)} options={ACCENTS} />
        </Field>

        <Field
          label="Object"
          hint={`The shape this project becomes on the world page. Round ${progress.round}: ${free.length} of ${progress.total} still free.`}
        >
          <Select
            value={draft.shape || ''}
            onChange={(v) => set('shape', v)}
            options={[{ value: '', label: 'Assign automatically' }, ...options]}
          />
        </Field>

        <div className="field" style={{ justifyContent: 'flex-end', gap: 'var(--s-3)' }}>
          <Switch checked={draft.featured} onChange={(v) => set('featured', v)} label="Featured" />
          <Switch checked={draft.published} onChange={(v) => set('published', v)} label="Published" />
        </div>
      </div>
    </section>
  );
}

export default function ProjectsPage() {
  const toast = useToast();
  const { data, setData, loading, reload } = useResource(api.getProjects);
  const [editing, setEditing] = useState(null);
  const dragIndex = useRef(null);
  const [overIndex, setOverIndex] = useState(null);

  const projects = data || [];

  async function remove(project) {
    if (!window.confirm(`Delete "${project.title}"? This cannot be undone.`)) return;
    try {
      await api.deleteProject(project.id);
      setData((prev) => prev.filter((p) => p.id !== project.id));
      toast.success('Project deleted.');
    } catch (err) {
      toast.error(err);
    }
  }

  // Optimistic reorder
  async function commitOrder(from, to) {
    if (from === to || from == null || to == null) return;
    const next = [...projects];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setData(next);

    try {
      await api.reorderProjects(next.map((p) => p.id));
    } catch (err) {
      toast.error(err);
      reload(); // Rollback on failure
    }
  }

  if (loading) return <span className="spinner" />;

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="dim">Drag to reorder. Order applies to the site and the README.</p>
        </div>
        {!editing && (
          <Button
            variant="primary"
            onClick={() => setEditing({ ...BLANK, shape: nextShape(projects) })}
          >
            New project
          </Button>
        )}
      </header>

      {editing && (
        <Editor
          initial={editing}
          projects={projects}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}

      <section className="panel">
        {projects.length === 0 ? (
          <Empty>No projects yet.</Empty>
        ) : (
          <ul>
            {projects.map((project, index) => (
              <li
                key={project.id}
                className="row"
                data-dragging={dragIndex.current === index || undefined}
                data-dragover={overIndex === index && dragIndex.current !== index ? 'true' : undefined}
                draggable
                onDragStart={() => {
                  dragIndex.current = index;
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverIndex(index);
                }}
                onDragEnd={() => {
                  dragIndex.current = null;
                  setOverIndex(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  commitOrder(dragIndex.current, index);
                  dragIndex.current = null;
                  setOverIndex(null);
                }}
              >
                <span className="drag-handle" aria-hidden="true">
                  ⠿
                </span>

                {project.screenshot ? (
                  <img className="thumb" src={project.screenshot} alt="" />
                ) : (
                  <span className="thumb" />
                )}

                <div className="row-main">
                  <div className="row-title">{project.title}</div>
                  <div className="row-sub">
                    {project.summary || project.slug}
                  </div>
                </div>

                <div className="row-actions">
                  {project.shape && <span className="pill">{labelOf(project.shape)}</span>}
                  {!project.published && <span className="pill">Draft</span>}
                  {project.featured && <span className="pill">Featured</span>}
                  <Button size="sm" variant="ghost" onClick={() => setEditing(project)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => remove(project)}>
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
