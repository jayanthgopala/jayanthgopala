import { useState } from 'react';
import { api } from '../lib/api.js';
import { useResource, useDraft, useUnsavedGuard } from '../lib/hooks.js';
import { Button, Field, Input, Textarea, useToast } from '../components/ui.jsx';
import ImageUploadField from '../components/ImageUploadField.jsx';

export default function ProfilePage() {
  const toast = useToast();
  const { data } = useResource(api.getProfile);
  const { draft, set, dirty, commit, reset } = useDraft(data);
  const [saving, setSaving] = useState(false);

  useUnsavedGuard(dirty);

  async function save() {
    setSaving(true);
    try {
      // The API speaks snake_case; the client maps at the boundary rather than
      // leaking column names into the form state.
      const saved = await api.saveProfile({
        name: draft.name,
        role: draft.role,
        headline: draft.headline,
        description: draft.description,
        location: draft.location,
        email: draft.email,
        avatar_url: draft.avatarUrl,
        cinematic_avatar_url: draft.cinematicAvatarUrl,
        resume_url: draft.resumeUrl,
        github_user: draft.githubUser,
        cta_primary: draft.ctaPrimary,
        cta_secondary: draft.ctaSecondary,
      });
      commit(saved);
      toast.success('Profile saved — syncing to GitHub.');
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
          <h1 className="page-title">Profile</h1>
          <p className="dim">Your hero section and README header.</p>
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
        <div className="grid-2">
          <Field label="Name">
            <Input value={draft.name} onChange={(v) => set('name', v)} />
          </Field>

          <Field label="Role">
            <Input value={draft.role} onChange={(v) => set('role', v)} placeholder="Software Engineer" />
          </Field>

          <Field
            label="Headline"
            full
            hint="The large hero heading. Keep it under about 70 characters."
          >
            <Textarea
              value={draft.headline}
              onChange={(v) => set('headline', v)}
              rows={2}
              maxLength={140}
            />
          </Field>

          <Field label="Description" full hint="One or two sentences under the headline.">
            <Textarea value={draft.description} onChange={(v) => set('description', v)} rows={3} />
          </Field>

          <ImageUploadField
            label="Portrait — Minimal mode"
            hint="Cropped to a circle in the hero's 3D object. Head-and-shoulders works best."
            preview="round"
            crop
            value={draft.avatarUrl}
            onChange={(v) => set('avatarUrl', v)}
          />

          <ImageUploadField
            label="Portrait — Cinematic mode"
            hint="Full-bleed behind the headline. Chest-up, subject centred, dark background. Not cropped — the whole image is used."
            value={draft.cinematicAvatarUrl}
            onChange={(v) => set('cinematicAvatarUrl', v)}
          />

          <Field label="Location">
            <Input value={draft.location} onChange={(v) => set('location', v)} />
          </Field>

          <Field label="Email">
            <Input type="email" value={draft.email} onChange={(v) => set('email', v)} />
          </Field>

          <Field label="GitHub username" hint="Must match your profile repo name exactly.">
            <Input value={draft.githubUser} onChange={(v) => set('githubUser', v)} />
          </Field>

          <Field label="Résumé URL">
            <Input value={draft.resumeUrl} onChange={(v) => set('resumeUrl', v)} placeholder="https://" />
          </Field>

          <Field label="Primary CTA">
            <Input value={draft.ctaPrimary} onChange={(v) => set('ctaPrimary', v)} />
          </Field>

          <Field label="Secondary CTA">
            <Input value={draft.ctaSecondary} onChange={(v) => set('ctaSecondary', v)} />
          </Field>
        </div>
      </section>
    </>
  );
}
