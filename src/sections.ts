import {
  LayoutDashboard, ListTodo, Map, Network, Eye, Box, Cpu, Zap, Code2,
  Globe, Users, CreditCard, MessageSquareCode, Repeat, BookOpen,
  UserCircle, Share2, CloudLightning, PhoneCall, Mic, ListChecks,
  BarChart, BrainCircuit, ActivitySquare, Fingerprint, GitMerge, Database,
  ArrowRightLeft, ShieldCheck, Atom, Satellite, Headset, History
} from 'lucide-react';
import type { SectionId } from './types';

export type SectionGroupId =
  | 'create'
  | 'build'
  | 'operate'
  | 'labs'
  | 'admin';

export interface SectionMeta {
  id: SectionId;
  label: string;
  icon: any;
  group: SectionGroupId;
  /** hidden by default in the sidebar; revealable from Settings → Features */
  hiddenByDefault?: boolean;
}

// Single source of truth for the sidebar + CommandPalette + Breadcrumb +
// Settings → Features panel.
//
// Design principle (2026-07-06): the default surface is minimal — Create +
// Build + Account. Everything operational or experimental is real and one
// toggle away, but never crowds the first impression. If someone can think
// it, the Create surfaces make it; the rest of the app is the engine room.
//
// Removed entirely in the honesty pass: 'fleet-health' (100% fictional MDM)
// and '3d-engine' (redundant with the 3D Studio). Renames: NPU→Neural
// Inference, Satellite Uplink→Orbital Tracking, Agent Swarm→System Telemetry,
// P2P WASM→WASM Workers.
export const SECTIONS: SectionMeta[] = [
  // ── Create: the product ───────────────────────────────────────────────
  { id: 'chat', label: 'Create', icon: MessageSquareCode, group: 'create' },
  { id: 'viewport3d', label: '3D Studio', icon: Box, group: 'create' },
  { id: 'media-studio', label: 'Media Studio', icon: Mic, group: 'create' },
  { id: 'deep-research', label: 'Deep Research', icon: Globe, group: 'create' },

  // ── Build: engineering surfaces ───────────────────────────────────────
  { id: 'ide', label: 'IDE', icon: Code2, group: 'build' },
  { id: 'vision', label: 'Vision & MVP', icon: Eye, group: 'build' },
  { id: 'requirements', label: 'Requirements', icon: ListTodo, group: 'build' },
  { id: 'roadmap', label: 'Roadmap', icon: Map, group: 'build' },
  { id: 'architecture', label: 'Architecture', icon: Network, group: 'build' },
  { id: 'tasks', label: 'Agent Tasks', icon: LayoutDashboard, group: 'build' },

  // ── Operate: real infra + telemetry (hidden by default) ──────────────
  { id: 'analytics', label: 'Analytics', icon: BarChart, group: 'operate', hiddenByDefault: true },
  { id: 'workflows', label: 'Automated Loops', icon: Repeat, group: 'operate', hiddenByDefault: true },
  { id: 'multi-agent-builder', label: 'Multi-Agent Builder', icon: Users, group: 'operate', hiddenByDefault: true },
  { id: 'swarm', label: 'System Telemetry', icon: Cpu, group: 'operate', hiddenByDefault: true },
  { id: 'cf-matrix', label: 'Edge Matrix', icon: CloudLightning, group: 'operate', hiddenByDefault: true },
  { id: 'edge-functions', label: 'Edge Functions', icon: Zap, group: 'operate', hiddenByDefault: true },
  { id: 'api-gateway', label: 'API Gateway', icon: ArrowRightLeft, group: 'operate', hiddenByDefault: true },
  { id: 'identity', label: 'Identity & SSO', icon: ShieldCheck, group: 'operate', hiddenByDefault: true },
  { id: 'database-viz', label: 'Database & Schema', icon: Database, group: 'operate', hiddenByDefault: true },
  { id: 'ci-cd', label: 'CI/CD', icon: GitMerge, group: 'operate', hiddenByDefault: true },
  { id: 'iac', label: 'Infrastructure as Code', icon: Network, group: 'operate', hiddenByDefault: true },

  // ── Labs: real experiments (hidden by default) ───────────────────────
  { id: 'ml-pipelines', label: 'ML Pipelines', icon: BrainCircuit, group: 'labs', hiddenByDefault: true },
  { id: 'webgpu', label: 'WebGPU Compute', icon: Zap, group: 'labs', hiddenByDefault: true },
  { id: 'wasm-compute', label: 'WASM Workers', icon: Share2, group: 'labs', hiddenByDefault: true },
  { id: 'quantum-compute', label: 'Quantum Emulator', icon: Atom, group: 'labs', hiddenByDefault: true },
  { id: 'superposition', label: 'Quantum Telemetry', icon: Box, group: 'labs', hiddenByDefault: true },
  { id: 'npu', label: 'Neural Inference', icon: Cpu, group: 'labs', hiddenByDefault: true },
  { id: 'dynamic-forms', label: 'Dynamic Forms', icon: ListChecks, group: 'labs', hiddenByDefault: true },
  { id: 'time-travel-debugger', label: 'Time-Travel Debugger', icon: History, group: 'labs', hiddenByDefault: true },
  { id: 'voip', label: 'VoIP WebRTC', icon: PhoneCall, group: 'labs', hiddenByDefault: true },
  { id: 'iot-edge', label: 'IoT Edge', icon: ActivitySquare, group: 'labs', hiddenByDefault: true },
  { id: 'webauthn', label: 'Passkey Auth', icon: Fingerprint, group: 'labs', hiddenByDefault: true },
  { id: 'satellite-link', label: 'Orbital Tracking', icon: Satellite, group: 'labs', hiddenByDefault: true },
  { id: 'ar-vr-bridge', label: 'AR/VR Bridge', icon: Headset, group: 'labs', hiddenByDefault: true },

  // ── Account (footer) ──────────────────────────────────────────────────
  { id: 'account', label: 'Account', icon: UserCircle, group: 'admin' },
  { id: 'billing', label: 'Billing', icon: CreditCard, group: 'admin' },
  { id: 'docs', label: 'Docs & Support', icon: BookOpen, group: 'admin' },
];

export const GROUP_LABELS: Record<SectionGroupId, string> = {
  create: 'Create',
  build: 'Build',
  operate: 'Operate',
  labs: 'Labs',
  admin: 'Account',
};

export const GROUP_ORDER: SectionGroupId[] = [
  'create', 'build', 'operate', 'labs', 'admin'
];

// ── Hidden-sections persistence ─────────────────────────────────────────
const HIDDEN_KEY = 'aura-sidebar-hidden';
// Bump when the default-hidden set changes so returning users pick up the
// new minimal layout instead of a stale stored set.
const HIDDEN_VERSION_KEY = 'aura-sidebar-hidden-v';
const HIDDEN_VERSION = '3';

function defaultHidden(): Set<SectionId> {
  return new Set(SECTIONS.filter(s => s.hiddenByDefault).map(s => s.id));
}

/** returns the set of section IDs the user has explicitly hidden */
export function getHiddenSections(): Set<SectionId> {
  try {
    if (localStorage.getItem(HIDDEN_VERSION_KEY) !== HIDDEN_VERSION) {
      localStorage.setItem(HIDDEN_VERSION_KEY, HIDDEN_VERSION);
      localStorage.removeItem(HIDDEN_KEY);
      return defaultHidden();
    }
    const raw = localStorage.getItem(HIDDEN_KEY);
    if (!raw) return defaultHidden();
    return new Set(JSON.parse(raw));
  } catch {
    return defaultHidden();
  }
}

export function setHiddenSections(set: Set<SectionId>) {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}

export function isSectionVisible(id: SectionId, hidden: Set<SectionId>): boolean {
  // Create and admin groups are always visible.
  const meta = SECTIONS.find(s => s.id === id);
  if (!meta) return true;
  if (meta.group === 'create' || meta.group === 'admin') return true;
  return !hidden.has(id);
}
