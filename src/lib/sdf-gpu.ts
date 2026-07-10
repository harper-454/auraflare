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
import { makeSDFMaterial } from './sdf-material';

export interface CompileResult {
  group: THREE.Group;
  triangles: number;
  opCount: number;
  backend: 'gpu' | 'cpu';
  resolution: number;
  fieldMs: number;
}

// All 8 primitives are implemented in the WGSL kernel (sdPrim branches t==0..7)
// and the fBm warp modifier runs on the GPU too, so every program the CPU can
// polygonize now has a full-resolution GPU path. The WGSL formulations are exact
// ports of the CPU ones in sdf-compiler.ts — the two backends must agree so
// switching between them never changes the mesh.
export const PRIM_ID: Record<PrimOp['prim'], number> = { sphere: 0, box: 1, capsule: 2, torus: 3, ellipsoid: 4, cone: 5, hex: 6, octahedron: 7, cylinder: 8 };
const MODE_ID: Record<NonNullable<PrimOp['mode']>, number> = { union: 0, smooth: 1, subtract: 2, intersect: 3 };
const FLOATS_PER_OP = 24; // 6 × vec4
// 500k tris = 18 MB per attribute buffer (pos/nrm/col) — comfortably under the
// default 128 MB storage-binding limit, and enough headroom that a dense
// warp-heavy organic at 144³ doesn't clip against the atomic allocator cap.
const MAX_TRIS = 500_000;

const MESH_WGSL = /* wgsl */ `
struct Params {
  origin : vec4<f32>,   // xyz = lattice origin
  cfg    : vec4<f32>,   // x = cell step, y = gradient h  (NOT 'meta' — reserved word in WGSL)
  dims   : vec4<u32>,   // x = N cells per axis, y = op count, z = max tris
  warp   : vec4<f32>,   // x = amp (0 = off), y = freq, z = octaves, w = seed
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
  if (t == 4u) {
    let s  = max(pr.xyz, vec3<f32>(1e-4));
    let k0 = length(p / s);
    let k1 = length(p / (s * s));
    if (k1 < 1e-9) { return -min(s.x, min(s.y, s.z)); }
    return k0 * (k0 - 1.0) / k1;
  }
  if (t == 5u) {
    // cone: circular base radius pr.x on XZ (y=0), apex at (0, pr.y, 0).
    // Faithful port of the CPU IQ cone (sign term uses the 2D cross product).
    let r  = pr.x;
    let hh = pr.y;
    let wx = length(p.xz);
    let wy = p.y - hh;
    let qx = r;
    let qy = -hh;
    let tt = clamp((wx * qx + wy * qy) / (qx * qx + qy * qy), 0.0, 1.0);
    let ax = wx - qx * tt;
    let ay = wy - qy * tt;
    let cbx = wx - qx * clamp(wx / qx, 0.0, 1.0);
    let cby = wy - qy;
    let dd = min(ax * ax + ay * ay, cbx * cbx + cby * cby);
    let sgn = max(-(wx * qy - wy * qx), -(wy - qy));
    return sqrt(dd) * sign(sgn);
  }
  if (t == 6u) {
    // hexagonal prism extruded along Y (matches CPU approximation).
    let ax = abs(p.x);
    let az = abs(p.z);
    let hx = az * 0.8660254 + ax * 0.5;
    var d2 = max(hx, az) - pr.x;
    d2 = max(d2, ax - pr.x);
    return max(d2, abs(p.y) - pr.y);
  }
  if (t == 7u) {
    // octahedron (bound approximation, matches CPU).
    return (abs(p.x) + abs(p.y) + abs(p.z) - pr.x) * 0.57735027;
  }
  // t == 8u: capped cylinder along Y — pr.x = radius, pr.y = half-height (matches CPU).
  let cd2 = length(p.xz) - pr.x;
  let cdy = abs(p.y) - pr.y;
  return min(max(cd2, cdy), 0.0) + length(max(vec2<f32>(cd2, cdy), vec2<f32>(0.0)));
}

fn sminf(a : f32, b : f32, k : f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// ── fBm value-noise warp (exact port of sdf-compiler.ts) ──
// Displaces the field to carve organic bark/coral/rock detail. The fract(sin)
// hash is the canonical shader hash; CPU and GPU agree to visual precision.
fn hash3(ix : f32, iy : f32, iz : f32, seed : f32) -> f32 {
  let h = sin(ix * 127.1 + iy * 311.7 + iz * 74.7 + seed * 53.3) * 43758.5453;
  return h - floor(h);
}
fn valueNoise3D(x : f32, y : f32, z : f32, seed : f32) -> f32 {
  let ix = floor(x); let iy = floor(y); let iz = floor(z);
  let fx = x - ix; let fy = y - iy; let fz = z - iz;
  let ux = fx * fx * (3.0 - 2.0 * fx);
  let uy = fy * fy * (3.0 - 2.0 * fy);
  let uz = fz * fz * (3.0 - 2.0 * fz);
  let c000 = hash3(ix, iy, iz, seed);           let c100 = hash3(ix + 1.0, iy, iz, seed);
  let c010 = hash3(ix, iy + 1.0, iz, seed);     let c110 = hash3(ix + 1.0, iy + 1.0, iz, seed);
  let c001 = hash3(ix, iy, iz + 1.0, seed);     let c101 = hash3(ix + 1.0, iy, iz + 1.0, seed);
  let c011 = hash3(ix, iy + 1.0, iz + 1.0, seed); let c111 = hash3(ix + 1.0, iy + 1.0, iz + 1.0, seed);
  let x00 = mix(c000, c100, ux);
  let x10 = mix(c010, c110, ux);
  let x01 = mix(c001, c101, ux);
  let x11 = mix(c011, c111, ux);
  let y0 = mix(x00, x10, uy);
  let y1 = mix(x01, x11, uy);
  return mix(y0, y1, uz);
}
fn fbm3D(px : f32, py : f32, pz : f32, octaves : u32, seed : f32) -> f32 {
  var amp = 0.5; var sum = 0.0; var norm = 0.0;
  var x = px; var y = py; var z = pz;
  for (var i = 0u; i < octaves; i = i + 1u) {
    sum = sum + amp * valueNoise3D(x, y, z, seed + f32(i) * 17.0);
    norm = norm + amp;
    x = x * 2.0; y = y * 2.0; z = z * 2.0; amp = amp * 0.5;
  }
  return sum / norm;
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
  // Optional fBm displacement (±amp around the clean surface) — matches CPU.
  if (P.warp.x > 0.0) {
    let n = fbm3D(wp.x * P.warp.y, wp.y * P.warp.y, wp.z * P.warp.y, u32(P.warp.z), P.warp.w);
    d = d - P.warp.x * (n - 0.5) * 2.0;
  }
  return d;
}

fn gradientAt(wp : vec3<f32>) -> vec3<f32> {
  let h = P.cfg.y;
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
  let step = P.cfg.x;
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

export function packOps(program: ShapeProgram): Float32Array {
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
      case 'cone': out[o + 20] = op.r ?? 0.3; out[o + 21] = op.h ?? 0.6; break;
      case 'cylinder': out[o + 20] = op.r ?? 0.3; out[o + 21] = op.h ?? 0.4; break;
      case 'hex': {
        const s = op.size ?? [0.35, 0.3, 0.3];
        out[o + 20] = s[0]; out[o + 21] = s[1];
        break;
      }
      case 'octahedron': out[o + 20] = op.r ?? 0.4; break;
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
        device.lost.then(() => { devicePromise = null; pipelineCache = null; });
        return device;
      } catch {
        return null;
      }
    })();
  }
  return devicePromise;
}

// The WGSL kernel is static — only the storage buffers (ops) and uniform (dims)
// change per generation. Compiling it is EXPENSIVE (~7 s on some drivers; it
// inlines sdProgram ~24× through gradientAt/colorAt/emitTri), so compile it once
// per device and reuse. Without this cache the compile ran on every generate,
// which was the entire cost of a "24 s" model. Async compile keeps the main
// thread responsive; the promise is cached so concurrent callers share one build.
let pipelineCache: { device: GPUDevice; pipeline: Promise<GPUComputePipeline> } | null = null;

function getPipeline(device: GPUDevice): Promise<GPUComputePipeline> {
  if (pipelineCache && pipelineCache.device === device) return pipelineCache.pipeline;
  const module = device.createShaderModule({ code: MESH_WGSL });
  const pipeline = device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
  pipelineCache = { device, pipeline };
  return pipeline;
}

/**
 * Warm the GPU device + kernel compilation ahead of the first generation.
 * Call this when the 3D surface mounts: the ~7 s one-time shader compile then
 * overlaps with the user reading the UI / typing a prompt, so their first
 * "Generate" feels instant instead of paying the compile cost inline.
 * Fire-and-forget; safe to call repeatedly (the device + pipeline are cached).
 */
export function warmupGPU(): void {
  getDevice().then(d => { if (d) getPipeline(d).catch(() => {}); }).catch(() => {});
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

  const pipeline = await getPipeline(device);

  const uni = new ArrayBuffer(64);
  const f32 = new Float32Array(uni);
  const u32 = new Uint32Array(uni);
  f32[0] = -BOUND; f32[1] = -BOUND; f32[2] = -BOUND;
  f32[4] = step; f32[5] = step * 0.5;                 // gradient h
  u32[8] = N; u32[9] = program.ops.length; u32[10] = MAX_TRIS;
  // warp vec4 (offset 48): amp, freq, octaves, seed. amp=0 disables the branch.
  const w = program.warp;
  f32[12] = w?.amp ?? 0; f32[13] = w?.freq ?? 6; f32[14] = w?.octaves ?? 4; f32[15] = w?.seed ?? 0;
  const uniform = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
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
 * or the deterministic CPU pipeline when WebGPU is unavailable.
 *
 * The WGSL kernel now implements all 8 primitives AND the fBm warp, so every
 * program the CPU can polygonize has a full-resolution GPU path — the newest,
 * most impressive shapes (crystals, gems, spiked/warped organics) no longer
 * drop to the low-res CPU fallback. We only route to CPU when WebGPU is missing
 * or the expanded op count exceeds the kernel's budget.
 */
// 144³ lattice: ~2.1× the cells of the old 112³ default, still a few-hundred-ms
// dispatch on the cached pipeline (compute was never the bottleneck — the one-time
// shader compile was), and visibly sharper edges/fillets on every model.
export async function compileProgramAuto(program: ShapeProgram, gpuRes = 144, cpuRes = 60): Promise<CompileResult> {
  const expanded = expandProgram(program);
  // Kernel supports every primitive + warp; the only bound is op count (matches
  // expandProgram's own cap). The prim check stays as a defensive guard so an
  // unrecognized future primitive falls back to CPU instead of packing as sphere.
  const gpuSupportedPrims = new Set(['sphere', 'box', 'capsule', 'torus', 'ellipsoid', 'cone', 'hex', 'octahedron', 'cylinder']);
  const gpuCompatible = expanded.ops.length <= 96
    && expanded.ops.every(o => gpuSupportedPrims.has(o.prim));

  if (gpuCompatible) {
    try {
      // CRITICAL: pass the EXPANDED program. packOps reads program.ops directly,
      // so passing the raw program would silently drop every symmetry-generated
      // op on the GPU path (e.g. a flower rendering with no petals).
      const gpu = await generateMeshGPU(expanded, gpuRes);
      if (gpu && gpu.triangles > 0) {
        const material = makeSDFMaterial({ metalness: program.metalness, roughness: program.roughness });
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
