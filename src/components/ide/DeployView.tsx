import React, { useState, useEffect } from 'react';
import { Cloud, Server, Cpu, Database, Globe, Activity, CheckCircle2, Network, Loader2, Play } from 'lucide-react';

export const DeployView = ({ target }: { target: string }) => {
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'deploying' | 'success' | 'error'>('idle');

  const runDeployment = async () => {
    setStatus('deploying');
    setLogs([`[System] Initializing ${target} deployment sequence...`]);
    
    try {
      let command = 'echo "No standard deploy script found for this target."';
      
      if (target === 'github') {
        command = 'git status && git log -1 || echo "Git repository not fully initialized."';
      } else if (target === 'ngrok') {
        command = 'npx ngrok --version || echo "Ngrok not installed."';
      } else if (target === 'cloudflare') {
        command = 'npx wrangler --version || echo "Wrangler CLI not installed. Run npm i -g wrangler"';
      } else if (target === 'vercel') {
        command = 'npx vercel --version || echo "Vercel CLI not installed. Run npm i -g vercel"';
      }

      setLogs(prev => [...prev, `> ${command}`]);
      
      const res = await fetch('/api/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command })
      });
      const data = await res.json();
      
      if (data.stdout) {
        setLogs(prev => [...prev, ...data.stdout.split('\n').filter(Boolean)]);
      }
      if (data.stderr) {
        setLogs(prev => [...prev, ...data.stderr.split('\n').filter(Boolean)]);
      }
      
      if (data.error) {
        setLogs(prev => [...prev, `[Error] ${data.error}`]);
        setStatus('error');
      } else {
        setLogs(prev => [...prev, '[System] Operation completed.']);
        setStatus('success');
      }
    } catch (e: any) {
      setLogs(prev => [...prev, `[Fatal Error] ${e.message}`]);
      setStatus('error');
    }
  };

  useEffect(() => {
    setStatus('idle');
    setLogs([`Select "Run Deployment" to execute target: ${target}`]);
  }, [target]);

  return (
    <div className="flex-1 flex flex-col bg-[#0f172a] text-slate-300 p-6 overflow-y-auto">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-xl font-bold text-white flex items-center gap-3">
          {target === 'cloudflare' && <><Cloud className="text-orange-400" /> Cloudflare Workers Deployment</>}
          {target === 'vercel' && <><Globe className="text-white" /> Vercel Deployment</>}
          {target === 'supabase' && <><Database className="text-emerald-400" /> Supabase Integration</>}
          {target === 'render' && <><Server className="text-indigo-400" /> Render.com API</>}
          {target === 'railway' && <><Activity className="text-purple-400" /> Railway Platform</>}
          {target === 'dogpu' && <><Cpu className="text-blue-500" /> DigitalOcean GPU Droplet</>}
          {target === 'github' && <><Globe className="text-slate-300" /> GitHub Repository Sync</>}
          {target === 'gitlab' && <><Globe className="text-orange-500" /> GitLab Repository Sync</>}
          {target === 'ngrok' && <><Network className="text-blue-400" /> Ngrok Secure Tunnel</>}
        </h2>
        <button 
          onClick={runDeployment}
          disabled={status === 'deploying'}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-400 text-white rounded text-sm flex items-center gap-2 transition-colors font-bold"
        >
          {status === 'deploying' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          Execute
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg">
          <div className="text-xs text-slate-500 mb-1">Status</div>
          <div className="text-lg text-white font-medium flex items-center gap-2">
            {status === 'success' && <><CheckCircle2 className="w-5 h-5 text-emerald-500" /> Success</>}
            {status === 'deploying' && <><Loader2 className="w-5 h-5 text-indigo-400 animate-spin" /> In Progress...</>}
            {status === 'error' && <><CheckCircle2 className="w-5 h-5 text-red-500" /> Failed</>}
            {status === 'idle' && <><Activity className="w-5 h-5 text-slate-500" /> Ready</>}
          </div>
        </div>
      </div>

      <div className="flex-1 bg-slate-950 border border-slate-800 rounded-lg flex flex-col overflow-hidden">
        <div className="px-4 py-2 bg-slate-900 border-b border-slate-800 text-xs font-mono text-slate-400 flex items-center gap-2 font-bold">
          <Activity className="w-4 h-4" /> Live Execution Logs
        </div>
        <div className="p-4 font-mono text-xs text-slate-300 space-y-1 overflow-y-auto h-full min-h-[250px]">
          {logs.map((log, idx) => (
             <div key={idx} className={log.startsWith('[Error]') || log.startsWith('[Fatal Error]') ? 'text-red-400' : log.startsWith('[System]') ? 'text-indigo-400 font-bold' : log.startsWith('>') ? 'text-amber-400' : 'text-emerald-400'}>{log}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
