import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MessageSquare, X, Send, Bot, Loader2 } from 'lucide-react';
import { SectionId } from '../types';
import { SECTIONS } from './CommandPalette';

interface FloatingAssistantProps {
  currentSection: string;
  onNavigate?: (s: SectionId) => void;
}

// "take me to the quantum emulator" → section match, no LLM round-trip needed
function matchNavIntent(message: string): { id: SectionId; label: string } | null {
  const m = message.toLowerCase().match(/(?:take me to|go to|open|navigate to|show me|jump to|switch to)\s+(?:the\s+)?(.+?)[.!?]?$/);
  if (!m) return null;
  const target = m[1].trim();
  let best: { id: SectionId; label: string } | null = null;
  let bestScore = 0;
  for (const s of SECTIONS) {
    const label = s.label.toLowerCase();
    let score = 0;
    if (label === target) score = 100;
    else if (label.includes(target) || target.includes(label)) score = 60;
    else {
      const words = target.split(/\s+/).filter(w => w.length > 2);
      score = words.filter(w => label.includes(w) || s.id.includes(w)).length * 20;
    }
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return bestScore >= 20 ? best : null;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function FloatingAssistant({ currentSection, onNavigate }: FloatingAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hello! I am your Aura Engine Assistant. How can I help you with this section?' }
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    // Real navigation intent — handled instantly, no LLM needed
    const nav = matchNavIntent(userMessage);
    if (nav && onNavigate) {
      onNavigate(nav.id);
      setMessages(prev => [...prev, { role: 'assistant', content: `Done — you're now in **${nav.label}**.` }]);
      return;
    }

    setIsLoading(true);

    try {
      // The floating assistant uses the synchronous chat endpoint (the main
      // NCP chat uses the durable async Workflow). /api/chat-sync is the
      // single-shot contract kept for lightweight context-aware helpers.
      const res = await fetch('/api/chat-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage, context: currentSection })
      });

      if (!res.ok) {
        throw new Error('Failed to get response');
      }

      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }

      setMessages(prev => [...prev, { role: 'assistant', content: data.text }]);
    } catch (error: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${error.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={`fixed bottom-6 right-6 z-40 p-4 rounded-full shadow-lg shadow-indigo-500/20 transition-all ${
          isOpen ? 'scale-0 opacity-0' : 'scale-100 opacity-100 bg-indigo-600 hover:bg-indigo-500 text-white'
        }`}
        title="Open Assistant"
      >
        <MessageSquare className="w-6 h-6" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-6 right-6 z-50 w-80 sm:w-96 h-[32rem] max-h-[calc(100vh-3rem)] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-500/20 rounded-lg">
                  <Bot className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-200 text-sm">Aura Assistant</h3>
                  <p className="text-xs text-slate-500 font-mono">Context: {currentSection}</p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Chat Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-br-sm'
                        : 'bg-slate-800 text-slate-300 rounded-bl-sm border border-slate-700'
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-slate-800 border border-slate-700 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                    <span className="text-xs text-slate-400">Thinking...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-slate-950 border-t border-slate-800">
              <form onSubmit={handleSubmit} className="flex items-center gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask a question..."
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-full px-4 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
                  disabled={isLoading}
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isLoading}
                  className="p-2 rounded-full bg-indigo-600 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-500 transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
