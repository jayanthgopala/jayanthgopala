import { useEffect, useState, useCallback } from 'react';
import { api } from './lib/api.js';
import { ToastProvider } from './components/ui.jsx';
import Login from './components/Login.jsx';
import Shell from './components/Shell.jsx';

export default function App() {
  const [authed, setAuthed] = useState(null); // null = still checking

  const check = useCallback(async () => {
    try {
      await api.me();
      setAuthed(true);
    } catch {
      setAuthed(false);
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  if (authed === null) {
    return (
      <div className="login">
        <span className="spinner" />
      </div>
    );
  }

  return (
    <ToastProvider>
      {authed ? (
        <Shell onLogout={() => setAuthed(false)} />
      ) : (
        <Login onSuccess={() => setAuthed(true)} />
      )}
    </ToastProvider>
  );
}
