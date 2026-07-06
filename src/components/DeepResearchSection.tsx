import React, { useState } from 'react';
import { Globe, Search, RefreshCw, Languages, FileText, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';
import Markdown from 'react-markdown';

export const DeepResearchSection = () => {
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState('English');
  const [isSearching, setIsSearching] = useState(false);
  const [result, setResult] = useState('');

  const handleSearch = async () => {
    if (!query) return;
    setIsSearching(true);
    setResult('');
    try {
      const res = await fetch('/api/deep-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, language })
      });
      const data = await res.json();
      setResult(data.result);
    } catch (e) {
      setResult('Failed to execute deep research.');
    }
    setIsSearching(false);
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border-l border-slate-800">
      <div className="h-14 border-b border-slate-800 flex items-center px-6 bg-slate-900/50 backdrop-blur z-10 sticky top-0">
        <h2 className="text-lg font-bold text-white flex items-center gap-3">
          <Globe className="text-blue-400" /> Deep Internet Research Swarm
        </h2>
      </div>
      <div className="flex-1 p-6 overflow-y-auto flex gap-6">
        <div className="w-1/3 flex flex-col gap-6">
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-6">
            <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
              <Search className="w-4 h-4 text-slate-400" /> Query Parameters
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Research Topic</label>
                <input 
                  type="text" 
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g. Next-Gen WebGL Frameworks"
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Target Language (Translation)</label>
                <div className="flex items-center bg-slate-900 border border-slate-800 rounded p-2 focus-within:border-blue-500">
                  <Languages className="w-4 h-4 text-slate-500 mr-2" />
                  <input 
                    type="text" 
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="bg-transparent border-none outline-none w-full text-sm text-slate-200"
                  />
                </div>
              </div>
              <button 
                onClick={handleSearch}
                disabled={isSearching || !query}
                className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded font-bold text-sm flex items-center justify-center gap-2 transition-colors shadow-lg shadow-blue-500/20"
              >
                {isSearching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                {isSearching ? 'Swarm Crawling Global Net...' : 'Execute Deep Search'}
              </button>
            </div>
          </div>
          
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-6">
             <h3 className="text-sm font-bold text-slate-300 mb-4">Swarm Telemetry</h3>
             <div className="space-y-2 text-xs text-slate-500 font-mono">
               <div className="flex justify-between"><span>Proxy Nodes:</span> <span className="text-blue-400">1,204 Active</span></div>
               <div className="flex justify-between"><span>Bypass Logic:</span> <span className="text-emerald-400">Enabled</span></div>
               <div className="flex justify-between"><span>Auto-Translate:</span> <span className="text-indigo-400">{language}</span></div>
             </div>
          </div>
        </div>

        <div className="w-2/3 bg-slate-950 border border-slate-800 rounded-xl flex flex-col overflow-hidden">
          <div className="h-10 border-b border-slate-800 flex items-center px-4 bg-slate-900 gap-2">
            <FileText className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Research Report</span>
          </div>
          <div className="p-6 overflow-y-auto flex-1">
            {isSearching ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-500">
                <Globe className="w-12 h-12 mb-4 animate-pulse text-blue-500/50" />
                <p className="text-sm animate-pulse">Agents are scraping foreign technical forums...</p>
              </div>
            ) : result ? (
              <div className="prose prose-invert prose-sm max-w-none text-slate-300 markdown-body">
                <Markdown>{result}</Markdown>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-slate-600">
                <CheckCircle2 className="w-12 h-12 mb-4 opacity-50" />
                <p className="text-sm">Awaiting research directives.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
