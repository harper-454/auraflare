import React, { useRef, useState, useEffect, useMemo, Suspense, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows, Center, Html, useGLTF, useAnimations } from '@react-three/drei';
import { Download, Search, Layers, Loader2, Box as BoxIcon, Play, Sparkles, Dices, Upload, Cloud, Trash2 } from 'lucide-react';
import * as THREE from 'three';
import { generateModel, exportGLB, parsePromptLocally, ShapeSpec } from '../../lib/meshforge';
import { composeWithAI, refineProgramWithAI, ShapeProgram } from '../../lib/sdf-compiler';
import { compileProgramAuto } from '../../lib/sdf-gpu';

// Real 3D assets: the Khronos glTF sample library on GitHub — no API key,
// CORS-open, production-grade PBR models fetched live from the internet.
const REPO = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models';
const INDEX_URL = `${REPO}/model-index.json`;

interface ModelEntry {
  label: string;
  name: string;
  screenshot: string;
  tags: string[];
  variants: Record<string, string>;
}

interface LoadStats {
  triangles: number;
  meshes: number;
  materials: number;
  bytes: number;
  loadMs: number;
  animations: number;
}

const PROMPT_IDEAS = [
  'a snowman with a top hat',
  'baby dragon with wings',
  'rocket ship with red fins',
  'mushroom house with a door',
  'twisted gold vase with stripes',
  'glowing purple alien coral',
];

function LoadedModel({ url, wireframe, onStats }: { url: string; wireframe: boolean; onStats: (s: Omit<LoadStats, 'bytes' | 'loadMs'>) => void }) {
  const { scene, animations } = useGLTF(url);
  const group = useRef<THREE.Group>(null);
  const { actions } = useAnimations(animations, group);

  useEffect(() => {
    Object.values(actions).forEach(a => a?.reset().play());
  }, [actions]);

  useEffect(() => {
    let triangles = 0, meshes = 0;
    const mats = new Set<THREE.Material>();
    scene.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        meshes++;
        const geo = mesh.geometry as THREE.BufferGeometry;
        triangles += Math.round((geo.index ? geo.index.count : geo.attributes.position?.count ?? 0) / 3);
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(m => mats.add(m));
      }
    });
    onStats({ triangles, meshes, materials: mats.size, animations: animations.length });
  }, [scene, animations, onStats]);

  useEffect(() => {
    scene.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(m => {
          (m as THREE.MeshStandardMaterial).wireframe = wireframe;
        });
      }
    });
  }, [scene, wireframe]);

  const scale = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3()).length();
    return size > 0 ? 3.5 / size : 1;
  }, [scene]);

  return (
    <group ref={group}>
      <Center>
        <primitive object={scene} scale={scale} />
      </Center>
    </group>
  );
}

function ForgedModel({ group, wireframe }: { group: THREE.Group; wireframe: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => { if (ref.current) ref.current.rotation.y += dt * 0.25; });

  useEffect(() => {
    group.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) (mesh.material as THREE.MeshStandardMaterial).wireframe = wireframe;
    });
  }, [group, wireframe]);

  const scale = useMemo(() => {
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3()).length();
    return size > 0 ? 3.2 / size : 1;
  }, [group]);

  return (
    <group ref={ref}>
      <Center>
        <primitive object={group} scale={scale} />
      </Center>
    </group>
  );
}

const Spinner = () => (
  <Html center>
    <div className="flex items-center gap-2 text-indigo-400 text-xs font-mono whitespace-nowrap">
      <Loader2 className="w-4 h-4 animate-spin" /> streaming glb…
    </div>
  </Html>
);

export const Model3DView = ({ mode }: { mode: string }) => {
  const [wireframe, setWireframe] = useState(false);
  const [index, setIndex] = useState<ModelEntry[]>([]);
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState<ModelEntry | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [stats, setStats] = useState<LoadStats | null>(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<'forge' | 'library' | 'gallery' | null>('forge');
  const [galleryItems, setGalleryItems] = useState<{ key: string; size: number; uploaded: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  // MeshForge (our own generator) state
  const [prompt, setPrompt] = useState('');
  const [forged, setForged] = useState<THREE.Group | null>(null);
  const [forgedSpec, setForgedSpec] = useState<ShapeSpec | null>(null);
  const [forging, setForging] = useState(false);
  const [parseSource, setParseSource] = useState<'ai' | 'preset' | 'local' | null>(null);
  const [composedOps, setComposedOps] = useState<number | null>(null);
  const [lastProgram, setLastProgram] = useState<ShapeProgram | null>(null);
  const [refineText, setRefineText] = useState('');
  const [refining, setRefining] = useState(false);
  const [backendInfo, setBackendInfo] = useState<{ backend: 'gpu' | 'cpu'; res: number; fieldMs: number } | null>(null);

  const bytesRef = useRef(0);
  const loadStart = useRef(0);

  useEffect(() => {
    fetch(INDEX_URL)
      .then(r => r.json())
      .then((all: ModelEntry[]) => {
        setIndex(all.filter(m => m.variants['glTF-Binary'] && !m.name.includes(' ')));
      })
      .catch(e => setError(`Could not reach model library: ${e.message}`));
  }, []);

  const loadModel = useCallback(async (entry: ModelEntry) => {
    setFetching(true);
    setError(null);
    setStats(null);
    loadStart.current = performance.now();
    try {
      const url = `${REPO}/${entry.name}/glTF-Binary/${encodeURIComponent(entry.variants['glTF-Binary'])}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      bytesRef.current = blob.size;
      setForged(null);
      setForgedSpec(null);
      setBlobUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
      setCurrent(entry);
      setPanel(null);
    } catch (e: any) {
      setError(`${entry.label}: ${e.message}`);
    }
    setFetching(false);
  }, []);

  // ——— MeshForge: our own free text-to-3D pipeline ———
  const forge = useCallback(async (input?: string) => {
    const text = (input ?? prompt).trim();
    if (!text) return;
    setForging(true);
    setError(null);
    setStats(null);
    loadStart.current = performance.now();
    try {
      // Stage 1: compositional SDF shape program — the LLM writes a part-by-part
      // sculpting program (preset library when offline), compiled via marching tetrahedra
      let group: THREE.Group, triangles: number, spec: ShapeSpec;
      const composed = await composeWithAI(text);
      if (composed) {
        const compiled = await compileProgramAuto(composed.program);
        group = compiled.group;
        triangles = compiled.triangles;
        spec = { ...parsePromptLocally(text), label: composed.program.label };
        setComposedOps(compiled.opCount);
        setParseSource(composed.source);
        setLastProgram(composed.program);
        setBackendInfo({ backend: compiled.backend, res: compiled.resolution, fieldMs: compiled.fieldMs });
      } else {
        // Fallback: single-family parametric synthesis (fully offline)
        spec = parsePromptLocally(text);
        const gen = generateModel(text, spec);
        group = gen.group;
        triangles = gen.triangles;
        setComposedOps(null);
        setParseSource('local');
        setLastProgram(null);
        setBackendInfo(null);
      }
      // Final stage: measure the real exportable GLB size
      const blob = await exportGLB(group);
      bytesRef.current = blob.size;
      setBlobUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
      setCurrent(null);
      setForged(group);
      setForgedSpec(spec);
      setStats({
        triangles,
        meshes: 1,
        materials: 1,
        animations: 0,
        bytes: blob.size,
        loadMs: Math.round(performance.now() - loadStart.current),
      });
      setPanel(null);
    } catch (e: any) {
      setError(`Forge failed: ${e.message}`);
    }
    setForging(false);
  }, [prompt]);

  // LLM self-revision: the model edits its own shape program
  const refine = useCallback(async () => {
    const instruction = refineText.trim();
    if (!instruction || !lastProgram) return;
    setRefining(true);
    setError(null);
    loadStart.current = performance.now();
    try {
      const updated = await refineProgramWithAI(lastProgram, instruction);
      if (!updated) throw new Error('AI returned no valid program — dev server + API key required for refine');
      const compiled = await compileProgramAuto(updated);
      const blob = await exportGLB(compiled.group);
      bytesRef.current = blob.size;
      setBlobUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
      setForged(compiled.group);
      setForgedSpec(s => (s ? { ...s, label: updated.label } : s));
      setLastProgram(updated);
      setComposedOps(compiled.opCount);
      setParseSource('ai');
      setBackendInfo({ backend: compiled.backend, res: compiled.resolution, fieldMs: compiled.fieldMs });
      setStats({
        triangles: compiled.triangles, meshes: 1, materials: 1, animations: 0,
        bytes: blob.size, loadMs: Math.round(performance.now() - loadStart.current),
      });
      setRefineText('');
    } catch (e: any) {
      setError(`Refine failed: ${e.message}`);
    }
    setRefining(false);
  }, [refineText, lastProgram]);

  const surprise = useCallback(() => {
    const idea = PROMPT_IDEAS[Math.floor(Math.random() * PROMPT_IDEAS.length)];
    setPrompt(idea);
    forge(idea);
  }, [forge]);

  const onMeshStats = useCallback((s: Omit<LoadStats, 'bytes' | 'loadMs'>) => {
    setStats({ ...s, bytes: bytesRef.current, loadMs: Math.round(performance.now() - loadStart.current) });
  }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return index
      .filter(m => !q || m.label.toLowerCase().includes(q) || m.tags.some(t => t.includes(q)))
      .sort((a, b) => Number(b.tags.includes('showcase')) - Number(a.tags.includes('showcase')))
      .slice(0, 24);
  }, [index, query]);

  const downloadGlb = useCallback(() => {
    if (!blobUrl) return;
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${forged ? (forgedSpec?.label ?? 'meshforge').replace(/\W+/g, '-') : current?.name ?? 'model'}.glb`;
    a.click();
  }, [blobUrl, current, forged, forgedSpec]);

  // ——— model gallery: .forge-gallery/ on the dev server, R2 in production ———
  const saveToCloud = useCallback(async () => {
    if (!blobUrl) return;
    setSaving(true);
    setError(null);
    try {
      const blob = await (await fetch(blobUrl)).blob();
      const base = (forged ? forgedSpec?.label ?? 'model' : current?.name ?? 'model').replace(/\W+/g, '-').toLowerCase();
      const key = `forge-${base}-${Date.now().toString(36)}.glb`;
      const res = await fetch(`/api/media/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'model/gltf-binary' },
        body: blob,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSavedKey(key);
      setTimeout(() => setSavedKey(null), 4000);
    } catch (e: any) {
      setError(`Save failed: ${e.message} — is the dev server running?`);
    }
    setSaving(false);
  }, [blobUrl, forged, forgedSpec, current]);

  const openGallery = useCallback(async () => {
    setPanel(p => (p === 'gallery' ? null : 'gallery'));
    try {
      const res = await fetch('/api/media');
      const data = await res.json();
      setGalleryItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      setGalleryItems([]);
    }
  }, []);

  const loadFromGallery = useCallback(async (key: string) => {
    setFetching(true);
    setError(null);
    setStats(null);
    loadStart.current = performance.now();
    try {
      const res = await fetch(`/api/media/${encodeURIComponent(key)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      bytesRef.current = blob.size;
      setForged(null); setForgedSpec(null); setComposedOps(null); setLastProgram(null); setBackendInfo(null);
      setBlobUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
      setCurrent({ label: key.replace(/^forge-/, '').replace(/\.glb$/, ''), name: key, screenshot: '', tags: ['gallery'], variants: {} });
      setPanel(null);
    } catch (e: any) {
      setError(`${key}: ${e.message}`);
    }
    setFetching(false);
  }, []);

  const deleteFromGallery = useCallback(async (key: string) => {
    await fetch(`/api/media/${encodeURIComponent(key)}`, { method: 'DELETE' }).catch(() => {});
    setGalleryItems(items => items.filter(i => i.key !== key));
  }, []);

  const title = forged ? forgedSpec?.label ?? 'MeshForge model' : current?.label ?? mode;

  return (
    <div className="flex-1 relative bg-slate-950 flex flex-col">
      {/* Stats HUD — every number measured from the actual asset */}
      <div className="absolute top-4 left-4 z-10 bg-slate-900/80 backdrop-blur border border-slate-700 p-3 rounded-lg flex items-center gap-4 shadow-xl">
        <div className="flex flex-col">
          <span className="text-slate-100 text-xs font-bold flex items-center gap-1.5">
            {forged && <Sparkles className="w-3 h-3 text-indigo-400" />}
            {title}
            {forged && parseSource && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-mono ${
                parseSource === 'ai'
                  ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
                  : parseSource === 'preset'
                    ? 'text-indigo-400 border-indigo-500/30 bg-indigo-500/10'
                    : 'text-amber-400 border-amber-500/30 bg-amber-500/10'
              }`}>
                {parseSource === 'ai' ? 'AI-composed' : parseSource === 'preset' ? 'preset program' : 'keyword-parsed'}
              </span>
            )}
          </span>
          <span className="text-slate-400 text-[10px]">
            {stats
              ? `${stats.triangles.toLocaleString()} tris · ${stats.meshes} mesh${stats.meshes === 1 ? '' : 'es'} · ${(stats.bytes / 1024).toFixed(0)} KB ${forged ? 'generated' : 'loaded'} in ${stats.loadMs}ms${stats.animations ? ` · ${stats.animations} anim` : ''}`
              : fetching || forging ? (forging ? 'forging mesh…' : 'downloading…') : 'no model loaded'}
          </span>
        </div>
        <div className="h-6 w-px bg-slate-700" />
        <button onClick={downloadGlb} disabled={!blobUrl} className="text-slate-400 hover:text-slate-100 disabled:opacity-30 transition-colors" title="Download real .glb">
          <Download className="w-4 h-4" />
        </button>
        <button
          onClick={saveToCloud}
          disabled={!blobUrl || saving}
          className={`transition-colors disabled:opacity-30 ${savedKey ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-100'}`}
          title={savedKey ? `Saved as ${savedKey}` : 'Save to model gallery (local dev disk / R2 in production)'}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        </button>
        <button
          onClick={() => setWireframe(!wireframe)}
          className={`transition-colors ${wireframe ? 'text-indigo-400' : 'text-slate-400 hover:text-slate-100'}`}
          title="Toggle Wireframe"
        >
          <Layers className="w-4 h-4" />
        </button>
      </div>

      <div className="absolute top-4 right-4 z-10 flex gap-2">
        <button
          onClick={() => setPanel(p => (p === 'forge' ? null : 'forge'))}
          disabled={forging}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center gap-2 shadow-lg shadow-indigo-500/20"
        >
          {forging ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Generate
        </button>
        <button
          onClick={() => setPanel(p => (p === 'library' ? null : 'library'))}
          disabled={fetching}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 rounded-lg text-xs font-bold flex items-center gap-2"
        >
          {fetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <BoxIcon className="w-4 h-4" />}
          Library
        </button>
        <button
          onClick={openGallery}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-bold flex items-center gap-2"
        >
          <Cloud className="w-4 h-4" />
          Gallery
        </button>
      </div>

      {/* MeshForge panel — our own generator, zero API keys */}
      {panel === 'forge' && (
        <div className="absolute top-16 right-4 z-20 w-80 bg-slate-900/95 backdrop-blur border border-slate-700 rounded-xl shadow-2xl p-4 space-y-3">
          <div>
            <div className="text-xs font-bold text-slate-200 mb-1 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" /> MeshForge <span className="text-slate-500 font-normal">— local text-to-3D</span>
            </div>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              Prompt → AI-written SDF shape program (parts blended like clay) → marching-tetrahedra compile → exportable GLB. Offline it falls back to preset programs, then parametric synthesis.
            </p>
          </div>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); forge(); } }}
            placeholder='e.g. "a snowman with a top hat"'
            rows={2}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={() => forge()}
              disabled={forging || !prompt.trim()}
              className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-colors"
            >
              {forging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Forge Mesh
            </button>
            <button
              onClick={surprise}
              disabled={forging}
              title="Random prompt"
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 rounded-lg transition-colors"
            >
              <Dices className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PROMPT_IDEAS.slice(0, 3).map(idea => (
              <button
                key={idea}
                onClick={() => { setPrompt(idea); forge(idea); }}
                className="text-[9px] px-2 py-1 bg-slate-950 border border-slate-800 hover:border-indigo-500/50 rounded-full text-slate-400 transition-colors"
              >
                {idea}
              </button>
            ))}
          </div>
          {lastProgram && (
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <div className="text-[10px] font-bold text-slate-400">
                Refine “{lastProgram.label}” — the AI edits its own program
              </div>
              <div className="flex gap-2">
                <input
                  value={refineText}
                  onChange={e => setRefineText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') refine(); }}
                  placeholder='e.g. "make the wings bigger"'
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                />
                <button
                  onClick={refine}
                  disabled={refining || !refineText.trim()}
                  className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-lg text-xs font-bold transition-colors flex items-center"
                >
                  {refining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Refine'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Khronos asset browser */}
      {panel === 'library' && (
        <div className="absolute top-16 right-4 z-20 w-80 max-h-[70%] bg-slate-900/95 backdrop-blur border border-slate-700 rounded-xl shadow-2xl flex flex-col overflow-hidden">
          <div className="p-3 border-b border-slate-800">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={`Search ${index.length} real assets…`}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 grid grid-cols-2 gap-2">
            {filtered.map(m => (
              <button
                key={m.name}
                onClick={() => loadModel(m)}
                className={`text-left rounded-lg border overflow-hidden transition-colors ${
                  current?.name === m.name ? 'border-indigo-500' : 'border-slate-800 hover:border-slate-600'
                }`}
              >
                <img
                  src={`${REPO}/${m.name}/${m.screenshot}`}
                  alt={m.label}
                  loading="lazy"
                  className="w-full h-16 object-cover bg-slate-950"
                />
                <div className="px-2 py-1.5">
                  <div className="text-[10px] font-bold text-slate-200 truncate">{m.label}</div>
                  <div className="text-[9px] text-slate-500 truncate">{m.tags.join(' · ')}</div>
                </div>
              </button>
            ))}
            {index.length === 0 && !error && (
              <div className="col-span-2 p-4 text-center text-xs text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin mx-auto mb-2" /> Fetching live model index…
              </div>
            )}
          </div>
        </div>
      )}

      {/* Saved-model gallery — disk in dev, R2 at the edge */}
      {panel === 'gallery' && (
        <div className="absolute top-16 right-4 z-20 w-80 max-h-[70%] bg-slate-900/95 backdrop-blur border border-slate-700 rounded-xl shadow-2xl flex flex-col overflow-hidden">
          <div className="p-3 border-b border-slate-800 text-xs font-bold text-slate-200 flex items-center gap-2">
            <Cloud className="w-3.5 h-3.5 text-indigo-400" /> Model Gallery
            <span className="text-slate-500 font-normal">— {galleryItems.length} saved</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {galleryItems.length === 0 && (
              <p className="p-4 text-center text-xs text-slate-500">
                Nothing saved yet. Forge a model, then hit the upload icon in the HUD.
              </p>
            )}
            {galleryItems.map(item => (
              <div key={item.key} className="flex items-center gap-2 p-2.5 bg-slate-950 border border-slate-800 rounded-lg group">
                <button onClick={() => loadFromGallery(item.key)} className="flex-1 text-left min-w-0">
                  <div className="text-[11px] font-mono text-slate-200 truncate">{item.key.replace(/^forge-/, '')}</div>
                  <div className="text-[9px] text-slate-500">
                    {(item.size / 1024).toFixed(0)} KB · {new Date(item.uploaded).toLocaleString()}
                  </div>
                </button>
                <button
                  onClick={() => deleteFromGallery(item.key)}
                  className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-rose-400 transition-all shrink-0"
                  title="Delete from gallery"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-10 px-4 py-2 bg-rose-500/10 border border-rose-500/30 rounded-lg text-xs font-mono text-rose-400">
          {error}
        </div>
      )}

      <div className="flex-1 cursor-move">
        <Canvas camera={{ position: [0, 0.5, 4], fov: 45 }}>
          <color attach="background" args={['#0a0c10']} />
          <ambientLight intensity={0.5} />
          <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} intensity={2} castShadow />
          <Suspense fallback={<Spinner />}>
            {forged
              ? <ForgedModel group={forged} wireframe={wireframe} />
              : blobUrl && <LoadedModel url={blobUrl} wireframe={wireframe} onStats={onMeshStats} />}
            <Environment preset="city" />
          </Suspense>
          <ContactShadows position={[0, -1.6, 0]} opacity={0.5} scale={10} blur={2} far={4} />
          <OrbitControls makeDefault autoRotate={!forged} autoRotateSpeed={0.5} />
        </Canvas>
      </div>

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-slate-900/80 backdrop-blur border border-slate-700 px-4 py-2 rounded-full shadow-xl flex items-center gap-4 text-[10px] font-mono text-slate-400">
        <span className="flex items-center gap-1.5">
          <Play className="w-3 h-3 text-emerald-400" />
          {forged ? 'MeshForge · generated on-device' : stats?.animations ? `${stats.animations} real animation clip(s) playing` : 'static asset'}
        </span>
        <div className="h-4 w-px bg-slate-700" />
        <span>
          {forged
            ? composedOps
              ? `${composedOps} SDF ops · ${backendInfo ? `${backendInfo.backend.toUpperCase()} field ${backendInfo.res}\u00b3 in ${backendInfo.fieldMs}ms` : 'marching tetrahedra'}`
              : `seed-locked · base: ${forgedSpec?.base}`
            : 'source: KhronosGroup/glTF-Sample-Assets'}
        </span>
      </div>
    </div>
  );
};
