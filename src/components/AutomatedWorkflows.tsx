import React, { useState, useEffect } from 'react';
import { Repeat, Play, Plus, Trash2, Link as LinkIcon, Settings, Clock, Activity, Cpu } from 'lucide-react';
import { motion } from 'motion/react';
import { collection, query, onSnapshot, addDoc, deleteDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthProvider';

export const AutomatedWorkflows = () => {
  const { user } = useAuth();
  const [workflows, setWorkflows] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'users', user.uid, 'workflows'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const wfs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setWorkflows(wfs);
    });
    return unsubscribe;
  }, [user]);

  const handleCreate = async () => {
    if (!user) return;
    await addDoc(collection(db, 'users', user.uid, 'workflows'), {
      name: 'New Custom Loop',
      trigger: 'Manual Execution',
      steps: ['Init execution context', 'Run diagnostic check'],
      active: true,
      lastRun: 'Never',
      createdAt: serverTimestamp()
    });
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    await deleteDoc(doc(db, 'users', user.uid, 'workflows', id));
  };

  const toggleActive = async (id: string, current: boolean) => {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid, 'workflows', id), { active: !current });
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0f1c] border-l border-slate-800">
      <div className="h-14 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/50 backdrop-blur z-10 sticky top-0">
        <h2 className="text-lg font-bold text-white flex items-center gap-3">
          <Repeat className="text-emerald-400" /> Automated Loops & Workflows
        </h2>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2 text-xs font-mono text-emerald-400 bg-emerald-400/10 px-3 py-1 rounded-full border border-emerald-500/20">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            FIRESTORE SYNC ACTIVE
          </span>
          <button onClick={handleCreate} className="flex items-center gap-2 bg-emerald-600/20 hover:bg-emerald-600/40 border border-emerald-500/30 text-emerald-300 px-4 py-1.5 rounded text-sm font-bold transition-colors">
            <Plus className="w-4 h-4" /> Create Loop
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <p className="text-slate-400 text-sm mb-8 max-w-3xl">
          Construct infinite execution loops and autonomous agent workflows. Bind triggers to code events, chron jobs, or webhooks.
        </p>

        {workflows.length === 0 && (
          <div className="text-slate-500 font-mono text-center mt-20">No automated loops defined. Click 'Create Loop' to add one.</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {workflows.map((wf, i) => (
            <motion.div 
              key={wf.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="bg-slate-950 border border-slate-800 rounded-xl p-6 flex flex-col relative overflow-hidden"
            >
              {wf.active && <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500"></div>}
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-white font-bold text-lg mb-1">{wf.name}</h3>
                  <div className="flex items-center gap-2 text-xs font-mono text-slate-500">
                    <Clock className="w-3 h-3" /> Trigger: {wf.trigger}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => toggleActive(wf.id, wf.active)}
                    className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${wf.active ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-400'}`}
                  >
                    {wf.active ? 'ACTIVE' : 'PAUSED'}
                  </button>
                  <button onClick={() => handleDelete(wf.id)} className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-md">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 bg-slate-900 border border-slate-800 rounded-lg p-4 mb-4">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Execution Chain</h4>
                <div className="space-y-3 relative before:absolute before:inset-0 before:ml-2 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-slate-800">
                  {wf.steps?.map((step: string, idx: number) => (
                    <div key={idx} className="relative flex items-center gap-3 bg-slate-900 z-10">
                      <div className="w-4 h-4 rounded-full bg-slate-800 border-2 border-slate-600 shrink-0"></div>
                      <span className="text-sm text-slate-300 font-mono">{step}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-500 font-mono mt-auto pt-4 border-t border-slate-800">
                <span className="flex items-center gap-1"><Activity className="w-3 h-3"/> Last run: {wf.lastRun}</span>
                <button className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300">
                  <Play className="w-3 h-3" /> Force Execute
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};
