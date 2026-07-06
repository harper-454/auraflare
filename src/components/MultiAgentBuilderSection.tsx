import React, { useState } from 'react';
import { Users, Code, Plus, Trash2, Cpu, Settings, CheckCircle2, Loader2, Key } from 'lucide-react';
import Markdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';

export const MultiAgentBuilderSection = () => {
  const [architecture, setArchitecture] = useState('Highly scalable global edge application with multi-regional database replication.');
  const [agents, setAgents] = useState([
    { id: 1, name: 'Architect Node', persona: 'Systems Architecture Expert' },
    { id: 2, name: 'Security Node', persona: 'Zero-Trust Security Auditor' },
    { id: 3, name: 'DevOps Node', persona: 'Kubernetes & CI/CD Specialist' }
  ]);
  const [isBuilding, setIsBuilding] = useState(false);
  const [result, setResult] = useState('');

  const addAgent = () => {
    setAgents([...agents, { id: Date.now(), name: 'Custom Node', persona: 'Frontend Specialist' }]);
  };

  const removeAgent = (id: number) => {
    setAgents(agents.filter(a => a.id !== id));
  };

  const handleBuild = async () => {
    setIsBuilding(true);
    setResult('');
    try {
      const res = await fetch('/api/multi-agent-build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents, architecture })
      });
      const data = await res.json();
      setResult(data.result);
    } catch (e) {
      setResult('Failed to execute build.');
    }
    setIsBuilding(false);
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border-l border-slate-800 relative">
      {/* Pro Badge Overlay */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2 bg-gradient-to-r from-amber-500/20 to-orange-600/20 border border-amber-500/50 px-3 py-1.5 rounded-full">
        <Key className="w-4 h-4 text-amber-400" />
        <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Pro Tier Feature</span>
      </div>

      <div className="h-14 border-b border-slate-800 flex items-center px-6 bg-slate-900/50 backdrop-blur z-10 sticky top-0">
        <h2 className="text-lg font-bold text-white flex items-center gap-3">
          <Users className="text-amber-400" /> Multi-Agent Complex Build Process
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-6 flex gap-6">
        <div className="w-1/2 flex flex-col gap-6">
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-6">
            <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
              <Code className="w-4 h-4 text-slate-400" /> Target Architecture
            </h3>
            <textarea 
              value={architecture}
              onChange={(e) => setArchitecture(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded p-3 text-sm text-slate-200 outline-none focus:border-amber-500 h-24 resize-none"
              placeholder="Describe the complex build or integration..."
            />
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-xl p-6 flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-slate-400" /> Agent Personas
              </h3>
              <button onClick={addAgent} className="text-xs font-bold text-amber-400 hover:text-amber-300 flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add Agent
              </button>
            </div>
            
            <div className="space-y-3 flex-1 overflow-y-auto pr-2">
              <AnimatePresence>
                {agents.map((agent, i) => (
                  <motion.div 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    key={agent.id} 
                    className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex items-center gap-3"
                  >
                    <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700 font-mono text-xs font-bold text-slate-400">
                      #{i + 1}
                    </div>
                    <div className="flex-1 flex flex-col gap-1">
                      <input 
                        type="text" 
                        value={agent.name}
                        onChange={(e) => {
                          const newAgents = [...agents];
                          newAgents[i].name = e.target.value;
                          setAgents(newAgents);
                        }}
                        className="bg-transparent border-none outline-none text-sm font-bold text-slate-200" 
                        placeholder="Agent Name"
                      />
                      <input 
                        type="text" 
                        value={agent.persona}
                        onChange={(e) => {
                          const newAgents = [...agents];
                          newAgents[i].persona = e.target.value;
                          setAgents(newAgents);
                        }}
                        className="bg-transparent border-none outline-none text-xs text-slate-400" 
                        placeholder="Agent Persona / Role"
                      />
                    </div>
                    <button onClick={() => removeAgent(agent.id)} className="text-slate-600 hover:text-red-400 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            <button 
              onClick={handleBuild}
              disabled={isBuilding}
              className="w-full py-3 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg font-bold text-sm flex items-center justify-center gap-2 mt-4 transition-colors shadow-lg shadow-amber-500/20"
            >
              {isBuilding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings className="w-4 h-4" />}
              {isBuilding ? 'Agents Debating & Building...' : 'Execute Multi-Agent Build'}
            </button>
          </div>
        </div>

        <div className="w-1/2 bg-slate-950 border border-slate-800 rounded-xl flex flex-col overflow-hidden">
          <div className="h-10 border-b border-slate-800 flex items-center px-4 bg-slate-900 gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Consensus Output</span>
          </div>
          <div className="p-6 overflow-y-auto flex-1 text-slate-300">
            {isBuilding ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-500">
                 <div className="flex items-center justify-center gap-4 mb-6">
                    <div className="w-8 h-8 rounded-full bg-slate-800 animate-bounce delay-75"></div>
                    <div className="w-8 h-8 rounded-full bg-slate-800 animate-bounce delay-150"></div>
                    <div className="w-8 h-8 rounded-full bg-slate-800 animate-bounce delay-300"></div>
                 </div>
                 <p className="text-sm font-mono animate-pulse">Agents resolving merge conflicts and security constraints...</p>
              </div>
            ) : result ? (
              <div className="prose prose-invert prose-sm max-w-none text-slate-300 markdown-body">
                <Markdown>{result}</Markdown>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-slate-600 font-mono text-sm">
                &gt; Awaiting execution parameters.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
