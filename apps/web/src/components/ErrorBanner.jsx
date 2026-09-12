import '../styles/sections.css';

// Displayed when the content API is unreachable
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
