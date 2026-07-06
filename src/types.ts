export type SectionId = 'vision' | 'requirements' | 'roadmap' | 'architecture' | 'tasks' | 'viewport3d' | 'swarm' | 'webgpu' | 'ide' | 'superposition' | 'npu' | 'iac' | 'deep-research' | 'multi-agent-builder' | 'billing' | 'fleet-health' | 'chat' | 'workflows' | 'docs' | 'account' | 'wasm-compute' | 'cf-matrix' | 'voip' | '3d-engine' | 'media-studio' | 'dynamic-forms' | 'analytics' | 'ml-pipelines' | 'iot-edge' | 'webauthn' | 'ci-cd' | 'database-viz' | 'api-gateway' | 'identity' | 'edge-functions' | 'quantum-compute' | 'satellite-link' | 'ar-vr-bridge' | 'time-travel-debugger';

export interface Requirement {
  id: string;
  title: string;
  description: string;
  category: 'core' | 'ai' | '3d' | 'export' | 'media' | 'integrations';
  priority: 'high' | 'medium' | 'low' | 'critical';
  implementationPlan?: string;
}

export interface RoadmapPhase {
  id: string;
  title: string;
  quarter: string;
  status: 'completed' | 'in-progress' | 'planned';
  items: string[];
}

export interface Task {
  id: string;
  title: string;
  status: 'todo' | 'in-progress' | 'done';
  assignee: 'human' | 'ai-agent';
  complexity: string;
  category: 'core' | 'ai' | '3d' | 'export' | 'media' | 'integrations';
  resolutionSteps?: string;
}

export interface SpecData {
  vision: string[];
  requirements: Requirement[];
  roadmap: RoadmapPhase[];
  tasks: Task[];
}
