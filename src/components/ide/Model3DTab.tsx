import React from 'react';
import { Box, Wand2, RefreshCcw, Bone } from 'lucide-react';

export const Model3DTab = ({ active3dMode, setActive3dMode }: { active3dMode: string, setActive3dMode: (m: string) => void }) => {
  return (
    <div className="text-sm text-slate-400">
      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">3D Generation</h3>
      
      <div className="space-y-4">
        <div>
          <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Prompt</label>
          <textarea 
            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs text-slate-200 h-20 resize-none"
            placeholder="A futuristic mechanical hound with glowing blue accents..."
            defaultValue="High fidelity rigged cyberpunk character"
          />
        </div>

        <div>
          <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Rigging Level</label>
          <select className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs text-slate-200">
            <option>Basic (Mixamo standard)</option>
            <option>Advanced (Face + Hand IK)</option>
            <option>Full Skeleton (Cinematic)</option>
          </select>
        </div>

        <button className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2">
          <Wand2 className="w-4 h-4" /> Generate Rigged Model
        </button>

        <div className="border-t border-slate-800 pt-4 mt-4">
          <div className="flex items-center gap-2 mb-2">
            <Box className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-medium text-slate-300">Generated Assets</span>
          </div>
          <div className="space-y-1">
            <div 
              onClick={() => setActive3dMode('character.glb')}
              className={`text-xs p-1.5 rounded cursor-pointer ${active3dMode === 'character.glb' ? 'bg-indigo-500/20 text-indigo-300' : 'hover:bg-slate-800 text-slate-400'}`}
            >
              cyberpunk_character_rigged.glb
            </div>
            <div 
              onClick={() => setActive3dMode('anim.glb')}
              className={`text-xs p-1.5 rounded cursor-pointer ${active3dMode === 'anim.glb' ? 'bg-indigo-500/20 text-indigo-300' : 'hover:bg-slate-800 text-slate-400'}`}
            >
              walk_cycle_test.glb
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
