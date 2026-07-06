import { motion } from 'motion/react';
import { projectData } from '../data';
import { useAutoSave } from '../hooks/useAutoSave';

export function VisionSection() {
  const [visionParagraphs, setVisionParagraphs] = useAutoSave('vision-paragraphs', projectData.vision);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-4xl space-y-8"
    >
      <header className="space-y-4">
        <h2 className="text-3xl font-bold tracking-tight text-slate-100">Vision & MVP</h2>
        <p className="text-lg text-slate-400">
          The autonomous polyglot IDE combining structural code visualization, real-time state telemetry, and an ultra-powerful Conversational Intent-to-App Compiler.
        </p>
      </header>

      <div className="grid gap-6">
        <div className="p-6 rounded-lg bg-teal-500/10 border border-teal-500/30">
          <h3 className="text-xl font-bold text-teal-400 mb-2">MVP Focus: The Intent Engine</h3>
          <p className="text-slate-300 leading-relaxed mb-4">
            The core MVP is the Conversational Intent-to-App Compiler. We are building a system where anyone can type plain English, and the engine automatically generates, configures, and deploys a full-stack, fully functioning application. No code required for beginners, with full power for experts.
          </p>
          <div className="flex items-center gap-2 text-xs font-mono text-teal-300">
            <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse"></span>
            STATUS: ACTIVE / HIGHEST PRIORITY
          </div>
        </div>

        {projectData.vision.map((paragraph, idx) => (
          <div key={idx} className="p-6 rounded-lg bg-slate-900 border border-slate-800">
            <p className="text-slate-300 leading-relaxed">
              {paragraph}
            </p>
          </div>
        ))}
      </div>
      
      <div className="mt-12 space-y-4">
        <h3 className="text-xl font-medium text-slate-200">The MVP "Side-by-Side" Dashboard</h3>
        <div className="aspect-video bg-slate-900 border border-slate-800 rounded-lg flex overflow-hidden">
          <div className="w-1/2 border-r border-slate-800 p-4 font-mono text-sm relative">
            <div className="text-slate-500 mb-4">// Logic Builder / Code Editor</div>
            <div className="space-y-2">
              <div className="h-4 w-3/4 bg-slate-800 rounded"></div>
              <div className="h-4 w-1/2 bg-slate-800 rounded ml-4"></div>
              <div className="h-4 w-5/6 bg-indigo-500/20 rounded ml-4 border border-indigo-500/50"></div>
              <div className="h-4 w-2/3 bg-slate-800 rounded ml-4"></div>
              <div className="h-4 w-1/4 bg-slate-800 rounded"></div>
            </div>
          </div>
          <div className="w-1/2 flex flex-col">
            <div className="h-1/2 p-4 bg-slate-950 font-mono text-xs text-emerald-400 border-b border-slate-800">
              <div className="text-slate-500 mb-2">// Real-time Telemetry & State</div>
              <div className="space-y-1">
                <div>&gt; execution_node: 0x4f2a</div>
                <div>&gt; state_diff: <span className="text-amber-400">mutated</span></div>
                <div className="text-slate-600 mt-2 border-t border-slate-800 pt-2 flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full border border-emerald-500/50 flex items-center justify-center text-[8px]">A</div>
                  <div className="h-px w-4 bg-slate-700"></div>
                  <div className="w-4 h-4 rounded-full border border-emerald-500 flex items-center justify-center bg-emerald-500/10 text-[8px]">B</div>
                </div>
              </div>
            </div>
            <div className="h-1/2 bg-white relative overflow-hidden flex flex-col">
              <div className="h-6 bg-slate-200 border-b border-slate-300 flex items-center px-2 gap-1.5 shrink-0">
                <div className="w-2 h-2 rounded-full bg-rose-400"></div>
                <div className="w-2 h-2 rounded-full bg-amber-400"></div>
                <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
                <div className="ml-2 px-2 py-0.5 bg-white rounded text-[8px] font-sans text-slate-500 w-full text-center truncate">
                  localhost:3000 (Zero-Latency HMR Sandbox)
                </div>
              </div>
              <div className="flex-1 p-4 bg-slate-50 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-8 h-8 mx-auto mb-2 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                  <div className="text-xs font-semibold text-slate-700">Live Preview</div>
                  <div className="text-[10px] text-slate-500 mt-1">Full-stack emulation active</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
