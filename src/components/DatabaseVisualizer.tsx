import { useState, useCallback, useMemo } from 'react';
import { Database, TableProperties, RefreshCw, Trash2, ChevronRight, ChevronDown } from 'lucide-react';

interface StoreEntry {
  key: string;
  bytes: number;
  value: unknown;
  parseError: boolean;
}

function readStore(): StoreEntry[] {
  return Object.keys(localStorage)
    .sort()
    .map(key => {
      const raw = localStorage.getItem(key) ?? '';
      let value: unknown = raw;
      let parseError = false;
      try { value = JSON.parse(raw); } catch { parseError = true; }
      return { key, bytes: raw.length * 2, value, parseError };
    });
}

function typeOf(v: unknown): string {
  if (Array.isArray(v)) return `array[${v.length}]`;
  if (v === null) return 'null';
  return typeof v;
}

export function DatabaseVisualizer() {
  // Real datastore: the browser's localStorage, which this app actually persists to
  const [entries, setEntries] = useState<StoreEntry[]>(readStore);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const refresh = useCallback(() => setEntries(readStore()), []);

  const remove = useCallback((key: string) => {
    if (!confirm(`Delete key "${key}" from localStorage? This is a real delete.`)) return;
    localStorage.removeItem(key);
    setEntries(readStore());
  }, []);

  const filtered = useMemo(
    () => entries.filter(e => e.key.toLowerCase().includes(filter.toLowerCase())),
    [entries, filter]
  );
  const totalBytes = entries.reduce((s, e) => s + e.bytes, 0);
  const appEntries = entries.filter(e => e.key.startsWith('aura-app-')).length;

  return (
    <div className="space-y-6 max-w-4xl mx-auto h-full flex flex-col">
      <div className="flex items-center justify-between shrink-0">
        <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-3">
          <Database className="text-indigo-400" /> Local Datastore
        </h2>
        <span className="text-xs font-mono text-emerald-400 bg-emerald-400/10 px-3 py-1 rounded-full border border-emerald-500/20">
          LIVE · localStorage
        </span>
      </div>

      <div className="grid grid-cols-3 gap-4 shrink-0">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="text-xl font-bold text-slate-100">{entries.length}</div>
          <div className="text-xs text-slate-500">Total Keys</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="text-xl font-bold text-slate-100">{appEntries}</div>
          <div className="text-xs text-slate-500">Aura App Keys</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="text-xl font-bold text-slate-100">{(totalBytes / 1024).toFixed(1)} KB</div>
          <div className="text-xs text-slate-500">Stored (approx)</div>
        </div>
      </div>

      <div className="flex gap-3 shrink-0">
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter keys…"
          className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
        />
        <button
          onClick={refresh}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col min-h-0">
        <div className="grid grid-cols-[1fr_100px_90px_40px] gap-2 px-4 py-2.5 border-b border-slate-800 text-xs font-semibold text-slate-400 uppercase tracking-wider shrink-0">
          <span className="flex items-center gap-2"><TableProperties className="w-3.5 h-3.5" /> Key</span>
          <span>Type</span>
          <span>Size</span>
          <span />
        </div>
        <div className="overflow-y-auto divide-y divide-slate-800/60">
          {filtered.length === 0 && (
            <div className="p-8 text-center text-sm text-slate-500">No keys match. This inspector reads your actual browser storage.</div>
          )}
          {filtered.map(e => (
            <div key={e.key}>
              <button
                onClick={() => setExpanded(expanded === e.key ? null : e.key)}
                className="w-full grid grid-cols-[1fr_100px_90px_40px] gap-2 px-4 py-2.5 text-left hover:bg-slate-800/40 transition-colors items-center"
              >
                <span className="text-sm font-mono text-slate-200 truncate flex items-center gap-1.5">
                  {expanded === e.key ? <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
                  {e.key}
                </span>
                <span className="text-xs font-mono text-indigo-400">{e.parseError ? 'string' : typeOf(e.value)}</span>
                <span className="text-xs font-mono text-slate-500">{(e.bytes / 1024).toFixed(2)} KB</span>
                <span
                  role="button"
                  onClick={ev => { ev.stopPropagation(); remove(e.key); }}
                  className="text-slate-600 hover:text-rose-400 transition-colors cursor-pointer"
                  title="Delete key"
                >
                  <Trash2 className="w-4 h-4" />
                </span>
              </button>
              {expanded === e.key && (
                <pre className="px-6 pb-4 pt-1 text-xs font-mono text-slate-400 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap break-all">
                  {e.parseError ? String(e.value) : JSON.stringify(e.value, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
