import { motion } from 'motion/react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, ContactShadows, Environment } from '@react-three/drei';
import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useAutoSave } from '../hooks/useAutoSave';
import { Play, Pause, Download, Wand2, RefreshCw, AlertTriangle, Sparkles, Box, Cpu, Zap, Cog } from 'lucide-react';
import * as THREE from 'three';

// The real text-to-3D pipeline (already shipped in src/lib, but only the
// buried IDE > 3D tab exposed it). This view routes the same engine to the
// visible "3D Viewport" surface so the prompt box actually generates a model.
import { composeWithAI, refineProgramWithAI, PRESET_PROGRAMS, type ShapeProgram } from '../lib/sdf-compiler';
import { compileProgramAuto } from '../lib/sdf-gpu';
import { parsePromptLocally, generateModel, exportGLB } from '../lib/meshforge';

type Mode = 'ai' | 'humanoid' | 'animal' | 'mechanical';
type Stats = {
  triangles: number;
  opCount: number | null;
  backend: 'gpu' | 'cpu' | 'preset';
  resolution: number;
  fieldMs: number;
  bytes: number;
  loadMs: number;
  source: 'ai' | 'preset' | 'local';
};

const PROMPT_IDEAS = [
  'a snowman with a carrot nose',
  'a rocket ship with fins',
  'a glossy red mushroom',
  'a six-petal flower on a green stem',
  'a faceted amethyst crystal cluster',
  'a low-poly dragon',
  'a wooden bar stool with four legs',
  'a gnarly oak tree with rough bark',
  'a chess pawn',
  'a colorful hot air balloon',
];

// ——— Preset rigs (kept from the original view; no longer the only path) ———
function PresetRig({ kind, spin }: { kind: 'humanoid' | 'animal' | 'mechanical'; spin: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (spin && ref.current) {
      ref.current.rotation.y += delta * 0.4;
      ref.current.position.y = Math.sin(performance.now() / 600) * 0.1;
    }
  });
  return (
    <group ref={ref} position={[0, 0.5, 0]}>
      {kind === 'humanoid' && (
        <>
          <mesh castShadow position={[0, 0, 0]}><boxGeometry args={[1, 1.5, 0.5]} /><meshStandardMaterial color="#6366f1" /></mesh>
          <mesh castShadow position={[0, 1.1, 0]}><sphereGeometry args={[0.4, 32, 32]} /><meshStandardMaterial color="#818cf8" /></mesh>
          <mesh castShadow position={[-0.8, 0.2, 0]}><boxGeometry args={[0.3, 1, 0.3]} /><meshStandardMaterial color="#a5b4fc" /></mesh>
          <mesh castShadow position={[0.8, 0.2, 0]}><boxGeometry args={[0.3, 1, 0.3]} /><meshStandardMaterial color="#a5b4fc" /></mesh>
        </>
      )}
      {kind === 'animal' && (
        <>
          <mesh castShadow position={[0, 0, 0]}><boxGeometry args={[0.8, 0.6, 1.5]} /><meshStandardMaterial color="#10b981" /></mesh>
          <mesh castShadow position={[0, 0.5, 0.85]}><boxGeometry args={[0.4, 0.4, 0.6]} /><meshStandardMaterial color="#34d399" /></mesh>
          <mesh castShadow position={[0.7, -0.55, 0.55]}><boxGeometry args={[0.2, 0.8, 0.2]} /><meshStandardMaterial color="#6ee7b7" /></mesh>
          <mesh castShadow position={[-0.7, -0.55, 0.55]}><boxGeometry args={[0.2, 0.8, 0.2]} /><meshStandardMaterial color="#6ee7b7" /></mesh>
        </>
      )}
      {kind === 'mechanical' && (
        <>
          <mesh castShadow position={[0, 0, 0]}><boxGeometry args={[1.2, 0.8, 1.2]} /><meshStandardMaterial color="#f59e0b" /></mesh>
          <mesh castShadow position={[0, 0.6, 0]}><sphereGeometry args={[0.3, 16, 16]} /><meshStandardMaterial color="#ef4444" /></mesh>
          <mesh ref={undefined} castShadow position={[-0.7, 0, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.4, 0.4, 0.2, 12]} /><meshStandardMaterial color="#fbbf24" /></mesh>
          <mesh castShadow position={[0.7, 0, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.4, 0.4, 0.2, 12]} /><meshStandardMaterial color="#fbbf24" /></mesh>
        </>
      )}
    </group>
  );
}

// Renders an arbitrary generated THREE.Group inside the canvas, with auto-rotation.
function GeneratedMesh({ group, spin }: { group: THREE.Group; spin: boolean }) {
  const root = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (spin && root.current) root.current.rotation.y += delta * 0.25;
  });
  useEffect(() => {
    if (root.current && group.parent !== root.current) {
      root.current.clear();
      root.current.add(group);
    }
  }, [group]);
  return <group ref={root} />;
}

export function Viewport3DSection() {
  const [mode, setMode] = useAutoSave<Mode>('viewport-mode', 'ai');
  const [ambientIntensity, setAmbientIntensity] = useAutoSave('viewport-ambient', 0.5);
  const [spotIntensity, setSpotIntensity] = useAutoSave('viewport-spot', 1.5);
  const [spin, setSpin] = useState(true);

  const [prompt, setPrompt] = useAutoSave('viewport-prompt', '');
  const [refineText, setRefineText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [generatedGroup, setGeneratedGroup] = useState<THREE.Group | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [label, setLabel] = useState<string>('');
  const [lastProgram, setLastProgram] = useState<ShapeProgram | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const loadStart = useRef(0);

  // Auto-rotate toggle was the old "play/pause". Keep the affordance.
  const [isPlaying, setIsPlaying] = useState(true);
  useEffect(() => { setSpin(isPlaying); }, [isPlaying]);

  const runForge = useCallback(async (input?: string) => {
    const text = (input ?? prompt).trim();
    if (!text) return;
    setIsGenerating(true);
    setError(null);
    setStats(null);
    loadStart.current = performance.now();
    try {
      let group: THREE.Group;
      let triangles: number;
      let opCount: number | null = null;
      let backend: Stats['backend'] = 'preset';
      let resolution = 0;
      let fieldMs = 0;
      let source: Stats['source'] = 'ai';

      // Deterministic-first (AGENTS.md §1): try the LLM-composed SDF program,
      // then fall back to preset, then to the fully-offline parametric generator.
      const composed = await composeWithAI(text);
      if (composed) {
        const compiled = await compileProgramAuto(composed.program);
        group = compiled.group;
        triangles = compiled.triangles;
        opCount = compiled.opCount;
        backend = compiled.backend;
        resolution = compiled.resolution;
        fieldMs = compiled.fieldMs;
        source = composed.source;
        setLastProgram(composed.program);
        setLabel(composed.program.label);
      } else {
        // Fully offline fallback: keyword → parametric single-family mesh.
        const spec = parsePromptLocally(text);
        const gen = generateModel(text, spec);
        group = gen.group;
        triangles = gen.triangles;
        source = 'local';
        setLastProgram(null);
        setLabel(spec.label || text.slice(0, 24));
      }

      const blob = await exportGLB(group);
      setBlobUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
      setGeneratedGroup(group);
      setStats({
        triangles, opCount, backend, resolution, fieldMs,
        bytes: blob.size, loadMs: Math.round(performance.now() - loadStart.current), source,
      });
    } catch (e: any) {
      setError(`Generation failed: ${e?.message || e}`);
    } finally {
      setIsGenerating(false);
    }
  }, [prompt]);

  const runRefine = useCallback(async () => {
    const instruction = refineText.trim();
    if (!instruction || !lastProgram) return;
    setIsRefining(true);
    setError(null);
    loadStart.current = performance.now();
    try {
      const updated = await refineProgramWithAI(lastProgram, instruction);
      if (!updated) throw new Error('AI refine unavailable — set GEMINI_API_KEY or try again.');
      const compiled = await compileProgramAuto(updated);
      const blob = await exportGLB(compiled.group);
      setBlobUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
      setGeneratedGroup(compiled.group);
      setLastProgram(updated);
      setLabel(updated.label);
      setStats({
        triangles: compiled.triangles, opCount: compiled.opCount, backend: compiled.backend,
        resolution: compiled.resolution, fieldMs: compiled.fieldMs,
        bytes: blob.size, loadMs: Math.round(performance.now() - loadStart.current), source: 'ai',
      });
      setRefineText('');
    } catch (e: any) {
      setError(`Refine failed: ${e?.message || e}`);
    } finally {
      setIsRefining(false);
    }
  }, [refineText, lastProgram]);

  const surprise = useCallback(() => {
    const idea = PROMPT_IDEAS[Math.floor(Math.random() * PROMPT_IDEAS.length)];
    setPrompt(idea);
    runForge(idea);
  }, [runForge, setPrompt]);

  const downloadGlb = useCallback(() => {
    if (!blobUrl) return;
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${(label || 'aura-model').replace(/\W+/g, '-')}.glb`;
    a.click();
  }, [blobUrl, label]);

  // Quick preset buttons (deterministic, no API needed) — wire to PRESET_PROGRAMS.
  const loadPreset = useCallback(async (key: keyof typeof PRESET_PROGRAMS) => {
    setIsGenerating(true);
    setError(null);
    loadStart.current = performance.now();
    try {
      const program = PRESET_PROGRAMS[key];
      const compiled = await compileProgramAuto(program);
      const blob = await exportGLB(compiled.group);
      setBlobUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
      setGeneratedGroup(compiled.group);
      setLastProgram(program);
      setLabel(program.label);
      setMode('ai');
      setStats({
        triangles: compiled.triangles, opCount: compiled.opCount, backend: 'preset',
        resolution: compiled.resolution, fieldMs: compiled.fieldMs,
        bytes: blob.size, loadMs: Math.round(performance.now() - loadStart.current), source: 'preset',
      });
    } catch (e: any) {
      setError(`Preset failed: ${e?.message || e}`);
    } finally {
      setIsGenerating(false);
    }
  }, [setMode]);

  const backendIcon = useMemo(() => {
    if (!stats) return null;
    if (stats.backend === 'gpu') return <><Cpu className="w-3 h-3" /> GPU · WebGPU</>;
    if (stats.backend === 'cpu') return <><Cpu className="w-3 h-3" /> CPU · marching-tet</>;
    return <><Zap className="w-3 h-3" /> preset</>;
  }, [stats]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="h-[calc(100vh-6rem)] flex flex-col space-y-4"
    >
      <header className="space-y-1 shrink-0">
        <h2 className="text-3xl font-bold tracking-tight text-slate-100">3D Viewport</h2>
        <p className="text-sm text-slate-400">
          Prompt-driven mesh generation. The LLM composes a signed-distance shape program, then a fused WebGPU kernel
          (CPU marching-tets fallback) polygonizes it into a real, exportable mesh.
        </p>
      </header>

      {error && (
        <div className="shrink-0 flex items-start gap-2 px-4 py-2 bg-rose-500/10 border border-rose-500/30 rounded-lg text-xs text-rose-300 font-mono">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-200">dismiss</button>
        </div>
      )}

      <div className="flex-1 bg-slate-900 border border-slate-800 rounded-lg overflow-hidden relative shadow-2xl">
        {/* Top-left: status + prompt */}
        <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 w-96 max-w-[calc(100%-2rem)]">
          <div className="flex gap-2 flex-wrap">
            <div className="px-3 py-1.5 bg-slate-950/80 backdrop-blur border border-slate-700 rounded text-xs font-mono text-indigo-400 flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isGenerating || isRefining ? 'bg-amber-400 animate-pulse' : stats ? 'bg-emerald-400' : 'bg-slate-500'}`} />
              {isGenerating ? 'GENERATING' : isRefining ? 'REFINING' : stats ? 'MESH READY' : 'IDLE'}
            </div>
            {stats && (
              <div className="px-3 py-1.5 bg-slate-950/80 backdrop-blur border border-slate-700 rounded text-xs font-mono text-slate-300 flex items-center gap-1.5">
                {backendIcon}
              </div>
            )}
            {stats && (
              <div className="px-3 py-1.5 bg-slate-950/80 backdrop-blur border border-slate-700 rounded text-xs font-mono text-slate-300">
                {(stats.triangles / 1000).toFixed(1)}k tris
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); runForge(); }}
            className="flex gap-2 mt-1"
          >
            <input
              type="text"
              placeholder="Describe a model…  e.g. 'a glossy red mushroom'"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="flex-1 bg-slate-950/80 backdrop-blur border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={isGenerating || !prompt.trim()}
              title="Generate from prompt"
              className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/40 disabled:cursor-not-allowed text-white rounded flex items-center justify-center transition-colors"
            >
              {isGenerating ? <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> : <Wand2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={surprise}
              title="Surprise me"
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded flex items-center justify-center transition-colors"
            >
              <Sparkles className="w-4 h-4" />
            </button>
          </form>

          {lastProgram && (
            <form
              onSubmit={(e) => { e.preventDefault(); runRefine(); }}
              className="flex gap-2"
            >
              <input
                type="text"
                placeholder="Refine…  e.g. 'make it taller', 'add a sphere on top'"
                value={refineText}
                onChange={(e) => setRefineText(e.target.value)}
                disabled={isRefining}
                className="flex-1 bg-slate-950/80 backdrop-blur border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isRefining || !refineText.trim()}
                title="Refine model"
                className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-600/40 disabled:cursor-not-allowed text-white rounded flex items-center justify-center transition-colors"
              >
                {isRefining ? <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              </button>
            </form>
          )}

          <div className="flex flex-wrap gap-1 mt-1">
            <span className="text-[10px] font-mono text-slate-500 self-center mr-1">PRESETS:</span>
            {(Object.keys(PRESET_PROGRAMS) as (keyof typeof PRESET_PROGRAMS)[]).map(k => (
              <button
                key={k}
                onClick={() => loadPreset(k)}
                className="px-2 py-1 text-[10px] font-mono bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded transition-colors"
              >
                {k}
              </button>
            ))}
          </div>
        </div>

        {/* Top-right: viewport controls */}
        <div className="absolute top-4 right-4 z-10 w-60 bg-slate-900/90 backdrop-blur border border-slate-700 rounded-lg p-4 shadow-xl space-y-3">
          <h3 className="text-sm font-semibold text-slate-200 border-b border-slate-800 pb-2 flex items-center gap-2">
            <Cog className="w-4 h-4" /> Controls
          </h3>

          <div className="space-y-2">
            <label className="text-xs text-slate-400 font-medium">View</label>
            <div className="grid grid-cols-2 gap-1">
              <button
                onClick={() => setMode('ai')}
                className={`py-1.5 text-xs rounded border ${mode === 'ai' ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300' : 'bg-slate-800 border-transparent text-slate-400 hover:bg-slate-700'}`}
              >AI Mesh</button>
              <button
                onClick={() => setMode('humanoid')}
                className={`py-1.5 text-xs rounded border ${mode === 'humanoid' ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300' : 'bg-slate-800 border-transparent text-slate-400 hover:bg-slate-700'}`}
              >Rigs</button>
            </div>
            {mode !== 'ai' && (
              <div className="grid grid-cols-3 gap-1 mt-1">
                {(['humanoid', 'animal', 'mechanical'] as const).map(k => (
                  <button
                    key={k}
                    onClick={() => setMode(k)}
                    className={`py-1 text-[10px] rounded border ${mode === k ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300' : 'bg-slate-800 border-transparent text-slate-400 hover:bg-slate-700'}`}
                  >{k.slice(0, 4)}</button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <button
              onClick={() => setSpin(s => !s)}
              className="flex items-center gap-2 cursor-pointer group w-full text-left"
            >
              <div className={`w-8 h-4 rounded-full flex items-center p-0.5 transition-colors ${spin ? 'bg-indigo-500' : 'bg-slate-700'}`}>
                <div className={`w-3 h-3 bg-white rounded-full transition-transform ${spin ? 'translate-x-4' : 'translate-x-0'}`} />
              </div>
              <span className="text-xs text-slate-300 group-hover:text-white transition-colors">Auto-rotate</span>
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-xs text-slate-400 font-medium">Ambient</label>
              <span className="text-xs text-slate-500">{ambientIntensity.toFixed(1)}</span>
            </div>
            <input type="range" min="0" max="2" step="0.1" value={ambientIntensity}
              onChange={(e) => setAmbientIntensity(parseFloat(e.target.value))}
              className="w-full accent-indigo-500" />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-xs text-slate-400 font-medium">Spot</label>
              <span className="text-xs text-slate-500">{spotIntensity.toFixed(1)}</span>
            </div>
            <input type="range" min="0" max="5" step="0.1" value={spotIntensity}
              onChange={(e) => setSpotIntensity(parseFloat(e.target.value))}
              className="w-full accent-indigo-500" />
          </div>

          <button
            onClick={downloadGlb}
            disabled={!blobUrl}
            className="w-full mt-2 flex items-center justify-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed border border-slate-700 rounded text-xs text-slate-200 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            {blobUrl ? 'Export .glb' : 'No mesh yet'}
          </button>
        </div>

        {/* Stats panel (bottom-right) — only when we have a real mesh */}
        {stats && (
          <div className="absolute bottom-4 right-4 z-10 w-60 bg-slate-900/90 backdrop-blur border border-slate-700 rounded-lg p-3 shadow-xl space-y-1 text-[11px] font-mono">
            <div className="flex justify-between"><span className="text-slate-500">label</span><span className="text-slate-200 truncate max-w-[140px]" title={label}>{label}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">source</span><span className="text-indigo-300">{stats.source}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">backend</span><span className="text-emerald-300">{stats.backend}{stats.resolution ? ` @${stats.resolution}³` : ''}</span></div>
            {stats.opCount !== null && <div className="flex justify-between"><span className="text-slate-500">ops</span><span className="text-slate-300">{stats.opCount}</span></div>}
            <div className="flex justify-between"><span className="text-slate-500">triangles</span><span className="text-slate-300">{stats.triangles.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">field</span><span className="text-slate-300">{stats.fieldMs} ms</span></div>
            <div className="flex justify-between"><span className="text-slate-500">total</span><span className="text-slate-300">{stats.loadMs} ms</span></div>
            <div className="flex justify-between"><span className="text-slate-500">glb size</span><span className="text-slate-300">{(stats.bytes / 1024).toFixed(1)} KB</span></div>
          </div>
        )}

        <Canvas shadows camera={{ position: [4, 3, 5], fov: 45 }}>
          <color attach="background" args={['#0f172a']} />
          <ambientLight intensity={ambientIntensity} />
          <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} intensity={spotIntensity} castShadow />
          <pointLight position={[-10, -10, -10]} intensity={0.5} />

          {mode === 'ai' && generatedGroup && <GeneratedMesh group={generatedGroup} spin={spin} />}
          {mode === 'ai' && !generatedGroup && (
            <PresetRig kind="mechanical" spin={spin} />
          )}
          {mode !== 'ai' && <PresetRig kind={mode} spin={spin} />}

          <ContactShadows position={[0, -0.01, 0]} opacity={0.4} scale={10} blur={2} far={4} />
          <Grid infiniteGrid fadeDistance={20} fadeStrength={5} sectionColor="#334155" cellColor="#1e293b" />
          <OrbitControls makeDefault enablePan enableZoom enableRotate
            minPolarAngle={0} maxPolarAngle={Math.PI / 2 + 0.1} />
          <Environment preset="city" />
        </Canvas>

        <div className="absolute bottom-4 left-4 z-10">
          <button
            onClick={() => { setIsPlaying(p => !p); }}
            className="w-9 h-9 flex items-center justify-center bg-indigo-500 hover:bg-indigo-400 text-white rounded-full transition-colors shadow-lg"
            title={isPlaying ? 'Pause rotation' : 'Resume rotation'}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
