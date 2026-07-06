import { useState, useEffect, createContext, useContext } from 'react';
import { StorageService } from '../lib/storage';

export const RestoreContext = createContext<boolean>(false);

export function useAutoSave<T>(key: string, initialValue: T) {
  const restored = useContext(RestoreContext);
  const [value, setValue] = useState<T>(initialValue);

  // Load from local storage when restore phase completes
  useEffect(() => {
    if (restored) {
      const saved = StorageService.load(`aura-app-${key}`);
      if (saved !== null) {
        setValue(saved);
      }
    }
  }, [restored, key]);

  // Save changes automatically, but only AFTER we have resolved the restore phase
  useEffect(() => {
    if (restored) {
      const timeout = setTimeout(() => {
        StorageService.save(`aura-app-${key}`, value);
        syncToCloud(key, value);
      }, 500); // debounce slightly
      return () => clearTimeout(timeout);
    }
  }, [value, restored, key]);

  return [value, setValue] as const;
}

// ── D1 cloud twin (2026-07-06) ───────────────────────────────────────────
// The Worker has had GET/PUT /api/spec (D1 `spec_data`) since 2026-07-05 but
// no client ever called it — spec edits died with the browser profile. This
// debounced fan-out mirrors every autosaved key to D1 so edits survive device
// switches. Fire-and-forget: local storage remains the source of truth for
// the current session; failures (e.g. the local dev server has no /api/spec)
// are silently ignored.
const pendingSync = new Map<string, ReturnType<typeof setTimeout>>();

function syncToCloud(key: string, value: unknown) {
  const existing = pendingSync.get(key);
  if (existing) clearTimeout(existing);
  pendingSync.set(key, setTimeout(() => {
    pendingSync.delete(key);
    fetch('/api/spec', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: `aura-app-${key}`, value }),
    }).catch(() => { /* offline or dev server — local copy is authoritative */ });
  }, 2000));
}
