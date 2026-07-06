import { motion, AnimatePresence } from 'motion/react';
import { Settings, X, Moon, Sun, Download, Upload, LayoutGrid } from 'lucide-react';
import { useEffect, useState } from 'react';
import { StorageService } from '../lib/storage';
import { SECTIONS, GROUP_LABELS, GROUP_ORDER, getHiddenSections, setHiddenSections } from '../sections';
import type { SectionId } from '../types';

type Tab = 'general' | 'features';

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
              </div>

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
