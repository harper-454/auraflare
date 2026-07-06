import { useState, useCallback } from 'react';
import { ArrowRightLeft, Zap, Loader2, PlayCircle, Activity } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

interface Route {
  method: 'GET' | 'POST';
  path: string;
  build: () => RequestInit & { url: string };
  note: string;
}

// The app's actual Express endpoints — every probe below is a real HTTP request
const ROUTES: Route[] = [
  {
    method: 'GET', path: '/api/fs/read?path=package.json', note: 'file read',
    build: () => ({ url: '/api/fs/read?path=package.json', method: 'GET' }),
  },
  {
    method: 'POST', path: '/api/exec (echo)', note: 'shell exec',
    build: () => ({
      url: '/api/exec', method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'echo gateway-probe', cwd: '' }),
    }),
  },
  {
    method: 'GET', path: '/api/fs/read?path=../etc (traversal)', note: 'WAF-style guard test — should be 403',
    build: () => ({ url: '/api/fs/read?path=' + encodeURIComponent('../../etc/passwd'), method: 'GET' }),
  },
];

interface ProbeResult {
  path: string;
  status: number | 'ERR';
  ms: number;
  ok: boolean;
}

export function ApiGateway() {
  const [results, setResults] = useState<Record<string, ProbeResult>>({});
  const [history, setHistory] = useState<{ t: string; ms: number }[]>([]);
  const [busy, setBusy] = useState(false);

  const probeAll = useCallback(async () => {
    setBusy(true);
    for (const route of ROUTES) {
      const { url, ...init } = route.build();
      const start = performance.now();
      try {
        const res = await fetch(url, init);
        const ms = Math.round(performance.now() - start);
        // The traversal probe is "ok" when the server correctly blocks it
        const expected403 = route.path.includes('traversal');
        setResults(r => ({ ...r, [route.path]: { path: route.path, status: res.status, ms, ok: expected403 ? res.status === 403 : res.ok } }));
        setHistory(h => [...h.slice(-19), { t: new Date().toLocaleTimeString(), ms }]);
      } catch {
        setResults(r => ({ ...r, [route.path]: { path: route.path, status: 'ERR', ms: Math.round(performance.now() - start), ok: false } }));
      }
    }
    setBusy(false);
  }, []);

  const tooltipStyle = { backgroundColor: '#10131a', border: '1px solid #242a35', borderRadius: 8, color: '#e2e6ee', fontSize: 12 };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-3">
          <ArrowRightLeft className="text-indigo-400" /> API Gateway Probe
        </h2>
        <span className="text-xs font-mono text-emerald-400 bg-emerald-400/10 px-3 py-1 rounded-full border border-emerald-500/20">
          REAL REQUESTS · LOCAL SERVER
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-8">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-slate-200 flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-400" /> Live Endpoint Health
            </h3>
            <button
              onClick={probeAll}
              disabled={busy}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded text-sm font-medium transition-colors flex items-center gap-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
              Probe All
            </button>
          </div>
          <div className="space-y-4">
            {ROUTES.map(route => {
              const r = results[route.path];
              return (
                <div key={route.path} className="p-4 bg-slate-950 border border-slate-700 rounded-lg flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-mono text-sm text-slate-300 truncate">
                      <span className={`font-bold mr-2 ${route.method === 'GET' ? 'text-emerald-400' : 'text-indigo-400'}`}>{route.method}</span>
                      {route.path}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">{route.note}</div>
                  </div>
                  {r ? (
                    <div className={`text-xs font-mono px-2 py-1 rounded border shrink-0 ${
                      r.ok ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-rose-400 border-rose-500/30 bg-rose-500/10'
                    }`}>
                      {r.status} · {r.ms}ms
                    </div>
                  ) : (
                    <span className="text-xs text-slate-600 shrink-0">not probed</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4" /> Latency (measured)
          </h3>
          {history.length === 0 ? (
            <p className="text-xs text-slate-500 leading-relaxed">
              Run a probe to record real round-trip latency against the local Express gateway.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="#242a35" />
                <XAxis dataKey="t" hide />
                <YAxis stroke="#5c6675" fontSize={10} unit="ms" width={45} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="ms" stroke="#7b8cfa" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
