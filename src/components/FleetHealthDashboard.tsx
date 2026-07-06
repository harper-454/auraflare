import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  HeartPulse, 
  Activity, 
  Server, 
  Database, 
  AlertTriangle, 
  CheckCircle2, 
  Zap, 
  Wrench,
  RefreshCw,
  TrendingUp,
  TrendingDown
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';

const mockPerformanceData = [
  { time: '00:00', latency: 45, errors: 2 },
  { time: '04:00', latency: 52, errors: 5 },
  { time: '08:00', latency: 120, errors: 15 }, // Spike
  { time: '12:00', latency: 65, errors: 3 },
  { time: '16:00', latency: 40, errors: 1 },
  { time: '20:00', latency: 48, errors: 2 },
  { time: '24:00', latency: 50, errors: 4 },
];

const initialAssets = [
  { 
    id: 'app-ecommerce-01',
    name: 'E-Commerce Backend API',
    type: 'Node.js Microservice',
    status: 'healthy',
    uptime: '99.9%',
    latency: '45ms',
    version: 'v2.4.1'
  },
  { 
    id: 'app-quantum-telemetry',
    name: 'Quantum Telemetry Agent',
    type: 'Go Daemon',
    status: 'warning',
    uptime: '94.2%',
    latency: '340ms',
    version: 'v1.0.2'
  },
  { 
    id: 'db-user-profiles',
    name: 'Global User Profiles DB',
    type: 'PostgreSQL Cluster',
    status: 'critical',
    uptime: '89.5%',
    latency: '850ms',
    version: 'v15.2'
  },
  { 
    id: 'site-marketing-page',
    name: 'Marketing Landing Page',
    type: 'React SPA',
    status: 'healthy',
    uptime: '100%',
    latency: '12ms',
    version: 'v5.1.0'
  }
];

export const FleetHealthDashboard = () => {
  const [assets, setAssets] = useState(initialAssets);
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [isHealing, setIsHealing] = useState<string | null>(null);

  const activeAsset = assets.find(a => a.id === selectedAsset);

  const handleAutoHeal = (id: string) => {
    setIsHealing(id);
    setTimeout(() => {
      setAssets(assets.map(a => 
        a.id === id 
          ? { ...a, status: 'healthy', latency: '35ms', uptime: '99.9%', version: 'v' + (parseFloat(a.version.slice(1)) + 0.1).toFixed(1) + '.0' } 
          : a
      ));
      setIsHealing(null);
    }, 2000);
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0f1c] border-l border-slate-800">
      <div className="h-14 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/50 backdrop-blur z-10 sticky top-0">
        <h2 className="text-lg font-bold text-white flex items-center gap-3">
          <HeartPulse className="text-rose-500" /> Fleet Health & MDM
        </h2>
        <div className="flex gap-2">
          <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3 py-1 rounded text-xs font-bold flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            Global Fleet Online
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 flex flex-col md:flex-row gap-6">
        {/* Left Column: Asset List & KPIs */}
        <div className="w-full md:w-1/3 flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
               <div className="text-xs text-slate-500 mb-1 font-bold uppercase tracking-wider">Total Assets</div>
               <div className="text-2xl font-bold text-white">{assets.length}</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
               <div className="text-xs text-slate-500 mb-1 font-bold uppercase tracking-wider">Critical Alerts</div>
               <div className="text-2xl font-bold text-rose-500">{assets.filter(a => a.status === 'critical').length}</div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl flex flex-col flex-1 overflow-hidden">
            <div className="p-4 border-b border-slate-800 bg-slate-950">
              <h3 className="font-bold text-white text-sm">Managed Applications</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {assets.map((asset) => (
                <button
                  key={asset.id}
                  onClick={() => setSelectedAsset(asset.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors flex items-center gap-3
                    ${selectedAsset === asset.id ? 'bg-slate-800 border-indigo-500/50' : 'bg-slate-950 border-slate-800 hover:border-slate-700'}
                  `}
                >
                  {asset.status === 'healthy' && <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />}
                  {asset.status === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />}
                  {asset.status === 'critical' && <AlertTriangle className="w-5 h-5 text-rose-500 flex-shrink-0 animate-pulse" />}
                  
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-slate-200 truncate">{asset.name}</div>
                    <div className="text-xs text-slate-500 truncate">{asset.type}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Drilldown & Management */}
        <div className="w-full md:w-2/3 flex flex-col gap-6">
          {activeAsset ? (
            <>
              {/* Asset Header Info */}
              <motion.div 
                key={activeAsset.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-slate-900 border border-slate-800 rounded-xl p-6"
              >
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h2 className="text-xl font-bold text-white mb-1">{activeAsset.name}</h2>
                    <div className="text-sm text-slate-400 flex items-center gap-2">
                      <Server className="w-4 h-4" /> {activeAsset.type}
                      <span className="text-slate-600">•</span>
                      <span className="font-mono text-indigo-400">{activeAsset.id}</span>
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    <button className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded text-xs font-bold transition-colors">
                      View Logs
                    </button>
                    {activeAsset.status !== 'healthy' && (
                      <button 
                        onClick={() => handleAutoHeal(activeAsset.id)}
                        disabled={isHealing === activeAsset.id}
                        className="px-4 py-2 bg-rose-600/20 hover:bg-rose-600/40 border border-rose-500/50 text-rose-300 rounded text-xs font-bold transition-colors flex items-center gap-2"
                      >
                        {isHealing === activeAsset.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
                        {isHealing === activeAsset.id ? 'Applying Patch...' : 'Auto-Heal & Upgrade'}
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-4 mb-6">
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Status</div>
                    <div className={`text-sm font-bold capitalize
                      ${activeAsset.status === 'healthy' ? 'text-emerald-400' : activeAsset.status === 'warning' ? 'text-amber-400' : 'text-rose-400'}
                    `}>{activeAsset.status}</div>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Uptime</div>
                    <div className="text-sm font-bold text-white">{activeAsset.uptime}</div>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Avg Latency</div>
                    <div className="text-sm font-bold text-white">{activeAsset.latency}</div>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Version</div>
                    <div className="text-sm font-mono text-indigo-400">{activeAsset.version}</div>
                  </div>
                </div>

                {/* Graph */}
                <div className="h-64 mt-4">
                  <h4 className="text-xs font-bold text-slate-400 mb-4">24h Performance Telemetry</h4>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={mockPerformanceData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorLatency" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={activeAsset.status === 'critical' ? '#f43f5e' : '#6366f1'} stopOpacity={0.3}/>
                          <stop offset="95%" stopColor={activeAsset.status === 'critical' ? '#f43f5e' : '#6366f1'} stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', fontSize: '12px' }}
                        itemStyle={{ color: '#e2e8f0' }}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="latency" 
                        stroke={activeAsset.status === 'critical' ? '#f43f5e' : '#6366f1'} 
                        fillOpacity={1} 
                        fill="url(#colorLatency)" 
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </motion.div>
            </>
          ) : (
            <div className="flex-1 border border-dashed border-slate-700 rounded-xl flex flex-col items-center justify-center text-slate-500 bg-slate-900/50">
              <Activity className="w-12 h-12 mb-4 opacity-50" />
              <p>Select an asset from the fleet to view telemetry and manage upgrades.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
