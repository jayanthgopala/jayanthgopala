import '../styles/sections.css';

/**
 * Shown only when the API is unreachable. The page still renders its skeleton
 * behind this — a portfolio that goes blank on a fetch failure is worse than
 * one that shows a degraded shell.
 */
export default function ErrorBanner({ message, onRetry }) {
  return (
    <div className="error-banner glass" role="status">
      <span className="dot" data-state="error" />
      <span className="error-banner-text">
        Couldn&rsquo;t reach the content API.
        <span className="error-banner-detail"> {message}</span>
      </span>
      <button type="button" className="btn btn-ghost" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
