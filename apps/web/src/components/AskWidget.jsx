import { useEffect, useRef, useState } from 'react';
import { copy, askQuestion } from '../lib/api.js';
import '../styles/ask.css';

const SparkIcon = (props) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M12 2.6l1.9 5.3 5.3 1.9-5.3 1.9-1.9 5.3-1.9-5.3-5.3-1.9 5.3-1.9L12 2.6zM18.5 15l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9.9-2.4z" />
  </svg>
);

/**
 * Floating "ask about me" assistant.
 *
 * Answers come from /api/ask, which is grounded in this site's own content and
 * refuses anything off-topic. The disclosure line under the header is not
 * decoration — a visitor should know they are reading a model's summary rather
 * than words the owner wrote.
 */
export default function AskWidget({ content = {}, profile }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([]);
  const inputRef = useRef(null);
  const feedRef = useRef(null);

  const enabled = copy(content, 'bot.enabled', 'true') !== 'false';

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Keep the newest answer in view without yanking the whole page.
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!enabled) return null;

  async function submit(e) {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;

    setMessages((m) => [...m, { role: 'user', text: q }]);
    setQuestion('');
    setBusy(true);

    try {
      const { answer } = await askQuestion(q);
      setMessages((m) => [...m, { role: 'bot', text: answer }]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: 'bot', text: err.message || 'Something went wrong. Try again in a moment.', error: true },
      ]);
    } finally {
      setBusy(false);
    }
  }

  const greeting = copy(
    content,
    'bot.greeting',
    `Ask me anything about ${profile?.name || 'his'} work, stack or background.`
  );

  return (
    <>
      <button
        type="button"
        className="ask-fab"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={copy(content, 'bot.title', 'Ask about me')}
      >
        <SparkIcon />
        <span>{copy(content, 'bot.title', 'Ask about me')}</span>
      </button>

      {open && (
        <div className="ask-panel glass" role="dialog" aria-label="Assistant">
          <header className="ask-head">
            <div>
              <strong className="ask-title">{copy(content, 'bot.title', 'Ask about me')}</strong>
              {/* Say plainly that this is generated. */}
              <span className="ask-note">AI-generated · answers only from this site</span>
            </div>
            <button type="button" className="ask-close" onClick={() => setOpen(false)} aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.8" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </header>

          <div className="ask-feed" ref={feedRef}>
            <p className="ask-msg ask-bot">{greeting}</p>

            {messages.map((m, i) => (
              <p
                key={i}
                className={`ask-msg ${m.role === 'user' ? 'ask-user' : 'ask-bot'}`}
                data-error={m.error || undefined}
              >
                {m.text}
              </p>
            ))}

            {busy && (
              <p className="ask-msg ask-bot ask-typing" aria-live="polite">
                <span /><span /><span />
              </p>
            )}
          </div>

          <form className="ask-form" onSubmit={submit}>
            <input
              ref={inputRef}
              className="ask-input"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={copy(content, 'bot.placeholder', 'What has he built?')}
              maxLength={400}
              disabled={busy}
            />
            <button type="submit" className="ask-send" disabled={!question.trim() || busy}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </form>
        </div>
      )}
    </>
  );
}
