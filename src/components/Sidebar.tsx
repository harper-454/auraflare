import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
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

  return (
    <aside className="w-64 border-r border-slate-800 bg-slate-950 flex flex-col h-full">
      <div className="p-5 border-b border-slate-900">
        <h1 className="text-lg font-bold tracking-tight text-slate-100 flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
          AuraFlare
        </h1>
        <p className="text-[11px] font-mono text-slate-500 mt-1">Natural-language → code</p>
      </div>

      <nav className="flex-1 px-3 py-3 overflow-y-auto">
        {GROUP_ORDER.map(group => {
          const items = SECTIONS.filter(s => s.group === group && isSectionVisible(s.id, hidden));
          if (items.length === 0) return null;
          const isCollapsed = effectiveCollapsed.has(group);
          const isAdmin = group === 'admin';
          return (
            <div key={group} className={isAdmin ? 'mt-4 pt-3 border-t border-slate-900' : 'mb-1'}>
              {!isAdmin && (
                <button
                  onClick={() => toggleGroup(group)}
                  className="w-full flex items-center gap-1 px-2 py-1.5 text-[10px] font-bold text-slate-600 uppercase tracking-wider hover:text-slate-400 transition-colors"
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
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-colors ${
                          isActive
                            ? 'bg-indigo-500/10 text-indigo-300'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="p-3 border-t border-slate-900 text-[10px] font-mono text-slate-600 flex items-center justify-between">
        <span>v2 · MVP</span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          LIVE
        </span>
      </div>
    </aside>
  );
}
