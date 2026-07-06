import React, { useState } from 'react';
import { Cloud, Server, Database, Network, Play, Terminal } from 'lucide-react';

export const IaCProvisioningSection = () => {
  const [logs, setLogs] = useState<string[]>(['[Terraform] Initializing backend...', '[Terraform] Parsing deduced application requirements...']);
  
  const handleProvision = async () => {
    setLogs(prev => [...prev, '> terraform apply -auto-approve']);
    try {
      const res = await fetch('/api/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'echo "mocking terraform provisioning...\\nProvisioning VPC... OK\\nProvisioning RDS Cluster... OK\\nState mapped to IaC syntax."' })
      });
      const data = await res.json();
      if (data.stdout) {
         setLogs(prev => [...prev, ...data.stdout.split('\n').filter(Boolean)]);
      }
    } catch(e) {}
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border-l border-slate-800">
      <div className="h-14 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/50 backdrop-blur z-10 sticky top-0">
        <h2 className="text-lg font-bold text-white flex items-center gap-3">
          <Cloud className="text-blue-400" /> Autonomous Infrastructure-as-Code
        </h2>
        <button onClick={handleProvision} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded text-sm font-bold transition-colors">
          <Play className="w-4 h-4" /> Dry Run Preview
        </button>
      </div>
      <div className="flex-1 p-6 flex gap-6 overflow-hidden">
        <div className="w-1/2 flex flex-col gap-4">
           <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex-1">
             <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2"><Network className="w-4 h-4"/> Inferred Topology</h3>
             <div className="space-y-3">
                <div className="bg-slate-900 p-3 rounded border border-slate-800 flex items-center gap-3">
                  <Database className="w-5 h-5 text-indigo-400" /> 
                  <div>
                    <div className="text-sm text-slate-200 font-bold">PostgreSQL Managed Database</div>
                    <div className="text-xs text-slate-500">Deduced from AuthTab & Data layer</div>
                  </div>
                </div>
                <div className="bg-slate-900 p-3 rounded border border-slate-800 flex items-center gap-3">
                  <Server className="w-5 h-5 text-emerald-400" /> 
                  <div>
                    <div className="text-sm text-slate-200 font-bold">Edge Compute Workers (x3)</div>
                    <div className="text-xs text-slate-500">Deduced from real-time requirements</div>
                  </div>
                </div>
             </div>
           </div>
        </div>
        <div className="w-1/2 bg-slate-950 border border-slate-800 rounded-xl flex flex-col overflow-hidden">
          <div className="h-10 border-b border-slate-800 flex items-center px-4 bg-slate-900">
            <Terminal className="w-4 h-4 text-slate-400 mr-2" />
            <span className="text-xs font-mono text-slate-400">Terraform Output</span>
          </div>
          <div className="p-4 font-mono text-xs text-blue-400 overflow-y-auto flex-1">
            {logs.map((l, i) => <div key={i} className="mb-1">{l}</div>)}
          </div>
        </div>
      </div>
    </div>
  );
}
