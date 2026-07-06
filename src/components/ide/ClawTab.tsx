import React from 'react';
import { Monitor, Cpu, HardDrive, Wifi, Settings2 } from 'lucide-react';

export const ClawTab = () => {
  return (
    <div className="text-sm text-slate-400">
      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">Claw Windows Agent</h3>
      <div className="space-y-4">
        <div className="p-3 bg-blue-900/20 border border-blue-500/30 rounded">
          <div className="flex items-center justify-between mb-2 text-blue-400">
            <div className="flex items-center gap-2">
              <Monitor className="w-4 h-4" />
              <span className="font-bold text-xs">Claw.exe Worker</span>
            </div>
            <span className="text-[10px] bg-blue-500/20 px-1.5 py-0.5 rounded text-blue-300 border border-blue-500/30">v2.4.1</span>
          </div>
          <p className="text-[10px] text-slate-400 mb-2">Full desktop control and app integration active.</p>
          <div className="w-full bg-slate-800 rounded-full h-1.5 mb-1 mt-3">
            <div className="bg-blue-500 h-1.5 rounded-full w-[45%]"></div>
          </div>
          <div className="flex justify-between text-[9px] text-slate-500">
            <span>CPU: 45%</span>
            <span>Mem: 8.2GB</span>
          </div>
        </div>

        <div>
          <h4 className="text-[10px] uppercase font-bold text-slate-500 mb-2">Capabilities</h4>
          <div className="space-y-1">
            <div className="flex items-center gap-2 p-1.5 text-xs">
              <HardDrive className="w-3 h-3 text-slate-400" />
              <span>Native FS Access</span>
            </div>
            <div className="flex items-center gap-2 p-1.5 text-xs">
              <Settings2 className="w-3 h-3 text-slate-400" />
              <span>OS Process Control</span>
            </div>
            <div className="flex items-center gap-2 p-1.5 text-xs">
              <Monitor className="w-3 h-3 text-slate-400" />
              <span>Screen Capture / OCR</span>
            </div>
          </div>
        </div>
        
        <button className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-blue-400 text-xs rounded border border-slate-700 flex items-center justify-center gap-2">
          <Wifi className="w-3 h-3" /> Reconnect Agent
        </button>
      </div>
    </div>
  );
};
