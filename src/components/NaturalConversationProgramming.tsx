import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Terminal, Send, Command, Bot, Sparkles,
  Settings2, Trash2, Cloud,
  Copy, Check, Loader2, CircleDot,
  FileText, Gamepad2, Mic2, Image as ImageIcon, Box, ShieldCheck, Map,
} from 'lucide-react';
import Markdown from 'react-markdown';
import type { SectionId } from '../types';

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
  /** local-only messages (e.g. generated images) are not in D1 history */
  localOnly?: boolean;
}

const SESSION_KEY = 'aura-chat-session';
const SEEN_KEY = 'aura-chat-seen-id'; // last message id rendered in this session

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

// ── Capability chips: one tap = a serious, fully-formed creation prompt. ──
// "If someone can think it, we can create it." Each chip either seeds the
// composer with an expert prompt or routes to the dedicated surface (3D).
interface Capability {
  icon: any;
  label: string;
  hint: string;
  /** prompt seeded into the composer (multi-line prompts encouraged) */
  prompt?: string;
  /** or navigate to a dedicated surface */
  navigate?: SectionId;
}

const CAPABILITIES: Capability[] = [
  {
    icon: FileText, label: 'Research paper', hint: 'structured, citable, thorough',
    prompt: 'Write a research paper on <topic>. Structure it with an abstract, introduction, methodology, findings, discussion, limitations, and references section. Be rigorous about what is established fact vs. open question.',
  },
  {
    icon: ShieldCheck, label: 'Enterprise app', hint: 'regulatory-grade specs',
    prompt: 'Design a regulatory-compliant enterprise application for <industry, e.g. healthcare claims processing>. Produce: (1) compliance requirements mapped to the governing regulations, (2) a data-handling and audit-trail architecture, (3) role-based access model, (4) the full technical spec with API surface, and (5) a phased build plan.',
  },
  {
    icon: Gamepad2, label: 'Video game', hint: 'design doc → playable code',
    prompt: 'Create a video game: <one-line concept>. First produce a tight game design doc (core loop, mechanics, progression, art direction), then implement a playable browser prototype in a single HTML file with canvas rendering and keyboard controls.',
  },
  {
    icon: Mic2, label: 'Podcast', hint: 'script, segments, show notes',
    prompt: 'Produce a complete podcast episode package on <topic>: a natural two-host script with distinct voices (~15 min), cold-open hook, segment breakdown with timestamps, ad-break placement, and publish-ready show notes with links.',
  },
  {
    icon: Map, label: 'Deep plan', hint: 'spec-grade project planning',
    prompt: 'Build an extreme-depth execution plan for <project>. Include: vision & MVP cut, complete requirements matrix (functional + non-functional), architecture with tradeoffs considered, risk register with mitigations, week-by-week roadmap, and the definition of done for every milestone.',
  },
  {
    icon: ImageIcon, label: 'Image', hint: 'FLUX on the edge — type /image',
    prompt: '/image ',
  },
  {
    icon: Box, label: '3D model', hint: 'text → real mesh → .glb',
    navigate: 'viewport3d',
  },
];

interface NcpProps {
  onNavigate?: (id: SectionId) => void;
}

export const NaturalConversationProgramming = ({ onNavigate }: NcpProps) => {
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
  const [error, setError] = useState<string | null>(null);

  // Per-run tracking. activeRun = the instanceId we're currently polling.
  const [activeRun, setActiveRun] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<string>('idle'); // idle | queued | running | paused | complete | errored
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const seenIdRef = useRef<string>(localStorage.getItem(SEEN_KEY) || '');

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

  // Initial load
  useEffect(() => {
    refreshHistory();
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

  // ── /image <prompt> → real FLUX generation on Workers AI, stored in R2. ──
  const generateImage = async (prompt: string) => {
    setIsGeneratingImage(true);
    const tempId = `img-user-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: tempId, role: 'user', content: `/image ${prompt}`,
      created_at: new Date().toISOString(), localOnly: true,
    }]);
    try {
      const res = await fetch('/api/media/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        throw new Error(data.error || (res.status === 404
          ? 'Image generation runs on the production edge (aura.massivenumber.com), not the local dev server.'
          : `Image generation failed (${res.status})`));
      }
      setMessages(prev => [...prev, {
        id: `img-ai-${Date.now()}`,
        role: 'ai',
        content: `![${prompt}](${data.url})\n\n*${prompt}* — generated with FLUX.2 on Workers AI, stored in R2.`,
        created_at: new Date().toISOString(),
        localOnly: true,
      }]);
    } catch (e: any) {
      setError(e.message || 'Image generation failed.');
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || activeRun || isGeneratingImage) return; // don't queue two runs at once
    const userText = input.trim();
    setInput('');
    setError(null);

    // Slash command: /image <prompt>
    if (userText.toLowerCase().startsWith('/image ')) {
      await generateImage(userText.slice(7).trim());
      return;
    }

    // Optimistic: show the user's message immediately.
    const tempId = `pending-${Date.now()}`;
    setMessages(prev => [...prev, { id: tempId, role: 'user', content: userText, created_at: new Date().toISOString() }]);
    setRunStatus('queued');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText, context: 'chat', sessionId }),
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

  const applyCapability = (cap: Capability) => {
    if (cap.navigate) {
      onNavigate?.(cap.navigate);
      return;
    }
    if (cap.prompt) {
      setInput(cap.prompt);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        // put the caret at the first <placeholder> for instant editing
        const idx = cap.prompt!.indexOf('<');
        if (idx >= 0) inputRef.current?.setSelectionRange(idx, cap.prompt!.indexOf('>') + 1);
      });
    }
  };

  const clearChat = async () => {
    if (!confirm('Start a fresh conversation? This clears the local view. The cloud history remains until you clear it from the dashboard.')) return;
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SEEN_KEY);
    seenIdRef.current = '';
    setActiveRun(null);
    setRunStatus('idle');
    setMessages([]);
    // reload to pick up a fresh sessionId
    setTimeout(() => window.location.reload(), 100);
  };

  const busy = activeRun !== null || isGeneratingImage;
  const statusLabel: Record<string, string> = {
    idle: '', queued: 'Queued…', running: 'Working…', paused: 'Needs input', complete: 'Done', errored: 'Error',
  };
  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-full bg-[#0a0f1c] relative">
      {/* Header */}
      <div className="h-14 border-b border-slate-800/60 flex items-center justify-between px-6 bg-slate-900/40 backdrop-blur z-10 sticky top-0">
        <h2 className="text-[15px] font-semibold text-slate-100 flex items-center gap-2.5">
          <Terminal className="w-4 h-4 text-indigo-400" /> Create
          <span className="hidden md:inline text-[11px] font-normal text-slate-500">— natural conversation programming</span>
        </h2>
        <div className="flex items-center gap-2">
          {busy && (
            <span className="flex items-center gap-1.5 text-xs font-mono px-3 py-1 rounded-full border bg-indigo-500/10 border-indigo-500/30 text-indigo-300">
              <Loader2 className="w-3 h-3 animate-spin" />
              {isGeneratingImage ? 'Painting…' : statusLabel[runStatus] || 'Working…'}
            </span>
          )}
          <span className="flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded-full border bg-emerald-400/10 border-emerald-500/20 text-emerald-400" title="The AI runs in a durable Cloudflare Workflow — it keeps working after you close the tab.">
            <Cloud className="w-3 h-3" /> DURABLE
          </span>
          <button
            onClick={clearChat}
            title="Start fresh"
            className="p-2 hover:bg-slate-800 rounded-lg text-slate-500 hover:text-rose-300 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsOptionsOpen(!isOptionsOpen)}
            title="Runtime details"
            className={`p-2 rounded-lg transition-colors ${isOptionsOpen ? 'bg-slate-800 text-white' : 'hover:bg-slate-800 text-slate-500 hover:text-white'}`}
          >
            <Settings2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Honest runtime panel (replaces the old decorative provider/model pickers) */}
      <AnimatePresence>
        {isOptionsOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border-b border-slate-800/60 bg-slate-900/40"
          >
            <div className="px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-mono">
              <div>
                <div className="text-slate-600 uppercase tracking-wider text-[10px] mb-1">Model</div>
                <div className="text-slate-300">kimi-k2.6 · Workers AI</div>
              </div>
              <div>
                <div className="text-slate-600 uppercase tracking-wider text-[10px] mb-1">Execution</div>
                <div className="text-slate-300">Durable Workflow · ≤6 turns</div>
              </div>
              <div>
                <div className="text-slate-600 uppercase tracking-wider text-[10px] mb-1">Memory</div>
                <div className="text-slate-300">D1 · full thread persisted</div>
              </div>
              <div>
                <div className="text-slate-600 uppercase tracking-wider text-[10px] mb-1">Images</div>
                <div className="text-slate-300">/image → FLUX.2 → R2</div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 overflow-y-auto">
        {/* Hero empty state — the first impression */}
        {isEmpty && (
          <div className="h-full flex flex-col items-center justify-center px-6 pb-24">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center max-w-2xl"
            >
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight bg-gradient-to-r from-slate-100 via-indigo-200 to-slate-300 bg-clip-text text-transparent">
                What should we build?
              </h1>
              <p className="mt-3 text-sm text-slate-500">
                Describe it in plain language. The AI keeps working even if you close the tab —
                your conversation is preserved exactly as you left it.
              </p>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 }}
              className="mt-8 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 w-full max-w-4xl"
            >
              {CAPABILITIES.map(cap => {
                const Icon = cap.icon;
                return (
                  <button
                    key={cap.label}
                    onClick={() => applyCapability(cap)}
                    className="group flex flex-col items-start gap-1.5 p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 hover:border-indigo-500/40 hover:bg-slate-900 transition-all text-left"
                  >
                    <Icon className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 transition-colors" />
                    <span className="text-[12px] font-medium text-slate-300">{cap.label}</span>
                    <span className="text-[10px] leading-tight text-slate-600">{cap.hint}</span>
                  </button>
                );
              })}
            </motion.div>
          </div>
        )}

        {/* Conversation */}
        {!isEmpty && (
          <div className="p-6 md:p-10 space-y-8">
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
                      {isGeneratingImage ? 'Generating image…' : runStatus === 'queued' ? 'Queued…' : 'Working — safe to close this tab'}
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {error && (
        <div className="mx-6 mb-2 px-4 py-2 bg-rose-500/10 border border-rose-500/30 rounded-lg text-xs text-rose-300 font-mono flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-200 ml-3">dismiss</button>
        </div>
      )}

      <div className="px-6 pb-6 pt-2 bg-transparent relative z-20">
        {/* Compact capability strip once a conversation exists */}
        {!isEmpty && !busy && (
          <div className="flex gap-1.5 mb-2 overflow-x-auto pb-1">
            {CAPABILITIES.map(cap => {
              const Icon = cap.icon;
              return (
                <button
                  key={cap.label}
                  onClick={() => applyCapability(cap)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/70 border border-slate-800 hover:border-indigo-500/40 text-[11px] text-slate-400 hover:text-slate-200 whitespace-nowrap transition-colors"
                >
                  <Icon className="w-3 h-3" /> {cap.label}
                </button>
              );
            })}
          </div>
        )}

        <div className="relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={busy ? 'Aura is working — safe to close the tab…' : 'Describe anything. Research, apps, games, images (/image), specs…'}
            disabled={busy}
            className="w-full bg-slate-900 border border-slate-800 rounded-2xl pl-5 pr-16 py-4 text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/40 outline-none resize-none overflow-hidden disabled:opacity-60 shadow-lg shadow-black/20"
            rows={1}
            style={{ minHeight: '60px', maxHeight: '220px' }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || busy}
            className="absolute right-2.5 top-2.5 p-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-xl transition-colors flex items-center justify-center"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-600 font-mono">
          <div className="flex gap-4 items-center flex-wrap">
            <span className="flex items-center gap-1"><Command className="w-3 h-3" /> Enter to send · Shift+Enter for a new line</span>
            <span className="flex items-center gap-1"><Sparkles className="w-3 h-3 text-indigo-400/70" /> Durable — survives tab close</span>
          </div>
          <span>≈{Math.round(input.length * 0.25)} tokens</span>
        </div>
      </div>
    </div>
  );
};
