import { motion } from 'motion/react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, ContactShadows, Environment } from '@react-three/drei';
import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useAutoSave } from '../hooks/useAutoSave';
import { Play, Pause, Download, Wand2, RefreshCw, AlertTriangle, Sparkles, Cpu, Cog, Paintbrush, ImagePlus } from 'lucide-react';
import * as THREE from 'three';

// The real text-to-3D pipeline (already shipped in src/lib, but only the
// buried IDE > 3D tab exposed it). This view routes the same engine to the
// visible "3D Viewport" surface so the prompt box actually generates a model.
import { refineProgramWithAI, buildPreviewProgram, flattenProgram, type ShapeProgram } from '../lib/sdf-compiler';
import { warmupGPU } from '../lib/sdf-gpu';
import { applyAnimators, type Animator } from '../lib/sdf-assembly';
import { forgeModel, forgeFromProgram, type ForgeResult } from '../lib/forge-pipeline';
import { getPreferredProvider, setPreferredProvider, listSelectableProviders, type PreferredProvider } from '../lib/ai-providers';
import { applyTriplanarToGroup, loadTexture } from '../lib/sdf-material';
import { parsePromptLocally, generateModel, exportGLB } from '../lib/meshforge';
import { BatchForgePanel } from './BatchForgePanel';
// 3D-2: live sphere-tracing preview — shows the SDF as a raymarched image
// while the user types, before polygonisation runs.
import { SDFRaytracer } from './SDFRaytracer';

type Stats = {
  triangles: number;
  opCount: number | null;
  backend: 'gpu' | 'cpu';
  resolution: number;
  fieldMs: number;
  bytes: number;
  loadMs: number;
  source: 'ai' | 'local' | 'photo' | 'cached';
  parts?: number;   // articulated part count (assemblies + static base)
  moving?: number;  // how many parts carry a motion spec
  qa?: 'passed' | 'revised' | 'skipped'; // pre-delivery inspection outcome
  ref?: string; // reference grounding: "online · 4 photos" | "generated · 2"
  provider?: string; // which AI provider composed the program
};

/**
 * Downscale a photo to a JPEG data URL. One size serves both consumers: the
 * vision-caption endpoint (which resizes further anyway) and the triplanar
 * albedo texture (1024px is plenty for a projected material).
 */
async function photoToDataUrl(file: File, maxDim = 1024): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}

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

// Renders an arbitrary generated THREE.Group inside the canvas, with
// auto-rotation of the whole model plus per-part kinematics (gears spin,
// pistons stroke) driven from the assembly animators every frame.
function GeneratedMesh({ group, spin, animators, motionOn }: {
  group: THREE.Group;
  spin: boolean;
  animators: Animator[];
  motionOn: boolean;
}) {
  const root = useRef<THREE.Group>(null);
  useFrame(({ clock }, delta) => {
    if (spin && root.current) root.current.rotation.y += delta * 0.25;
    if (motionOn && animators.length) applyAnimators(animators, clock.getElapsedTime());
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

  // Provider selection (shared app-wide via localStorage; honored by aiChatSync).
  // Options recompute on each open of the section so Settings edits show up.
  const [preferredProvider, setPreferredProviderState] = useState<PreferredProvider>(() => getPreferredProvider());
  const providerOptions = useMemo(() => listSelectableProviders(), []);

  // Texturing (triplanar projection — SDF meshes have no UVs) + photo→3D.
  const [textureText, setTextureText] = useState('');
  const [isTexturing, setIsTexturing] = useState(false);
  const [textureInfo, setTextureInfo] = useState<string | null>(null);
  const [isPhotoLoading, setIsPhotoLoading] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Articulated assemblies: per-part animators drive live motion; the matching
  // baked clips ride along into the .glb export.
  const [animators, setAnimators] = useState<Animator[]>([]);
  const clipsRef = useRef<THREE.AnimationClip[]>([]);
  // Pre-delivery QA: the model inspects its own render and revises once.
  const [isInspecting, setIsInspecting] = useState(false);
  // Reference grounding: real photos (or generated stand-ins) anchor the compose.
  const [isReferencing, setIsReferencing] = useState(false);

  // 3D-2: live preview — build a fresh ShapeProgram from the prompt text using
  // keyword heuristics (no preset lookup), then raymarch it while the AI compose
  // call runs.  buildPreviewProgram constructs every ShapeProgram from scratch.
  const [previewProgram, setPreviewProgram] = useState<ShapeProgram | null>(null);
  useEffect(() => {
    const tid = setTimeout(() => {
      setPreviewProgram(prompt.trim().length >= 4 ? buildPreviewProgram(prompt) : null);
    }, 350);
    return () => clearTimeout(tid);
  }, [prompt]);

  // The raytracer can't animate assemblies — bake them into a static pose
  // (exact placement math) for the preview shader. Memoized: a fresh object
  // per render would recompile the fragment shader every frame.
  const previewFlat = useMemo(() => {
    const p = lastProgram ?? previewProgram;
    return p ? flattenProgram(p) : null;
  }, [lastProgram, previewProgram]);

  // Auto-rotate toggle was the old "play/pause". Keep the affordance.
  const [isPlaying, setIsPlaying] = useState(true);
  useEffect(() => { setSpin(isPlaying); }, [isPlaying]);

  // Compile the GPU kernel up front (one-time ~seconds cost) so it overlaps with
  // the user reading the UI / typing — the first "Generate" then skips the wait.
  useEffect(() => { warmupGPU(); }, []);

  // Show a forge result (interactive, batch, cache, or gallery) in the viewport.
  const presentResult = useCallback((r: ForgeResult, opts?: { loadMs?: number }) => {
    setBlobUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(r.blob); });
    setGeneratedGroup(r.group);
    setAnimators(r.animators);
    clipsRef.current = r.clips;
    setLastProgram(r.program);
    setLabel(r.label);
    setTextureInfo(null);
    setStats({
      triangles: r.triangles, opCount: r.opCount, backend: r.backend, resolution: r.resolution,
      fieldMs: r.fieldMs, bytes: r.blob.size, loadMs: opts?.loadMs ?? 0,
      source: r.source, parts: r.parts, moving: r.moving, qa: r.qa, ref: r.ref, provider: r.provider,
    });
  }, []);

  const runForge = useCallback(async (input?: string, photoDataUrl?: string) => {
    const text = (input ?? prompt).trim();
    if (!text) return;
    setIsGenerating(true);
    setError(null);
    setStats(null);
    loadStart.current = performance.now();
    try {
      try {
        // The photo path is grounded by the photo itself — skip web references,
        // QA, and the cache; everything else shares the forge pipeline.
        const result = await forgeModel(
          text,
          { ground: !photoDataUrl, qa: !photoDataUrl, useCache: !photoDataUrl },
          stage => { setIsReferencing(stage === 'referencing'); setIsInspecting(stage === 'inspecting'); },
        );
        presentResult(result, { loadMs: Math.round(performance.now() - loadStart.current) });
        if (photoDataUrl) {
          // Photo→3D: the uploaded photo doubles as the triplanar albedo, so
          // the model wears the exact real-world surface it was generated from.
          const tex = await loadTexture(photoDataUrl);
          applyTriplanarToGroup(result.group, tex, { metalness: result.program?.metalness, roughness: result.program?.roughness });
          setTextureInfo('photo albedo');
          setStats(prev => (prev ? { ...prev, source: 'photo' } : prev));
        }
      } catch {
        // Absolute last resort: the offline parametric single-family mesh.
        const spec = parsePromptLocally(text);
        const gen = generateModel(text, spec);
        const blob = await exportGLB(gen.group);
        setBlobUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
        setGeneratedGroup(gen.group);
        setAnimators([]);
        clipsRef.current = [];
        setLastProgram(null);
        setLabel(spec.label || text.slice(0, 24));
        setTextureInfo(null);
        setStats({
          triangles: gen.triangles, opCount: null, backend: 'cpu', resolution: 0, fieldMs: 0,
          bytes: blob.size, loadMs: Math.round(performance.now() - loadStart.current), source: 'local',
        });
      }
    } catch (e: any) {
      setError(`Generation failed: ${e?.message || e}`);
    } finally {
      setIsReferencing(false);
      setIsInspecting(false);
      setIsGenerating(false);
    }
  }, [prompt, presentResult]);

  const runRefine = useCallback(async () => {
    const instruction = refineText.trim();
    if (!instruction || !lastProgram) return;
    setIsRefining(true);
    setError(null);
    loadStart.current = performance.now();
    try {
      const updated = await refineProgramWithAI(lastProgram, instruction);
      if (!updated) throw new Error('AI refine unavailable — configure a provider in Settings → AI or try again.');
      const result = await forgeFromProgram(updated, 'ai');
      presentResult(result, { loadMs: Math.round(performance.now() - loadStart.current) });
      setRefineText('');
    } catch (e: any) {
      setError(`Refine failed: ${e?.message || e}`);
    } finally {
      setIsRefining(false);
    }
  }, [refineText, lastProgram, presentResult]);

  // Generate a seamless material with SDXL-Lightning and project it onto the
  // current mesh (triplanar — no UVs needed). Blank input derives the material
  // from the model's own label.
  const applyTexture = useCallback(async () => {
    if (!generatedGroup) return;
    const matPrompt = textureText.trim() || `${label || prompt} surface material`;
    setIsTexturing(true);
    setError(null);
    try {
      const res = await fetch('/api/media/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: matPrompt, kind: 'texture' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || `texture endpoint ${res.status}`);
      const tex = await loadTexture(data.url);
      applyTriplanarToGroup(generatedGroup, tex, {
        metalness: lastProgram?.metalness,
        roughness: lastProgram?.roughness,
      });
      setTextureInfo(matPrompt.slice(0, 48));
      setTextureText('');
    } catch (e: any) {
      setError(`Texture failed: ${e?.message || e}`);
    } finally {
      setIsTexturing(false);
    }
  }, [generatedGroup, textureText, label, prompt, lastProgram]);

  // Photo→3D: vision model describes the object, the SDF composer builds the
  // geometry from that description, and the photo itself becomes the albedo.
  const generateFromPhoto = useCallback(async (file: File) => {
    setIsPhotoLoading(true);
    setError(null);
    try {
      const dataUrl = await photoToDataUrl(file);
      const res = await fetch('/api/media/describe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || `describe endpoint ${res.status}`);
      const description = String(data.description || '').trim();
      if (!description) throw new Error('vision model returned no description');
      setPrompt(description.slice(0, 220));
      await runForge(description, dataUrl);
    } catch (e: any) {
      setError(`Photo→3D failed: ${e?.message || e}`);
    } finally {
      setIsPhotoLoading(false);
    }
  }, [runForge, setPrompt]);

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

  const backendIcon = useMemo(() => {
    if (!stats) return null;
    if (stats.backend === 'gpu') return <><Cpu className="w-3 h-3" /> GPU · WebGPU</>;
    return <><Cpu className="w-3 h-3" /> CPU · marching-tet</>;
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
              <span className={`w-2 h-2 rounded-full ${isGenerating || isRefining || isTexturing || isPhotoLoading ? 'bg-amber-400 animate-pulse' : stats ? 'bg-emerald-400' : (previewProgram || lastProgram) ? 'bg-violet-400 animate-pulse' : 'bg-slate-500'}`} />
              {isPhotoLoading ? 'READING PHOTO' : isReferencing ? 'REFERENCING' : isInspecting ? 'INSPECTING' : isGenerating ? 'GENERATING' : isRefining ? 'REFINING' : isTexturing ? 'TEXTURING' : stats ? 'MESH READY' : (previewProgram || lastProgram) && !generatedGroup ? 'PREVIEWING' : 'IDLE'}
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
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              disabled={isPhotoLoading || isGenerating}
              title="Generate from a photo — the AI describes it, builds the model, and wraps it in the photo's surface"
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed border border-slate-700 text-slate-200 rounded flex items-center justify-center transition-colors"
            >
              {isPhotoLoading ? <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> : <ImagePlus className="w-4 h-4" />}
            </button>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = ''; // allow re-selecting the same file
                if (file) generateFromPhoto(file);
              }}
            />
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

          {generatedGroup && (
            <form
              onSubmit={(e) => { e.preventDefault(); applyTexture(); }}
              className="flex gap-2"
            >
              <input
                type="text"
                placeholder="Texture…  e.g. 'weathered bronze', 'oak bark' (blank = auto)"
                value={textureText}
                onChange={(e) => setTextureText(e.target.value)}
                disabled={isTexturing}
                className="flex-1 bg-slate-950/80 backdrop-blur border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-fuchsia-500 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isTexturing || isGenerating}
                title="Generate a seamless material and project it onto the mesh (triplanar)"
                className="px-3 py-2 bg-fuchsia-600 hover:bg-fuchsia-500 disabled:bg-fuchsia-600/40 disabled:cursor-not-allowed text-white rounded flex items-center justify-center transition-colors"
              >
                {isTexturing ? <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> : <Paintbrush className="w-4 h-4" />}
              </button>
            </form>
          )}

        </div>

        {/* Top-right: viewport controls */}
        <div className="absolute top-4 right-4 z-10 w-60 bg-slate-900/90 backdrop-blur border border-slate-700 rounded-lg p-4 shadow-xl space-y-3">
          <h3 className="text-sm font-semibold text-slate-200 border-b border-slate-800 pb-2 flex items-center gap-2">
            <Cog className="w-4 h-4" /> Controls
          </h3>

          <div className="space-y-1">
            <label className="text-xs text-slate-400 font-medium">AI provider</label>
            <select
              value={preferredProvider}
              onChange={e => { setPreferredProvider(e.target.value as PreferredProvider); setPreferredProviderState(e.target.value as PreferredProvider); }}
              title="Which model composes 3D programs. Auto tries the whole chain; a specific choice is strict — its real error shows if it fails. Manage providers in Settings → AI."
              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              {providerOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
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
            {stats.provider && <div className="flex justify-between"><span className="text-slate-500">provider</span><span className="text-fuchsia-300 truncate max-w-[140px]" title={stats.provider}>{stats.provider}</span></div>}
            <div className="flex justify-between"><span className="text-slate-500">backend</span><span className="text-emerald-300">{stats.backend}{stats.resolution ? ` @${stats.resolution}³` : ''}</span></div>
            {stats.opCount !== null && <div className="flex justify-between"><span className="text-slate-500">ops</span><span className="text-slate-300">{stats.opCount}</span></div>}
            {stats.parts !== undefined && stats.parts > 1 && <div className="flex justify-between"><span className="text-slate-500">parts</span><span className="text-amber-300">{stats.parts}{stats.moving ? ` · ${stats.moving} moving` : ''}</span></div>}
            {stats.qa && stats.qa !== 'skipped' && <div className="flex justify-between"><span className="text-slate-500">qa</span><span className={stats.qa === 'revised' ? 'text-cyan-300' : 'text-emerald-300'}>{stats.qa === 'revised' ? 'inspected · revised' : 'inspected · passed'}</span></div>}
            {stats.ref && <div className="flex justify-between"><span className="text-slate-500">refs</span><span className="text-sky-300">{stats.ref}</span></div>}
            <div className="flex justify-between"><span className="text-slate-500">triangles</span><span className="text-slate-300">{stats.triangles.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">field</span><span className="text-slate-300">{stats.fieldMs} ms</span></div>
            <div className="flex justify-between"><span className="text-slate-500">total</span><span className="text-slate-300">{stats.loadMs} ms</span></div>
            <div className="flex justify-between"><span className="text-slate-500">glb size</span><span className="text-slate-300">{(stats.bytes / 1024).toFixed(1)} KB</span></div>
            {textureInfo && <div className="flex justify-between"><span className="text-slate-500">texture</span><span className="text-fuchsia-300 truncate max-w-[140px]" title={`${textureInfo} — triplanar projection (viewport); .glb keeps vertex colors`}>{textureInfo}</span></div>}
          </div>
        )}

        <Canvas shadows camera={{ position: [4, 3, 5], fov: 45 }}>
          <color attach="background" args={['#0f172a']} />
          <ambientLight intensity={ambientIntensity} />
          <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} intensity={spotIntensity} castShadow />
          <pointLight position={[-10, -10, -10]} intensity={0.5} />

          {generatedGroup && <GeneratedMesh group={generatedGroup} spin={spin} animators={animators} motionOn={isPlaying} />}
          {/* 3D-2: live raymarch preview — shows while the user types or while
              generation is running.  Priority: real mesh > AI program > local
              preview program.  The SDFRaytracer renders a full-screen
              sphere-traced SDF image; it disappears the moment the real
              polygonized mesh is ready.  With nothing to show, the empty
              grid awaits a prompt — no canned placeholder models. */}
          {!generatedGroup && previewFlat && (
            <SDFRaytracer program={previewFlat} />
          )}

          <ContactShadows position={[0, -0.01, 0]} opacity={0.4} scale={10} blur={2} far={4} />
          <Grid infiniteGrid fadeDistance={20} fadeStrength={5} sectionColor="#334155" cellColor="#1e293b" />
          <OrbitControls makeDefault enablePan enableZoom enableRotate
            minPolarAngle={0} maxPolarAngle={Math.PI / 2 + 0.1} />
          <Environment preset="city" />
        </Canvas>

        <div className="absolute bottom-4 left-4 z-10 flex items-center gap-2">
          <BatchForgePanel onModelReady={(r) => presentResult(r)} />
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
