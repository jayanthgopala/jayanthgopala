import { api } from '../lib/api.js';
import { useResource } from '../lib/hooks.js';
import { Empty } from '../components/ui.jsx';

function timeAgo(value) {
  if (!value) return 'never';
  const iso = String(value).replace(' ', 'T');
  const then = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  const mins = Math.floor((Date.now() - then.getTime()) / 60000);
  if (Number.isNaN(mins)) return '—';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

export default function Dashboard() {
  const { data, loading } = useResource(api.overview);

  if (loading) return <span className="spinner" />;
  if (!data) return <Empty>Couldn&rsquo;t load the overview.</Empty>;

  // `visitors` is absent until the Worker carrying it is deployed, so every
  // read is guarded — an older API must not blank the dashboard.
  const v = data.visitors;

  const stats = [
    { label: 'Unique visitors', value: v ? v.unique.toLocaleString() : '—' },
    { label: 'Visitors today', value: v ? v.today.toLocaleString() : '—' },
    { label: 'Last 7 days', value: v ? v.last7.toLocaleString() : '—' },
    { label: 'Page views', value: v ? v.visits.toLocaleString() : '—' },
    { label: 'Projects', value: data.counts.projects },
    { label: 'Published', value: data.counts.published },
    { label: 'Stack items', value: data.counts.stack },
    { label: 'Links', value: data.counts.socials },
  ];

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="dim">Everything here publishes to your site and your GitHub profile.</p>
        </div>
        <span className="pill">
          <span className="dot" data-state={data.status.available ? 'operational' : 'degraded'} />
          {data.status.available ? 'Available' : 'At capacity'}
        </span>
      </header>

      <section className="panel">
        <div className="grid-3">
          {stats.map((stat) => (
            <div key={stat.label} className="stat">
              <span className="stat-value">{stat.value}</span>
              <span className="eyebrow">{stat.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 style={{ fontSize: '1rem' }}>GitHub sync</h2>
          <span className="dim mono">last published {timeAgo(data.lastSyncAt)}</span>
        </div>

        {data.syncs.length === 0 ? (
          <Empty>Nothing published yet. Open the Publish tab to push your README.</Empty>
        ) : (
          <ul>
            {data.syncs.map((entry) => (
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
