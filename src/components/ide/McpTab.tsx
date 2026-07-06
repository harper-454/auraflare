import React from 'react';
import { Network, Link2, Key, Activity } from 'lucide-react';

export const McpTab = () => {
  return (
    <div className="text-sm text-slate-400">
      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">MCP & API Hub</h3>
      <div className="space-y-4">
        <div className="p-3 bg-slate-900 border border-emerald-500/30 rounded">
          <div className="flex items-center gap-2 mb-2 text-emerald-400">
            <Network className="w-4 h-4" />
            <span className="font-bold text-xs">Aura MCP Server</span>
          </div>
          <p className="text-[10px] text-slate-400 mb-2">Providing local context and filesystem access to Claude/Gemini agents.</p>
          <div className="flex items-center gap-2 text-[10px]">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-emerald-500">Connected (Port 8080)</span>
          </div>
        </div>

        <div>
          <h4 className="text-[10px] uppercase font-bold text-slate-500 mb-2">Connected APIs</h4>
          <div className="space-y-1">
            <div className="flex items-center justify-between p-2 hover:bg-slate-800 rounded">
              <div className="flex items-center gap-2">
                <Link2 className="w-3 h-3 text-slate-400" />
                <span className="text-xs">Stripe Billing</span>
              </div>
              <Activity className="w-3 h-3 text-emerald-400" />
            </div>
            <div className="flex items-center justify-between p-2 hover:bg-slate-800 rounded">
              <div className="flex items-center gap-2">
                <Key className="w-3 h-3 text-slate-400" />
                <span className="text-xs">OpenAI Services</span>
              </div>
              <Activity className="w-3 h-3 text-emerald-400" />
            </div>
            <div className="flex items-center justify-between p-2 hover:bg-slate-800 rounded">
              <div className="flex items-center gap-2">
                <Key className="w-3 h-3 text-slate-400" />
                <span className="text-xs">Gemini Live API</span>
              </div>
              <Activity className="w-3 h-3 text-emerald-400" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
