import { useState, useEffect, useCallback, useMemo } from 'react';
import { History, Camera, RotateCcw, Diff, ChevronRight, ChevronDown } from 'lucide-react';

/**
 * Real time travel: periodically snapshots the app's actual persisted state
 * (every aura-app-* localStorage key), diffs snapshots, and can genuinely
 * rewind the application to any captured moment.
 */

interface Snapshot {
  id: string;
  ts: number;
  auto: boolean;
  data: Record<string, string>;
}

const SNAP_KEY = 'aura-tt-snapshots';
const MAX_SNAPSHOTS = 30;

function captureState(): Record<string, string> {
  const data: Record<string, string> = {};
  Object.keys(localStorage)
    .filter(k => k.startsWith('aura-app-'))
    .forEach(k => { data[k] = localStorage.getItem(k) ?? ''; });
  return data;
}

function stateHash(data: Record<string, string>): string {
  let h = 0;
  for (const [k, v] of Object.entries(data)) {
    const s = k + v;
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  return String(h);
}

function loadSnapshots(): Snapshot[] {
  try { return JSON.parse(localStorage.getItem(SNAP_KEY) ?? '[]'); } catch { return []; }
}

function diffStates(a: Record<string, string>, b: Record<string, string>) {
  const changed: string[] = [], added: string[] = [], removed: string[] = [];
  for (const k of Object.keys(b)) {
    if (!(k in a)) added.push(k);
    else if (a[k] !== b[k]) changed.push(k);
  }
  for (const k of Object.keys(a)) if (!(k in b)) removed.push(k);
  return { changed, added, removed, total: changed.length + added.length + removed.length };
}

export function TimeTravelDebugger() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>(loadSnapshots);
  const [selected, setSelected] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const persist = useCallback((snaps: Snapshot[]) => {
    const trimmed = snaps.slice(-MAX_SNAPSHOTS);
    setSnapshots(trimmed);
    try { localStorage.setItem(SNAP_KEY, JSON.stringify(trimmed)); } catch { /* quota */ }
  }, []);

  const takeSnapshot = useCallback((auto: boolean) => {
    const data = captureState();
    setSnapshots(prev => {
      const last = prev[prev.length - 1];
      if (auto && last && stateHash(last.data) === stateHash(data)) return prev; // unchanged — skip
      const next = [...prev.slice(-(MAX_SNAPSHOTS - 1)), {
        id: crypto.randomUUID(), ts: Date.now(), auto, data,
      }];
      try { localStorage.setItem(SNAP_KEY, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  }, []);

  // Auto-capture every 10s when state actually changed
  useEffect(() => {
    takeSnapshot(true);
    const id = setInterval(() => takeSnapshot(true), 10000);
    return () => clearInterval(id);
  }, [takeSnapshot]);

  const rewind = useCallback((snap: Snapshot) => {
    if (!confirm(`Rewind the app to ${new Date(snap.ts).toLocaleTimeString()}? Current unsaved state will be replaced (a safety snapshot is taken first).`)) return;
    takeSnapshot(false); // safety point
    Object.keys(localStorage)
      .filter(k => k.startsWith('aura-app-'))
      .forEach(k => localStorage.removeItem(k));
    Object.entries(snap.data).forEach(([k, v]) => localStorage.setItem(k, v));
    location.reload();
  }, [takeSnapshot]);

  const current = useMemo(() => captureState(), [snapshots]);
  const selectedSnap = snapshots.find(s => s.id === selected) ?? null;
  const diff = selectedSnap ? diffStates(selectedSnap.data, current) : null;

  const fmtBytes = (data: Record<string, string>) =>
    (Object.values(data).reduce((s, v) => s + v.length * 2, 0) / 1024).toFixed(1);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-3">
          <History className="text-indigo-400" /> Time Travel Debugger
        </h2>
        <span className="text-xs font-mono text-emerald-400 bg-emerald-400/10 px-3 py-1 rounded-full border border-emerald-500/20">
          REAL STATE · {snapshots.length} SNAPSHOTS
        </span>
      </div>

      <p className="text-sm text-slate-400">
        Captures your actual persisted app state (tasks, requirements, forms, settings) every 10 seconds when it changes.
        Rewinding really restores it — this is not a visualization.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col max-h-[520px]">
          <div className="flex items-center justify-between mb-4 shrink-0">
            <h3 className="text-sm font-semibold text-slate-300">Timeline</h3>
            <button
              onClick={() => takeSnapshot(false)}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-bold flex items-center gap-1.5 transition-colors"
            >
              <Camera className="w-3.5 h-3.5" /> Capture Now
            </button>
          </div>
          <div className="overflow-y-auto space-y-1.5">
            {snapshots.length === 0 && <p className="text-xs text-slate-500">No snapshots yet — interact with the app.</p>}
            {[...snapshots].reverse().map((s, ri) => {
              const idx = snapshots.length - 1 - ri;
              const prev = snapshots[idx - 1];
              const d = prev ? diffStates(prev.data, s.data).total : Object.keys(s.data).length;
              return (
                <button
                  key={s.id}
                  onClick={() => setSelected(selected === s.id ? null : s.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    selected === s.id ? 'border-indigo-500/60 bg-indigo-500/10' : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-slate-200">{new Date(s.ts).toLocaleTimeString()}</span>
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full border ${
                      s.auto ? 'text-slate-500 border-slate-700' : 'text-indigo-400 border-indigo-500/40 bg-indigo-500/10'
                    }`}>{s.auto ? 'auto' : 'manual'}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    {Object.keys(s.data).length} keys · {fmtBytes(s.data)} KB · {d} change{d === 1 ? '' : 's'} vs previous
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col max-h-[520px]">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2 shrink-0">
            <Diff className="w-4 h-4" /> Diff vs Now
          </h3>
          {!selectedSnap ? (
            <p className="text-xs text-slate-500">Select a snapshot to see what changed since then — and to rewind.</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 mb-4 shrink-0">
                <div className="bg-slate-950 border border-slate-800 rounded p-2 text-center">
                  <div className="text-lg font-bold text-amber-400">{diff!.changed.length}</div>
                  <div className="text-[9px] text-slate-500 uppercase">Changed</div>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded p-2 text-center">
                  <div className="text-lg font-bold text-emerald-400">{diff!.added.length}</div>
                  <div className="text-[9px] text-slate-500 uppercase">Added since</div>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded p-2 text-center">
                  <div className="text-lg font-bold text-rose-400">{diff!.removed.length}</div>
                  <div className="text-[9px] text-slate-500 uppercase">Removed since</div>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1 mb-4">
                {[
                  ...diff!.changed.map(k => ({ k, tag: '±', cls: 'text-amber-400' })),
                  ...diff!.added.map(k => ({ k, tag: '+', cls: 'text-emerald-400' })),
                  ...diff!.removed.map(k => ({ k, tag: '−', cls: 'text-rose-400' })),
                ].map(({ k, tag, cls }) => (
                  <div key={k}>
                    <button
                      onClick={() => setExpandedKey(expandedKey === k ? null : k)}
                      className="w-full flex items-center gap-2 p-2 bg-slate-950 border border-slate-800 rounded text-left hover:border-slate-700"
                    >
                      {expandedKey === k ? <ChevronDown className="w-3 h-3 text-slate-600" /> : <ChevronRight className="w-3 h-3 text-slate-600" />}
                      <span className={`font-mono text-xs font-bold ${cls}`}>{tag}</span>
                      <span className="font-mono text-[10px] text-slate-300 truncate">{k.replace('aura-app-', '')}</span>
                    </button>
                    {expandedKey === k && (
                      <pre className="mt-1 p-2 bg-slate-950 border border-slate-800 rounded text-[9px] font-mono text-slate-500 max-h-28 overflow-auto whitespace-pre-wrap break-all">
                        then: {selectedSnap.data[k]?.slice(0, 400) ?? '(absent)'}
                        {'\n'}now:  {current[k]?.slice(0, 400) ?? '(absent)'}
                      </pre>
                    )}
                  </div>
                ))}
                {diff!.total === 0 && <p className="text-xs text-slate-500">Identical to current state.</p>}
              </div>
              <button
                onClick={() => rewind(selectedSnap)}
                className="shrink-0 w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-colors"
              >
                <RotateCcw className="w-4 h-4" /> Rewind App To This Moment
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
