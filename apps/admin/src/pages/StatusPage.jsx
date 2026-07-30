import { useState } from 'react';
import { api } from '../lib/api.js';
import { useResource, useDraft, useUnsavedGuard } from '../lib/hooks.js';
import {
  Button, Field, Input, Select, Switch, Range, useToast,
} from '../components/ui.jsx';

const DEPLOY_STATES = [
  { value: 'ready', label: 'Ready' },
  { value: 'building', label: 'Building' },
  { value: 'error', label: 'Error' },
];

const HEALTH_STATES = [
  { value: 'operational', label: 'Operational' },
  { value: 'degraded', label: 'Degraded' },
  { value: 'down', label: 'Down' },
];

export default function StatusPage() {
  const toast = useToast();
  const { data } = useResource(api.getStatus);
  const { draft, set, dirty, commit, reset } = useDraft(data);
  const [saving, setSaving] = useState(false);

  useUnsavedGuard(dirty);

  async function save() {
    setSaving(true);
    try {
      const saved = await api.saveStatus({
        available: draft.available,
        availability_note: draft.availabilityNote,
        current_project: draft.currentProject,
        current_project_url: draft.currentProjectUrl,
        current_progress: draft.currentProgress,
        deploy_label: draft.deployLabel,
        deploy_state: draft.deployState,
        github_state: draft.githubState,
        health_state: draft.healthState,
        health_uptime: draft.healthUptime,
        timezone: draft.timezone,
      });
      commit(saved);
      toast.success('Status updated — live on the site and the README SVG.');
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  if (!data) return <span className="spinner" />;

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Live status</h1>
          <p className="dim">
            Drives the status card on your site and the live SVG in your README.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
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

      <section className="panel">
        <div className="panel-head">
          <h2 style={{ fontSize: '1rem' }}>Availability</h2>
          <Switch
            checked={draft.available}
            onChange={(v) => set('available', v)}
            label={draft.available ? 'Open to work' : 'At capacity'}
          />
        </div>

        <Field label="Availability note" hint="Shown next to the pulsing indicator.">
          <Input
            value={draft.availabilityNote}
            onChange={(v) => set('availabilityNote', v)}
            placeholder="Available for collaborations"
          />
        </Field>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 style={{ fontSize: '1rem' }}>Current project</h2>
        </div>

        <div className="grid-2">
          <Field label="Project name">
            <Input value={draft.currentProject} onChange={(v) => set('currentProject', v)} />
          </Field>

          <Field label="Project URL">
            <Input
              value={draft.currentProjectUrl}
              onChange={(v) => set('currentProjectUrl', v)}
              placeholder="https://"
            />
          </Field>

          <Field label="Progress" full>
            <Range value={draft.currentProgress} onChange={(v) => set('currentProgress', v)} />
          </Field>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 style={{ fontSize: '1rem' }}>System</h2>
        </div>

        <div className="grid-2">
          <Field label="Latest deployment">
            <Input
              value={draft.deployLabel}
              onChange={(v) => set('deployLabel', v)}
              placeholder="portfolio-web · production"
            />
          </Field>

          <Field label="Deployment state">
            <Select
              value={draft.deployState}
              onChange={(v) => set('deployState', v)}
              options={DEPLOY_STATES}
            />
          </Field>

          <Field label="GitHub state">
            <Select
              value={draft.githubState}
              onChange={(v) => set('githubState', v)}
              options={HEALTH_STATES}
            />
          </Field>

          <Field label="System health">
            <Select
              value={draft.healthState}
              onChange={(v) => set('healthState', v)}
              options={HEALTH_STATES}
            />
          </Field>

          <Field label="Uptime %">
            <Input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={draft.healthUptime}
              onChange={(v) => set('healthUptime', Number(v))}
            />
          </Field>

          <Field label="Timezone" hint="IANA name, e.g. Asia/Kolkata. Shows local time on the card.">
            <Input value={draft.timezone} onChange={(v) => set('timezone', v)} />
          </Field>
        </div>
      </section>
    </>
  );
}
