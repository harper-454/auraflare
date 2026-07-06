/**
 * WebGPU backend for the SDF shape-program compiler.
 *
 * v2: the ENTIRE pipeline runs on the GPU in one fused WGSL kernel —
 * each thread takes one lattice cell, evaluates the shape program at its
 * 8 corners, runs marching tetrahedra, fixes winding against the SDF
 * gradient, computes smooth gradient normals and per-part vertex colors,
 * and appends finished triangles via an atomic allocator. Only the finished
 * vertex data is read back; the distance field never leaves VRAM.
 *
 * Tuned for wave64 GPUs (workgroup_size 64 — ideal on AMD RDNA2 like the
 * RX 6900 XT; runs through D3D12 on Windows browsers, no ROCm involved).
 * Falls back to the deterministic CPU compiler when WebGPU is unavailable.
 */
import * as THREE from 'three';
import type { ShapeProgram, PrimOp } from './sdf-compiler';
import { BOUND, polygonizeField, evaluateFieldCPU, expandProgram } from './sdf-compiler';

export interface CompileResult {
  group: THREE.Group;
  triangles: number;
  opCount: number;
  backend: 'gpu' | 'cpu';
  resolution: number;
  fieldMs: number;
}

// Only the original 5 primitives are implemented in the WGSL kernel (sdPrim
// branches t==0..4). cone/hex/octahedron + warp route to the CPU pipeline via
// compileProgramAuto's gpuCompatible gate, so they never reach packOps.
const PRIM_ID: Partial<Record<PrimOp['prim'], number>> = { sphere: 0, box: 1, capsule: 2, torus: 3, ellipsoid: 4 };
const MODE_ID: Record<NonNullable<PrimOp['mode']>, number> = { union: 0, smooth: 1, subtract: 2, intersect: 3 };
const FLOATS_PER_OP = 24; // 6 × vec4
const MAX_TRIS = 350_000;

const MESH_WGSL = /* wgsl */ `
struct Params {
  origin : vec4<f32>,   // xyz = lattice origin
  meta   : vec4<f32>,   // x = cell step, y = gradient h
  dims   : vec4<u32>,   // x = N cells per axis, y = op count, z = max tris
};
@group(0) @binding(0) var<uniform> P : Params;
@group(0) @binding(1) var<storage, read> ops : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> counter : atomic<u32>;
@group(0) @binding(3) var<storage, read_write> outPos : array<f32>;
@group(0) @binding(4) var<storage, read_write> outNrm : array<f32>;
@group(0) @binding(5) var<storage, read_write> outCol : array<f32>;

const CORNERS = array<vec3<f32>, 8>(
  vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(1.0, 1.0, 0.0), vec3<f32>(0.0, 1.0, 0.0),
  vec3<f32>(0.0, 0.0, 1.0), vec3<f32>(1.0, 0.0, 1.0), vec3<f32>(1.0, 1.0, 1.0), vec3<f32>(0.0, 1.0, 1.0),
);
const TETS = array<vec4<u32>, 6>(
  vec4<u32>(0u, 5u, 1u, 6u), vec4<u32>(0u, 1u, 2u, 6u), vec4<u32>(0u, 2u, 3u, 6u),
  vec4<u32>(0u, 3u, 7u, 6u), vec4<u32>(0u, 7u, 4u, 6u), vec4<u32>(0u, 4u, 5u, 6u),
);

fn sdPrim(base : u32, wp : vec3<f32>) -> f32 {
  let q  = wp - ops[base + 1u].xyz;
  let p  = vec3<f32>(dot(ops[base + 2u].xyz, q), dot(ops[base + 3u].xyz, q), dot(ops[base + 4u].xyz, q));
  let pr = ops[base + 5u];
  let t  = u32(ops[base].x);
  if (t == 0u) { return length(p) - pr.x; }
  if (t == 1u) {
    let d = abs(p) - pr.xyz;
    return length(max(d, vec3<f32>(0.0))) + min(max(d.x, max(d.y, d.z)), 0.0);
  }
  if (t == 2u) {
    let b  = pr.xyz;
    let bb = max(dot(b, b), 1e-6);
    let h  = clamp(dot(p, b) / bb, 0.0, 1.0);
    return length(p - b * h) - pr.w;
  }
  if (t == 3u) {
    let qq = vec2<f32>(length(p.xz) - pr.x, p.y);
    return length(qq) - pr.y;
  }
  let s  = max(pr.xyz, vec3<f32>(1e-4));
  let k0 = length(p / s);
  let k1 = length(p / (s * s));
  if (k1 < 1e-9) { return -min(s.x, min(s.y, s.z)); }
  return k0 * (k0 - 1.0) / k1;
}

fn sminf(a : f32, b : f32, k : f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

fn sdProgram(wp : vec3<f32>) -> f32 {
  var d = 1e9;
  for (var o = 0u; o < P.dims.y; o = o + 1u) {
    let base  = o * 6u;
    let di    = sdPrim(base, wp);
    let mode  = u32(ops[base].y);
    let blend = max(ops[base].z, 0.001);
    if (mode == 1u)      { d = sminf(d, di, blend); }
    else if (mode == 2u) { d = max(d, -di); }
    else if (mode == 3u) { d = max(d, di); }
    else                 { d = min(d, di); }
  }
  return d;
}

fn gradientAt(wp : vec3<f32>) -> vec3<f32> {
  let h = P.meta.y;
  let g = vec3<f32>(
    sdProgram(wp + vec3<f32>(h, 0.0, 0.0)) - sdProgram(wp - vec3<f32>(h, 0.0, 0.0)),
    sdProgram(wp + vec3<f32>(0.0, h, 0.0)) - sdProgram(wp - vec3<f32>(0.0, h, 0.0)),
    sdProgram(wp + vec3<f32>(0.0, 0.0, h)) - sdProgram(wp - vec3<f32>(0.0, 0.0, h)),
  );
  return normalize(g + vec3<f32>(1e-9, 0.0, 0.0));
}

// nearest non-subtract primitive drives the vertex color
// (color rgb is packed in the free .w lanes of slots 1-3)
fn colorAt(wp : vec3<f32>) -> vec3<f32> {
  var best = 1e9;
  var col = vec3<f32>(0.48, 0.55, 0.98);
  for (var o = 0u; o < P.dims.y; o = o + 1u) {
    let base = o * 6u;
    if (u32(ops[base].y) == 2u) { continue; }
    let d = abs(sdPrim(base, wp));
    if (d < best) {
      best = d;
      col = vec3<f32>(ops[base + 1u].w, ops[base + 2u].w, ops[base + 3u].w);
    }
  }
  return col;
}

fn emitTri(a : vec3<f32>, b : vec3<f32>, c : vec3<f32>) {
  let g = gradientAt((a + b + c) / 3.0);
  var b2 = b;
  var c2 = c;
  if (dot(cross(b - a, c - a), g) < 0.0) { let t = b2; b2 = c2; c2 = t; }

  let tri = atomicAdd(&counter, 1u);
  if (tri >= P.dims.z) { return; }
  let o = tri * 9u;

  let verts = array<vec3<f32>, 3>(a, b2, c2);
  for (var v = 0u; v < 3u; v = v + 1u) {
    let p = verts[v];
    let n = gradientAt(p);
    let cl = colorAt(p);
    let vo = o + v * 3u;
    outPos[vo] = p.x;  outPos[vo + 1u] = p.y;  outPos[vo + 2u] = p.z;
    outNrm[vo] = n.x;  outNrm[vo + 1u] = n.y;  outNrm[vo + 2u] = n.z;
    outCol[vo] = cl.x; outCol[vo + 1u] = cl.y; outCol[vo + 2u] = cl.z;
  }
}

fn vinterp(pa : vec3<f32>, pb : vec3<f32>, va : f32, vb : f32) -> vec3<f32> {
  return pa + (va / (va - vb)) * (pb - pa);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let N = P.dims.x;
  let cell = gid.x;
  if (cell >= N * N * N) { return; }
  let i = cell % N;
  let j = (cell / N) % N;
  let k = cell / (N * N);
  let step = P.meta.x;
  let base = P.origin.xyz + vec3<f32>(f32(i), f32(j), f32(k)) * step;

  var cp : array<vec3<f32>, 8>;
  var cv : array<f32, 8>;
  for (var c = 0u; c < 8u; c = c + 1u) {
    cp[c] = base + CORNERS[c] * step;
    cv[c] = sdProgram(cp[c]);
  }

  for (var t = 0u; t < 6u; t = t + 1u) {
    let tt = TETS[t];
    let p0 = cp[tt.x]; let p1 = cp[tt.y]; let p2 = cp[tt.z]; let p3 = cp[tt.w];
    let v0 = cv[tt.x]; let v1 = cv[tt.y]; let v2 = cv[tt.z]; let v3 = cv[tt.w];

    var m = 0u;
    if (v0 < 0.0) { m = m | 1u; }
    if (v1 < 0.0) { m = m | 2u; }
    if (v2 < 0.0) { m = m | 4u; }
    if (v3 < 0.0) { m = m | 8u; }
    if (m == 0u || m == 15u) { continue; }

    switch m {
      case 1u, 14u: {
        emitTri(vinterp(p0, p1, v0, v1), vinterp(p0, p2, v0, v2), vinterp(p0, p3, v0, v3));
      }
      case 2u, 13u: {
        emitTri(vinterp(p1, p0, v1, v0), vinterp(p1, p3, v1, v3), vinterp(p1, p2, v1, v2));
      }
      case 4u, 11u: {
        emitTri(vinterp(p2, p0, v2, v0), vinterp(p2, p1, v2, v1), vinterp(p2, p3, v2, v3));
      }
      case 8u, 7u: {
        emitTri(vinterp(p3, p0, v3, v0), vinterp(p3, p2, v3, v2), vinterp(p3, p1, v3, v1));
      }
      case 3u, 12u: {
        let a = vinterp(p0, p3, v0, v3);
        let b = vinterp(p0, p2, v0, v2);
        let c = vinterp(p1, p3, v1, v3);
        let d = vinterp(p1, p2, v1, v2);
        emitTri(a, b, c);
        emitTri(c, b, d);
      }
      case 5u, 10u: {
        let a = vinterp(p0, p1, v0, v1);
        let b = vinterp(p2, p3, v2, v3);
        let c = vinterp(p0, p3, v0, v3);
        let d = vinterp(p1, p2, v1, v2);
        emitTri(a, b, c);
        emitTri(a, d, b);
      }
      case 6u, 9u: {
        let a = vinterp(p0, p1, v0, v1);
        let b = vinterp(p1, p3, v1, v3);
        let c = vinterp(p2, p3, v2, v3);
        let d = vinterp(p0, p2, v0, v2);
        emitTri(a, b, c);
        emitTri(a, c, d);
      }
      default: {}
    }
  }
}
`;

function packOps(program: ShapeProgram): Float32Array {
  const out = new Float32Array(program.ops.length * FLOATS_PER_OP);
  program.ops.forEach((op, i) => {
    const o = i * FLOATS_PER_OP;
    out[o] = PRIM_ID[op.prim] ?? 0;
    out[o + 1] = MODE_ID[op.mode] ?? 0;
    out[o + 2] = op.blend ?? 0.08;
    out[o + 4] = op.pos[0]; out[o + 5] = op.pos[1]; out[o + 6] = op.pos[2];

    // color rgb rides in the spare .w lanes of slots 1-3
    const col = new THREE.Color(op.color || '#7b8cfa');
    out[o + 7] = col.r; out[o + 11] = col.g; out[o + 15] = col.b;

    let rows = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    if (op.rot && (op.rot[0] || op.rot[1] || op.rot[2])) {
      const e = new THREE.Euler(
        (op.rot[0] * Math.PI) / 180, (op.rot[1] * Math.PI) / 180, (op.rot[2] * Math.PI) / 180,
      );
      const el = new THREE.Matrix4().makeRotationFromEuler(e).invert().elements;
      rows = [el[0], el[4], el[8], el[1], el[5], el[9], el[2], el[6], el[10]];
    }
    for (let r = 0; r < 3; r++) {
      out[o + 8 + r * 4] = rows[r * 3];
      out[o + 9 + r * 4] = rows[r * 3 + 1];
      out[o + 10 + r * 4] = rows[r * 3 + 2];
    }
    // NOTE: row w-lanes at o+11 / o+15 already carry color; row2 w-lane (o+19) unused

    switch (op.prim) {
      case 'sphere': out[o + 20] = op.r ?? 0.3; break;
      case 'box': {
        const s = op.size ?? [0.3, 0.3, 0.3];
        out[o + 20] = s[0]; out[o + 21] = s[1]; out[o + 22] = s[2];
        break;
      }
      case 'capsule': {
        const s = op.size ?? [0, 0.5, 0];
        out[o + 20] = s[0]; out[o + 21] = s[1]; out[o + 22] = s[2];
        out[o + 23] = op.r ?? 0.15;
        break;
      }
      case 'torus': out[o + 20] = op.R ?? 0.5; out[o + 21] = op.r ?? 0.12; break;
      case 'ellipsoid': {
        const s = op.size ?? [0.3, 0.2, 0.3];
        out[o + 20] = s[0]; out[o + 21] = s[1]; out[o + 22] = s[2];
        break;
      }
    }
  });
  return out;
}

let devicePromise: Promise<GPUDevice | null> | null = null;

function getDevice(): Promise<GPUDevice | null> {
  if (!devicePromise) {
    devicePromise = (async () => {
      try {
        const gpu = (navigator as any)?.gpu;
        if (!gpu) return null;
        const adapter = await gpu.requestAdapter();
        if (!adapter) return null;
        const device: GPUDevice = await adapter.requestDevice();
        device.lost.then(() => { devicePromise = null; });
        return device;
      } catch {
        return null;
      }
    })();
  }
  return devicePromise;
}

/**
 * Full GPU mesh extraction: fused SDF + marching tetrahedra kernel.
 * Returns null when WebGPU is unavailable so callers can fall back.
 */
export async function generateMeshGPU(program: ShapeProgram, resolution: number): Promise<{
  geometry: THREE.BufferGeometry; triangles: number; ms: number;
} | null> {
  const device = await getDevice();
  if (!device) return null;
  const t0 = performance.now();

  const N = resolution;
  const cells = N * N * N;
  const step = (BOUND * 2) / N;

  const module = device.createShaderModule({ code: MESH_WGSL });
  const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });

  const uni = new ArrayBuffer(48);
  const f32 = new Float32Array(uni);
  const u32 = new Uint32Array(uni);
  f32[0] = -BOUND; f32[1] = -BOUND; f32[2] = -BOUND;
  f32[4] = step; f32[5] = step * 0.5;                 // gradient h
  u32[8] = N; u32[9] = program.ops.length; u32[10] = MAX_TRIS;
  const uniform = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniform, 0, uni);

  const packed = packOps(program);
  const opsBuf = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(opsBuf, 0, packed);

  const counterBuf = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(counterBuf, 0, new Uint32Array([0]));

  const bytesPerAttr = MAX_TRIS * 9 * 4;
  const mk = () => device.createBuffer({ size: bytesPerAttr, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const posBuf = mk(), nrmBuf = mk(), colBuf = mk();

  const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 1, resource: { buffer: opsBuf } },
      { binding: 2, resource: { buffer: counterBuf } },
      { binding: 3, resource: { buffer: posBuf } },
      { binding: 4, resource: { buffer: nrmBuf } },
      { binding: 5, resource: { buffer: colBuf } },
    ],
  });

  // dispatch + read the triangle count
  const counterRead = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  let enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bind);
  pass.dispatchWorkgroups(Math.ceil(cells / 64));
  pass.end();
  enc.copyBufferToBuffer(counterBuf, 0, counterRead, 0, 4);
  device.queue.submit([enc.finish()]);
  await counterRead.mapAsync(GPUMapMode.READ);
  const triangles = Math.min(new Uint32Array(counterRead.getMappedRange())[0], MAX_TRIS);
  counterRead.unmap();

  // read back only the live vertex data
  const liveBytes = triangles * 9 * 4;
  const geometry = new THREE.BufferGeometry();
  if (liveBytes > 0) {
    const mkRead = () => device.createBuffer({ size: liveBytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const posRead = mkRead(), nrmRead = mkRead(), colRead = mkRead();
    enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(posBuf, 0, posRead, 0, liveBytes);
    enc.copyBufferToBuffer(nrmBuf, 0, nrmRead, 0, liveBytes);
    enc.copyBufferToBuffer(colBuf, 0, colRead, 0, liveBytes);
    device.queue.submit([enc.finish()]);
    await Promise.all([posRead.mapAsync(GPUMapMode.READ), nrmRead.mapAsync(GPUMapMode.READ), colRead.mapAsync(GPUMapMode.READ)]);
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(posRead.getMappedRange().slice(0)), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrmRead.getMappedRange().slice(0)), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colRead.getMappedRange().slice(0)), 3));
    posRead.unmap(); nrmRead.unmap(); colRead.unmap();
    posRead.destroy(); nrmRead.destroy(); colRead.destroy();
  }

  [uniform, opsBuf, counterBuf, posBuf, nrmBuf, colBuf].forEach(b => b.destroy());
  return { geometry, triangles, ms: Math.round((performance.now() - t0) * 10) / 10 };
}

/**
 * Compile with the best backend: fused GPU marching-tets at high resolution,
 * or the deterministic CPU pipeline when WebGPU is unavailable OR the program
 * uses features the WGSL kernel doesn't yet support.
 *
 * The GPU kernel currently implements only the original 5 primitives
 * (sphere/box/capsule/torus/ellipsoid) and has no fBm warp. When a program
 * uses cone/hex/octahedron, the warp modifier, or symmetries/parts that expand
 * to >64 ops, we route straight to CPU for correctness. This keeps the GPU
 * fast path for the common case and never produces a wrong mesh.
 */
export async function compileProgramAuto(program: ShapeProgram, gpuRes = 112, cpuRes = 60): Promise<CompileResult> {
  const expanded = expandProgram(program);
  const gpuSupportedPrims = new Set(['sphere', 'box', 'capsule', 'torus', 'ellipsoid']);
  const gpuCompatible = !expanded.warp
    && expanded.ops.length <= 24
    && expanded.ops.every(o => gpuSupportedPrims.has(o.prim));

  if (gpuCompatible) {
    try {
      const gpu = await generateMeshGPU(program, gpuRes);
      if (gpu && gpu.triangles > 0) {
        const material = new THREE.MeshStandardMaterial({
          vertexColors: true,
          metalness: program.metalness ?? 0.15,
          roughness: program.roughness ?? 0.55,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(gpu.geometry, material);
        mesh.name = program.label || 'sdf-model';
        const group = new THREE.Group();
        group.name = 'MeshForge-SDF-GPU';
        group.add(mesh);
        return { group, triangles: gpu.triangles, opCount: expanded.ops.length, backend: 'gpu', resolution: gpuRes, fieldMs: gpu.ms };
      }
    } catch { /* fall back to CPU */ }
  }

  const t1 = performance.now();
  const field = evaluateFieldCPU(program, cpuRes);
  const fieldMs = Math.round((performance.now() - t1) * 10) / 10;
  const r = polygonizeField(program, field, cpuRes);
  return { ...r, opCount: expanded.ops.length, backend: 'cpu', resolution: cpuRes, fieldMs };
}
