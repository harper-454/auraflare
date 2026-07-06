import React, { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { motion } from 'motion/react';
import { 
  FolderTree, FileCode2, Terminal as TerminalIcon, 
  GitBranch, Users, Database, Rocket, Monitor, Box, Zap
} from 'lucide-react';

import { AuthTab } from './AuthTab';
import { DeployTab } from './ide/DeployTab';
import { McpTab } from './ide/McpTab';
import { ClawTab } from './ide/ClawTab';
import { Model3DTab } from './ide/Model3DTab';
import { DeployView } from './ide/DeployView';
import { McpView } from './ide/McpView';
import { ClawView } from './ide/ClawView';
import { Model3DView } from './ide/Model3DView';

export const IdeWorkspaceSection = () => {
  const [activeTab, setActiveTab] = useState<'editor' | 'terminal' | 'git' | 'collab' | 'auth' | 'deploy' | 'mcp' | 'claw' | '3d'>('editor');
  
  // States for sub-tabs
  const [activeDeploy, setActiveDeploy] = useState('cloudflare');
  const [active3dMode, setActive3dMode] = useState('character.glb');
  
  const [files, setFiles] = useState<any[]>([]);
  const [activeFile, setActiveFile] = useState('main.ts');
  const [cwd, setCwd] = useState('/');
  const [fileContent, setFileContent] = useState('Loading...');
  
  const terminalRef = useRef<HTMLDivElement>(null);
  const termInstance = useRef<Terminal | null>(null);
  
  const [commits, setCommits] = useState<any[]>([]);
  
  useEffect(() => {
    if (activeTab === 'git') {
      fetch('/api/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'git log -n 5 --pretty=format:"%h|%s|%an" || echo "a1b2c3d|Initial commit|System"' })
      })
      .then(r => r.json())
      .then(data => {
        if (data.stdout) {
          const lines = data.stdout.split('\n').filter(Boolean);
          setCommits(lines.map(line => {
            const [id, message, author] = line.split('|');
            return { id, message, author: author || 'Unknown' };
          }));
        }
      });
    }
  }, [activeTab]);

  const handleCommit = () => {
    if (commitMessage) {
      fetch('/api/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'git add . && git commit -m "' + commitMessage + '"' })
      })
      .then(() => {
        setCommitMessage('');
        setActiveTab('editor');
        setTimeout(() => setActiveTab('git'), 50); // hack to re-trigger useEffect
      });
    }
  };

  const [commitMessage, setCommitMessage] = useState('');

  // Fetch directory contents
  useEffect(() => {
    fetch('/api/fs/read?path=' + cwd)
      .then(r => r.json())
      .then(data => {
        if (data && data.type === 'dir') {
          setFiles(data.files);
        }
      })
      .catch(() => {});
  }, [cwd]);

  // Fetch file contents
  useEffect(() => {
    if (!activeFile) return;
    setFileContent('Loading...');
    fetch('/api/fs/read?path=' + (cwd === '/' ? '' : cwd + '/') + activeFile)
      .then(r => r.json())
      .then(data => {
        if (data && data.type === 'file') {
          setFileContent(data.content);
        }
      })
      .catch(() => {});
  }, [activeFile, cwd]);

  const saveFile = () => {
    fetch('/api/fs/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: (cwd === '/' ? '' : cwd + '/') + activeFile,
        content: fileContent
      })
    })
    .then(r => r.json())
    .then(data => {
      if (data && data.success && termInstance.current) {
        termInstance.current.writeln('\x1b[32mSaved ' + activeFile + '\x1b[0m');
      }
    })
    .catch(() => {});
  };
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveFile();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeFile, fileContent, cwd]);

  useEffect(() => {
    if (activeTab === 'terminal' && terminalRef.current && !termInstance.current) {
      const term = new Terminal({
        theme: { background: '#0f172a', foreground: '#e2e8f0' },
        fontFamily: 'JetBrains Mono, monospace',
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalRef.current);
      fitAddon.fit();
      term.writeln('\x1b[1;34m$ \x1b[0m Aura Engine Embedded Terminal');
      
      let inputBuffer = '';
      term.onData(data => {
        if (data === '\r') {
          term.writeln('');
          const cmd = inputBuffer;
          inputBuffer = '';
          if (cmd.trim() !== '') {
            fetch('/api/exec', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ command: cmd, cwd: '.' })
            })
            .then(r => r.json())
            .then(res => {
              if (res.stdout) term.write(res.stdout.replace(/\n/g, '\r\n'));
              if (res.stderr) term.write('\x1b[31m' + res.stderr.replace(/\n/g, '\r\n') + '\x1b[0m');
              if (res.error) term.write('\x1b[31mError: ' + res.error + '\x1b[0m\r\n');
              term.write('\x1b[1;34m$ \x1b[0m');
            })
            .catch(err => {
              term.write('\x1b[31mError: ' + err.message + '\x1b[0m\r\n');
              term.write('\x1b[1;34m$ \x1b[0m');
            });
          } else {
            term.write('\x1b[1;34m$ \x1b[0m');
          }
        } else if (data === '\u007F') {
          if (inputBuffer.length > 0) {
            inputBuffer = inputBuffer.slice(0, -1);
            term.write('\b \b');
          }
        } else {
          inputBuffer += data;
          term.write(data);
        }
      });
      termInstance.current = term;
    }
  }, [activeTab]);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="h-[700px] flex flex-col mt-6 bg-slate-900 border border-slate-700/50 rounded-xl overflow-hidden shadow-2xl shadow-black/50"
    >
      <div className="h-12 bg-slate-950 border-b border-slate-800 flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <FolderTree className="w-3 h-3 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-200 leading-tight">Aura IDE / Preview</h2>
            <p className="text-[10px] text-slate-400">Integrated Dev Environment & MVP Hub</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1 bg-slate-900 border border-slate-800 rounded-full">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-[10px] font-medium text-slate-300">Live Workspace</span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Activity Bar */}
        <div className="w-14 bg-slate-950 border-r border-slate-800 flex flex-col items-center py-4 gap-4 shrink-0">
          <button onClick={() => setActiveTab('editor')} className={`p-2 rounded-lg transition-colors ${activeTab === 'editor' ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500 hover:text-slate-300'}`} title="Explorer"><FileCode2 className="w-5 h-5" /></button>
          <button onClick={() => setActiveTab('terminal')} className={`p-2 rounded-lg transition-colors ${activeTab === 'terminal' ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500 hover:text-slate-300'}`} title="Terminal"><TerminalIcon className="w-5 h-5" /></button>
          <button onClick={() => setActiveTab('git')} className={`p-2 rounded-lg transition-colors ${activeTab === 'git' ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500 hover:text-slate-300'}`} title="Source Control"><GitBranch className="w-5 h-5" /></button>
          <button onClick={() => setActiveTab('collab')} className={`p-2 rounded-lg transition-colors ${activeTab === 'collab' ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500 hover:text-slate-300'}`} title="Collaboration"><Users className="w-5 h-5" /></button>
          <button onClick={() => setActiveTab('auth')} className={`p-2 rounded-lg transition-colors ${activeTab === 'auth' ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500 hover:text-slate-300'}`} title="Database & Auth"><Database className="w-5 h-5" /></button>
          <div className="w-6 h-px bg-slate-800 my-1"></div>
          <button onClick={() => setActiveTab('deploy')} className={`p-2 rounded-lg transition-colors ${activeTab === 'deploy' ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-500 hover:text-slate-300'}`} title="Deploy & Integrations"><Rocket className="w-5 h-5" /></button>
          <button onClick={() => setActiveTab('mcp')} className={`p-2 rounded-lg transition-colors ${activeTab === 'mcp' ? 'bg-amber-500/20 text-amber-400' : 'text-slate-500 hover:text-slate-300'}`} title="MCP & API"><Zap className="w-5 h-5" /></button>
          <button onClick={() => setActiveTab('claw')} className={`p-2 rounded-lg transition-colors ${activeTab === 'claw' ? 'bg-blue-500/20 text-blue-400' : 'text-slate-500 hover:text-slate-300'}`} title="Claw Desktop Remote"><Monitor className="w-5 h-5" /></button>
          <button onClick={() => setActiveTab('3d')} className={`p-2 rounded-lg transition-colors ${activeTab === '3d' ? 'bg-purple-500/20 text-purple-400' : 'text-slate-500 hover:text-slate-300'}`} title="3D Generation"><Box className="w-5 h-5" /></button>
        </div>

        {/* Secondary Sidebar */}
        <div className="w-64 bg-[#0f172a] border-r border-slate-800 flex flex-col">
          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === 'editor' && (
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">Explorer</h3>
                <div className="space-y-1">
                  <div 
                    onClick={() => {
                      if (cwd !== '/') {
                        const parts = cwd.split('/');
                        parts.pop();
                        setCwd(parts.join('/') || '/');
                      }
                    }}
                    className="flex items-center gap-2 text-sm text-slate-300 p-1.5 hover:bg-slate-800 rounded cursor-pointer font-mono"
                  >
                    <FolderTree className="w-4 h-4 text-indigo-400" /> {cwd} {cwd !== '/' && '(..)'}
                  </div>
                  {files.sort((a, b) => b.isDir - a.isDir).map((file) => (
                    <div 
                      key={file.name}
                      onClick={() => {
                        if (file.isDir) {
                          setCwd(cwd === '/' ? file.name : cwd + '/' + file.name);
                        } else {
                          setActiveFile(file.name);
                        }
                      }}
                      className={`flex items-center gap-2 text-sm p-1.5 hover:bg-slate-800 rounded cursor-pointer pl-6 font-mono ${activeFile === file.name && !file.isDir ? 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/20' : 'text-slate-400'}`}
                    >
                      {file.isDir ? (
                        <FolderTree className="w-4 h-4 text-blue-400" />
                      ) : (
                        <FileCode2 className={`w-4 h-4 ${file.name.endsWith('.ts') || file.name.endsWith('.tsx') ? 'text-emerald-400' : 'text-amber-400'}`} />
                      )}
                      {file.name}
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {activeTab === 'terminal' && (
              <div className="text-sm text-slate-400">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">Terminal Sessions</h3>
                <div className="p-2 bg-slate-800 rounded text-slate-200 border border-slate-700 flex items-center justify-between">
                  <span>bash</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                </div>
              </div>
            )}
            
            {activeTab === 'git' && (
              <div className="text-sm text-slate-400">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">Source Control</h3>
                <div className="space-y-3">
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded">
                    <input 
                      type="text" 
                      placeholder="Message (Enter to commit)" 
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleCommit(); }}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs mb-2 text-slate-200" 
                    />
                    <button 
                      onClick={handleCommit}
                      className="w-full py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs"
                    >
                      Commit
                    </button>
                  </div>
                  <div>
                    <h4 className="text-xs font-medium text-slate-300 mb-2">Recent Commits ({commits.length})</h4>
                    <div className="space-y-1">
                      {commits.map(commit => (
                        <div key={commit.id} className="p-2 bg-slate-900 border border-slate-800 rounded">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] text-slate-500 font-mono">{commit.id}</span>
                            <span className="text-[10px] text-indigo-400">{commit.author}</span>
                          </div>
                          <p className="text-xs text-slate-300">{commit.message}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {activeTab === 'collab' && (
              <div className="text-sm text-slate-400">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">Live Collaboration</h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-2 bg-emerald-500/10 border border-emerald-500/20 rounded">
                    <span className="text-emerald-400 text-xs font-bold flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Yjs Sync Active</span>
                  </div>
                  <h4 className="text-xs font-medium text-slate-300 mt-4 mb-2">Connected Peers</h4>
                  <div className="flex items-center gap-2 p-2 hover:bg-slate-800 rounded">
                    <div className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center text-white text-xs font-bold">You</div>
                    <span className="text-xs text-slate-300">Human</span>
                  </div>
                  <div className="flex items-center gap-2 p-2 hover:bg-slate-800 rounded">
                    <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center text-white text-xs font-bold">AI</div>
                    <span className="text-xs text-slate-300">Aura Agent</span>
                  </div>
                </div>
              </div>
            )}
            
            {activeTab === 'deploy' && <DeployTab activeDeploy={activeDeploy} setActiveDeploy={setActiveDeploy} />}
            {activeTab === 'mcp' && <McpTab />}
            {activeTab === 'claw' && <ClawTab />}
            {activeTab === '3d' && <Model3DTab active3dMode={active3dMode} setActive3dMode={setActive3dMode} />}
            {activeTab === 'auth' && (
               <div>
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">Database & Auth</h3>
                  <p className="text-xs text-slate-400 mb-4">Firebase / Cloud SQL settings are shown in the main view.</p>
               </div>
            )}
          </div>
        </div>

        {/* Main Area */}
        <div className="flex-1 bg-[#1e1e1e] flex flex-col overflow-hidden relative">
          {activeTab === 'deploy' && <DeployView target={activeDeploy} />}
          {activeTab === 'mcp' && <McpView />}
          {activeTab === 'claw' && <ClawView />}
          {activeTab === '3d' && <Model3DView mode={active3dMode} />}
          {activeTab === 'auth' && <AuthTab />}
          
          {(activeTab === 'editor' || activeTab === 'git' || activeTab === 'collab') && (
            <>
              <div className="bg-[#252526] border-b border-[#1e1e1e] flex items-center justify-between text-sm text-slate-400 font-mono">
                <div className="px-4 py-2 bg-[#1e1e1e] border-t-2 border-indigo-500 text-slate-200">
                  {cwd === '/' ? '' : cwd + '/'}{activeFile}
                </div>
                <div className="pr-4 text-xs">
                  <button onClick={saveFile} className="hover:text-indigo-400 transition-colors">Save (Cmd+S)</button>
                </div>
              </div>
              <div className="flex-1">
                <Editor
                  height="100%"
                  language={activeFile?.endsWith('.css') ? 'css' : activeFile?.endsWith('.json') ? 'json' : activeFile?.endsWith('.html') ? 'html' : 'typescript'}
                  theme="vs-dark"
                  value={fileContent}
                  onChange={(val) => {
                    setFileContent(val || '');
                  }}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 14,
                    fontFamily: 'JetBrains Mono, monospace',
                    wordWrap: 'on',
                    padding: { top: 16 }
                  }}
                />
              </div>
            </>
          )}

          {activeTab === 'terminal' && (
             <div className="flex-1 p-2 bg-[#0f172a]">
                <div ref={terminalRef} className="h-full w-full" />
             </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};
