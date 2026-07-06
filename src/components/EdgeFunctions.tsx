import { useState, useRef, useCallback, useEffect } from 'react';
import { Zap, Code2, Activity, Play, Loader2 } from 'lucide-react';

const DEFAULT_CODE = `// Runs in a real Web Worker isolate in your browser.
// Export a handler: (request) => Response-like object
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/api/fast') {
      return {
        status: 200,
        body: 'Edge Hello from ' + url.pathname,
        headers: { 'X-Runtime': 'worker-isolate' },
      };
    }
    return { status: 404, body: 'Not found: ' + url.pathname };
  }
};`;

// Worker shell: receives handler source, evaluates it in the isolate, invokes fetch()
const WORKER_SHELL = `
let handler = null;
self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'deploy') {
      const src = msg.code.replace(/export\\s+default/, 'self.__mod =');
      new Function(src)();
      handler = self.__mod;
      self.postMessage({ type: 'deployed' });
    } else if (msg.type === 'invoke') {
      const t0 = performance.now();
      const res = await handler.fetch({ url: msg.url, method: 'GET' });
      const ms = performance.now() - t0;
      self.postMessage({ type: 'result', status: res.status, body: String(res.body), headers: res.headers ?? {}, ms });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
`;

interface Invocation {
  path: string;
  status: number | null;
  body: string;
  ms: number;
  cold: boolean;
  error?: string;
}

export function EdgeFunctions() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [path, setPath] = useState('/api/fast');
  const [log, setLog] = useState<Invocation[]>([]);
  const [busy, setBusy] = useState(false);
  const [deployed, setDeployed] = useState(false);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const invoke = useCallback(() => {
    setBusy(true);
    const cold = !workerRef.current;
    const t0 = performance.now();

    const finish = (inv: Omit<Invocation, 'cold'>) => {
      setLog(l => [{ ...inv, cold }, ...l.slice(0, 9)]);
      setBusy(false);
    };

    const run = (w: Worker) => {
      w.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'deployed') {
          setDeployed(true);
          w.postMessage({ type: 'invoke', url: 'https://edge.local' + path });
        } else if (m.type === 'result') {
          finish({ path, status: m.status, body: m.body, ms: performance.now() - t0 });
        } else if (m.type === 'error') {
          finish({ path, status: null, body: '', ms: performance.now() - t0, error: m.message });
        }
      };
      w.onerror = (e) => finish({ path, status: null, body: '', ms: performance.now() - t0, error: e.message });
      w.postMessage({ type: 'deploy', code });
    };

    if (!workerRef.current) {
      const url = URL.createObjectURL(new Blob([WORKER_SHELL], { type: 'application/javascript' }));
      workerRef.current = new Worker(url);
      URL.revokeObjectURL(url);
    }
    run(workerRef.current);
  }, [code, path]);

  const redeploy = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setDeployed(false);
  }, []);

  const avgWarm = log.filter(l => !l.cold && !l.error);
  const avgMs = avgWarm.length ? avgWarm.reduce((s, l) => s + l.ms, 0) / avgWarm.length : null;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-3">
          <Zap className="text-indigo-400" /> Edge Function Runtime
        </h2>
        <span className={`text-xs font-mono px-3 py-1 rounded-full border ${
          deployed ? 'text-emerald-400 bg-emerald-400/10 border-emerald-500/20' : 'text-slate-400 bg-slate-400/10 border-slate-500/20'
        }`}>
          {deployed ? 'ISOLATE WARM' : 'COLD'}
        </span>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8">
        <div className="flex flex-col md:flex-row gap-6">
          <div className="flex-1 bg-slate-950 border border-slate-800 rounded p-4 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-slate-200 flex items-center gap-2">
                <Code2 className="w-4 h-4 text-indigo-400" /> Handler Code (editable, actually executed)
              </h3>
              <button onClick={redeploy} className="text-xs text-slate-500 hover:text-slate-300 font-mono">kill isolate</button>
            </div>
            <textarea
              value={code}
              onChange={e => { setCode(e.target.value); setDeployed(false); }}
              spellCheck={false}
              rows={14}
              className="flex-1 bg-transparent text-xs font-mono text-slate-300 outline-none resize-none leading-relaxed"
            />
            <div className="flex gap-2 mt-3 pt-3 border-t border-slate-800">
              <input
                value={path}
                onChange={e => setPath(e.target.value)}
                className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-xs font-mono text-slate-300 focus:outline-none focus:border-indigo-500"
              />
              <button
                onClick={invoke}
                disabled={busy}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold rounded flex items-center gap-2 transition-colors"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Invoke
              </button>
            </div>
          </div>

          <div className="w-full md:w-72 space-y-4">
            <div className="bg-slate-950 border border-slate-800 rounded p-4">
              <div className="text-xs text-slate-500 mb-1">Avg Warm Latency (measured)</div>
              <div className="text-2xl font-bold text-emerald-400">{avgMs !== null ? `${avgMs.toFixed(1)}ms` : '—'}</div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded p-4 max-h-72 overflow-y-auto">
              <div className="text-xs text-slate-500 mb-2 flex items-center gap-1.5">
                <Activity className="w-3 h-3" /> Invocation Log
              </div>
              {log.length === 0 && <p className="text-xs text-slate-600">No invocations yet.</p>}
              <div className="space-y-2">
                {log.map((inv, i) => (
                  <div key={i} className="text-xs font-mono border-b border-slate-800/60 pb-2">
                    <div className="flex justify-between">
                      <span className="text-slate-300 truncate">{inv.path}</span>
                      <span className={inv.error ? 'text-rose-400' : inv.status === 200 ? 'text-emerald-400' : 'text-amber-400'}>
                        {inv.error ? 'ERR' : inv.status}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-500 mt-0.5">
                      <span className="truncate max-w-[140px]" title={inv.error ?? inv.body}>{inv.error ?? inv.body}</span>
                      <span>{inv.ms.toFixed(1)}ms{inv.cold ? ' ❄' : ''}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
