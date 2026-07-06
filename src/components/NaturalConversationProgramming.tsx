import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Terminal, Send, Command, FolderGit2, Bot, Cpu, Sparkles,
  Settings2, Network, HardDrive, Trash2, Cloud, CloudOff,
  Copy, Check, Loader2, CircleDot
} from 'lucide-react';
import Markdown from 'react-markdown';

// Durable chat: the AI runs in a Cloudflare Workflow that survives this
// browser closing. POST /api/chat returns an instanceId immediately; we poll
// /api/chat/history and render each turn as the Workflow writes it to D1.
// Every message keeps its true role (user/ai/system) — never conflated.

interface ServerMessage {
  id: string;
  role: 'user' | 'ai' | 'system';
  content: string;
  instance_id?: string;
  created_at?: string;
}

const SESSION_KEY = 'aura-chat-session';
const SETTINGS_KEY = 'aura-chat-settings';
const SEEN_KEY = 'aura-chat-seen-id'; // last message id rendered in this session

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

function loadSettings(): ChatSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { return DEFAULT_SETTINGS; }
}

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
  const [sessionId] = useState<string>(() => {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
    return id;
  });

  const [messages, setMessages] = useState<ServerMessage[]>([]);
  const [input, setInput] = useState('');
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [settings, setSettings] = useState<ChatSettings>(() => loadSettings());
  const [error, setError] = useState<string | null>(null);

  // Per-run tracking. activeRun = the instanceId we're currently polling.
  const [activeRun, setActiveRun] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<string>('idle'); // idle | queued | running | paused | complete | errored
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const seenIdRef = useRef<string>(localStorage.getItem(SEEN_KEY) || '');

  const updateSetting = <K extends keyof ChatSettings>(k: K, v: ChatSettings[K]) => {
    setSettings(prev => {
      const next = { ...prev, [k]: v };
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  // ── Load history on mount (this is what makes "leave and come back" work).
  // Whatever the Workflow produced while you were away is right here.
  const refreshHistory = useCallback(async (): Promise<ServerMessage[]> => {
    try {
      const url = `/api/chat/history?sessionId=${encodeURIComponent(sessionId)}` +
        (seenIdRef.current ? `&sinceId=${encodeURIComponent(seenIdRef.current)}` : '');
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      const msgs: ServerMessage[] = (data.messages ?? []).map((m: any) => ({
        id: m.id, role: m.role, content: m.content, instance_id: m.instance_id, created_at: m.created_at,
      }));
      if (msgs.length > 0) {
        // advance the cursor
        seenIdRef.current = msgs[msgs.length - 1].id;
        localStorage.setItem(SEEN_KEY, seenIdRef.current);
        setMessages(prev => {
          const existing = new Set(prev.map(m => m.id));
          const merged = [...prev, ...msgs.filter(m => !existing.has(m.id))];
          return merged;
        });
      }
      return msgs;
    } catch { return []; }
  }, [sessionId]);

  // Initial load + on sessionId change
  useEffect(() => {
    // On a fresh session, show a welcome message. On a returning session,
    // history will populate from the server.
    refreshHistory().then((msgs) => {
      if (msgs.length === 0 && !localStorage.getItem('aura-chat-seen-init')) {
        localStorage.setItem('aura-chat-seen-init', '1');
        setMessages([{
          id: 'sys-init',
          role: 'system',
          content: 'Aura Engine initialized. Describe what to build — the AI keeps working even after you close this tab, and your full history is preserved when you return.',
          created_at: new Date().toISOString(),
        }]);
      }
    });
  }, [refreshHistory]);

  // ── Poll an active run until it finishes (or pauses for input).
  useEffect(() => {
    if (!activeRun) return;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      // Pull any new messages AND the run status together.
      await refreshHistory();
      try {
        const res = await fetch(`/api/chat/status?instanceId=${encodeURIComponent(activeRun!)}`);
        if (res.ok) {
          const data = await res.json();
          const s = data.run || data.status || 'running';
          setRunStatus(s);
          if (s === 'complete' || s === 'errored') {
            // Final drain, then stop polling.
            await refreshHistory();
            setActiveRun(null);
            setRunStatus('idle');
            return;
          }
          if (s === 'paused') {
            // Blocked — keep the run active in the UI so the user sees the question.
            // We stop polling; the user replies with a new message which starts a new run.
            setActiveRun(null);
            return;
          }
        }
      } catch { /* transient — keep polling */ }
      pollRef.current = setTimeout(poll, 1500);
    };

    poll();
    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [activeRun, refreshHistory]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || activeRun) return; // don't queue two runs at once
    const userText = input.trim();
    setInput('');
    setError(null);

    // Optimistic: show the user's message immediately.
    const tempId = `pending-${Date.now()}`;
    setMessages(prev => [...prev, { id: tempId, role: 'user', content: userText, created_at: new Date().toISOString() }]);
    setRunStatus('queued');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          context: 'chat',
          sessionId,
          model: settings.selectedModel,
          agent: settings.selectedAgent,
          provider: settings.selectedProvider,
          project: settings.selectedProject,
          memory: settings.memoryEnabled,
        }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      if (data.fallback === 'sync' && typeof data.text === 'string') {
        // Edge had no Workflow binding (e.g. migration not deployed yet) and
        // returned a single synchronous reply. Render it directly.
        setRunStatus('idle');
        seenIdRef.current = '';
        setMessages(prev => [
          ...prev.filter(m => m.id !== tempId),
          { id: `ai-${Date.now()}`, role: 'ai' as const, content: data.text, created_at: new Date().toISOString() },
        ]);
        return;
      }

      // Durable path: a Workflow instance is now running server-side.
      // Drop the optimistic temp message (the real one will arrive via history
      // polling with its proper server id), and start polling.
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setActiveRun(data.instanceId);
      setRunStatus('running');
      // immediate first poll so the user's own message reappears quickly
      refreshHistory();
    } catch (e: any) {
      setError(e.message || 'Failed to start the AI workflow.');
      setRunStatus('idle');
      // keep the optimistic user message so they know what they asked
    }
  };

  const clearChat = async () => {
    if (!confirm('Start a fresh conversation? This clears the local view. The cloud history remains until you clear it from the dashboard.')) return;
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SEEN_KEY);
    localStorage.removeItem('aura-chat-seen-init');
    seenIdRef.current = '';
    setActiveRun(null);
    setRunStatus('idle');
    setMessages([{
      id: 'sys-init',
      role: 'system',
      content: 'New conversation started. Ready when you are.',
      created_at: new Date().toISOString(),
    }]);
    // reload to pick up a fresh sessionId
    setTimeout(() => window.location.reload(), 100);
  };

  const busy = activeRun !== null;
  const statusLabel: Record<string, string> = {
    idle: '', queued: 'Queued…', running: 'Working…', paused: 'Needs input', complete: 'Done', errored: 'Error',
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0f1c] border-l border-slate-800 relative">
      {/* Header */}
      <div className="h-14 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/50 backdrop-blur z-10 sticky top-0">
        <h2 className="text-lg font-bold text-white flex items-center gap-3">
          <Terminal className="text-indigo-400" /> Natural Conversation Programming
        </h2>
        <div className="flex items-center gap-3">
          {busy && (
            <span className="flex items-center gap-1.5 text-xs font-mono px-3 py-1 rounded-full border bg-indigo-500/10 border-indigo-500/30 text-indigo-300">
              <Loader2 className="w-3 h-3 animate-spin" />
              {statusLabel[runStatus] || 'Working…'}
            </span>
          )}
          <span className="flex items-center gap-1.5 text-xs font-mono px-3 py-1 rounded-full border bg-emerald-400/10 border-emerald-500/20 text-emerald-400">
            <Cloud className="w-3 h-3" /> DURABLE
          </span>
          <button
            onClick={clearChat}
            title="Start fresh"
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
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
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
                  {msg.instance_id && msg.role === 'ai' && (
                    <span className="flex items-center gap-0.5 text-[9px] text-emerald-600">
                      <CircleDot className="w-2.5 h-2.5" /> durable
                    </span>
                  )}
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
          {busy && (
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
                <span className="text-xs font-mono text-emerald-500/70">
                  {runStatus === 'queued' ? 'Queued…' : 'Working — safe to close this tab'}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>

      {error && (
        <div className="mx-6 mb-2 px-4 py-2 bg-rose-500/10 border border-rose-500/30 rounded-lg text-xs text-rose-300 font-mono flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-200 ml-3">dismiss</button>
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
            placeholder={busy ? 'Aura is working — safe to close the tab…' : 'Describe what to build. The AI keeps working after you leave…'}
            disabled={busy}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-4 pr-16 py-4 text-slate-200 placeholder:text-slate-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none resize-none overflow-hidden disabled:opacity-60"
            rows={1}
            style={{ minHeight: '60px', maxHeight: '200px' }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || busy}
            className="absolute right-2 top-2 p-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-lg transition-colors flex items-center justify-center"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-slate-500 font-mono">
          <div className="flex gap-4 items-center flex-wrap">
            <span className="flex items-center gap-1"><Command className="w-3 h-3" /> + Enter to send</span>
            <span className="flex items-center gap-1"><Sparkles className="w-3 h-3 text-indigo-400" /> Durable workflow</span>
            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Cloud className="w-3 h-3" /> Survives tab close
            </span>
          </div>
          <span>≈{Math.round(input.length * 0.25)} tokens</span>
        </div>
      </div>
    </div>
  );
};
