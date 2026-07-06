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
      }, 500); // debounce slightly
      return () => clearTimeout(timeout);
    }
  }, [value, restored, key]);

  return [value, setValue] as const;
}
