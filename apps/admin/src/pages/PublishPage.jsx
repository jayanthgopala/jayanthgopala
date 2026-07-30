import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Button, Empty, useToast } from '../components/ui.jsx';

function timeAgo(value) {
  if (!value) return '—';
  const iso = String(value).replace(' ', 'T');
  const then = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  const mins = Math.floor((Date.now() - then.getTime()) / 60000);
  if (Number.isNaN(mins)) return '—';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

export default function PublishPage() {
  const toast = useToast();
  const [preview, setPreview] = useState('');
  const [log, setLog] = useState([]);
  const [state, setState] = useState(null);
  const [github, setGithub] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const [markdown, entries, syncState] = await Promise.all([
        api.readmePreview(),
        api.syncLog(),
        api.syncState(),
      ]);
      setPreview(markdown);
      setLog(entries);
      setState(syncState);
    } catch (err) {
      toast.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // Verifies the PAT independently, so a bad token is visible before you
    // need it rather than at the moment you press Publish.
    api.githubCheck().then(setGithub).catch(() => setGithub({ ok: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function publish() {
    setPublishing(true);
    try {
      const result = await api.sync();
      toast.success(
        result.commitSha
          ? `Published — commit ${result.commitSha.slice(0, 7)}`
          : 'Published.'
      );
      refresh();
    } catch (err) {
      toast.error(err);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Publish</h1>
          <p className="dim">
            Renders your README from live content and commits it to your profile repo.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
          {state && (
            <span className="pill">
              <span className="dot" data-state={state.hasUnpublishedChanges ? 'degraded' : 'ok'} />
              {state.hasUnpublishedChanges ? 'Unpublished changes' : 'Up to date'}
            </span>
          )}

          {github && (
            <span className="pill">
              <span className="dot" data-state={github.ok ? 'ok' : 'fail'} />
              {github.ok ? `@${github.user.login}` : 'Token invalid'}
            </span>
          )}
          <Button variant="primary" onClick={publish} loading={publishing}>
            {publishing ? 'Publishing…' : 'Publish now'}
          </Button>
        </div>
      </header>

      <section className="panel">
        <div className="panel-head">
          <h2 style={{ fontSize: '1rem' }}>README preview</h2>
          <span className="dim mono">{preview.length.toLocaleString()} chars</span>
        </div>

        {loading ? (
          <span className="spinner" />
        ) : (
          <pre className="readme-preview">{preview}</pre>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 style={{ fontSize: '1rem' }}>Sync history</h2>
          <Button size="sm" variant="ghost" onClick={refresh}>
            Refresh
          </Button>
        </div>

        {log.length === 0 ? (
          <Empty>Nothing published yet.</Empty>
        ) : (
          <ul>
            {log.map((entry) => (
              <li key={entry.id} className="row">
                <span className="dot" data-state={entry.ok ? 'ok' : 'fail'} />
                <div className="row-main">
                  <div className="row-title">{entry.message}</div>
                  <div className="row-sub">
                    {entry.trigger} · {timeAgo(entry.createdAt)}
                  </div>
                </div>
                {entry.commitSha && (
                  <span className="mono dim">{entry.commitSha.slice(0, 7)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
