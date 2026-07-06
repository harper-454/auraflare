import { useState, useRef, useCallback, useEffect } from 'react';
import { Share2, Server, Globe, Play, Square, Activity, Zap, Network, Layers } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// A real WebAssembly module, hand-assembled: export "work"(n: i32) -> i32
// computes sum of i*i for i in [0, n) in a tight wasm loop.
const WASM_BYTES = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,             // magic + version
  0x01, 0x06, 0x01, 0x60, 0x01, 0x7f, 0x01, 0x7f,             // type: (i32) -> i32
  0x03, 0x02, 0x01, 0x00,                                     // function section
  0x07, 0x08, 0x01, 0x04, 0x77, 0x6f, 0x72, 0x6b, 0x00, 0x00, // export "work"
  0x0a, 0x28, 0x01, 0x26,                                     // code section
  0x01, 0x02, 0x7f,                                           // 2 i32 locals
  0x02, 0x40, 0x03, 0x40,                                     // block, loop
  0x20, 0x01, 0x20, 0x00, 0x4e, 0x0d, 0x01,                   // i >= n ? br_if exit
  0x20, 0x02, 0x20, 0x01, 0x20, 0x01, 0x6c, 0x6a, 0x21, 0x02, // acc += i*i
  0x20, 0x01, 0x41, 0x01, 0x6a, 0x21, 0x01,                   // i++
  0x0c, 0x00, 0x0b, 0x0b,                                     // br loop, end, end
  0x20, 0x02, 0x0b,                                           // return acc
]);

const N = 20_000_000;

// Worker source: instantiates the wasm module and benchmarks wasm vs plain JS
const workerSource = `
self.onmessage = async (e) => {
  const { bytes, n, id } = e.data;
  const { instance } = await WebAssembly.instantiate(bytes);
  const work = instance.exports.work;
  while (true) {
    let t0 = performance.now();
    const wasmResult = work(n);
    const wasmMs = performance.now() - t0;
    t0 = performance.now();
    let acc = 0;
    for (let i = 0; i < n; i++) acc = (acc + i * i) | 0;
    const jsMs = performance.now() - t0;
    self.postMessage({ id, wasmMs, jsMs, ok: wasmResult === acc });
    await new Promise(r => setTimeout(r, 400));
  }
};
`;

interface NodeStat {
  id: number;
  wasmMs: number | null;
  jsMs: number | null;
  runs: number;
  verified: boolean;
}

export const WasmComputeSection = () => {
  const [active, setActive] = useState(false);
  const [nodes, setNodes] = useState<NodeStat[]>([]);
  const [wasmSupported] = useState(() => typeof WebAssembly !== 'undefined');
  const [error, setError] = useState<string | null>(null);
  const workersRef = useRef<Worker[]>([]);

  const stop = useCallback(() => {
    workersRef.current.forEach(w => w.terminate());
    workersRef.current = [];
    setActive(false);
    setNodes([]);
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(() => {
    setError(null);
    try {
      const count = Math.min(navigator.hardwareConcurrency || 4, 8);
      const url = URL.createObjectURL(new Blob([workerSource], { type: 'application/javascript' }));
      setNodes(Array.from({ length: count }, (_, id) => ({ id, wasmMs: null, jsMs: null, runs: 0, verified: false })));

      workersRef.current = Array.from({ length: count }, (_, id) => {
        const w = new Worker(url);
        w.onmessage = (e) => {
          const { id, wasmMs, jsMs, ok } = e.data;
          setNodes(prev => prev.map(nd => nd.id === id
            ? { id, wasmMs, jsMs, runs: nd.runs + 1, verified: ok }
            : nd));
        };
        w.onerror = (e) => setError(e.message);
        w.postMessage({ bytes: WASM_BYTES, n: N, id });
        return w;
      });
      URL.revokeObjectURL(url);
      setActive(true);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  const done = nodes.filter(n => n.wasmMs !== null);
  const avgWasm = done.length ? done.reduce((s, n) => s + (n.wasmMs ?? 0), 0) / done.length : 0;
  const avgJs = done.length ? done.reduce((s, n) => s + (n.jsMs ?? 0), 0) / done.length : 0;
  const speedup = avgWasm > 0 ? (avgJs / avgWasm) : 0;
  // Real aggregate throughput: N multiply-adds per run per worker
  const gops = done.length && avgWasm > 0 ? (done.length * N / (avgWasm / 1000)) / 1e9 : 0;

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/50 backdrop-blur z-10 sticky top-0 rounded-t-xl">
        <h2 className="text-lg font-bold text-slate-100 flex items-center gap-3">
          <Share2 className="text-indigo-400" /> WASM Compute Swarm
        </h2>
        <button
          onClick={active ? stop : start}
          disabled={!wasmSupported}
          className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-bold transition-colors disabled:opacity-50 ${
            active
              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/30'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
          }`}
        >
          {active ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          {active ? 'Stop Swarm' : 'Start Worker Swarm'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 md:p-10 flex flex-col xl:flex-row gap-8">
        <div className="w-full xl:w-1/3 flex flex-col gap-6">
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-5">
              <Network className="w-32 h-32 text-indigo-500" />
            </div>
            <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2 relative z-10">
              <Globe className="w-4 h-4 text-slate-400" /> Measured Performance
            </h3>
            <div className="grid grid-cols-2 gap-4 relative z-10">
              <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg text-center">
                <div className="text-3xl font-bold text-indigo-400 mb-1">{nodes.length}</div>
                <div className="text-xs text-slate-500 font-bold uppercase tracking-wider">Live Workers</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg text-center">
                <div className="text-3xl font-bold text-emerald-400 mb-1">{gops ? gops.toFixed(2) : '0.00'}</div>
                <div className="text-xs text-slate-500 font-bold uppercase tracking-wider">GOPS (real)</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg text-center col-span-2">
                <div className="text-xl font-bold text-slate-200 mb-1">
                  {speedup ? `${speedup.toFixed(2)}× vs JS` : wasmSupported ? 'WebAssembly Ready' : 'WASM Unsupported'}
                </div>
                <div className="text-xs text-slate-500 font-bold uppercase tracking-wider">WASM Speedup (measured)</div>
              </div>
            </div>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-xl p-6">
            <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
              <Layers className="w-4 h-4 text-slate-400" /> Workload
            </h3>
            <div className="space-y-3 text-xs font-mono text-slate-400">
              <div className="flex justify-between"><span className="text-slate-500">Module</span><span>hand-assembled, {WASM_BYTES.length} bytes</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Kernel</span><span>Σ i² for i &lt; {N.toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Baseline</span><span>identical JS loop</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Isolation</span><span>1 Web Worker / core</span></div>
              <div className="flex justify-between">
                <span className="text-slate-500">Verification</span>
                <span className={done.every(n => n.verified) && done.length ? 'text-emerald-400' : ''}>
                  {done.length ? (done.every(n => n.verified) ? 'wasm == js ✓' : 'MISMATCH') : 'pending'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="w-full xl:w-2/3 bg-slate-950 border border-slate-800 rounded-xl flex flex-col overflow-hidden relative">
          <div className="p-4 border-b border-slate-800 bg-slate-900 flex justify-between items-center z-10">
            <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2">
              <Activity className="w-4 h-4 text-slate-400" /> Worker Pool ({navigator.hardwareConcurrency} cores detected)
            </h3>
            {active && (
              <span className="flex items-center gap-2 text-xs font-mono text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Executing real WASM
              </span>
            )}
          </div>

          <div className="flex-1 p-6 overflow-y-auto relative">
            {error && <div className="p-3 mb-4 bg-rose-500/10 border border-rose-500/30 rounded text-xs font-mono text-rose-400">{error}</div>}
            {!active ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500">
                <Network className="w-16 h-16 mb-4 opacity-20" />
                <p className="text-sm font-bold uppercase tracking-widest">Swarm Idle</p>
                <p className="text-xs mt-2 text-slate-600">Start the swarm to benchmark a real WebAssembly kernel on every core</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 relative z-10">
                <AnimatePresence>
                  {nodes.map((node, i) => (
                    <motion.div
                      key={node.id}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ delay: i * 0.05 }}
                      className="bg-slate-900/80 backdrop-blur border border-slate-800 rounded-lg p-4 flex items-center gap-4"
                    >
                      <div className="relative">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 ${
                          node.wasmMs !== null ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10' : 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
                        }`}>
                          <Server className="w-4 h-4" />
                        </div>
                        {node.wasmMs !== null && (
                          <span className="absolute -top-1 -right-1 flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs font-mono font-bold text-slate-200">worker-{node.id}</span>
                          <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-400">
                            {node.runs} runs
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-xs font-mono text-slate-500">
                          <span className="flex items-center gap-1">
                            <Zap className="w-3 h-3" /> wasm {node.wasmMs !== null ? `${node.wasmMs.toFixed(0)}ms` : '…'}
                          </span>
                          <span>js {node.jsMs !== null ? `${node.jsMs.toFixed(0)}ms` : '…'}</span>
                        </div>
                        <div className="mt-2 w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 transition-all duration-500"
                            style={{ width: node.wasmMs && node.jsMs ? `${Math.min(100, (node.jsMs / (node.wasmMs + node.jsMs)) * 100)}%` : '0%' }}
                          />
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
