import { motion } from 'motion/react';
import { projectData } from '../data';
import { useAutoSave } from '../hooks/useAutoSave';
import { Box, Code2, Layers, Cpu, Image as ImageIcon, Plug } from 'lucide-react';

export function RequirementsSection() {
  const [requirements, setRequirements] = useAutoSave('requirements-data', projectData.requirements);

  const updateReq = (idx, field, value) => {
    const newReqs = [...requirements];
    newReqs[idx] = { ...newReqs[idx], [field]: value };
    setRequirements(newReqs);
  };

  const getIcon = (category: string) => {
    switch(category) {
      case 'core': return <Code2 className="w-5 h-5 text-indigo-400" />;
      case 'ai': return <Cpu className="w-5 h-5 text-emerald-400" />;
      case '3d': return <Box className="w-5 h-5 text-amber-400" />;
      case 'export': return <Layers className="w-5 h-5 text-rose-400" />;
      case 'media': return <ImageIcon className="w-5 h-5 text-purple-400" />;
      case 'integrations': return <Plug className="w-5 h-5 text-cyan-400" />;
      default: return <Code2 className="w-5 h-5 text-slate-400" />;
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-5xl space-y-8"
    >
      <header className="space-y-4">
        <h2 className="text-3xl font-bold tracking-tight text-slate-100">Core Requirements</h2>
        <p className="text-lg text-slate-400">
          The technical bounds and features defining the engine.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {requirements.map((req, idx) => (
          <motion.div 
            key={req.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: idx * 0.05 }}
            className="p-6 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-950 rounded-md">
                  {getIcon(req.category)}
                </div>
                <div>
                  <div className="text-xs font-mono text-slate-500">{req.id}</div>
                  <input 
  type="text" 
  value={req.title} 
  onChange={(e) => updateReq(idx, 'title', e.target.value)}
  className="font-medium text-slate-200 bg-transparent border-b border-transparent hover:border-slate-700 focus:border-indigo-500 focus:outline-none w-full transition-colors"
/>
                </div>
              </div>
              <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-full ${
                req.priority === 'high' ? 'bg-indigo-500/10 text-indigo-400' :
                req.priority === 'medium' ? 'bg-slate-800 text-slate-400' :
                'bg-slate-900 text-slate-500 border border-slate-800'
              }`}>
                {req.priority}
              </span>
            </div>
            <textarea 
  value={req.description}
  onChange={(e) => updateReq(idx, 'description', e.target.value)}
  className="w-full text-sm text-slate-400 leading-relaxed bg-transparent border border-transparent hover:border-slate-800 focus:border-indigo-500 focus:outline-none rounded resize-none min-h-[80px] p-2 -ml-2 transition-colors"
/>
            {req.implementationPlan && (
              <div className="mt-4 pt-4 border-t border-slate-800">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">AI Execution Protocol</h4>
                <p className="text-xs text-indigo-300/80 font-mono leading-relaxed bg-indigo-950/20 p-3 rounded border border-indigo-900/50">
                  {req.implementationPlan}
                </p>
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
