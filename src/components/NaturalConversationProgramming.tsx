import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Terminal, Send, Command, FolderGit2, Monitor, Bot, Cpu, Sparkles,
  Settings2, ChevronUp, Globe, Database, Search, HardDrive, Network,
  Trash2, Cloud, CloudOff, Copy, Check, FileCode2
} from 'lucide-react';
import Markdown from 'react-markdown';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthProvider';

interface Message {
  id: string;
  role: 'user' | 'ai' | 'system';
  content: string;
  timestamp: Date | any;
}

const LOCAL_KEY = 'aura-chat-history';
const SETTINGS_KEY = 'aura-chat-settings';

interface ChatSettings {
  selectedAgent: string;
  selectedProvider: string;
  selectedModel: string;
  selectedProject: string;
  memoryEnabled: boolean;
}

const DEFAULT_SETTINGS: ChatSettings = {
  selectedAgent: 'architect-v4',
  selectedProvider: 'google',
  selectedModel: 'gemini-1.5-pro',
  selectedProject: 'project-alpha',
  memoryEnabled: true,
};

function loadLocalMessages(): Message[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch { return []; }
}

function saveLocalMessages(msgs: Message[]) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(msgs.slice(-200))); } catch { /* quota */ }
}

function loadSettings(): ChatSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { return DEFAULT_SETTINGS; }
}

// Extract the first fenced code block from markdown, if any.
function extractCode(md: string): { code: string; lang: string } | null {
  const m = md.match(/```([\w-]*)\n([\s\S]*?)```/);
  if (!m) return null;
  return { lang: m[1] || 'text', code: m[2] };
}

function CodeMessage({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const codeInfo = extractCode(content);
  const copy = () => {
    if (!codeInfo) return;
    navigator.clipboard.writeText(codeInfo.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="markdown-body text-sm leading-relaxed max-w-prose">
      <Markdown>{content}</Markdown>
      {codeInfo && (
        <button
          onClick={copy}
          className="mt-2 flex items-center gap-1.5 px-2.5 py-1 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 rounded text-xs font-medium transition-colors"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : `Copy ${codeInfo.lang || 'code'}`}
        </button>
      )}
    </div>
  );
}

export const NaturalConversationProgramming = () => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>(() => {
    const local = loadLocalMessages();
    if (local.length === 0) {
      return [{
        id: 'sys-init',
        role: 'system',
        content: 'Aura Engine Core initialized. Type a request — e.g. "generate a React counter component" or "write a Cloudflare Worker that proxies an API". Code is rendered inline and copyable.',
        timestamp: new Date()
      }];
    }
    return local;
  });
  const [input, setInput] = useState('');
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [settings, setSettings] = useState<ChatSettings>(() => loadSettings());
  const updateSetting = <K extends keyof ChatSettings>(k: K, v: ChatSettings[K]) => {
    setSettings(prev => {
      const next = { ...prev, [k]: v };
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ——— Cloud sync overlay (only when signed in) ———
  // When the user authenticates, we attach a Firestore listener and merge any
  // cloud history that isn't already in local state. We never block the UI on
  // auth: chat works instantly, sign-in just adds cross-device sync.
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'users', user.uid, 'chat'), orderBy('timestamp', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (snapshot.empty) return;
      const cloud = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Message[];
      setMessages(prev => {
        const ids = new Set(prev.map(m => m.id));
        const merged = [...prev];
        let changed = false;
        for (const m of cloud) {
          if (!ids.has(m.id)) { merged.push(m); changed = true; }
        }
        return changed ? merged.sort((a, b) => {
          const ta = a.timestamp?.toMillis?.() ?? (a.timestamp instanceof Date ? a.timestamp.getTime() : 0);
          const tb = b.timestamp?.toMillis?.() ?? (b.timestamp instanceof Date ? b.timestamp.getTime() : 0);
          return ta - tb;
        }) : prev;
      });
    });
    return unsubscribe;
  }, [user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const persistLocal = useCallback((msgs: Message[]) => {
    saveLocalMessages(msgs);
  }, []);

  const handleSend = async () => {
    if (!input.trim() || isGenerating) return;

    const userText = input.trim();
    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: userText,
      timestamp: new Date()
    };
    setMessages(prev => {
      const next = [...prev, userMsg];
      persistLocal(next);
      return next;
    });
    setInput('');
    setIsGenerating(true);
    setError(null);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          context: 'chat',
          model: settings.selectedModel,
          agent: settings.selectedAgent,
          provider: settings.selectedProvider,
          project: settings.selectedProject,
          memory: settings.memoryEnabled
        })
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      // Server returns { text } — never { reply }. The old code read data.reply
      // and so every AI message was persisted as "Processing error."
      const replyText: string = data.text || '*(empty response)*';
      const aiMsg: Message = {
        id: `ai-${Date.now()}`,
        role: 'ai',
        content: replyText,
        timestamp: new Date()
      };
      setMessages(prev => {
        const next = [...prev, aiMsg];
        if (settings.memoryEnabled) {
          next.push({
            id: `sys-${Date.now()}`,
            role: 'system',
            content: `Context synced → [${settings.selectedProject}] · provider: ${settings.selectedProvider}`,
            timestamp: new Date()
          });
        }
        persistLocal(next);
        return next;
      });

      // Mirror to Firestore when signed in (best-effort; failures are non-fatal)
      if (user) {
        const base = { content: undefined as any, timestamp: serverTimestamp() };
        addDoc(collection(db, 'users', user.uid, 'chat'), { ...base, role: 'user', content: userText }).catch(() => {});
        addDoc(collection(db, 'users', user.uid, 'chat'), { ...base, role: 'ai', content: replyText }).catch(() => {});
      }
    } catch (error: any) {
      console.error(error);
      setError(error.message || 'Unknown error');
      setMessages(prev => {
        const next = [...prev, {
          id: `err-${Date.now()}`,
          role: 'system' as const,
          content: `⚠️ ${error.message || 'Error communicating with AI Gateway.'} — your message is preserved locally.`,
          timestamp: new Date()
        }];
        persistLocal(next);
        return next;
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const clearChat = () => {
    if (!confirm('Clear this conversation? Local history will be removed.')) return;
    localStorage.removeItem(LOCAL_KEY);
    setMessages([{
      id: 'sys-init',
      role: 'system',
      content: 'Conversation cleared. Ready when you are.',
      timestamp: new Date()
    }]);
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0f1c] border-l border-slate-800 relative">
      {/* Header */}
      <div className="h-14 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/50 backdrop-blur z-10 sticky top-0">
        <h2 className="text-lg font-bold text-white flex items-center gap-3">
          <Terminal className="text-indigo-400" /> Natural Conversation Programming
        </h2>
        <div className="flex items-center gap-3">
          <span className={`flex items-center gap-1.5 text-xs font-mono px-3 py-1 rounded-full border ${user
            ? 'text-emerald-400 bg-emerald-400/10 border-emerald-500/20'
            : 'text-slate-400 bg-slate-700/30 border-slate-600/40'}`}>
            {user ? <Cloud className="w-3 h-3" /> : <CloudOff className="w-3 h-3" />}
            {user ? 'CLOUD SYNC' : 'LOCAL ONLY'}
          </span>
          <button
            onClick={clearChat}
            title="Clear conversation"
            className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-rose-300 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsOptionsOpen(!isOptionsOpen)}
            className={`p-2 rounded-lg transition-colors ${isOptionsOpen ? 'bg-slate-800 text-white' : 'hover:bg-slate-800 text-slate-400 hover:text-white'}`}
          >
            <Settings2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 md:p-10 space-y-8">
        <AnimatePresence>
          {messages.map((msg, i) => (
            <motion.div
              key={msg.id || i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-4 max-w-4xl ${msg.role === 'user' ? 'ml-auto flex-row-reverse' : ''}`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${
                msg.role === 'user'
                  ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-400'
                  : msg.role === 'system'
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                  : 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
              }`}>
                {msg.role === 'user' ? <Terminal className="w-4 h-4" /> :
                 msg.role === 'system' ? <Command className="w-4 h-4" /> :
                 <Bot className="w-4 h-4" />}
              </div>
              <div className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className="flex items-center gap-2 text-xs font-mono text-slate-500">
                  <span className="font-bold uppercase tracking-wider text-slate-400">
                    {msg.role === 'user' ? 'You' : msg.role === 'system' ? 'System' : 'Aura'}
                  </span>
                </div>
                <div className={`p-4 rounded-xl border ${
                  msg.role === 'user'
                    ? 'bg-indigo-600/10 border-indigo-500/20 text-indigo-100 rounded-tr-sm'
                    : msg.role === 'system'
                    ? 'bg-amber-500/5 border-amber-500/20 text-amber-200/80 font-mono text-sm rounded-tl-sm'
                    : 'bg-slate-900 border-slate-800 text-slate-300 rounded-tl-sm'
                }`}>
                  {msg.role === 'ai'
                    ? <CodeMessage content={msg.content} />
                    : <div className="text-sm leading-relaxed max-w-prose whitespace-pre-wrap">{msg.content}</div>}
                </div>
              </div>
            </motion.div>
          ))}
          {isGenerating && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-4 max-w-4xl"
            >
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border bg-emerald-500/20 border-emerald-500/50 text-emerald-400">
                <Bot className="w-4 h-4 animate-pulse" />
              </div>
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce"></div>
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                </div>
                <span className="text-xs font-mono text-emerald-500/70">Generating…</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>

      {error && (
        <div className="mx-6 mb-2 px-4 py-2 bg-rose-500/10 border border-rose-500/30 rounded-lg text-xs text-rose-300 font-mono">
          {error}
        </div>
      )}

      <div className="p-6 bg-slate-950 border-t border-slate-800 relative z-20">
        <AnimatePresence>
          {isOptionsOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0, marginBottom: 0 }}
              animate={{ opacity: 1, height: 'auto', marginBottom: 24 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 grid grid-cols-2 lg:grid-cols-5 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1"><FolderGit2 className="w-3 h-3" /> Project</label>
                  <select
                    value={settings.selectedProject}
                    onChange={(e) => updateSetting('selectedProject', e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                  >
                    <option value="project-alpha">Global Context</option>
                    <option value="frontend-workspace">Frontend Workspace</option>
                    <option value="backend-services">Backend Services</option>
                    <option value="infrastructure">Infrastructure</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1"><Network className="w-3 h-3" /> Provider</label>
                  <select
                    value={settings.selectedProvider}
                    onChange={(e) => updateSetting('selectedProvider', e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                  >
                    <option value="google">Google GenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="openai">OpenAI</option>
                    <option value="meta">Meta Llama</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1"><Cpu className="w-3 h-3" /> Model</label>
                  <select
                    value={settings.selectedModel}
                    onChange={(e) => updateSetting('selectedModel', e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                  >
                    {settings.selectedProvider === 'google' && (
                      <>
                        <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                        <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                      </>
                    )}
                    {settings.selectedProvider !== 'google' && (
                      <option value="default-model">Default Model</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1"><Bot className="w-3 h-3" /> Agent</label>
                  <select
                    value={settings.selectedAgent}
                    onChange={(e) => updateSetting('selectedAgent', e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                  >
                    <option value="architect-v4">Architect v4</option>
                    <option value="debugger-pro">Debugger Pro</option>
                    <option value="ux-researcher">UX Researcher</option>
                  </select>
                </div>
                <div className="flex flex-col justify-end">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1"><HardDrive className="w-3 h-3" /> Memory</label>
                  <button
                    onClick={() => updateSetting('memoryEnabled', !settings.memoryEnabled)}
                    className={`w-full py-2 px-3 rounded-lg text-sm font-bold border transition-colors flex items-center justify-center gap-2 ${settings.memoryEnabled ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300' : 'bg-slate-800 border-slate-700 text-slate-500'}`}
                  >
                    <div className={`w-2 h-2 rounded-full ${settings.memoryEnabled ? 'bg-indigo-400 animate-pulse' : 'bg-slate-500'}`}></div>
                    {settings.memoryEnabled ? 'RECORDING' : 'PAUSED'}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Describe what to build, or ask for code…  (e.g. 'a React hook for debounced search')"
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-4 pr-16 py-4 text-slate-200 placeholder:text-slate-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none resize-none overflow-hidden"
            rows={1}
            style={{ minHeight: '60px', maxHeight: '200px' }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isGenerating}
            className="absolute right-2 top-2 p-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-lg transition-colors flex items-center justify-center"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-slate-500 font-mono">
          <div className="flex gap-4 items-center flex-wrap">
            <span className="flex items-center gap-1"><Command className="w-3 h-3" /> + Enter to send</span>
            <span className="flex items-center gap-1"><Sparkles className="w-3 h-3 text-indigo-400" /> Context aware</span>
            {settings.memoryEnabled && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                <FileCode2 className="w-3 h-3" /> Code blocks copyable
              </span>
            )}
          </div>
          <span>≈{Math.round(input.length * 0.25)} tokens</span>
        </div>
      </div>
    </div>
  );
};
