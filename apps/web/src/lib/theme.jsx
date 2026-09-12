import { useEffect, useState } from 'react';

/** Presentation mode management and validation. */

export const MODES = ['minimal'];
const STORAGE_KEY = 'pf_mode';

const isValid = (m) => MODES.includes(m);

function storedMode() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isValid(value) ? value : null;
  } catch {
    return null;
  }
}

export function useThemeMode(content) {
  const adminDefault = content?.['theme.default'];

  const [mode, setMode] = useState(() => storedMode() || 'minimal');
  // Track explicit user selection to avoid overwriting with server defaults
  const [explicit, setExplicit] = useState(() => storedMode() !== null);

  // Adopt admin default only if visitor hasn't explicitly set a preference
  useEffect(() => {
    if (explicit || !isValid(adminDefault)) return;
    setMode(adminDefault);
  }, [adminDefault, explicit]);

  // Drive CSS from a single attribute on <html>.
  useEffect(() => {
    document.documentElement.dataset.mode = mode;
  }, [mode]);

  return { mode };
}
