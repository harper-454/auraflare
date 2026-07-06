import { useState, useCallback, useEffect } from 'react';
import { CloudLightning, Globe, Server, Loader2, RefreshCw, Wifi } from 'lucide-react';
import { motion } from 'motion/react';

interface TraceData {
  [key: string]: string;
}

interface EdgeProbe {
  host: string;
  label: string;
  ms: number | null;
  status: 'idle' | 'probing' | 'done' | 'error';
}

// Real Cloudflare-fronted hosts; latency is measured from your browser
const PROBE_HOSTS: Omit<EdgeProbe, 'ms' | 'status'>[] = [
  { host: 'https://www.cloudflare.com/cdn-cgi/trace', label: 'Cloudflare Core' },
  { host: 'https://cloudflare-dns.com/cdn-cgi/trace', label: '1.1.1.1 DNS Edge' },
  { host: 'https://workers.cloudflare.com/cdn-cgi/trace', label: 'Workers Platform' },
];

const TRACE_FIELDS: { key: string; label: string }[] = [
  { key: 'colo', label: 'Edge Colo (IATA)' },
  { key: 'loc', label: 'Country' },
  { key: 'ip', label: 'Your Public IP' },
  { key: 'http', label: 'HTTP Version' },
  { key: 'tls', label: 'TLS Version' },
  { key: 'warp', label: 'WARP' },
  { key: 'fl', label: 'Cloudflare FL' },
  { key: 'visit_scheme', label: 'Scheme' },
];

export const CloudflareEdgeMatrix = () => {
  const [trace, setTrace] = useState<TraceData | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [probes, setProbes] = useState<EdgeProbe[]>(PROBE_HOSTS.map(p => ({ ...p, ms: null, status: 'idle' })));
  const [loading, setLoading] = useState(false);

  // Server-side trace via Node fetch (avoids browser CORS), so we get the full colo report
  const fetchTrace = useCallback(async () => {
    setLoading(true);
    setTraceError(null);
    try {
      const script = `fetch('https://www.cloudflare.com/cdn-cgi/trace').then(r=>r.text()).then(t=>console.log(t)).catch(e=>{console.error(e.message);process.exit(1)});`;
      const b64 = btoa(script);
      const res = await fetch('/api/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: `node -e "eval(Buffer.from('${b64}','base64').toString())"`, cwd: '' }),
      });
      const data = await res.json();
      if (data.stdout) {
        const parsed: TraceData = {};
        data.stdout.trim().split('\n').forEach((line: string) => {
          const [k, ...v] = line.split('=');
          if (k) parsed[k.trim()] = v.join('=').trim();
        });
        setTrace(parsed);
      } else {
        setTraceError(data.error || data.stderr || 'No response — is the dev server running?');
      }
    } catch (e: any) {
      setTraceError(e.message);
    }
    setLoading(false);
  }, []);

  // Browser-side latency measurement (no-cors: opaque response, but timing is real)
  const runProbes = useCallback(async () => {
    for (let i = 0; i < PROBE_HOSTS.length; i++) {
      setProbes(p => p.map((pr, j) => (j === i ? { ...pr, status: 'probing' } : pr)));
      const start = performance.now();
      try {
        await fetch(PROBE_HOSTS[i].host, { mode: 'no-cors', cache: 'no-store' });
        const ms = Math.round(performance.now() - start);
        setProbes(p => p.map((pr, j) => (j === i ? { ...pr, ms, status: 'done' } : pr)));
      } catch {
        setProbes(p => p.map((pr, j) => (j === i ? { ...pr, ms: null, status: 'error' } : pr)));
      }
    }
  }, []);

  useEffect(() => { fetchTrace(); runProbes(); }, [fetchTrace, runProbes]);

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/50 backdrop-blur z-10 sticky top-0 rounded-t-xl">
        <h2 className="text-lg font-bold text-slate-100 flex items-center gap-3">
          <CloudLightning className="text-amber-400" /> Cloudflare Edge Matrix
        </h2>
        <button
          onClick={() => { fetchTrace(); runProbes(); }}
          disabled={loading}
          className="flex items-center gap-2 text-xs font-mono text-emerald-400 bg-emerald-400/10 px-3 py-1.5 rounded-full border border-emerald-500/20 hover:bg-emerald-400/20 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          LIVE TRACE
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 md:p-10 space-y-10">
        <div>
          <h3 className="text-xl font-bold text-slate-200 mb-4 flex items-center gap-2">
            <Globe className="text-indigo-400" /> Your Edge Connection (cdn-cgi/trace)
          </h3>
          {traceError && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-lg text-sm text-rose-400 font-mono mb-4">{traceError}</div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {TRACE_FIELDS.map(f => (
              <div key={f.key} className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">{f.label}</div>
                <div className="text-lg font-bold font-mono text-slate-200 truncate" title={trace?.[f.key]}>
                  {loading && !trace ? '…' : trace?.[f.key] ?? '—'}
                </div>
              </div>
            ))}
          </div>
          {trace?.colo && (
            <p className="text-xs text-slate-500 mt-3">
              Your traffic enters Cloudflare's network at the <span className="text-indigo-400 font-mono">{trace.colo}</span> data center. This is a live trace from your machine, not a simulation.
            </p>
          )}
        </div>

        <div>
          <h3 className="text-xl font-bold text-slate-200 mb-4 flex items-center gap-2">
            <Wifi className="text-emerald-400" /> Edge Latency (browser-measured)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {probes.map((p, idx) => (
              <motion.div
                key={p.host}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                className={`bg-slate-950 border rounded-xl p-5 ${
                  p.status === 'done' && p.ms !== null && p.ms < 100 ? 'border-emerald-500/30' :
                  p.status === 'error' ? 'border-rose-500/30' : 'border-slate-800'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <h4 className="text-sm font-bold text-slate-200">{p.label}</h4>
                  <Server className="w-4 h-4 text-slate-500" />
                </div>
                <div className="text-2xl font-bold font-mono text-slate-100">
                  {p.status === 'probing' ? <Loader2 className="w-5 h-5 animate-spin text-indigo-400" /> :
                   p.status === 'error' ? <span className="text-rose-400 text-sm">unreachable</span> :
                   p.ms !== null ? `${p.ms}ms` : '—'}
                </div>
                <div className="text-[10px] font-mono text-slate-600 mt-2 truncate">{p.host.replace('https://', '')}</div>
              </motion.div>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-3">
            Round-trip time from your browser to each Cloudflare property. First probe includes DNS + TLS handshake; refresh to see warm-connection times.
          </p>
        </div>
      </div>
    </div>
  );
};
