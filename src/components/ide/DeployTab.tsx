import React from 'react';
import { Cloud, Server, Cpu, Database, Globe, Network, Activity } from 'lucide-react';

export const DeployTab = ({ activeDeploy, setActiveDeploy }: { activeDeploy: string, setActiveDeploy: (a: string) => void }) => {
  const targets = [
    { id: 'cloudflare', name: 'Cloudflare', icon: <Cloud className="w-4 h-4 text-orange-400" />, type: 'Edge Compute' },
    { id: 'vercel', name: 'Vercel', icon: <Globe className="w-4 h-4 text-white" />, type: 'Frontend' },
    { id: 'supabase', name: 'Supabase', icon: <Database className="w-4 h-4 text-emerald-400" />, type: 'Postgres & Auth' },
    { id: 'render', name: 'Render.com', icon: <Server className="w-4 h-4 text-indigo-400" />, type: 'Backend API' },
    { id: 'railway', name: 'Railway', icon: <Activity className="w-4 h-4 text-purple-400" />, type: 'Platform' },
    { id: 'dogpu', name: 'DO GPU', icon: <Cpu className="w-4 h-4 text-blue-500" />, type: 'AI Inference' },
    { id: 'github', name: 'GitHub', icon: <Globe className="w-4 h-4 text-slate-300" />, type: 'Repository' },
    { id: 'gitlab', name: 'GitLab', icon: <Globe className="w-4 h-4 text-orange-500" />, type: 'Repository' },
    { id: 'ngrok', name: 'Ngrok', icon: <Network className="w-4 h-4 text-blue-400" />, type: 'Tunneling' },
  ];

  return (
    <div className="text-sm text-slate-400">
      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">Deployment Targets</h3>
      <div className="space-y-1">
        {targets.map(t => (
          <div 
            key={t.id}
            onClick={() => setActiveDeploy(t.id)}
            className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${activeDeploy === t.id ? 'bg-indigo-500/20 border border-indigo-500/30 text-indigo-300' : 'hover:bg-slate-800'}`}
          >
            {t.icon}
            <div>
              <div className="font-medium">{t.name}</div>
              <div className="text-[10px] text-slate-500">{t.type}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
