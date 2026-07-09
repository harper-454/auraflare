import { motion, AnimatePresence } from 'motion/react';
import { Settings, X, Moon, Sun, Download, Upload, LayoutGrid, Bot, KeyRound, LogIn } from 'lucide-react';
import { useEffect, useState } from 'react';
import { StorageService } from '../lib/storage';
import { SECTIONS, GROUP_LABELS, GROUP_ORDER, getHiddenSections, setHiddenSections } from '../sections';
import { getProviderSettings, saveProviderSettings, getGeminiOAuthToken, newId, PROVIDER_TEMPLATES, testProvider, type CustomProvider, type ProviderSettings, type PreferredProvider } from '../lib/ai-providers';
import { useAuth } from './AuthProvider';
import type { SectionId } from '../types';

type Tab = 'general' | 'features' | 'providers';

/**
 * BYO-model settings. Chain order: Google sign-in (Gemini OAuth) → the provider
 * list below, top to bottom → AuraFlare Cloud (built-in, always-on fallback).
 * Providers are added from templates (Gemini / ChatGPT / Claude / Openference /
 * local LLMs) or fully custom — anything OpenAI-compatible works.
 */
function ProvidersTab() {
  const { user, signIn } = useAuth();
  const [settings, setSettings] = useState<ProviderSettings>(() => getProviderSettings());
  const [hasOAuth, setHasOAuth] = useState<boolean>(() => !!getGeminiOAuthToken());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // per-rung health-check state: id → testing | {ok, ms, reply?/error?}
  const [tests, setTests] = useState<Record<string, 'testing' | Awaited<ReturnType<typeof testProvider>>>>({});

  const runTest = async (id: PreferredProvider) => {
    setTests(t => ({ ...t, [id]: 'testing' }));
    const result = await testProvider(id);
    setTests(t => ({ ...t, [id]: result }));
  };

  const testBadge = (id: string) => {
    const t = tests[id];
    if (!t) return null;
    if (t === 'testing') return <span className="text-[9px] text-slate-500 animate-pulse">testing…</span>;
    return t.ok
      ? <span className="text-[9px] text-emerald-400" title={`replied: ${t.reply}`}>✓ {t.ms} ms</span>
      : <span className="text-[9px] text-rose-400" title={t.error}>✗ {t.error?.slice(0, 48)}</span>;
  };

  const commit = (next: ProviderSettings) => { setSettings(next); saveProviderSettings(next); };
  const patch = (id: string, p: Partial<CustomProvider>) =>
    commit({ providers: settings.providers.map(x => x.id === id ? { ...x, ...p } : x) });
  const move = (id: string, dir: -1 | 1) => {
    const list = [...settings.providers];
    const i = list.findIndex(x => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    commit({ providers: list });
  };

  const field = (label: string, value: string | undefined, placeholder: string, onChange: (v: string) => void, type: 'password' | 'text' = 'text') => (
    <label className="block">
      <span className="text-[10px] font-medium text-slate-500">{label}</span>
      <input
        type={type}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="mt-0.5 w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
      />
    </label>
  );

  return (
    <div className="space-y-4 overflow-y-auto pr-1" style={{ maxHeight: 'calc(100vh - 16rem)' }}>
      <p className="text-xs text-slate-500">
        Bring your own models. Tried top to bottom; AuraFlare Cloud is the built-in default and final fallback. Keys never leave this browser.
      </p>

      <div>
        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Sign in (OAuth first)</h3>
        <button
          onClick={async () => { await signIn(); setHasOAuth(!!getGeminiOAuthToken()); }}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 rounded-md text-xs font-medium transition-colors"
        >
          <LogIn className="w-3.5 h-3.5" />
          {user ? `Signed in as ${user.email ?? user.displayName ?? 'Google user'}` : 'Sign in with Google (Gemini)'}
        </button>
        <p className={`mt-1.5 text-[10px] flex items-center gap-2 ${hasOAuth ? 'text-emerald-400' : 'text-slate-600'}`}>
          <span className="flex-1">
            {hasOAuth
              ? '✓ Gemini OAuth active — tried before everything below'
              : user
                ? 'Signed in, but no Gemini token this session — sign in again to grant it.'
                : 'Gemini access with your Google account — no API key needed.'}
          </span>
          {hasOAuth && (
            <>
              {testBadge('oauth')}
              <button
                onClick={() => runTest('oauth')}
                disabled={tests['oauth'] === 'testing'}
                className="px-1.5 py-0.5 text-[9px] font-medium bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded disabled:opacity-40 transition-colors"
              >
                Test
              </button>
            </>
          )}
        </p>
      </div>

      <div className="pt-3 border-t border-slate-800/50">
        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Your providers</h3>

        {settings.providers.length === 0 && (
          <p className="text-[11px] text-slate-600 mb-2">None yet — the built-in default handles everything until you add one.</p>
        )}

        <div className="space-y-1.5">
          {settings.providers.map((p, i) => (
            <div key={p.id} className="bg-slate-900 border border-slate-800 rounded-md">
              <div className="flex items-center gap-2 px-2.5 py-2">
                <input
                  type="checkbox"
                  checked={p.enabled}
                  onChange={e => patch(p.id, { enabled: e.target.checked })}
                  className="accent-indigo-500"
                  title={p.enabled ? 'Enabled' : 'Disabled'}
                />
                <button onClick={() => setExpanded(expanded === p.id ? null : p.id)} className="flex-1 text-left">
                  <span className={`text-xs font-medium ${p.enabled ? 'text-slate-200' : 'text-slate-500'}`}>{p.name}</span>
                  <span className="ml-2 text-[10px] font-mono text-slate-500">{p.model}</span>
                  {!p.apiKey && p.kind !== 'openai' && <span className="ml-2 text-[9px] text-amber-400">no key</span>}
                </button>
                {testBadge(p.id)}
                <button
                  onClick={() => runTest(p.id)}
                  disabled={tests[p.id] === 'testing' || !p.baseUrl || !p.model}
                  className="px-1.5 py-0.5 text-[9px] font-medium bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded disabled:opacity-40 transition-colors"
                  title="Send a tiny prompt through this provider and show latency or the real error"
                >
                  Test
                </button>
                <button onClick={() => move(p.id, -1)} disabled={i === 0} className="text-slate-600 hover:text-slate-300 disabled:opacity-30 text-[10px]" title="Higher priority">▲</button>
                <button onClick={() => move(p.id, 1)} disabled={i === settings.providers.length - 1} className="text-slate-600 hover:text-slate-300 disabled:opacity-30 text-[10px]" title="Lower priority">▼</button>
                <button
                  onClick={() => commit({ providers: settings.providers.filter(x => x.id !== p.id) })}
                  className="text-slate-600 hover:text-rose-400"
                  title="Remove provider"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {expanded === p.id && (
                <div className="px-2.5 pb-2.5 space-y-1.5 border-t border-slate-800/60 pt-2">
                  {field('Name', p.name, 'My provider', v => patch(p.id, { name: v }))}
                  {field('API key', p.apiKey, p.kind === 'openai' && p.baseUrl.includes('localhost') ? 'not needed for local' : 'sk-…', v => patch(p.id, { apiKey: v || undefined }), 'password')}
                  {field('Model', p.model, 'model id', v => patch(p.id, { model: v }))}
                  {field('Base URL', p.baseUrl, 'https://…', v => patch(p.id, { baseUrl: v }))}
                  <p className="text-[9px] text-slate-600">Wire format: {p.kind === 'openai' ? 'OpenAI-compatible (/chat/completions)' : p.kind === 'anthropic' ? 'Anthropic Messages API' : 'Google Gemini REST'}</p>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-2">
          {!pickerOpen ? (
            <button
              onClick={() => setPickerOpen(true)}
              className="w-full px-3 py-1.5 bg-slate-900 border border-dashed border-slate-700 hover:border-indigo-500 text-slate-400 hover:text-indigo-300 rounded-md text-[11px] font-medium transition-colors"
            >
              + Add provider
            </button>
          ) : (
            <div className="space-y-1 bg-slate-900 border border-slate-800 rounded-md p-2">
              {PROVIDER_TEMPLATES.map(t => (
                <button
                  key={t.name}
                  onClick={() => {
                    commit({ providers: [...settings.providers, { id: newId(), name: t.name, kind: t.kind, baseUrl: t.baseUrl, model: t.model, enabled: true }] });
                    setPickerOpen(false);
                    setExpanded(null);
                  }}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-800 transition-colors"
                >
                  <span className="text-xs text-slate-200">{t.name}</span>
                  <span className="block text-[9px] text-slate-500">{t.hint}</span>
                </button>
              ))}
              <button
                onClick={() => {
                  commit({ providers: [...settings.providers, { id: newId(), name: 'Custom provider', kind: 'openai', baseUrl: '', model: '', enabled: true }] });
                  setPickerOpen(false);
                }}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-800 transition-colors"
              >
                <span className="text-xs text-slate-200">Custom…</span>
                <span className="block text-[9px] text-slate-500">Any OpenAI-compatible endpoint — hosted or local.</span>
              </button>
              <button onClick={() => setPickerOpen(false)} className="w-full text-[10px] text-slate-500 hover:text-slate-300 pt-1">cancel</button>
            </div>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2 px-2.5 py-2 bg-slate-900/60 border border-slate-800/60 rounded-md">
          <span className="flex-1">
            <span className="text-xs font-medium text-slate-300">AuraFlare Cloud</span>
            <span className="block text-[9px] text-slate-600">Built-in default & final fallback — Workers AI, no key needed.</span>
          </span>
          {testBadge('cloud')}
          <button
            onClick={() => runTest('cloud')}
            disabled={tests['cloud'] === 'testing'}
            className="px-1.5 py-0.5 text-[9px] font-medium bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded disabled:opacity-40 transition-colors"
          >
            Test
          </button>
        </div>
      </div>

      <div className="pt-3 border-t border-slate-800/50">
        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Built-in default</h3>
        <div className="bg-slate-900 border border-slate-800 rounded-md px-2.5 py-2 flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-200">AuraFlare Cloud</span>
            <span className="block text-[9px] text-slate-500">Free · Workers AI — llama-3.3-70b (3D compose) + kimi-k2.6 (chat). Own trained model on the roadmap.</span>
          </div>
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">ALWAYS ON</span>
        </div>
      </div>

      <p className="text-[10px] text-slate-600 pt-2 border-t border-slate-800/50 flex items-center gap-1.5">
        <KeyRound className="w-3 h-3" /> Used by 3D compose/refine and prompt parsing. Changes apply immediately.
      </p>
    </div>
  );
}

export function SettingsPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [tab, setTab] = useState<Tab>('general');
  const [hidden, setHidden] = useState<Set<SectionId>>(() => getHiddenSections());

  useEffect(() => {
    const savedTheme = StorageService.load('app-theme') || 'dark';
    setTheme(savedTheme);
  }, []);

  useEffect(() => {
    StorageService.save('app-theme', theme);
    if (theme === 'light') {
      document.documentElement.classList.add('light-theme');
    } else {
      document.documentElement.classList.remove('light-theme');
    }
  }, [theme]);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="fixed top-6 right-6 z-40 p-2 rounded-full bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
        title="Settings"
      >
        <Settings className="w-5 h-5" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 bottom-0 z-50 w-80 bg-slate-950 border-l border-slate-800 p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold text-slate-200 flex items-center gap-2">
                  <Settings className="w-5 h-5" />
                  Preferences
                </h2>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-900 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex gap-1 mb-6 p-1 bg-slate-900 rounded-lg border border-slate-800">
                <button
                  onClick={() => setTab('general')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-medium transition-colors ${tab === 'general' ? 'bg-slate-800 text-slate-100' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  <Settings className="w-3.5 h-3.5" /> General
                </button>
                <button
                  onClick={() => setTab('features')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-medium transition-colors ${tab === 'features' ? 'bg-slate-800 text-slate-100' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" /> Features
                </button>
                <button
                  onClick={() => setTab('providers')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-medium transition-colors ${tab === 'providers' ? 'bg-slate-800 text-slate-100' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  <Bot className="w-3.5 h-3.5" /> AI
                </button>
              </div>

              {tab === 'providers' && <ProvidersTab />}

              {tab === 'features' && (
                <div className="space-y-5 overflow-y-auto pr-1" style={{ maxHeight: 'calc(100vh - 16rem)' }}>
                  <p className="text-xs text-slate-500">
                    Show or hide sections from the sidebar. Create and Account sections are always visible.
                  </p>
                  {GROUP_ORDER
                    .filter(g => g !== 'create' && g !== 'admin')
                    .map(group => {
                      const items = SECTIONS.filter(s => s.group === group);
                      if (items.length === 0) return null;
                      const allHidden = items.every(s => hidden.has(s.id));
                      return (
                        <div key={group}>
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                              {GROUP_LABELS[group]}
                            </h3>
                            <button
                              onClick={() => {
                                setHidden(prev => {
                                  const next = new Set(prev);
                                  if (allHidden) items.forEach(s => next.delete(s.id));
                                  else items.forEach(s => next.add(s.id));
                                  setHiddenSections(next);
                                  return next;
                                });
                              }}
                              className="text-[10px] text-indigo-400 hover:text-indigo-300 font-medium"
                            >
                              {allHidden ? 'Show all' : 'Hide all'}
                            </button>
                          </div>
                          <div className="space-y-1">
                            {items.map(s => {
                              const Icon = s.icon;
                              const isHidden = hidden.has(s.id);
                              return (
                                <button
                                  key={s.id}
                                  onClick={() => {
                                    setHidden(prev => {
                                      const next = new Set(prev);
                                      if (next.has(s.id)) next.delete(s.id);
                                      else next.add(s.id);
                                      setHiddenSections(next);
                                      return next;
                                    });
                                  }}
                                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs transition-colors ${isHidden ? 'text-slate-600 hover:bg-slate-900' : 'text-slate-300 bg-slate-900/50 hover:bg-slate-900'}`}
                                >
                                  <Icon className="w-3.5 h-3.5 shrink-0" />
                                  <span className="flex-1 text-left truncate">{s.label}</span>
                                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${isHidden ? 'bg-slate-800 text-slate-600' : 'bg-emerald-500/10 text-emerald-400'}`}>
                                    {isHidden ? 'HIDDEN' : 'SHOWN'}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  <p className="text-[10px] text-slate-600 pt-2 border-t border-slate-800/50">
                    Changes apply when you close this panel.
                  </p>
                </div>
              )}

              {tab === 'general' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-medium text-slate-400 mb-3 uppercase tracking-wider">Appearance</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setTheme('dark')}
                      className={`flex flex-col items-center justify-center gap-2 p-4 rounded-lg border transition-all ${
                        theme === 'dark' 
                          ? 'bg-indigo-500/10 border-indigo-500 text-indigo-400' 
                          : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      <Moon className="w-6 h-6" />
                      <span className="text-xs font-medium">Dark Mode</span>
                    </button>
                    <button
                      onClick={() => setTheme('light')}
                      className={`flex flex-col items-center justify-center gap-2 p-4 rounded-lg border transition-all ${
                        theme === 'light' 
                          ? 'bg-amber-500/10 border-amber-500 text-amber-400' 
                          : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      <Sun className="w-6 h-6" />
                      <span className="text-xs font-medium">High Contrast</span>
                    </button>
                  </div>
                </div>
                
                
                <div className="pt-6 border-t border-slate-800/50">
                   <h3 className="text-sm font-medium text-slate-400 mb-3 uppercase tracking-wider">Project Export/Import</h3>
                   <div className="space-y-2">
                     <button
                      onClick={() => {
                        const data = localStorage.getItem('app-storage');
                        if (data) {
                          const blob = new Blob([data], { type: 'application/json' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = 'aura-engine-spec-export.json';
                          a.click();
                          URL.revokeObjectURL(url);
                        } else {
                          alert('No data to export.');
                        }
                      }}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 rounded-md text-sm font-medium transition-colors"
                     >
                       <Download className="w-4 h-4" />
                       Export Project Spec
                     </button>
                     
                     <label className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 rounded-md text-sm font-medium transition-colors cursor-pointer">
                       <Upload className="w-4 h-4" />
                       Import Project Spec
                       <input 
                         type="file" 
                         accept=".json" 
                         className="hidden" 
                         onChange={(e) => {
                           const file = e.target.files?.[0];
                           if (file) {
                             const reader = new FileReader();
                             reader.onload = (event) => {
                               try {
                                 const content = event.target?.result as string;
                                 JSON.parse(content); // validate JSON
                                 localStorage.setItem('app-storage', content);
                                 window.location.reload();
                               } catch (err) {
                                 alert('Invalid JSON file.');
                               }
                             };
                             reader.readAsText(file);
                           }
                         }} 
                       />
                     </label>
                   </div>
                </div>

                <div className="pt-6 border-t border-slate-800/50">

                   <h3 className="text-sm font-medium text-slate-400 mb-3 uppercase tracking-wider">Data Management</h3>
                   <button
                    onClick={() => {
                      if (confirm('Are you sure you want to clear all saved local data?')) {
                        StorageService.clearAll();
                        window.location.reload();
                      }
                    }}
                    className="w-full px-4 py-2 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/20 rounded-md text-sm font-medium transition-colors text-left"
                   >
                     Clear Local Data
                   </button>
                </div>
              </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
