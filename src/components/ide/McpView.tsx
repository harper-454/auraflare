import React, { useState, useEffect } from 'react';
import { Network, Search, Zap, Code2, CheckCircle2, XCircle, RefreshCcw } from 'lucide-react';

export const McpView = () => {
  const [envStatus, setEnvStatus] = useState<any>({ gemini: false, node: false, stripe: false });
  const [checking, setChecking] = useState(true);

  const checkIntegrations = async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'echo GEMINI=$GEMINI_API_KEY && node -v' })
      });
      const data = await res.json();
      
      const hasGemini = data.stdout?.includes('GEMINI=AIza');
      const hasNode = data.stdout?.includes('v2');
      
      setEnvStatus({ gemini: hasGemini, node: hasNode, stripe: false });
    } catch (e) {
      console.error(e);
    }
    setChecking(false);
  };

  useEffect(() => {
    checkIntegrations();
  }, []);

  return (
    <div className="flex-1 flex flex-col bg-[#0f172a] text-slate-300 p-6 overflow-y-auto">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-xl font-bold text-white flex items-center gap-3">
          <Network className="text-emerald-400" /> Model Context Protocol (MCP) & API Hub
        </h2>
        <button onClick={checkIntegrations} disabled={checking} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white rounded text-sm flex items-center gap-2 transition-colors disabled:opacity-50">
          <RefreshCcw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} /> Scan Environment
        </button>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center border border-slate-700">
              <Code2 className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-200">Local Filesystem MCP</h3>
              <p className="text-xs text-slate-500">Provides read/write access to project</p>
            </div>
          </div>
          <div className="space-y-2 mb-4">
            <div className="flex justify-between text-xs p-2 bg-slate-950 rounded">
              <span className="text-slate-500">Node.js Runtime</span>
              {envStatus.node ? <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> Active</span> : <span className="text-slate-500">Checking...</span>}
            </div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center border border-slate-700">
              <Search className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-200">Gemini Core API</h3>
              <p className="text-xs text-slate-500">Google GenAI Integration</p>
            </div>
          </div>
          <div className="space-y-2 mb-4">
            <div className="flex justify-between text-xs p-2 bg-slate-950 rounded">
              <span className="text-slate-500">API Key Detected</span>
              {envStatus.gemini ? <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> Loaded</span> : <span className="text-red-400 flex items-center gap-1"><XCircle className="w-3 h-3"/> Missing</span>}
            </div>
          </div>
        </div>
      </div>
      
      <div className="mt-8">
        <h3 className="text-sm font-bold text-slate-300 mb-4">Network Activity Logs</h3>
        <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden font-mono text-xs text-slate-400 p-4 min-h-[200px]">
           <div className="text-emerald-400">[System] MCP Hub Initialized...</div>
           <div className="text-slate-500">[System] Scanning container environment variables for API keys...</div>
           {envStatus.gemini && <div className="text-indigo-400">[Auth] Found GEMINI_API_KEY.</div>}
           {envStatus.node && <div className="text-indigo-400">[Runtime] Node.js container active.</div>}
           <div className="text-slate-500">[Network] Listening for MCP protocol requests...</div>
        </div>
      </div>
    </div>
  );
}
