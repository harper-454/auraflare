import { motion } from 'motion/react';
import { projectData } from '../data';
import { useAutoSave } from '../hooks/useAutoSave';
import { CheckCircle2, Circle, Clock } from 'lucide-react';

import { Task } from '../types';

export function RoadmapSection() {
  const [tasks] = useAutoSave<Task[]>('tasks', projectData.tasks);
  
  const completedTasks = tasks.filter(t => t.status === 'done').length;
  const totalTasks = tasks.length;
  const progressPercentage = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);

  const [roadmap, setRoadmap] = useAutoSave('roadmap-data', projectData.roadmap);

  const updateItem = (phaseIdx, itemIdx, value) => {
    const newRoadmap = [...roadmap];
    newRoadmap[phaseIdx].items[itemIdx] = value;
    setRoadmap(newRoadmap);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-4xl space-y-8"
    >
      
      <header className="space-y-4">
        <h2 className="text-3xl font-bold tracking-tight text-slate-100">Project Roadmap</h2>
        <p className="text-lg text-slate-400">
          The strategic timeline for deploying the Aura Engine components.
        </p>
      </header>

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 my-8">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-bold text-slate-200">Global Task Progress</h3>
          <span className="text-sm font-mono text-indigo-400">{progressPercentage}% ({completedTasks}/{totalTasks})</span>
        </div>
        <div className="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden border border-slate-800">
          <div 
            className="bg-indigo-500 h-2.5 rounded-full transition-all duration-1000 ease-out" 
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
      </div>


      <div className="relative border-l-2 border-slate-800 ml-4 space-y-12 pb-12 mt-12">
        {roadmap.map((phase, idx) => (
          <div key={phase.id} className="relative pl-8">
            {/* Timeline dot */}
            <div className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 bg-slate-950 ${
              phase.status === 'completed' ? 'border-emerald-500' :
              phase.status === 'in-progress' ? 'border-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]' :
              'border-slate-700'
            }`} />
            
            <div className="flex flex-col md:flex-row md:items-baseline gap-2 md:gap-4 mb-4">
              <h3 className="text-xl font-bold text-slate-200">{phase.title}</h3>
              <div className="text-sm font-mono text-slate-500 bg-slate-900 px-2 py-0.5 rounded border border-slate-800 w-fit">
                {phase.quarter}
              </div>
            </div>
            
            <ul className="space-y-3">
              {phase.items.map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-slate-400">
                  {phase.status === 'completed' ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-500/50 shrink-0 mt-0.5" />
                  ) : phase.status === 'in-progress' ? (
                    <Clock className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                  ) : (
                    <Circle className="w-5 h-5 text-slate-700 shrink-0 mt-0.5" />
                  )}
                  <input 
  type="text"
  value={item}
  onChange={(e) => updateItem(idx, i, e.target.value)}
  className="bg-transparent border-b border-transparent hover:border-slate-700 focus:border-indigo-500 focus:outline-none w-full text-slate-400 focus:text-slate-200 transition-colors"
/>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
