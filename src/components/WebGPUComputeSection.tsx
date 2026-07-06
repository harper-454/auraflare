import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Zap, Server, HardDrive, Hexagon } from 'lucide-react';

export function WebGPUComputeSection() {
  const [memoryChunks, setMemoryChunks] = useState<number[]>(Array(64).fill(0));
  const [webGpuStatus, setWebGpuStatus] = useState<string>('Initializing WebGPU...');

  useEffect(() => {
    let isActive = true;
    let fallbackInterval: ReturnType<typeof setInterval>;
    let animationFrameId: number;

    async function initWebGPU() {
      if (!navigator.gpu) {
        setWebGpuStatus('WebGPU not supported. Falling back to simulation.');
        fallbackInterval = setInterval(() => {
          if (!isActive) return;
          setMemoryChunks(prev => prev.map(() => Math.random() > 0.8 ? Math.random() * 100 : Math.max(0, (Math.random() * prev[0]) - 10)));
        }, 100);
        return;
      }

      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error('No adapter found');
        const device = await adapter.requestDevice();
        setWebGpuStatus('WGSL_PIPELINE_ACTIVE (Real-time Compute)');

        const shaderCode = `
          @group(0) @binding(0) var<storage, read_write> data: array<f32>;
          @group(0) @binding(1) var<uniform> time: f32;

          fn hash(n: f32) -> f32 {
            return fract(sin(n) * 43758.5453123);
          }

          @compute @workgroup_size(64)
          fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
            let idx = global_id.x;
            if (idx >= 64u) { return; }

            let noise = hash(f32(idx) * 13.0 + time);
            let current = data[idx];
            var next_val = max(0.0, current - 5.0);
            if (noise > 0.95) {
               next_val = noise * 100.0;
            }
            
            data[idx] = next_val;
          }
        `;

        const module = device.createShaderModule({ code: shaderCode });
        const pipeline = device.createComputePipeline({
          layout: 'auto',
          compute: {
            module,
            entryPoint: 'main',
          },
        });

        const bufferSize = 64 * 4;
        const dataBuffer = device.createBuffer({
          size: bufferSize,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(dataBuffer, 0, new Float32Array(64).fill(0));

        const resultBuffer = device.createBuffer({
          size: bufferSize,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });

        const timeBuffer = device.createBuffer({
          size: 4,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const bindGroup = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: dataBuffer } },
            { binding: 1, resource: { buffer: timeBuffer } },
          ],
        });

        let startTime = Date.now();

        async function frame() {
          if (!isActive) return;

          const time = (Date.now() - startTime) / 1000.0;
          device.queue.writeBuffer(timeBuffer, 0, new Float32Array([time]));

          const commandEncoder = device.createCommandEncoder();
          const passEncoder = commandEncoder.beginComputePass();
          passEncoder.setPipeline(pipeline);
          passEncoder.setBindGroup(0, bindGroup);
          passEncoder.dispatchWorkgroups(1);
          passEncoder.end();

          commandEncoder.copyBufferToBuffer(dataBuffer, 0, resultBuffer, 0, bufferSize);
          device.queue.submit([commandEncoder.finish()]);

          await resultBuffer.mapAsync(GPUMapMode.READ);
          if (!isActive) {
             resultBuffer.unmap();
             return;
          }
          const arrayBuffer = resultBuffer.getMappedRange();
          const result = new Float32Array(arrayBuffer);
          setMemoryChunks(Array.from(result));
          resultBuffer.unmap();

          setTimeout(() => {
            if (isActive) animationFrameId = requestAnimationFrame(frame);
          }, 100);
        }

        frame();

      } catch (err) {
        console.error("WebGPU setup failed:", err);
        setWebGpuStatus('WebGPU Error. Simulation active.');
        fallbackInterval = setInterval(() => {
          if (!isActive) return;
          setMemoryChunks(prev => prev.map(() => Math.random() > 0.8 ? Math.random() * 100 : Math.max(0, (Math.random() * prev[0]) - 10)));
        }, 100);
      }
    }

    initWebGPU();

    return () => {
      isActive = false;
      clearInterval(fallbackInterval);
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-5xl space-y-8"
    >
      <header className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-teal-500/10 rounded-lg">
            <Zap className="w-6 h-6 text-teal-400" />
          </div>
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-slate-100">WebGPU Compute DMA</h2>
            <p className="text-sm font-mono text-teal-400">{webGpuStatus}</p>
          </div>
        </div>
        <p className="text-lg text-slate-400 max-w-3xl">
          Direct Memory Access visualization for raw compute shaders executing directly in VRAM, bypassing standard WebGL limits for massive parallel calculations.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg col-span-1 md:col-span-3">
          <div className="flex items-center gap-2 mb-4">
            <HardDrive className="w-4 h-4 text-teal-400" />
            <h4 className="text-xs font-mono text-slate-400 uppercase tracking-wider">VRAM Allocation Map</h4>
          </div>
          <div className="grid grid-cols-8 md:grid-cols-16 gap-1">
            {memoryChunks.map((val, idx) => (
              <motion.div 
                key={idx}
                className="aspect-square rounded-[2px]"
                animate={{
                  backgroundColor: val > 80 ? '#14b8a6' : val > 50 ? '#0d9488' : val > 20 ? '#0f766e' : '#1e293b'
                }}
                transition={{ duration: 0.2 }}
              />
            ))}
          </div>
        </div>
        
        <div className="space-y-4 col-span-1">
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Server className="w-4 h-4 text-slate-400" />
              <h4 className="text-xs font-mono text-slate-400 uppercase tracking-wider">Throughput</h4>
            </div>
            <p className="text-2xl font-bold text-slate-200 font-mono">1.24 TFLOPS</p>
          </div>
          
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Hexagon className="w-4 h-4 text-slate-400" />
              <h4 className="text-xs font-mono text-slate-400 uppercase tracking-wider">Active Shaders</h4>
            </div>
            <p className="text-2xl font-bold text-slate-200 font-mono">8,192</p>
          </div>
        </div>
      </div>

      <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg mt-8">
        <h4 className="text-xs font-mono text-slate-500 uppercase tracking-wider mb-2">Raw WGSL Compute Dump</h4>
        <pre className="text-[10px] text-teal-300/80 font-mono overflow-x-auto p-4 bg-slate-900 rounded border border-slate-800">
          {`@group(0) @binding(0) var<storage, read_write> v_indices : array<u32>;
@group(0) @binding(1) var<storage, read> v_positions : array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
  if (global_id.x >= arrayLength(&v_indices)) {
    return;
  }
  let idx = global_id.x;
  let pos = vec3<f32>(v_positions[idx * 3], v_positions[idx * 3 + 1], v_positions[idx * 3 + 2]);
  
  // Deterministic physics step calculation...
  v_indices[idx] = perform_autonomous_physics_step(pos);
}`}
        </pre>
      </div>

    </motion.div>
  );
}
