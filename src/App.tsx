import { useState, useEffect } from 'react';
import { StorageService } from './lib/storage';
import { RestoreContext } from './hooks/useAutoSave';
import { motion, AnimatePresence } from 'motion/react';
import { Save, X } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { CommandPalette } from './components/CommandPalette';
import { VisionSection } from './components/VisionSection';
import { RequirementsSection } from './components/RequirementsSection';
import { RoadmapSection } from './components/RoadmapSection';
import { ArchitectureSection } from './components/ArchitectureSection';
import { TasksSection } from './components/TasksSection';
import { Viewport3DSection } from './components/Viewport3DSection';
import { SwarmMonitorSection } from './components/SwarmMonitorSection';
import { WebGPUComputeSection } from './components/WebGPUComputeSection';

import { DeepResearchSection } from './components/DeepResearchSection';
import { MultiAgentBuilderSection } from './components/MultiAgentBuilderSection';
import { CloudflareEdgeMatrix } from './components/CloudflareEdgeMatrix';
import { WasmComputeSection } from './components/WasmComputeSection';
import { NaturalConversationProgramming } from './components/NaturalConversationProgramming';
import { AutomatedWorkflows } from './components/AutomatedWorkflows';
import { DocsAndSupport } from './components/DocsAndSupport';
import { AccountManagement } from './components/AccountManagement';
import { FleetHealthDashboard } from './components/FleetHealthDashboard';
import { BillingSection } from './components/BillingSection';
import { SuperpositionDebuggingSection } from './components/SuperpositionDebuggingSection';
import { NeuromorphicHardwareSection } from './components/NeuromorphicHardwareSection';
import { IaCProvisioningSection } from './components/IaCProvisioningSection';

import { IdeWorkspaceSection } from './components/IdeWorkspaceSection';
import { Breadcrumb } from './components/Breadcrumb';
import { FloatingAssistant } from './components/FloatingAssistant';
import { SettingsPanel } from './components/SettingsPanel';
import { VoipNode } from './components/VoipNode';
import { WebGLEngine } from './components/WebGLEngine';
import { MediaStudio } from './components/MediaStudio';
import { DynamicForms } from './components/DynamicForms';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { MLPipelines } from './components/MLPipelines';
import { IoTEdge } from './components/IoTEdge';
import { WebAuthnNode } from './components/WebAuthnNode';
import { CIDashboard } from './components/CIDashboard';
import { DatabaseVisualizer } from './components/DatabaseVisualizer';
import { ApiGateway } from './components/ApiGateway';
import { IdentityProvider } from './components/IdentityProvider';
import { EdgeFunctions } from './components/EdgeFunctions';
import { QuantumEmulator } from './components/QuantumEmulator';
import { SatelliteLink } from './components/SatelliteLink';
import { ARVRBridge } from './components/ARVRBridge';
import { TimeTravelDebugger } from './components/TimeTravelDebugger';
import { SectionId } from './types';

export default function App() {
  const [currentSection, setCurrentSection] = useState<SectionId>('chat');
  const [hasSavedData, setHasSavedData] = useState(false);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    if (StorageService.hasSavedData()) {
      setHasSavedData(true);
    } else {
      setRestored(true);
    }
  }, []);

  const handleRestore = () => {
    setRestored(true);
    setHasSavedData(false);
  };

  const handleDiscard = () => {
    StorageService.clearAll();
    setRestored(true);
    setHasSavedData(false);
  };

  const renderContent = () => {
    switch (currentSection) {
      case 'vision':
        return <VisionSection />;
      case 'requirements':
        return <RequirementsSection />;
      case 'roadmap':
        return <RoadmapSection />;
      case 'architecture':
        return <ArchitectureSection />;
      case 'tasks':
        return <TasksSection />;
      case 'viewport3d':
        return <Viewport3DSection />;
      case 'swarm':
        return <SwarmMonitorSection />;
      case 'webgpu':
        return <WebGPUComputeSection />;

      case 'chat': return <NaturalConversationProgramming />;
      case 'workflows': return <AutomatedWorkflows />;
      case 'docs': return <DocsAndSupport />;
      case 'account': return <AccountManagement />;
      case 'fleet-health': return <FleetHealthDashboard />;

      case 'deep-research': return <DeepResearchSection />;
      case 'multi-agent-builder': return <MultiAgentBuilderSection />;
      case 'billing': return <BillingSection />;
      case 'superposition': return <SuperpositionDebuggingSection />;
      case 'npu': return <NeuromorphicHardwareSection />;
      case 'iac': return <IaCProvisioningSection />;

      case 'cf-matrix': return <CloudflareEdgeMatrix />;
      case 'wasm-compute': return <WasmComputeSection />;

      case 'ide': return <IdeWorkspaceSection />;
      case 'voip': return <VoipNode />;
      case '3d-engine': return <WebGLEngine />;
      case 'media-studio': return <MediaStudio />;
      case 'dynamic-forms': return <DynamicForms />;
      case 'analytics': return <AnalyticsDashboard />;
      case 'ml-pipelines': return <MLPipelines />;
      case 'iot-edge': return <IoTEdge />;
      case 'webauthn': return <WebAuthnNode />;
      case 'ci-cd': return <CIDashboard />;
      case 'database-viz': return <DatabaseVisualizer />;
      case 'api-gateway': return <ApiGateway />;
      case 'time-travel-debugger': return <TimeTravelDebugger />;
      case 'identity': return <IdentityProvider />;
      case 'edge-functions': return <EdgeFunctions />;
      case 'quantum-compute': return <QuantumEmulator />;
      case 'satellite-link': return <SatelliteLink />;
      case 'ar-vr-bridge': return <ARVRBridge />;
      default:
        return <IdeWorkspaceSection />;
    }
  };

  return (

    <RestoreContext.Provider value={restored}>
      <CommandPalette onNavigate={setCurrentSection} />
      <SettingsPanel />
      <FloatingAssistant currentSection={currentSection} onNavigate={setCurrentSection} />
      <div className="flex h-screen bg-slate-950 text-slate-200 overflow-hidden font-sans">
        <Sidebar currentSection={currentSection} onSelect={setCurrentSection} />
        
        <main className="flex-1 overflow-hidden relative flex flex-col">
          <AnimatePresence>
            {hasSavedData && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 bg-slate-900 border border-indigo-500/50 shadow-lg shadow-indigo-500/20 px-6 py-4 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <Save className="w-5 h-5 text-indigo-400" />
                  <div>
                    <h3 className="text-sm font-bold text-slate-200">Unsaved Session Found</h3>
                    <p className="text-xs text-slate-400">Would you like to restore your previous edits?</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={handleDiscard}
                    className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    Discard
                  </button>
                  <button
                    onClick={handleRestore}
                    className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded transition-colors"
                  >
                    Restore
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="flex-1 overflow-y-auto">
            {/* App-like surfaces (chat, 3D, IDE) own their padding and need full width */}
            <div className="h-full flex flex-col">
              <Breadcrumb currentSection={currentSection} />
              <div className="flex-1 min-h-0">
                {renderContent()}
              </div>
            </div>
          </div>
        </main>
      </div>
    </RestoreContext.Provider>

  );
}
