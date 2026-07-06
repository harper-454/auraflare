import React, { useState, useEffect } from 'react';
import { Monitor, Terminal, FileCode2, Maximize2, Settings, ShieldCheck, Cpu, HardDrive, RefreshCcw } from 'lucide-react';

export const ClawView = () => {
  const [sysInfo, setSysInfo] = useState<any>({ cpu: 'Loading...', mem: 'Loading...', disk: 'Loading...' });
  const [processes, setProcesses] = useState<string[]>([]);
  const [logs, setLogs] = useState<string[]>(['[System] Claw Agent Initialized', '[System] Binding to container OS...']);

  const fetchSysInfo = async () => {
    try {
      // Memory
      const memRes = await fetch('/api/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'free -m' })
      });
      const memData = await memRes.json();
      
      // Disk
      const diskRes = await fetch('/api/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'df -h /' })
      });
      const diskData = await diskRes.json();
      
      // Processes
      const psRes = await fetch('/api/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'ps aux --sort=-%cpu | head -n 6' })
      });
      const psData = await psRes.json();

      let memUsage = '0%';
      if (memData.stdout) {
        const lines = memData.stdout.split('\n');
        if (lines[1]) {
          const parts = lines[1].split(/\s+/);
          const total = parseInt(parts[1]);
          const used = parseInt(parts[2]);
          memUsage = ((used / total) * 100).toFixed(1) + '%';
        }
      }

      let diskUsage = '0%';
      if (diskData.stdout) {
        const lines = diskData.stdout.split('\n');
        if (lines[1]) {
          const parts = lines[1].split(/\s+/);
          diskUsage = parts[4];
        }
      }

      setSysInfo({ mem: memUsage, disk: diskUsage, raw: memData.stdout });
      
      if (psData.stdout) {
        setProcesses(psData.stdout.split('\n').filter(Boolean));
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchSysInfo();
    const interval = setInterval(fetchSysInfo, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex-1 flex flex-col bg-[#0f172a] overflow-hidden relative">
      {/* Remote Toolbar */}
      <div className="h-10 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-4 z-10 shadow-md shadow-black/20">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm">
            <Monitor className="w-4 h-4" /> Claw Container Agent (Live)
          </div>
          <div className="h-4 w-px bg-slate-700"></div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-500" /> Kernel Hook Active
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchSysInfo} className="text-slate-400 hover:text-white" title="Refresh Stats"><RefreshCcw className="w-4 h-4" /></button>
          <button className="text-slate-400 hover:text-white"><Settings className="w-4 h-4" /></button>
          <button className="text-slate-400 hover:text-white"><Maximize2 className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="flex-1 relative bg-slate-950 p-4 overflow-y-auto">
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg">
            <div className="flex items-center gap-2 text-slate-400 mb-2 font-bold text-xs"><Cpu className="w-4 h-4"/> Memory Usage</div>
            <div className="text-2xl font-mono text-emerald-400">{sysInfo.mem}</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg">
            <div className="flex items-center gap-2 text-slate-400 mb-2 font-bold text-xs"><HardDrive className="w-4 h-4"/> Disk Usage</div>
            <div className="text-2xl font-mono text-blue-400">{sysInfo.disk}</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg">
            <div className="flex items-center gap-2 text-slate-400 mb-2 font-bold text-xs"><Terminal className="w-4 h-4"/> Active Agent</div>
            <div className="text-sm font-mono text-indigo-400 mt-2">Claw v1.0.0 (Linux Container)</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 h-[400px]">
          <div className="bg-slate-900 border border-slate-800 rounded-lg flex flex-col overflow-hidden">
            <div className="h-8 bg-slate-800 border-b border-slate-700 flex items-center px-3 text-xs text-slate-400 gap-2 font-bold">
              <Settings className="w-3 h-3 text-slate-300" />
              Live Process Monitor (top CPU)
            </div>
            <div className="flex-1 p-3 overflow-auto">
              <pre className="text-[10px] font-mono text-slate-300">
                {processes.join('\n')}
              </pre>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-lg flex flex-col overflow-hidden">
            <div className="h-8 bg-slate-800 border-b border-slate-700 flex items-center px-3 text-xs text-slate-400 gap-2 font-bold">
              <Terminal className="w-3 h-3 text-slate-300" />
              Agent Action Log
            </div>
            <div className="flex-1 p-3 overflow-auto">
              {logs.map((log, i) => (
                <div key={i} className="text-xs font-mono text-emerald-400 mb-1">{log}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
