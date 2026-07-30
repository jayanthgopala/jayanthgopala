import { useEffect, useState } from 'react';
import { copy } from '../lib/api.js';
import '../styles/status.css';

/** "3m ago" style formatting. D1 stores UTC without a Z suffix. */
function relativeTime(value) {
  if (!value) return '—';
  const iso = String(value).replace(' ', 'T');
  const then = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  const diff = Date.now() - then.getTime();
  if (Number.isNaN(diff)) return '—';

  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function useLocalTime(timeZone) {
  const [time, setTime] = useState('');

  useEffect(() => {
    const tick = () => {
      try {
        setTime(
          new Intl.DateTimeFormat('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: timeZone || 'UTC',
          }).format(new Date())
        );
      } catch {
        setTime(''); // invalid IANA zone from the admin panel — fail quietly
      }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [timeZone]);

  return time;
}

function Row({ label, state, children }) {
  return (
    <div className="status-row">
      <span className="status-row-label">{label}</span>
      <span className="status-row-value">
        {state && <span className="dot" data-state={state} />}
        {children}
      </span>
    </div>
  );
}

/**
 * The live status widget. Its data is refreshed by App's 60s poll, so this
 * component stays purely presentational.
 */
export default function StatusCard({ status, loading, content = {} }) {
  const localTime = useLocalTime(status.timezone);
  const progress = Math.max(0, Math.min(100, Number(status.currentProgress) || 0));

  return (
    <article className="status card glass" data-loading={loading || undefined}>
      <header className="status-head">
        <div className="status-avail">
          <span
            className={`dot ${status.available ? 'dot-pulse' : ''}`}
            data-state={status.available ? 'operational' : 'degraded'}
          />
          <span className="status-avail-text">
            {status.availabilityNote ||
              (status.available
                ? copy(content, 'status.available', 'Available')
                : copy(content, 'status.unavailable', 'At capacity'))}
          </span>
        </div>
        {localTime && <span className="mono status-time">{localTime} local</span>}
      </header>

      <div className="status-current">
        <span className="eyebrow">{copy(content, 'status.label.current', 'Current project')}</span>
        <h3 className="status-project">
          {status.currentProjectUrl ? (
            <a href={status.currentProjectUrl} target="_blank" rel="noreferrer noopener">
              {status.currentProject || '—'}
            </a>
          ) : (
            status.currentProject || '—'
          )}
        </h3>

        <div
          className="status-bar"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Current project progress"
        >
          <span className="status-bar-fill" style={{ '--progress': `${progress}%` }} />
        </div>
        <span className="mono status-progress">{progress}%</span>
      </div>

      <div className="status-rows">
        <Row
          label={copy(content, 'status.label.deployment', 'Latest deployment')}
          state={status.deployState}
        >
          <span className="status-truncate">{status.deployLabel || '—'}</span>
          <span className="status-ago">{relativeTime(status.deployAt)}</span>
        </Row>

        <Row label={copy(content, 'status.label.github', 'GitHub')} state={status.githubState}>
          {status.githubState || '—'}
        </Row>

        <Row
          label={copy(content, 'status.label.health', 'System health')}
          state={status.healthState}
        >
          {Number(status.healthUptime || 0).toFixed(2)}% uptime
        </Row>
      </div>
    </article>
  );
}
