/**
 * Batch Forge — queue many prompts, walk away, come back to a library.
 *
 * Runs the full grounded pipeline per prompt unattended (references → compose
 * → compile → optional QA) and persists every artifact to the media gallery
 * (R2 in prod, disk in dev): animated .glb + snapshot + program JSON + QA
 * report. Saved models reload through their stored program with ZERO AI calls.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Layers, Play, Square, RefreshCw, Download, FolderOpen } from 'lucide-react';
import {
  forgeModel, saveModelArtifacts, listGalleryModels, loadGalleryModel,
  type ForgeResult, type ForgeStage, type GalleryEntry,
} from '../lib/forge-pipeline';

interface BatchItem {
  prompt: string;
  status: 'queued' | ForgeStage | 'saved' | 'failed';
  detail?: string;
}

export function BatchForgePanel({ onModelReady }: {
  onModelReady: (result: ForgeResult, prompt: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [promptsText, setPromptsText] = useState('');
  const [fastMode, setFastMode] = useState(true);
  const [running, setRunning] = useState(false);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [gallery, setGallery] = useState<GalleryEntry[]>([]);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const stopRef = useRef(false);

  const refreshGallery = useCallback(async () => {
    setGallery(await listGalleryModels().catch(() => []));
  }, []);

  useEffect(() => { if (open) refreshGallery(); }, [open, refreshGallery]);

  const runBatch = useCallback(async () => {
    const prompts = promptsText.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 12);
    if (!prompts.length || running) return;
    stopRef.current = false;
    setRunning(true);
    setItems(prompts.map(prompt => ({ prompt, status: 'queued' })));

    const patch = (i: number, p: Partial<BatchItem>) =>
      setItems(prev => prev.map((it, j) => (j === i ? { ...it, ...p } : it)));

    for (let i = 0; i < prompts.length; i++) {
      if (stopRef.current) { patch(i, { status: 'failed', detail: 'stopped' }); continue; }
      try {
        const result = await forgeModel(prompts[i], { qa: !fastMode }, stage => patch(i, { status: stage }));
        onModelReady(result, prompts[i]);
        let saveNote = '';
        try { await saveModelArtifacts(prompts[i], result); } catch { saveNote = ' · SAVE FAILED'; }
        patch(i, {
          status: 'saved',
          detail: `${(result.triangles / 1000).toFixed(1)}k tris${result.parts ? ` · ${result.parts} parts` : ''}${result.moving ? ` · ${result.moving} moving` : ''}${result.qa === 'revised' ? ' · QA revised' : ''}${result.source === 'cached' ? ' · from cache' : ''}${saveNote}`,
        });
      } catch (e: any) {
        patch(i, { status: 'failed', detail: String(e?.message ?? e).slice(0, 60) });
      }
    }
    setRunning(false);
    refreshGallery();
  }, [promptsText, running, fastMode, onModelReady, refreshGallery]);

  const loadSaved = useCallback(async (entry: GalleryEntry) => {
    setLoadingKey(entry.jsonKey);
    try {
      const loaded = await loadGalleryModel(entry.jsonKey);
      if (loaded) onModelReady(loaded.result, loaded.prompt);
    } finally {
      setLoadingKey(null);
    }
  }, [onModelReady]);

  const statusColor: Record<string, string> = {
    queued: 'text-slate-500', referencing: 'text-sky-300', composing: 'text-indigo-300',
    compiling: 'text-violet-300', inspecting: 'text-cyan-300', exporting: 'text-slate-300',
    cache: 'text-emerald-300', saved: 'text-emerald-400', failed: 'text-rose-400',
  };

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        title="Batch Forge — queue prompts, get a saved model library"
        className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors shadow-lg ${open ? 'bg-amber-500 hover:bg-amber-400 text-slate-950' : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'}`}
      >
        <Layers className="w-4 h-4" />
      </button>

      {open && (
        <div className="absolute bottom-16 left-4 z-20 w-[26rem] max-w-[calc(100%-2rem)] bg-slate-900/95 backdrop-blur border border-slate-700 rounded-lg shadow-2xl p-3 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-200 flex items-center gap-1.5"><Layers className="w-3.5 h-3.5" /> Batch Forge</h3>
            <label className="flex items-center gap-1.5 text-[10px] text-slate-400 cursor-pointer" title="Skip the QA inspection round — half the AI calls per model">
              <input type="checkbox" checked={fastMode} onChange={e => setFastMode(e.target.checked)} className="accent-amber-500" />
              fast mode
            </label>
          </div>

          <textarea
            value={promptsText}
            onChange={e => setPromptsText(e.target.value)}
            placeholder={'One model per line…\na desk fan with spinning blades\na wooden water wheel\na grandfather clock with swinging pendulum'}
            rows={3}
            disabled={running}
            className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-amber-500 disabled:opacity-60 resize-y"
          />

          <div className="flex gap-2">
            {!running ? (
              <button
                onClick={runBatch}
                disabled={!promptsText.trim()}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:bg-amber-600/40 disabled:cursor-not-allowed text-white rounded text-xs font-medium transition-colors"
              >
                <Play className="w-3 h-3" /> Forge all
              </button>
            ) : (
              <button
                onClick={() => { stopRef.current = true; }}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded text-xs font-medium transition-colors"
              >
                <Square className="w-3 h-3" /> Stop after current
              </button>
            )}
            <button
              onClick={refreshGallery}
              title="Refresh library"
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded text-xs transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>

          {items.length > 0 && (
            <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
              {items.map((it, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px] font-mono">
                  <span className={`shrink-0 w-20 uppercase ${statusColor[it.status] ?? 'text-slate-400'}`}>{it.status}</span>
                  <span className="flex-1 truncate text-slate-300" title={it.prompt}>{it.prompt}</span>
                  {it.detail && <span className="shrink-0 text-slate-500">{it.detail}</span>}
                </div>
              ))}
            </div>
          )}

          <div className="pt-2 border-t border-slate-800/60">
            <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1"><FolderOpen className="w-3 h-3" /> Library ({gallery.length})</h4>
            {gallery.length === 0 ? (
              <p className="text-[10px] text-slate-600">Nothing saved yet — forge a batch and it lands here.</p>
            ) : (
              <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                {gallery.map(entry => (
                  <div key={entry.jsonKey} className="flex items-center gap-2 text-[11px]">
                    <button
                      onClick={() => loadSaved(entry)}
                      disabled={loadingKey === entry.jsonKey}
                      className="flex-1 text-left truncate text-slate-300 hover:text-amber-300 transition-colors disabled:opacity-50"
                      title="Load (recompiles from the saved program — no AI calls)"
                    >
                      {loadingKey === entry.jsonKey ? 'loading…' : entry.name}
                    </button>
                    <a
                      href={`/api/media/${encodeURIComponent(entry.glbKey)}`}
                      download={`${entry.name.replace(/\W+/g, '-')}.glb`}
                      className="shrink-0 text-slate-500 hover:text-slate-200 transition-colors"
                      title="Download animated .glb"
                    >
                      <Download className="w-3 h-3" />
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
