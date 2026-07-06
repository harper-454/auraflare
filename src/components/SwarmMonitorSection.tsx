import { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Cpu, Activity, BrainCircuit, Users, ShieldAlert, Loader2 } from 'lucide-react';

interface CoreInfo {
  model: string;
  speed: number;
  load: number;
}

interface HostTelemetry {
  platform: string;
  arch: string;
  host: string;
  uptime: number;
  freemem: number;
  totalmem: number;
  loadavg: number[];
  cores: CoreInfo[];
}

// Samples per-core CPU times twice (700ms apart) and reports real utilization.
// Base64-encoded so the one-liner survives both cmd.exe and sh quoting.
const TELEMETRY_SCRIPT = `
const os=require('os');
const a=os.cpus();
setTimeout(()=>{
  const b=os.cpus();
  const cores=b.map((c,i)=>{
    const at=a[i].times,bt=c.times;
    const idle=bt.idle-at.idle;
    const total=(bt.user-at.user)+(bt.nice-at.nice)+(bt.sys-at.sys)+(bt.irq-at.irq)+idle;
    return {model:c.model,speed:c.speed,load:total?Math.round(100*(1-idle/total)):0};
  });
  console.log(JSON.stringify({platform:os.platform(),arch:os.arch(),host:os.hostname(),uptime:os.uptime(),freemem:os.freemem(),totalmem:os.totalmem(),loadavg:os.loadavg(),cores}));
},700);
`;

export function SwarmMonitorSection() {
  const [telemetry, setTelemetry] = useState<HostTelemetry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let mounted = true;

    const poll = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const b64 = btoa(TELEMETRY_SCRIPT);
        const res = await fetch('/api/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: `node -e "eval(Buffer.from('${b64}','base64').toString())"`, cwd: '' }),
        });
        const data = await res.json();
        if (!mounted) return;
        if (data.stdout) {
          setTelemetry(JSON.parse(data.stdout.trim()));
          setError(null);
        } else if (data.error || data.stderr) {
          setError(data.error || data.stderr);
        }
      } catch (e: any) {
        if (mounted) setError(`${e.message} — is the dev server (npm run dev) running?`);
      } finally {
        busy.current = false;
      }
    };

    poll();
    const id = setInterval(poll, 3000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  const avgLoad = telemetry
    ? Math.round(telemetry.cores.reduce((s, c) => s + c.load, 0) / telemetry.cores.length)
    : 0;
  const memUsedPct = telemetry
    ? Math.round(((telemetry.totalmem - telemetry.freemem) / telemetry.totalmem) * 100)
    : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-5xl space-y-8"
    >
      <header className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-500/10 rounded-lg">
            <Users className="w-6 h-6 text-indigo-400" />
          </div>
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-slate-100">Compute Swarm Monitor</h2>
            <p className="text-sm font-mono text-indigo-400">
              {telemetry ? `${telemetry.host.toUpperCase()} · ${telemetry.platform}/${telemetry.arch} · LIVE` : 'CONNECTING…'}
            </p>
          </div>
        </div>
        <p className="text-lg text-slate-400 max-w-3xl">
          Live telemetry from your machine's CPU cores, sampled through the local execution gateway every 3 seconds. Every number below is measured, not simulated.
        </p>
      </header>

      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-lg text-sm text-rose-400 font-mono">
          Telemetry unavailable: {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <BrainCircuit className="w-4 h-4 text-emerald-400" />
            <h4 className="text-xs font-mono text-slate-400 uppercase tracking-wider">Cores Online</h4>
          </div>
          <p className="text-2xl font-bold text-slate-200">{telemetry?.cores.length ?? '—'}</p>
        </div>
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-amber-400" />
            <h4 className="text-xs font-mono text-slate-400 uppercase tracking-wider">Avg CPU Load</h4>
          </div>
          <p className="text-2xl font-bold text-slate-200">{telemetry ? `${avgLoad}%` : '—'}</p>
        </div>
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <ShieldAlert className="w-4 h-4 text-indigo-400" />
            <h4 className="text-xs font-mono text-slate-400 uppercase tracking-wider">Memory In Use</h4>
          </div>
          <p className="text-2xl font-bold text-slate-200">
            {telemetry ? `${memUsedPct}%` : '—'}
            {telemetry && (
              <span className="text-xs font-normal text-slate-500 ml-2">
                {((telemetry.totalmem - telemetry.freemem) / 1073741824).toFixed(1)} / {(telemetry.totalmem / 1073741824).toFixed(0)} GB
              </span>
            )}
          </p>
        </div>
      </div>

      {!telemetry && !error && (
        <div className="flex items-center gap-3 text-slate-500 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Sampling CPU cores…
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {telemetry?.cores.map((core, i) => (
          <motion.div
            key={i}
            layout
            className="p-4 bg-slate-900 border border-slate-800 rounded-lg flex flex-col justify-between"
          >
            <div>
              <div className="flex justify-between items-start mb-2">
                <Cpu className="w-5 h-5 text-slate-400" />
                <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${
                  core.load > 60
                    ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                    : core.load > 20
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                }`}>
                  {core.load > 60 ? 'hot' : core.load > 20 ? 'active' : 'idle'}
                </span>
              </div>
              <div className="text-xs font-mono text-slate-500">CORE-{String(i).padStart(2, '0')} · {core.speed} MHz</div>
              <div className="font-medium text-xs text-slate-300 mt-1 truncate" title={core.model}>{core.model}</div>
            </div>

            <div className="mt-4 pt-4 border-t border-slate-800/50">
              <div className="flex justify-between items-center mb-1 text-xs">
                <span className="text-slate-500 font-mono">LOAD</span>
                <span className="text-slate-400">{core.load}%</span>
              </div>
              <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden">
                <motion.div
                  className={`h-full ${core.load > 60 ? 'bg-rose-500' : 'bg-indigo-500'}`}
                  animate={{ width: `${core.load}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
