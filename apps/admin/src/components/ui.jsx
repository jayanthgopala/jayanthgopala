import { createContext, useCallback, useContext, useMemo, useState } from 'react';

/* --- Form primitives ------------------------------------------------------ */

export function Field({ label, hint, full, children }) {
  return (
    <label className={`field ${full ? 'field-full' : ''}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Input({ value, onChange, ...rest }) {
  return (
    <input
      className="input"
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
      {...rest}
    />
  );
}

export function Textarea({ value, onChange, ...rest }) {
  return (
    <textarea
      className="textarea"
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
      {...rest}
    />
  );
}

export function Select({ value, onChange, options = [], ...rest }) {
  return (
    <select
      className="select"
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
      {...rest}
    >
      {options.map((opt) => {
        const { value: v, label } = typeof opt === 'string' ? { value: opt, label: opt } : opt;
        return (
          <option key={v} value={v}>
            {label}
          </option>
        );
      })}
    </select>
  );
}

export function Switch({ checked, onChange, label }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange?.(e.target.checked)} />
      <span className="switch-track" />
      {label && <span className="label">{label}</span>}
    </label>
  );
}

export function Range({ value, onChange, min = 0, max = 100 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
      <input
        className="range"
        type="range"
        min={min}
        max={max}
        value={value ?? 0}
        onChange={(e) => onChange?.(Number(e.target.value))}
      />
      <span className="mono muted" style={{ minWidth: 38, textAlign: 'right' }}>
        {value ?? 0}%
      </span>
    </div>
  );
}

export function Button({ variant = 'secondary', size, loading, children, ...rest }) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''}`}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading && <span className="spinner" />}
      {children}
    </button>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

/* --- Toasts ---------------------------------------------------------------
   Every save, delete and publish reports back here. Silent success is the
   fastest way to make an operator distrust a panel.                          */

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((message, kind = 'info') => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, kind }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, kind === 'error' ? 7000 : 3800);
  }, []);

  const value = useMemo(
    () => ({
      success: (m) => push(m, 'success'),
      error: (m) => push(String(m?.message || m), 'error'),
      info: (m) => push(m, 'info'),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast" data-kind={toast.kind} role="status">
            <span
              className="dot"
              data-state={toast.kind === 'error' ? 'fail' : toast.kind === 'success' ? 'ok' : ''}
              style={{ marginTop: 7 }}
            />
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
