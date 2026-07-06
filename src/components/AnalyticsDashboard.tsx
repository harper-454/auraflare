import { useMemo, useState, useEffect } from 'react';
import { BarChart3, Activity, Gauge, Database, Bot } from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts';
import { StorageService } from '../lib/storage';
import { projectData } from '../data';
import { Task, Requirement } from '../types';

const COLORS = ['#7b8cfa', '#5fc99a', '#dcb35c', '#e58398', '#5fbedd', '#b394e8'];

interface AiStat {
  endpoint: string;
  calls: number;
  avg_ms: number;
  cache_hits: number;
}

export function AnalyticsDashboard() {
  // Real data: live from the same storage the Tasks/Requirements sections write to
  const [tasks, setTasks] = useState<Task[]>(() => StorageService.load('aura-app-tasks') ?? projectData.tasks);
  const [requirements] = useState<Requirement[]>(() => StorageService.load('aura-app-requirements-data') ?? projectData.requirements);
  const [fps, setFps] = useState(0);
  const [memory, setMemory] = useState<{ used: number; total: number } | null>(null);

  // Real edge-side AI telemetry from D1 `ai_log` via /api/ai-stats.
  // This endpoint has existed since 2026-07-05; this is the first UI to read it.
  const [aiStats, setAiStats] = useState<AiStat[] | null>(null);
  const [aiStatsError, setAiStatsError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/ai-stats');
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (!cancelled) { setAiStats(data.stats ?? []); setAiStatsError(false); }
      } catch {
        if (!cancelled) setAiStatsError(true); // local dev server has no D1
      }
    };
    load();
    const id = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Live refresh when other sections save
  useEffect(() => {
    const id = setInterval(() => {
      const t = StorageService.load('aura-app-tasks');
      if (t) setTasks(t);
      const mem = (performance as any).memory;
      if (mem) setMemory({ used: mem.usedJSHeapSize / 1048576, total: mem.jsHeapSizeLimit / 1048576 });
    }, 2000);
    return () => clearInterval(id);
  }, []);

  // Real render-loop FPS measurement
  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf: number;
    const loop = (now: number) => {
      frames++;
      if (now - last >= 1000) {
        setFps(frames);
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const statusData = useMemo(() => {
    const counts = { todo: 0, 'in-progress': 0, done: 0 };
    tasks.forEach(t => { counts[t.status] = (counts[t.status] ?? 0) + 1; });
    return [
      { name: 'Todo', value: counts.todo },
      { name: 'In Progress', value: counts['in-progress'] },
      { name: 'Done', value: counts.done },
    ];
  }, [tasks]);

  const categoryData = useMemo(() => {
    const map = new Map<string, { category: string; total: number; done: number }>();
    tasks.forEach(t => {
      const e = map.get(t.category) ?? { category: t.category, total: 0, done: 0 };
      e.total++;
      if (t.status === 'done') e.done++;
      map.set(t.category, e);
    });
    return [...map.values()];
  }, [tasks]);

  const priorityData = useMemo(() => {
    const counts = new Map<string, number>();
    requirements.forEach(r => counts.set(r.priority, (counts.get(r.priority) ?? 0) + 1));
    return [...counts.entries()].map(([name, value]) => ({ name, value }));
  }, [requirements]);

  const completion = tasks.length ? Math.round((statusData[2].value / tasks.length) * 100) : 0;

  // Real localStorage footprint of this app
  const storageBytes = useMemo(() => {
    let bytes = 0;
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith('aura-app-')) bytes += (localStorage.getItem(k)?.length ?? 0) * 2;
    });
    return bytes;
  }, [tasks]);

  const tooltipStyle = { backgroundColor: '#10131a', border: '1px solid #242a35', borderRadius: 8, color: '#e2e6ee', fontSize: 12 };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-3">
          <BarChart3 className="text-indigo-400" /> Project Analytics
        </h2>
        <span className="text-xs font-mono text-emerald-400 bg-emerald-400/10 px-3 py-1 rounded-full border border-emerald-500/20">
          LIVE · LOCAL DATA
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <Activity className="w-6 h-6 text-emerald-400 mb-3" />
          <div className="text-2xl font-bold text-slate-100">{completion}%</div>
          <div className="text-xs text-slate-500">Tasks Complete ({statusData[2].value}/{tasks.length})</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <Gauge className="w-6 h-6 text-indigo-400 mb-3" />
          <div className="text-2xl font-bold text-slate-100">{fps} <span className="text-sm font-normal text-slate-500">fps</span></div>
          <div className="text-xs text-slate-500">Render Loop (measured)</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <Database className="w-6 h-6 text-amber-400 mb-3" />
          <div className="text-2xl font-bold text-slate-100">{(storageBytes / 1024).toFixed(1)} <span className="text-sm font-normal text-slate-500">KB</span></div>
          <div className="text-xs text-slate-500">Persisted App Data</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <BarChart3 className="w-6 h-6 text-rose-400 mb-3" />
          <div className="text-2xl font-bold text-slate-100">
            {memory ? memory.used.toFixed(0) : '—'} <span className="text-sm font-normal text-slate-500">MB</span>
          </div>
          <div className="text-xs text-slate-500">JS Heap {memory ? `/ ${memory.total.toFixed(0)} MB` : '(Chrome only)'}</div>
        </div>
      </div>

      {/* Real AI usage from the edge (D1 ai_log) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
            <Bot className="w-4 h-4 text-indigo-400" /> AI Usage — edge telemetry
          </h3>
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
            aiStatsError
              ? 'text-slate-500 bg-slate-800/60 border-slate-700'
              : 'text-emerald-400 bg-emerald-400/10 border-emerald-500/20'
          }`}>
            {aiStatsError ? 'DEV — no D1 locally' : 'LIVE · D1 ai_log'}
          </span>
        </div>
        {aiStats && aiStats.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-mono text-slate-500 uppercase tracking-wider">
                  <th className="pb-2 pr-4">Endpoint</th>
                  <th className="pb-2 pr-4">Calls</th>
                  <th className="pb-2 pr-4">Avg latency</th>
                  <th className="pb-2">Cache hits</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {aiStats.map(s => (
                  <tr key={s.endpoint} className="border-t border-slate-800/60">
                    <td className="py-2 pr-4 font-mono text-indigo-300">{s.endpoint}</td>
                    <td className="py-2 pr-4">{s.calls}</td>
                    <td className="py-2 pr-4">{s.avg_ms >= 1000 ? `${(s.avg_ms / 1000).toFixed(1)} s` : `${Math.round(s.avg_ms)} ms`}</td>
                    <td className="py-2">{s.cache_hits}<span className="text-slate-600"> / {s.calls}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-slate-500 font-mono">
            {aiStatsError
              ? 'AI telemetry lives in production D1 — open aura.massivenumber.com to see real usage.'
              : 'No AI calls logged yet.'}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">Tasks by Category</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={categoryData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#242a35" />
              <XAxis dataKey="category" stroke="#5c6675" fontSize={11} />
              <YAxis stroke="#5c6675" fontSize={11} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(123,140,250,0.06)' }} />
              <Bar dataKey="total" fill="#7b8cfa" radius={[4, 4, 0, 0]} name="Total" />
              <Bar dataKey="done" fill="#5fc99a" radius={[4, 4, 0, 0]} name="Done" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">Requirements by Priority</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={priorityData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
                {priorityData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="none" />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-3 justify-center mt-2">
            {priorityData.map((p, i) => (
              <span key={p.name} className="text-xs text-slate-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} /> {p.name} ({p.value})
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-slate-300 mb-4">Status Distribution</h3>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={statusData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#242a35" />
            <XAxis dataKey="name" stroke="#5c6675" fontSize={11} />
            <YAxis stroke="#5c6675" fontSize={11} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Area type="monotone" dataKey="value" stroke="#7b8cfa" fill="rgba(123,140,250,0.15)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
