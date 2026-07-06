import {
  LayoutDashboard, ListTodo, Map, Network, Eye, Box, Cpu, Zap, Code2,
  Globe, Users, CreditCard, HeartPulse, MessageSquareCode, Repeat, BookOpen,
  UserCircle, Share2, CloudLightning, PhoneCall, Gamepad2, Mic, ListChecks,
  BarChart, BrainCircuit, ActivitySquare, Fingerprint, GitMerge, Database,
  ArrowRightLeft, ShieldCheck, Atom, Satellite, Headset, History
} from 'lucide-react';
import type { SectionId } from './types';

export type SectionGroupId =
  | 'primary'
  | 'spec'
  | 'ai'
  | 'infra'
  | 'compute'
  | 'studio'
  | 'connectivity'
  | 'admin';

export interface SectionMeta {
  id: SectionId;
  label: string;
  icon: any;
  group: SectionGroupId;
  /** hidden by default in the sidebar; revealable from Settings → Features */
  hiddenByDefault?: boolean;
}

// Single source of truth for the sidebar + Settings → Features panel.
// Groups are rendered in the order they appear here.
export const SECTIONS: SectionMeta[] = [
  // ── Primary: the actual product surfaces ──────────────────────────────
  { id: 'chat', label: 'NCP Chat', icon: MessageSquareCode, group: 'primary' },
  { id: 'viewport3d', label: '3D Viewport', icon: Box, group: 'primary' },
  { id: 'ide', label: 'IDE Workspace', icon: Code2, group: 'primary' },

  // ── Spec & Planning ───────────────────────────────────────────────────
  { id: 'vision', label: 'Vision & MVP', icon: Eye, group: 'spec' },
  { id: 'requirements', label: 'Requirements', icon: ListTodo, group: 'spec' },
  { id: 'roadmap', label: 'Roadmap', icon: Map, group: 'spec' },
  { id: 'architecture', label: 'Architecture', icon: Network, group: 'spec' },
  { id: 'tasks', label: 'Agent Tasks', icon: LayoutDashboard, group: 'spec' },

  // ── AI Systems ────────────────────────────────────────────────────────
  { id: 'deep-research', label: 'Deep Research', icon: Globe, group: 'ai' },
  { id: 'multi-agent-builder', label: 'Multi-Agent Builder', icon: Users, group: 'ai' },
  { id: 'swarm', label: 'Agent Swarm', icon: Cpu, group: 'ai' },
  { id: 'workflows', label: 'Automated Loops', icon: Repeat, group: 'ai' },

  // ── Infrastructure ────────────────────────────────────────────────────
  { id: 'cf-matrix', label: 'Cloudflare Edge Matrix', icon: CloudLightning, group: 'infra' },
  { id: 'edge-functions', label: 'Edge Functions', icon: Zap, group: 'infra' },
  { id: 'api-gateway', label: 'API Gateway', icon: ArrowRightLeft, group: 'infra' },
  { id: 'identity', label: 'Identity & SSO', icon: ShieldCheck, group: 'infra' },
  { id: 'database-viz', label: 'Database & Schema', icon: Database, group: 'infra' },
  { id: 'ci-cd', label: 'CI/CD Pipelines', icon: GitMerge, group: 'infra' },
  { id: 'iac', label: 'Autonomous IaC', icon: Network, group: 'infra' },

  // ── Compute (power-user; hidden by default) ───────────────────────────
  { id: 'webgpu', label: 'WebGPU Compute', icon: Zap, group: 'compute', hiddenByDefault: true },
  { id: 'wasm-compute', label: 'P2P WASM Compute', icon: Share2, group: 'compute', hiddenByDefault: true },
  { id: 'quantum-compute', label: 'Quantum Emulator', icon: Atom, group: 'compute', hiddenByDefault: true },
  { id: 'superposition', label: 'Quantum Telemetry', icon: Box, group: 'compute', hiddenByDefault: true },
  { id: 'npu', label: 'NPU Bindings', icon: Cpu, group: 'compute', hiddenByDefault: true },

  // ── Studio ────────────────────────────────────────────────────────────
  { id: 'media-studio', label: 'AI Media Studio', icon: Mic, group: 'studio' },
  { id: 'analytics', label: 'Real-time Analytics', icon: BarChart, group: 'studio' },
  { id: 'ml-pipelines', label: 'ML Pipelines', icon: BrainCircuit, group: 'studio' },
  { id: 'dynamic-forms', label: 'Dynamic Forms', icon: ListChecks, group: 'studio' },
  { id: '3d-engine', label: 'WebGL Game Engine', icon: Gamepad2, group: 'studio' },
  { id: 'time-travel-debugger', label: 'Time-Travel Debugger', icon: History, group: 'studio', hiddenByDefault: true },

  // ── Connectivity (power-user; hidden by default) ──────────────────────
  { id: 'voip', label: 'VoIP WebRTC Node', icon: PhoneCall, group: 'connectivity', hiddenByDefault: true },
  { id: 'iot-edge', label: 'IoT Edge Node', icon: ActivitySquare, group: 'connectivity', hiddenByDefault: true },
  { id: 'webauthn', label: 'Passkey Auth', icon: Fingerprint, group: 'connectivity', hiddenByDefault: true },
  { id: 'satellite-link', label: 'Satellite Uplink', icon: Satellite, group: 'connectivity', hiddenByDefault: true },
  { id: 'ar-vr-bridge', label: 'AR/VR Metaverse', icon: Headset, group: 'connectivity', hiddenByDefault: true },

  // ── Account & Admin (footer) ──────────────────────────────────────────
  { id: 'account', label: 'Account', icon: UserCircle, group: 'admin' },
  { id: 'billing', label: 'Billing', icon: CreditCard, group: 'admin' },
  { id: 'fleet-health', label: 'Fleet Health', icon: HeartPulse, group: 'admin' },
  { id: 'docs', label: 'Docs & Support', icon: BookOpen, group: 'admin' },
];

export const GROUP_LABELS: Record<SectionGroupId, string> = {
  primary: 'Workspace',
  spec: 'Spec & Planning',
  ai: 'AI Systems',
  infra: 'Infrastructure',
  compute: 'Compute',
  studio: 'Studio',
  connectivity: 'Connectivity',
  admin: 'Account',
};

export const GROUP_ORDER: SectionGroupId[] = [
  'primary', 'spec', 'ai', 'infra', 'compute', 'studio', 'connectivity', 'admin'
];

// ── Hidden-sections persistence ─────────────────────────────────────────
const HIDDEN_KEY = 'aura-sidebar-hidden';

/** returns the set of section IDs the user has explicitly hidden */
export function getHiddenSections(): Set<SectionId> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    if (!raw) {
      // first run: hide everything flagged hiddenByDefault
      return new Set(SECTIONS.filter(s => s.hiddenByDefault).map(s => s.id));
    }
    return new Set(JSON.parse(raw));
  } catch {
    return new Set(SECTIONS.filter(s => s.hiddenByDefault).map(s => s.id));
  }
}

export function setHiddenSections(set: Set<SectionId>) {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}

export function isSectionVisible(id: SectionId, hidden: Set<SectionId>): boolean {
  // Primary and admin groups are always visible.
  const meta = SECTIONS.find(s => s.id === id);
  if (!meta) return true;
  if (meta.group === 'primary' || meta.group === 'admin') return true;
  return !hidden.has(id);
}
