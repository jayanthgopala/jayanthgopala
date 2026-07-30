import { useState } from 'react';
import { api } from '../lib/api.js';
import { Button, Field, Input } from './ui.jsx';

export default function Login({ onSuccess }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.login(password);
      onSuccess();
    } catch (err) {
      setError(err.status === 401 ? 'Incorrect password.' : err.message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <span className="login-mark">P</span>

        <div>
          <h1 style={{ fontSize: '1.25rem' }}>Console</h1>
          <p className="dim" style={{ fontSize: 'var(--t-xs)' }}>
            Sign in to manage your portfolio and profile.
          </p>
        </div>

        <Field label="Password">
          <Input
            type="password"
            value={password}
            onChange={setPassword}
            autoFocus
            autoComplete="current-password"
            placeholder="••••••••"
          />
        </Field>

        {error && (
          <span style={{ color: 'var(--rose)', fontSize: 'var(--t-xs)' }}>{error}</span>
        )}

        <Button
          variant="primary"
          type="submit"
          className="btn btn-primary btn-block"
          loading={busy}
          disabled={!password || busy}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
