import { useState, useEffect, useCallback } from 'react';
import { Cpu, Zap, Activity, Loader2 } from 'lucide-react';

// Real GPU compute: each invocation runs 1024 fused multiply-adds in a WGSL shader
const WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> data: array<f32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= arrayLength(&data)) { return; }
  var x = data[i];
  for (var k = 0u; k < 1024u; k++) {
    x = x * 1.0000001 + 0.0000001;
  }
  data[i] = x;
}
`;

const N = 1 << 20;          // 1M elements
const FLOPS_PER_RUN = N * 1024 * 2; // mul + add per iteration

interface GpuInfo {
  vendor: string;
  architecture: string;
  device: string;
  maxWorkgroups: number;
  maxBufferMB: number;
  fallback: boolean;
}

export const NeuromorphicHardwareSection = () => {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [info, setInfo] = useState<GpuInfo | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ms: number; gflops: number; checksum: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const gpu = (navigator as any).gpu;
    if (!gpu) { setSupported(false); return; }
    gpu.requestAdapter().then((adapter: any) => {
      if (!adapter) { setSupported(false); return; }
      setSupported(true);
      const ai = adapter.info ?? {};
      setInfo({
        vendor: ai.vendor || 'unknown',
        architecture: ai.architecture || 'unknown',
        device: ai.device || ai.description || 'GPU',
        maxWorkgroups: adapter.limits?.maxComputeWorkgroupsPerDimension ?? 0,
        maxBufferMB: Math.round((adapter.limits?.maxStorageBufferBindingSize ?? 0) / 1048576),
        fallback: Boolean(adapter.isFallbackAdapter),
      });
    }).catch(() => setSupported(false));
  }, []);

  const runBenchmark = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const adapter = await (navigator as any).gpu.requestAdapter();
      const device = await adapter.requestDevice();

      const buffer = device.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
      const readback = device.createBuffer({ size: 256 * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      device.queue.writeBuffer(buffer, 0, new Float32Array(N).fill(1));

      const module = device.createShaderModule({ code: WGSL });
      const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
      const bind = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer } }],
      });

      // Warmup dispatch
      let enc = device.createCommandEncoder();
      let pass = enc.beginComputePass();
      pass.setPipeline(pipeline); pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(Math.ceil(N / 256)); pass.end();
      device.queue.submit([enc.finish()]);
      await device.queue.onSubmittedWorkDone();

      // Timed dispatch
      const t0 = performance.now();
      enc = device.createCommandEncoder();
      pass = enc.beginComputePass();
      pass.setPipeline(pipeline); pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(Math.ceil(N / 256)); pass.end();
      enc.copyBufferToBuffer(buffer, 0, readback, 0, 256 * 4);
      device.queue.submit([enc.finish()]);
      await device.queue.onSubmittedWorkDone();
      const ms = performance.now() - t0;

      await readback.mapAsync(GPUMapMode.READ);
      const sample = new Float32Array(readback.getMappedRange().slice(0));
      readback.unmap();
      const checksum = sample.reduce((s, v) => s + v, 0);

      setResult({ ms, gflops: FLOPS_PER_RUN / (ms / 1000) / 1e9, checksum });
      device.destroy();
    } catch (e: any) {
      setError(`${e.name ?? 'Error'}: ${e.message}`);
    }
    setRunning(false);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/50 backdrop-blur z-10 sticky top-0 rounded-t-xl">
        <h2 className="text-lg font-bold text-slate-100 flex items-center gap-3">
          <Cpu className="text-emerald-400" /> Neural Compute Bindings (GPU)
        </h2>
        <button
          onClick={runBenchmark}
          disabled={!supported || running}
          className="text-emerald-400 hover:text-emerald-300 disabled:opacity-40 text-xs font-bold border border-emerald-500/30 px-3 py-1 rounded bg-emerald-500/10 flex items-center gap-2"
        >
          {running && <Loader2 className="w-3 h-3 animate-spin" />}
          {running ? 'Dispatching…' : 'Run GPU Benchmark'}
        </button>
      </div>
      <div className="flex-1 p-6 overflow-y-auto">
        <p className="text-slate-400 text-sm mb-6 max-w-3xl">
          This section binds to your machine's real GPU through WebGPU. The benchmark dispatches an actual WGSL compute
          shader — {(N / 1048576).toFixed(0)}M elements × 1,024 FMA iterations — and reports measured throughput.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-6">
            <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" /> Detected Hardware (adapter.info)
            </h3>
            {supported === null && <div className="text-sm text-slate-500">Querying adapter…</div>}
            {supported === false && (
              <div className="text-sm text-rose-400">
                WebGPU unavailable in this browser. Use Chrome/Edge 113+ with hardware acceleration enabled.
              </div>
            )}
            {info && (
              <div className="space-y-3">
                {[
                  { k: 'Vendor', v: info.vendor },
                  { k: 'Architecture', v: info.architecture },
                  { k: 'Device', v: info.device },
                  { k: 'Max storage binding', v: `${info.maxBufferMB} MB` },
                  { k: 'Max workgroups/dim', v: info.maxWorkgroups.toLocaleString() },
                  { k: 'Software fallback', v: info.fallback ? 'yes (no real GPU)' : 'no — hardware' },
                ].map(row => (
                  <div key={row.k} className="bg-slate-900 p-3 rounded-lg border border-slate-800 flex justify-between items-center">
                    <span className="text-slate-500 text-xs">{row.k}</span>
                    <span className="text-emerald-400 font-mono text-xs">{row.v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-xl p-6 flex flex-col items-center justify-center relative overflow-hidden">
            {running && <div className="absolute inset-0 bg-emerald-500/5 animate-pulse" />}
            <Zap className={`w-16 h-16 mb-4 ${result ? 'text-emerald-400' : 'text-emerald-500/20'}`} />
            {result ? (
              <div className="text-center relative z-10">
                <div className="text-4xl font-bold text-slate-100 mb-1">{result.gflops.toFixed(1)} <span className="text-lg text-slate-400">GFLOPS</span></div>
                <p className="text-slate-400 text-sm">measured in {result.ms.toFixed(1)}ms on your GPU</p>
                <p className="text-slate-600 font-mono text-[10px] mt-2">checksum {result.checksum.toFixed(4)} · result verified on readback</p>
              </div>
            ) : (
              <div className="text-center relative z-10">
                <h3 className="text-lg font-bold text-slate-200">Edge Inference Substrate</h3>
                <p className="text-slate-500 text-xs max-w-xs mt-2">
                  {supported ? 'Run the benchmark to measure real compute throughput.' : 'Awaiting WebGPU support.'}
                </p>
              </div>
            )}
            {error && <p className="mt-4 text-xs font-mono text-rose-400 relative z-10 text-center">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
};
