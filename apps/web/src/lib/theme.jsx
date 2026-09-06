import { useEffect, useState } from 'react';

/**
 * The presentation mode, as an attribute on <html>.
 *
 * There is one mode. There were two — a second, cinematic presentation lived
 * alongside this one — and it has been taken out of the app; the working copy
 * is in `apps/web/.backup/cinematic-v2/`, with notes on putting it back.
 *
 * WHY THIS DID NOT COLLAPSE INTO A CONSTANT. `data-mode="minimal"` still goes
 * on the root element, and `MODES` still gates what may be stored, because two
 * things outlive the removal: visitors who chose cinematic have `pf_mode` set
 * in their browser, and the database still carries a `theme.default` key that
 * an admin may have set to it. Both now fail `isValid` and fall through to
 * minimal, which is exactly the behaviour wanted — a stale preference for a
 * mode that no longer exists resolves silently instead of rendering nothing.
 * Deleting the validation would have let those values through to an attribute
 * no stylesheet answers to.
 */

export const MODES = ['minimal'];
const STORAGE_KEY = 'pf_mode';

const isValid = (m) => MODES.includes(m);

function storedMode() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isValid(value) ? value : null;
    // Private-mode Safari throws on localStorage access rather than returning
    // null, so this has to be guarded.
  } catch {
    return null;
  }
}

export function useThemeMode(content) {
  const adminDefault = content?.['theme.default'];

  const [mode, setMode] = useState(() => storedMode() || 'minimal');
  // Tracks whether the visitor has expressed a preference, so a late-arriving
  // admin default doesn't stomp on a choice they already made.
  const [explicit, setExplicit] = useState(() => storedMode() !== null);

  // Content arrives after first paint; adopt the admin default only if the
  // visitor has not chosen for themselves.
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
