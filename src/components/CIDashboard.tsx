import { useState, useCallback, useRef, useEffect } from 'react';
import { GitMerge, PlayCircle, CheckCircle2, XCircle, Clock, Loader2 } from 'lucide-react';

type StageStatus = 'pending' | 'running' | 'passed' | 'failed';

interface Stage {
  id: string;
  name: string;
  command: string;
  status: StageStatus;
  output: string;
  durationMs: number | null;
}

const initialStages: Stage[] = [
  { id: 'typecheck', name: 'TypeScript Check', command: 'npx tsc --noEmit --pretty false', status: 'pending', output: '', durationMs: null },
  { id: 'audit', name: 'Dependency Audit', command: 'npm audit --omit=dev --audit-level=high', status: 'pending', output: '', durationMs: null },
  { id: 'build', name: 'Production Build', command: 'npx vite build', status: 'pending', output: '', durationMs: null },
];

export function CIDashboard() {
  // Real pipeline: each stage executes an actual command in the project via /api/exec
  const [stages, setStages] = useState<Stage[]>(initialStages);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => () => { cancelled.current = true; }, []);

  const patch = (id: string, p: Partial<Stage>) =>
    setStages(s => s.map(st => (st.id === id ? { ...st, ...p } : st)));

  const runPipeline = useCallback(async () => {
    setRunning(true);
    cancelled.current = false;
    setStages(initialStages);

    for (const stage of initialStages) {
      if (cancelled.current) break;
      patch(stage.id, { status: 'running' });
      const start = performance.now();
      try {
        const res = await fetch('/api/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: stage.command, cwd: '' }),
        });
        const data = await res.json();
        const durationMs = performance.now() - start;
        const output = [data.stdout, data.stderr].filter(Boolean).join('\n').trim() || '(no output)';
        const failed = Boolean(data.error);
        patch(stage.id, { status: failed ? 'failed' : 'passed', output, durationMs });
        if (failed) {
          setExpanded(stage.id);
          break; // stop pipeline on failure, like real CI
        }
      } catch (err: any) {
        patch(stage.id, { status: 'failed', output: `Request failed: ${err.message}. Is the dev server (npm run dev) running?`, durationMs: performance.now() - start });
        break;
      }
    }
    setRunning(false);
  }, []);

  const icon = (s: StageStatus) => {
    switch (s) {
      case 'passed': return <CheckCircle2 className="w-5 h-5 text-emerald-400" />;
      case 'failed': return <XCircle className="w-5 h-5 text-rose-400" />;
      case 'running': return <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />;
      default: return <Clock className="w-5 h-5 text-slate-500" />;
    }
  };

  const ring = (s: StageStatus) => {
    switch (s) {
      case 'passed': return 'bg-emerald-500/20 border-emerald-500/50';
      case 'failed': return 'bg-rose-500/20 border-rose-500/50';
      case 'running': return 'bg-indigo-500/20 border-indigo-500/50';
      default: return 'bg-slate-800 border-slate-700';
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-3">
          <GitMerge className="text-indigo-400" /> CI Pipeline
        </h2>
        <span className="text-xs font-mono text-emerald-400 bg-emerald-400/10 px-3 py-1 rounded-full border border-emerald-500/20">
          RUNS REAL COMMANDS · LOCAL
        </span>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8">
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-xl font-bold text-slate-200">Verification Pipeline</h3>
          <button
            onClick={runPipeline}
            disabled={running}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded text-sm font-medium transition-colors flex items-center gap-2"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            {running ? 'Running…' : 'Run Pipeline'}
          </button>
        </div>

        <div className="space-y-6">
          {stages.map((stage, i) => (
            <div key={stage.id}>
              {i > 0 && <div className="w-0.5 h-6 bg-slate-800 ml-5 -mt-4 mb-2" />}
              <div className={`flex items-center gap-4 ${stage.status === 'pending' ? 'opacity-50' : ''}`}>
                <div className={`w-10 h-10 rounded-full border flex items-center justify-center shrink-0 ${ring(stage.status)}`}>
                  {icon(stage.status)}
                </div>
                <button
                  onClick={() => setExpanded(expanded === stage.id ? null : stage.id)}
                  className={`flex-1 text-left rounded p-4 flex items-center justify-between border transition-colors ${
                    stage.status === 'running' ? 'bg-indigo-500/5 border-indigo-500/30' : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className={`font-bold ${stage.status === 'failed' ? 'text-rose-400' : stage.status === 'running' ? 'text-indigo-400' : 'text-slate-200'}`}>
                      {stage.name}
                    </div>
                    <div className="text-xs text-slate-500 font-mono mt-1">
                      $ {stage.command}
                      {stage.durationMs !== null && ` · ${(stage.durationMs / 1000).toFixed(1)}s`}
                    </div>
                  </div>
                  <span className={`text-xs capitalize ${
                    stage.status === 'passed' ? 'text-emerald-400' :
                    stage.status === 'failed' ? 'text-rose-400' :
                    stage.status === 'running' ? 'text-indigo-400' : 'text-slate-500'
                  }`}>{stage.status}</span>
                </button>
              </div>
              {expanded === stage.id && stage.output && (
                <pre className="ml-14 mt-2 p-4 bg-slate-950 border border-slate-800 rounded text-xs font-mono text-slate-400 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
                  {stage.output}
                </pre>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
