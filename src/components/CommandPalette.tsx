import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Command, CornerDownLeft, Moon, Trash2, Download, Shuffle } from 'lucide-react';
import { SectionId } from '../types';
import { StorageService } from '../lib/storage';
import { SECTIONS as REGISTRY_SECTIONS } from '../sections';

interface PaletteEntry {
  id: string;
  label: string;
  hint: string;
  kind: 'section' | 'action';
  run: () => void;
}

// Re-exported for FloatingAssistant (and anything else that needs the list).
// Single source of truth: src/sections.ts
export const SECTIONS: { id: SectionId; label: string }[] = REGISTRY_SECTIONS.map(s => ({
  id: s.id,
  label: s.label,
}));

export function CommandPalette({ onNavigate }: { onNavigate: (s: SectionId) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const exportAll = useCallback(() => {
    const data: Record<string, unknown> = {};
    Object.keys(localStorage)
      .filter(k => k.startsWith('aura-app-'))
      .forEach(k => { try { data[k] = JSON.parse(localStorage.getItem(k) ?? 'null'); } catch { data[k] = localStorage.getItem(k); } });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aura-project-export.json';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const entries = useMemo<PaletteEntry[]>(() => [
    ...SECTIONS.map(s => ({
      id: s.id,
      label: s.label,
      hint: 'Go to section',
      kind: 'section' as const,
      run: () => onNavigate(s.id),
    })),
    {
      id: 'action-theme', label: 'Toggle light / dark theme', hint: 'Action', kind: 'action',
      run: () => document.documentElement.classList.toggle('light-theme'),
    },
    {
      id: 'action-export', label: 'Export all project data (JSON)', hint: 'Action', kind: 'action',
      run: exportAll,
    },
    {
      id: 'action-clear', label: 'Clear all saved project data…', hint: 'Action · destructive', kind: 'action',
      run: () => {
        if (confirm('Really clear all locally saved project data? This is a real delete.')) {
          StorageService.clearAll();
          location.reload();
        }
      },
    },
    {
      id: 'action-random', label: 'Beam me somewhere random', hint: 'Action', kind: 'action',
      run: () => onNavigate(SECTIONS[Math.floor(Math.random() * SECTIONS.length)].id),
    },
  ], [onNavigate, exportAll]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(e => e.label.toLowerCase().includes(q) || e.id.includes(q));
  }, [entries, query]);

  // Global hotkey
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
        setQuery('');
        setCursor(0);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 10); }, [open]);
  useEffect(() => { setCursor(0); }, [query]);
  useEffect(() => {
    listRef.current?.children[cursor]?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const select = (entry: PaletteEntry) => {
    setOpen(false);
    entry.run();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-slate-950/60 backdrop-blur-sm flex items-start justify-center pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-xl shadow-2xl shadow-indigo-500/10 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
          <Command className="w-4 h-4 text-indigo-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(filtered.length - 1, c + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(0, c - 1)); }
              else if (e.key === 'Enter' && filtered[cursor]) select(filtered[cursor]);
            }}
            placeholder="Jump to any section or run an action…"
            className="flex-1 bg-transparent text-sm text-slate-200 placeholder:text-slate-500 outline-none"
          />
          <kbd className="text-[9px] font-mono text-slate-500 border border-slate-700 rounded px-1.5 py-0.5">ESC</kbd>
        </div>
        <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 && <div className="px-4 py-6 text-center text-xs text-slate-500">No matches.</div>}
          {filtered.map((e, i) => (
            <button
              key={e.id}
              onClick={() => select(e)}
              onMouseEnter={() => setCursor(i)}
              className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                i === cursor ? 'bg-indigo-500/15' : 'hover:bg-slate-800/50'
              }`}
            >
              <span className="shrink-0 text-slate-500">
                {e.id === 'action-theme' ? <Moon className="w-3.5 h-3.5" />
                  : e.id === 'action-clear' ? <Trash2 className="w-3.5 h-3.5 text-rose-400/70" />
                  : e.id === 'action-export' ? <Download className="w-3.5 h-3.5" />
                  : e.id === 'action-random' ? <Shuffle className="w-3.5 h-3.5" />
                  : <CornerDownLeft className="w-3.5 h-3.5" />}
              </span>
              <span className={`text-sm flex-1 truncate ${i === cursor ? 'text-slate-100' : 'text-slate-300'}`}>{e.label}</span>
              <span className="text-[9px] font-mono text-slate-600 shrink-0">{e.hint}</span>
            </button>
          ))}
        </div>
        <div className="px-4 py-2 border-t border-slate-800 text-[9px] font-mono text-slate-600 flex gap-4">
          <span>↑↓ navigate</span><span>↵ select</span><span>ctrl+K toggle</span>
        </div>
      </div>
    </div>
  );
}
