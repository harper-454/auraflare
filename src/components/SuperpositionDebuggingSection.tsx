import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { GitMerge, Layers, RefreshCcw, Terminal, Activity, Cpu } from 'lucide-react';

export const SuperpositionDebuggingSection = () => {
  const [states, setStates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStates = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'echo "Branch Alpha: CPU 12% | Mem 140MB\\nBranch Beta: CPU 45% | Mem 280MB\\nBranch Gamma (Crash): Memory Overflow"' })
      });
      const data = await res.json();
      if (data.stdout) {
        setStates(data.stdout.split('\n').filter(Boolean));
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchStates();
    const interval = setInterval(fetchStates, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col h-full bg-slate-900 border-l border-slate-800">
      <div className="h-14 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/50 backdrop-blur z-10 sticky top-0">
        <h2 className="text-lg font-bold text-white flex items-center gap-3">
          <Layers className="text-indigo-400" /> Superposition Debugging
        </h2>
        <button onClick={fetchStates} className="text-slate-400 hover:text-white"><RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>
      <div className="flex-1 p-6 overflow-y-auto">
        <p className="text-slate-400 text-sm mb-6 max-w-3xl">
          Observing parallel execution outcomes of multiple architectural branches simultaneously before collapsing into a final commit.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {states.map((state, i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className={`p-6 rounded-xl border ${state.includes('Crash') ? 'border-red-900/50 bg-red-950/20' : 'border-slate-800 bg-slate-900'} relative overflow-hidden`}
            >
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <GitMerge className="w-24 h-24" />
              </div>
              <div className="relative z-10">
                <h3 className={`text-lg font-bold mb-2 ${state.includes('Crash') ? 'text-red-400' : 'text-indigo-400'}`}>Timeline {i + 1}</h3>
                <div className="font-mono text-xs text-slate-300 space-y-2 mt-4 bg-slate-950 p-4 rounded-lg border border-slate-800">
                  <div className="flex items-center gap-2"><Cpu className="w-3 h-3 text-slate-500" /> {state}</div>
                  <div className="flex items-center gap-2 text-slate-500"><Terminal className="w-3 h-3" /> Isolates running headless</div>
                </div>
                {state.includes('Crash') ? (
                  <button className="mt-4 w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-bold transition-colors">Prune Timeline</button>
                ) : (
                  <button className="mt-4 w-full py-2 bg-indigo-600/20 hover:bg-indigo-600/40 border border-indigo-500/30 text-indigo-300 rounded text-xs font-bold transition-colors">Collapse & Commit</button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};
