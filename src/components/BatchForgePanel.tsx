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
        const result = await forgeModel(prompts[i], { qa: !fastMode, detail: !fastMode }, stage => patch(i, { status: stage }));
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
        className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors shadow-lg ${open ? 'bg-indigo-500 hover:bg-indigo-400 text-white' : 'bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200'}`}
      >
        <Layers className="w-4 h-4" />
      </button>

      {open && (
        // w-96 fixed + viewport-relative cap: the absolute parent is the narrow
        // button row, so a percentage max-width would crush the panel.
        <div className="absolute bottom-12 left-0 z-20 w-96 max-w-[80vw] bg-slate-900/90 backdrop-blur border border-slate-700 rounded-lg p-4 shadow-xl space-y-3">
          <h3 className="text-sm font-semibold text-slate-200 border-b border-slate-800 pb-2 flex items-center gap-2">
            <Layers className="w-4 h-4" /> Batch Forge
          </h3>

          <div className="space-y-2">
            <button
              onClick={() => setFastMode(f => !f)}
              className="flex items-center gap-2 cursor-pointer group w-full text-left"
              title="Skip the QA inspection round — half the AI calls per model"
            >
              <div className={`w-8 h-4 rounded-full flex items-center p-0.5 transition-colors ${fastMode ? 'bg-indigo-500' : 'bg-slate-700'}`}>
                <div className={`w-3 h-3 bg-white rounded-full transition-transform ${fastMode ? 'translate-x-4' : 'translate-x-0'}`} />
              </div>
              <span className="text-xs text-slate-300 group-hover:text-white transition-colors">Fast mode (skip QA)</span>
            </button>
          </div>

          <textarea
            value={promptsText}
            onChange={e => setPromptsText(e.target.value)}
            placeholder={'One model per line…\na desk fan with spinning blades\na wooden water wheel\na grandfather clock with swinging pendulum'}
            rows={3}
            disabled={running}
            className="w-full bg-slate-950/80 backdrop-blur border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 disabled:opacity-50 resize-y"
          />

          <div className="flex gap-2">
            {!running ? (
              <button
                onClick={runBatch}
                disabled={!promptsText.trim()}
                title="Forge every prompt and save each model to the library"
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/40 disabled:cursor-not-allowed text-white rounded text-xs transition-colors"
              >
                <Play className="w-3.5 h-3.5" /> Forge all
              </button>
            ) : (
              <button
                onClick={() => { stopRef.current = true; }}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded text-xs transition-colors"
              >
                <Square className="w-3.5 h-3.5" /> Stop after current
              </button>
            )}
            <button
              onClick={refreshGallery}
              title="Refresh library"
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded flex items-center justify-center transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {items.length > 0 && (
            <div className="space-y-1 max-h-32 overflow-y-auto pr-1 text-[11px] font-mono">
              {items.map((it, i) => (
                <div key={i} className="flex justify-between gap-2">
                  <span className={`shrink-0 ${statusColor[it.status] ?? 'text-slate-400'}`}>{it.status}</span>
                  <span className="flex-1 truncate text-right text-slate-300" title={`${it.prompt}${it.detail ? ` — ${it.detail}` : ''}`}>
                    {it.detail || it.prompt}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="pt-3 border-t border-slate-800 space-y-2">
            <label className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
              <FolderOpen className="w-3.5 h-3.5" /> Library ({gallery.length})
            </label>
            {gallery.length === 0 ? (
              <p className="text-[11px] font-mono text-slate-500">Nothing saved yet — forge a batch and it lands here.</p>
            ) : (
              <div className="space-y-1 max-h-36 overflow-y-auto pr-1 text-[11px] font-mono">
                {gallery.map(entry => (
                  <div key={entry.jsonKey} className="flex justify-between items-center gap-2">
                    <button
                      onClick={() => loadSaved(entry)}
                      disabled={loadingKey === entry.jsonKey}
                      className="flex-1 text-left truncate text-slate-300 hover:text-indigo-300 transition-colors disabled:opacity-50"
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
                      <Download className="w-3.5 h-3.5" />
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
