import { useState, useRef, useCallback } from 'react';
import { Box, Gamepad2, Layers, Trash2 } from 'lucide-react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';

interface Entity {
  id: number;
  kind: 'box' | 'sphere' | 'torus';
  position: [number, number, number];
  color: string;
  speed: number;
}

const COLORS = ['#7b8cfa', '#5fc99a', '#dcb35c', '#e58398', '#5fbedd', '#b394e8'];
let entityId = 0;

function SpinningEntity({ entity }: { entity: Entity }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ref.current) {
      ref.current.rotation.x += dt * entity.speed;
      ref.current.rotation.y += dt * entity.speed * 0.7;
    }
  });
  return (
    <mesh ref={ref} position={entity.position} castShadow>
      {entity.kind === 'box' && <boxGeometry args={[1, 1, 1]} />}
      {entity.kind === 'sphere' && <sphereGeometry args={[0.6, 32, 32]} />}
      {entity.kind === 'torus' && <torusGeometry args={[0.5, 0.2, 16, 48]} />}
      <meshStandardMaterial color={entity.color} roughness={0.35} metalness={0.4} />
    </mesh>
  );
}

// Reads real renderer statistics every frame, pushes to HUD ~4×/sec
function StatsProbe({ onStats }: { onStats: (s: { fps: number; calls: number; triangles: number }) => void }) {
  const { gl } = useThree();
  const frames = useRef(0);
  const last = useRef(performance.now());
  useFrame(() => {
    frames.current++;
    const now = performance.now();
    if (now - last.current >= 250) {
      onStats({
        fps: Math.round((frames.current * 1000) / (now - last.current)),
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
      });
      frames.current = 0;
      last.current = now;
    }
  });
  return null;
}

export function WebGLEngine() {
  // Real three.js engine: live scene, real renderer stats, interactive orbit camera
  const [entities, setEntities] = useState<Entity[]>([
    { id: entityId++, kind: 'box', position: [0, 0.5, 0], color: '#7b8cfa', speed: 0.8 },
  ]);
  const [stats, setStats] = useState({ fps: 0, calls: 0, triangles: 0 });

  const spawn = useCallback(() => {
    const kinds: Entity['kind'][] = ['box', 'sphere', 'torus'];
    setEntities(e => [...e, {
      id: entityId++,
      kind: kinds[Math.floor(Math.random() * kinds.length)],
      position: [(Math.random() - 0.5) * 8, 0.5 + Math.random() * 3, (Math.random() - 0.5) * 8],
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      speed: 0.3 + Math.random() * 1.5,
    }]);
  }, []);

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex items-center justify-between shrink-0">
        <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-3">
          <Gamepad2 className="text-indigo-400" /> WebGL Engine
        </h2>
        <div className="flex gap-3">
          <span className="text-xs font-mono text-indigo-400 bg-indigo-400/10 px-3 py-1 rounded-full border border-indigo-500/20">THREE.JS · LIVE</span>
          <span className="text-xs font-mono text-emerald-400 bg-emerald-400/10 px-3 py-1 rounded-full border border-emerald-500/20">{entities.length} ENTITIES</span>
        </div>
      </div>

      <div className="flex-1 min-h-[500px] bg-slate-900 border border-slate-800 rounded-xl relative overflow-hidden">
        <Canvas shadows camera={{ position: [6, 5, 8], fov: 50 }}>
          <color attach="background" args={['#0a0c10']} />
          <fog attach="fog" args={['#0a0c10', 15, 35]} />
          <ambientLight intensity={0.4} />
          <directionalLight position={[5, 8, 5]} intensity={1.2} castShadow />
          <Grid infiniteGrid sectionColor="#242a35" cellColor="#161a22" fadeDistance={30} />
          {entities.map(e => <SpinningEntity key={e.id} entity={e} />)}
          <OrbitControls makeDefault enableDamping />
          <StatsProbe onStats={setStats} />
        </Canvas>

        {/* Real renderer HUD */}
        <div className="absolute top-4 left-4 bg-slate-950/80 backdrop-blur border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-400 pointer-events-none">
          FPS: <span className="text-emerald-400">{stats.fps}</span><br />
          Draw Calls: <span className="text-indigo-400">{stats.calls}</span><br />
          Triangles: <span className="text-slate-200">{stats.triangles.toLocaleString()}</span>
        </div>

        {/* Live scene graph */}
        <div className="absolute top-4 right-4 bg-slate-950/80 backdrop-blur border border-slate-800 rounded-lg p-3 text-xs font-mono max-h-56 overflow-y-auto">
          <div className="text-slate-500 mb-2 uppercase font-bold tracking-wider flex items-center gap-2">
            <Layers className="w-3 h-3" /> Hierarchy
          </div>
          <ul className="space-y-1 text-slate-300">
            <li>- Scene</li>
            <li className="pl-4">- PerspectiveCamera</li>
            <li className="pl-4">- DirectionalLight</li>
            {entities.map(e => (
              <li key={e.id} className="pl-4 flex items-center gap-2 group">
                <span style={{ color: e.color }}>- {e.kind}_{String(e.id).padStart(2, '0')}</span>
                <button
                  onClick={() => setEntities(ents => ents.filter(x => x.id !== e.id))}
                  className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-rose-400"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-4">
          <button
            onClick={spawn}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            <Box className="w-4 h-4" /> Spawn Entity
          </button>
          <button
            onClick={() => setEntities([])}
            className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-lg transition-colors border border-slate-700"
          >
            Clear Scene
          </button>
        </div>
      </div>
    </div>
  );
}
