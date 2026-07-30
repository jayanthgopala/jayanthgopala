import { useEffect, useState } from 'react';
import { copy, externalUrl } from '../lib/api.js';
import { SocialIcon, ArrowUpRight } from './Icons.jsx';
import '../styles/status.css';

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
/** Strips protocol, `www.`, `mailto:` and any trailing slash for display. */
function prettyUrl(url = '') {
  return String(url)
    .replace(/^mailto:/, '')
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
}

export default function StatusCard({ status, loading, content = {}, socials = [] }) {
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
            <a href={externalUrl(status.currentProjectUrl)} target="_blank" rel="noreferrer noopener">
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

      {/* Links, not system metrics. Deployment state, "GitHub: operational" and
          an uptime percentage were seeded demo values that nothing actually
          measured — a status card is worse than useless if its numbers are
          decorative. These come from the Links editor. */}
      {socials.length > 0 && (
        <div className="status-rows">
          {socials.map((social) => (
            <a
              key={social.id ?? social.url}
              className="status-link"
              href={externalUrl(social.url)}
              target="_blank"
              rel="noreferrer noopener"
            >
              <span className="status-link-label">
                <SocialIcon icon={social.icon} width={15} height={15} />
                {social.label}
              </span>
              <span className="status-link-go">
                <span className="status-link-url">{prettyUrl(social.url)}</span>
                <ArrowUpRight width={13} height={13} />
              </span>
            </a>
          ))}
        </div>
      )}
    </article>
  );
}
