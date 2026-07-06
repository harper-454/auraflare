import { ChevronRight, Home } from 'lucide-react';
import { SectionId } from '../types';
import { SECTIONS } from '../sections';

const labels: Record<SectionId, string> = SECTIONS.reduce((acc, s) => {
  (acc as any)[s.id] = s.label;
  return acc;
}, {} as Record<SectionId, string>);

interface BreadcrumbProps {
  currentSection: SectionId;
}

// App-like surfaces own their own header chrome, so we hide the breadcrumb
// there to avoid a doubled title bar.
const HIDE_ON: SectionId[] = ['chat', 'viewport3d', 'ide'];

export function Breadcrumb({ currentSection }: BreadcrumbProps) {
  if (HIDE_ON.includes(currentSection)) return null;
  return (
    <div className="flex items-center gap-2 text-sm font-medium text-slate-400 px-6 pt-6 pb-4 border-b border-slate-800/50">
      <div className="flex items-center gap-2 hover:text-slate-200 transition-colors cursor-default">
        <Home className="w-4 h-4" />
        <span>AuraFlare</span>
      </div>
      <ChevronRight className="w-4 h-4 text-slate-600" />
      <span className="text-indigo-400">
        {labels[currentSection] ?? currentSection}
      </span>
    </div>
  );
}
