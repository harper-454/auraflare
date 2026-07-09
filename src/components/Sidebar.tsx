import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, SlidersHorizontal } from 'lucide-react';
import type { SectionId } from '../types';
import {
  SECTIONS, GROUP_LABELS, GROUP_ORDER, getHiddenSections, isSectionVisible,
  type SectionGroupId
} from '../sections';

interface SidebarProps {
  currentSection: SectionId;
  onSelect: (id: SectionId) => void;
}

export function Sidebar({ currentSection, onSelect }: SidebarProps) {
  // Recompute hidden set on each render so toggling in Settings is picked up
  // immediately (SettingsPanel writes to localStorage; a window 'storage'
  // event or a manual re-render after close refreshes this).
  const hidden = useMemo(() => getHiddenSections(), []);
  const [collapsed, setCollapsed] = useState<Set<SectionGroupId>>(new Set());

  const toggleGroup = (g: SectionGroupId) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g); else next.add(g);
      return next;
    });
  };

  // If the active section is in a collapsed group, expand that group.
  const activeMeta = SECTIONS.find(s => s.id === currentSection);
  const effectiveCollapsed = useMemo(() => {
    if (activeMeta && collapsed.has(activeMeta.group)) {
      const next = new Set(collapsed);
      next.delete(activeMeta.group);
      return next;
    }
    return collapsed;
  }, [collapsed, activeMeta]);

  // How many real sections are tucked away (for the "unlock" hint).
  const hiddenCount = useMemo(
    () => SECTIONS.filter(s => !isSectionVisible(s.id, hidden)).length,
    [hidden],
  );

  return (
    <aside className="w-56 border-r border-slate-800/60 bg-slate-950 flex flex-col h-full">
      <div className="px-5 pt-5 pb-4">
        <h1 className="text-[17px] font-bold tracking-tight flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-gradient-to-br from-indigo-400 to-fuchsia-500" />
          <span className="bg-gradient-to-r from-slate-100 to-slate-400 bg-clip-text text-transparent">
            AuraFlare
          </span>
        </h1>
        <p className="text-[10px] font-mono text-slate-600 mt-1 pl-4">think it → build it</p>
      </div>

      <nav className="flex-1 px-3 pb-3 overflow-y-auto">
        {GROUP_ORDER.map(group => {
          const items = SECTIONS.filter(s => s.group === group && isSectionVisible(s.id, hidden));
          if (items.length === 0) return null;
          const isCollapsed = effectiveCollapsed.has(group);
          const isAdmin = group === 'admin';
          const isCreate = group === 'create';
          return (
            <div key={group} className={isAdmin ? 'mt-4 pt-3 border-t border-slate-900' : 'mb-2'}>
              {!isAdmin && !isCreate && (
                <button
                  onClick={() => toggleGroup(group)}
                  className="w-full flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-slate-600 uppercase tracking-widest hover:text-slate-400 transition-colors"
                >
                  {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {GROUP_LABELS[group]}
                </button>
              )}
              {!isCollapsed && (
                <div className="space-y-0.5 mt-0.5">
                  {items.map(item => {
                    const Icon = item.icon;
                    const isActive = currentSection === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => onSelect(item.id)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all ${
                          isActive
                            ? 'bg-indigo-500/10 text-indigo-300 shadow-[inset_2px_0_0_0_rgba(129,140,248,0.9)]'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/80'
                        }`}
                      >
                        <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-indigo-400' : ''}`} />
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {hiddenCount > 0 && (
          <button
            onClick={() => {
              // The Settings gear lives in the top-right; nudge users there.
              const el = document.querySelector<HTMLButtonElement>('[title="Settings"]');
              el?.click();
            }}
            className="mt-3 w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] text-slate-600 hover:text-slate-400 hover:bg-slate-900/60 transition-colors"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            {hiddenCount} more tools in Settings
          </button>
        )}
      </nav>

      <div className="px-4 py-3 border-t border-slate-900 text-[10px] font-mono text-slate-600 flex items-center justify-between">
        <span>v2 · MVP</span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          LIVE
        </span>
      </div>
    </aside>
  );
}
