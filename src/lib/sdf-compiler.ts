/**
 * SDF Shape-Program Compiler — MeshForge stage 2.
 *
 * The compositional upgrade: instead of one parametric family per prompt, the
 * LLM emits a *shape program* — a list of SDF primitives (sphere, box, capsule,
 * torus, ellipsoid) combined with union / smooth-blend / subtract / intersect —
 * and this module compiles it into a real mesh:
 *
 *   program → signed distance field lattice → marching tetrahedra →
 *   gradient normals → per-part vertex colors → THREE.Group (GLB-exportable)
 *
 * Fully deterministic, fully local, no ML weights, no paid APIs.
 */
import * as THREE from 'three';
import { makeSDFMaterial } from './sdf-material';
import { aiChatSync } from './ai-providers';

export type PrimKind = 'sphere' | 'box' | 'capsule' | 'torus' | 'ellipsoid' | 'cone' | 'hex' | 'octahedron';
export type CsgMode = 'union' | 'smooth' | 'subtract' | 'intersect';

export interface PrimOp {
  prim: PrimKind;
  mode: CsgMode;
  color: string;
  pos: [number, number, number];
  rot?: [number, number, number];   // euler degrees
  r?: number;                       // sphere radius / capsule+torus tube radius / cone base radius
  size?: [number, number, number];  // box half-extents / ellipsoid radii / capsule end-offset from pos / hex prism half-extents
  R?: number;                       // torus major radius
  h?: number;                       // cone height (apex above pos)
  blend?: number;                   // smoothing k for mode 'smooth'
}

/** A reusable named sub-tree — referenced by instances. */
export interface PartDef {
  name: string;
  ops: PrimOp[];
}

/** Mirror / array / radial-array / grid / scatter — expanded to flat ops before compile. */
export type Symmetry =
  | { kind: 'mirror'; axis: 'x' | 'y' | 'z' }
  | { kind: 'radial'; of: string; count: number; radius: number; axis?: 'x' | 'y' | 'z'; spin?: boolean }
  | { kind: 'linear'; of: string; axis: 'x' | 'y' | 'z'; count: number; spacing: number }
  | { kind: 'grid'; of: string; nx: number; nz: number; dx: number; dz: number };

/** fBm noise displacement of the final field — turns flat surfaces into organic terrain. */
export interface Warp {
  amp: number;       // displacement amplitude (try 0.03–0.12)
  freq: number;      // spatial frequency (try 4–12)
  octaves?: number;  // default 4
  seed?: number;
}

/** Kinematics for an assembly: how the part moves, forever, around its local origin. */
export type MotionKind = 'spin' | 'oscillate' | 'piston';
export interface Motion {
  kind: MotionKind;
  axis: 'x' | 'y' | 'z';
  rpm?: number;    // spin: signed revolutions/minute (meshing gears alternate sign)
  deg?: number;    // oscillate: swing amplitude in degrees
  freq?: number;   // oscillate/piston: cycles per second
  dist?: number;   // piston: travel amplitude (world units, pre-scale)
  phase?: number;  // radians offset (piston firing order, gear alignment)
}

/** Where an assembly sits in the model. Authored full-size in its LOCAL frame,
 *  then scaled down into place — which multiplies its effective resolution:
 *  a gear at scale 0.25 gets ~4× the surface detail of the same gear authored
 *  in world units, because it owns a whole polygonization lattice. */
export interface Placement {
  pos: [number, number, number];
  rot?: [number, number, number]; // euler degrees
  scale?: number;                 // uniform, 0.05–1.5
}

/** A named, separately-polygonized, independently-movable part. */
export interface Assembly {
  name: string;
  ops: PrimOp[];
  parts?: PartDef[];
  symmetries?: Symmetry[];
  place: Placement;
  motion?: Motion;
  metalness?: number;  // per-part material override (brass gears in a steel case)
  roughness?: number;
}

export interface ShapeProgram {
  label: string;
  ops: PrimOp[];
  parts?: PartDef[];      // named reusable sub-trees (referenced by symmetries)
  symmetries?: Symmetry[]; // expand-time transforms (no kernel cost)
  warp?: Warp;            // optional field displacement
  assemblies?: Assembly[]; // articulated parts — each compiles to its own mesh
  metalness?: number;
  roughness?: number;
}

// ——— per-op precomputation (inverse rotation as a 3×3 matrix) ———
interface CompiledOp extends PrimOp {
  inv: number[] | null; // row-major 3x3 inverse rotation
}

function compileOps(ops: PrimOp[]): CompiledOp[] {
  return ops.map(op => {
    if (!op.rot || (op.rot[0] === 0 && op.rot[1] === 0 && op.rot[2] === 0)) return { ...op, inv: null };
    const e = new THREE.Euler(
      (op.rot[0] * Math.PI) / 180,
      (op.rot[1] * Math.PI) / 180,
      (op.rot[2] * Math.PI) / 180,
    );
    const m = new THREE.Matrix4().makeRotationFromEuler(e).invert();
    const el = m.elements; // column-major
    return { ...op, inv: [el[0], el[4], el[8], el[1], el[5], el[9], el[2], el[6], el[10]] };
  });
}

// ——— primitive SDFs (Inigo Quilez formulations) ———
function primDist(op: CompiledOp, px: number, py: number, pz: number): number {
  // into local space
  let x = px - op.pos[0], y = py - op.pos[1], z = pz - op.pos[2];
  if (op.inv) {
    const m = op.inv;
    const lx = m[0] * x + m[1] * y + m[2] * z;
    const ly = m[3] * x + m[4] * y + m[5] * z;
    const lz = m[6] * x + m[7] * y + m[8] * z;
    x = lx; y = ly; z = lz;
  }
  switch (op.prim) {
    case 'sphere': {
      const r = op.r ?? 0.3;
      return Math.sqrt(x * x + y * y + z * z) - r;
    }
    case 'box': {
      const s = op.size ?? [0.3, 0.3, 0.3];
      const qx = Math.abs(x) - s[0], qy = Math.abs(y) - s[1], qz = Math.abs(z) - s[2];
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
      return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0);
    }
    case 'capsule': {
      // segment from local origin to `size`, radius r
      const b = op.size ?? [0, 0.5, 0];
      const r = op.r ?? 0.15;
      const bb = b[0] * b[0] + b[1] * b[1] + b[2] * b[2] || 1e-6;
      let h = (x * b[0] + y * b[1] + z * b[2]) / bb;
      h = Math.min(1, Math.max(0, h));
      const dx = x - b[0] * h, dy = y - b[1] * h, dz = z - b[2] * h;
      return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
    }
    case 'torus': {
      const R = op.R ?? 0.5, r = op.r ?? 0.12;
      const q = Math.sqrt(x * x + z * z) - R;
      return Math.sqrt(q * q + y * y) - r;
    }
    case 'ellipsoid': {
      const s = op.size ?? [0.3, 0.2, 0.3];
      const k0 = Math.sqrt((x / s[0]) ** 2 + (y / s[1]) ** 2 + (z / s[2]) ** 2);
      const k1 = Math.sqrt((x / s[0] ** 2) ** 2 + (y / s[1] ** 2) ** 2 + (z / s[2] ** 2) ** 2);
      return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(s[0], s[1], s[2]);
    }
    case 'cone': {
      // IQ exact cone SDF: circular base of radius r on the XZ plane (y=0),
      // apex at (0,h,0). Faithful port of iquilezles.org sdCone — the previous
      // hand-rolled variant used a dot product in the sign term where IQ uses
      // a 2D cross product, which flipped the sign in a far-field wedge and
      // produced phantom geometry (caught by the 2026-07-06 audit).
      const r = op.r ?? 0.3;
      const h = op.h ?? 0.6;
      const wx = Math.sqrt(x * x + z * z);
      const wy = y - h;                    // IQ space: tip at origin, base at y=-h
      const qx = r, qy = -h;
      const t = clamp((wx * qx + wy * qy) / (qx * qx + qy * qy), 0, 1);
      const ax = wx - qx * t, ay = wy - qy * t;          // closest point on slant
      const bx = wx - qx * clamp(wx / qx, 0, 1), by = wy - qy; // closest point on base
      const dd = Math.min(ax * ax + ay * ay, bx * bx + by * by);
      const s = Math.max(-(wx * qy - wy * qx), -(wy - qy)); // k = sign(qy) = -1
      return Math.sqrt(dd) * Math.sign(s);
    }
    case 'hex': {
      // IQ hexagonal prism, extruded along Y. size[0]=radial, size[1]=half-height.
      const s = op.size ?? [0.35, 0.3, 0.3];
      const px = Math.abs(x);
      const pz = Math.abs(z);
      // 2D hex distance in the XZ plane
      const hx = pz * 0.8660254 + px * 0.5; // 30° rotation projection
      let d2 = Math.max(hx, pz) - s[0];
      d2 = Math.max(d2, px - s[0]);
      return Math.max(d2, Math.abs(y) - s[1]);
    }
    case 'octahedron': {
      // IQ octahedron: |x|+|y|+|z| - r, scaled.
      const r = op.r ?? 0.4;
      const sX = Math.abs(x), sY = Math.abs(y), sZ = Math.abs(z);
      return (sX + sY + sZ - r) * 0.57735027;
    }
  }
}

function smin(a: number, b: number, k: number): number {
  const h = Math.min(1, Math.max(0, 0.5 + (0.5 * (b - a)) / k));
  return b + (a - b) * h - k * h * (1 - h);
}

function clamp(x: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, x)); }

// ——— fBm noise displacement (deterministic, seeded) ———
// Cheap 3D value-noise + fBm. Used by the optional `warp` modifier to turn
// flat surfaces into organic terrain, bark, coral, etc.
function hash3(x: number, y: number, z: number, seed: number): number {
  let h = x * 127.1 + y * 311.7 + z * 74.7 + seed * 53.3;
  h = Math.sin(h) * 43758.5453;
  return h - Math.floor(h);
}
function valueNoise3D(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const c000 = hash3(ix, iy, iz, seed),     c100 = hash3(ix + 1, iy, iz, seed);
  const c010 = hash3(ix, iy + 1, iz, seed), c110 = hash3(ix + 1, iy + 1, iz, seed);
  const c001 = hash3(ix, iy, iz + 1, seed), c101 = hash3(ix + 1, iy, iz + 1, seed);
  const c011 = hash3(ix, iy + 1, iz + 1, seed), c111 = hash3(ix + 1, iy + 1, iz + 1, seed);
  const x00 = c000 + (c100 - c000) * ux;
  const x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux;
  const x11 = c011 + (c111 - c011) * ux;
  const y0 = x00 + (x10 - x00) * uy;
  const y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz; // [0,1]
}
function fbm3D(x: number, y: number, z: number, octaves: number, seed: number): number {
  let amp = 0.5, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise3D(x, y, z, seed + i * 17);
    norm += amp;
    x *= 2; y *= 2; z *= 2; amp *= 0.5;
  }
  return sum / norm; // [0,1]
}

function programDist(ops: CompiledOp[], x: number, y: number, z: number, warp?: Warp): number {
  let d = 1e9;
  for (const op of ops) {
    const di = primDist(op, x, y, z);
    switch (op.mode) {
      case 'smooth': d = smin(d, di, Math.max(0.001, op.blend ?? 0.08)); break;
      case 'subtract': d = Math.max(d, -di); break;
      case 'intersect': d = Math.max(d, di); break;
      default: d = Math.min(d, di);
    }
  }
  // Optional fBm noise displacement: turns flat surfaces into organic terrain.
  // Subtracting amp*noise from the field pushes the surface outward where
  // noise is high, carving rocky/barky detail at near-zero kernel cost.
  if (warp && warp.amp > 0) {
    const oct = warp.octaves ?? 4;
    const n = fbm3D(x * warp.freq, y * warp.freq, z * warp.freq, oct, warp.seed ?? 0);
    d -= warp.amp * (n - 0.5) * 2; // ±amp around the clean surface
  }
  return d;
}

// ——— marching tetrahedra ———
const CORNERS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
const TETS = [
  [0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6],
  [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6],
];

export const BOUND = 1.35;

/**
 * Expand a ShapeProgram's `symmetries` and `parts` into a flat `ops` list.
 * This is the DSL layer that lets the LLM say "4 legs around the body" or
 * "mirror left/right" without writing every primitive by hand — the biggest
 * authoring win, and it costs nothing in the polygonizer (still a flat list).
 *
 * Mirror, radial-array, linear-array, and grid are all pure transforms on
 * op position/rotation, applied before compileOps.
 */
export function expandProgram(program: ShapeProgram): ShapeProgram {
  if (!program.symmetries?.length && !program.parts?.length) return program;
  const parts = new Map<string, PrimOp[]>((program.parts ?? []).map(p => [p.name, p.ops]));
  const ops: PrimOp[] = [...program.ops];

  for (const sym of program.symmetries ?? []) {
    if (sym.kind === 'mirror') {
      // Mirror every op that lies on the +side of the axis (avoids duplicates).
      const ax = sym.axis;
      const mirrored: PrimOp[] = [];
      for (const op of ops) {
        if (op.pos[axisIndex(ax)] > 0.001) {
          mirrored.push(mirrorOp(op, ax));
        }
      }
      ops.push(...mirrored);
    } else if (sym.kind === 'radial') {
      const tmpl = parts.get(sym.of);
      if (!tmpl) continue;
      const axis = sym.axis ?? 'y';
      const count = clamp(Math.round(sym.count), 2, 16);
      // `radius` is the ring radius: translate the part OUTWARD (perpendicular
      // to the rotation axis), then rotate copies around the axis. Translating
      // along the axis itself (the old bug) left every copy coincident when the
      // part was authored at the origin — the documented LLM usage.
      // Outward = +x for rings around y or z (parts are conventionally authored
      // with their long axis along +x), +y for rings around x.
      const outward: 'x' | 'y' | 'z' = (['y', 'x', 'x'] as const)[axisIndex(axis)];
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2;
        for (const op of tmpl) {
          ops.push(rotateAroundAxis(translateOp(op, sym.radius, outward), ang, axis, sym.spin));
        }
      }
    } else if (sym.kind === 'linear') {
      const tmpl = parts.get(sym.of);
      if (!tmpl) continue;
      const count = clamp(Math.round(sym.count), 2, 12);
      const ai = axisIndex(sym.axis);
      for (let i = 0; i < count; i++) {
        const offset = (i - (count - 1) / 2) * sym.spacing;
        for (const op of tmpl) {
          const cloned: PrimOp = JSON.parse(JSON.stringify(op));
          cloned.pos = [...op.pos] as [number, number, number];
          cloned.pos[ai] += offset;
          ops.push(cloned);
        }
      }
    } else if (sym.kind === 'grid') {
      const tmpl = parts.get(sym.of);
      if (!tmpl) continue;
      const nx = clamp(Math.round(sym.nx), 1, 8);
      const nz = clamp(Math.round(sym.nz), 1, 8);
      for (let ix = 0; ix < nx; ix++) {
        for (let iz = 0; iz < nz; iz++) {
          const ox = (ix - (nx - 1) / 2) * sym.dx;
          const oz = (iz - (nz - 1) / 2) * sym.dz;
          for (const op of tmpl) {
            const cloned: PrimOp = JSON.parse(JSON.stringify(op));
            cloned.pos = [op.pos[0] + ox, op.pos[1], op.pos[2] + oz];
            ops.push(cloned);
          }
        }
      }
    }
  }

  // Cap at 64 ops total so a runaway LLM can't blow up the polygonizer.
  return { ...program, ops: ops.slice(0, 64) };
}

function axisIndex(ax: 'x' | 'y' | 'z'): 0 | 1 | 2 {
  return ax === 'x' ? 0 : ax === 'y' ? 1 : 2;
}

function mirrorOp(op: PrimOp, ax: 'x' | 'y' | 'z'): PrimOp {
  const cloned: PrimOp = JSON.parse(JSON.stringify(op));
  const ai = axisIndex(ax);
  cloned.pos = [...op.pos] as [number, number, number];
  cloned.pos[ai] = -cloned.pos[ai];
  // Negate the rotation component on the mirror axis so geometry flips correctly.
  if (cloned.rot) {
    cloned.rot = [...cloned.rot] as [number, number, number];
    // mirroring on axis N negates the rotation about the OTHER two axes
    const other = [0, 1, 2].filter(i => i !== ai) as (0 | 1 | 2)[];
    cloned.rot[other[0]] = -cloned.rot[other[0]];
    cloned.rot[other[1]] = -cloned.rot[other[1]];
  }
  return cloned;
}

function translateOp(op: PrimOp, dist: number, ax: 'x' | 'y' | 'z'): PrimOp {
  const cloned: PrimOp = JSON.parse(JSON.stringify(op));
  cloned.pos = [...op.pos] as [number, number, number];
  cloned.pos[axisIndex(ax)] += dist;
  return cloned;
}

function rotateAroundAxis(op: PrimOp, angRad: number, ax: 'x' | 'y' | 'z', spin: boolean | undefined): PrimOp {
  const cloned: PrimOp = JSON.parse(JSON.stringify(op));
  const ai = axisIndex(ax);
  const cos = Math.cos(angRad), sin = Math.sin(angRad);
  // rotate position around axis `ai` in the plane perpendicular to it
  const p = [...op.pos] as [number, number, number];
  const u = (ai + 1) % 3, v = (ai + 2) % 3;
  const ru = p[u] * cos - p[v] * sin;
  const rv = p[u] * sin + p[v] * cos;
  p[u] = ru; p[v] = rv;
  cloned.pos = p;
  if (spin) {
    // also yaw the part to face outward (rotate about the same axis)
    const deg = (angRad * 180) / Math.PI;
    cloned.rot = cloned.rot ? [...cloned.rot] as [number, number, number] : [0, 0, 0];
    cloned.rot[ai] = (cloned.rot[ai] ?? 0) + deg;
  }
  return cloned;
}

export function evaluateFieldCPU(program: ShapeProgram, resolution = 60): Float32Array {
  const expanded = expandProgram(program);
  const ops = compileOps(expanded.ops);
  const warp = expanded.warp;
  const L = resolution + 1;
  const step = (BOUND * 2) / resolution;
  const field = new Float32Array(L * L * L);
  for (let k = 0; k < L; k++) {
    const z = -BOUND + k * step;
    for (let j = 0; j < L; j++) {
      const y = -BOUND + j * step;
      let idx = k * L * L + j * L;
      for (let i = 0; i < L; i++, idx++) {
        field[idx] = programDist(ops, -BOUND + i * step, y, z, warp);
      }
    }
  }
  return field;
}

export function compileProgram(program: ShapeProgram, resolution = 60): {
  group: THREE.Group;
  triangles: number;
  opCount: number;
} {
  return polygonizeField(program, evaluateFieldCPU(program, resolution), resolution);
}

/** Polygonize a precomputed SDF lattice (from CPU or the WebGPU evaluator). */
export function polygonizeField(program: ShapeProgram, field: Float32Array, resolution: number): {
  group: THREE.Group;
  triangles: number;
  opCount: number;
} {
  // Expand symmetries/parts once so gradient + per-part color see every op.
  const expanded = expandProgram(program);
  const ops = compileOps(expanded.ops);
  const warp = expanded.warp;
  const N = resolution;
  const step = (BOUND * 2) / N;
  const L = N + 1;

  const positions: number[] = [];
  const pt: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const pv = [0, 0, 0, 0];

  const interp = (a: number, b: number) => {
    const va = pv[a], vb = pv[b];
    const t = va / (va - vb);
    const pa = pt[a], pb = pt[b];
    positions.push(pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1]), pa[2] + t * (pb[2] - pa[2]));
  };

  for (let k = 0; k < N; k++) {
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        for (const tet of TETS) {
          let inside = 0;
          for (let c = 0; c < 4; c++) {
            const [dx, dy, dz] = CORNERS[tet[c]];
            const fi = (k + dz) * L * L + (j + dy) * L + (i + dx);
            pv[c] = field[fi];
            pt[c][0] = -BOUND + (i + dx) * step;
            pt[c][1] = -BOUND + (j + dy) * step;
            pt[c][2] = -BOUND + (k + dz) * step;
            if (pv[c] < 0) inside |= 1 << c;
          }
          switch (inside) {
            case 0x00: case 0x0f: break;
            case 0x01: case 0x0e: interp(0, 1); interp(0, 2); interp(0, 3); break;
            case 0x02: case 0x0d: interp(1, 0); interp(1, 3); interp(1, 2); break;
            case 0x04: case 0x0b: interp(2, 0); interp(2, 1); interp(2, 3); break;
            case 0x08: case 0x07: interp(3, 0); interp(3, 2); interp(3, 1); break;
            case 0x03: case 0x0c:
              interp(0, 3); interp(0, 2); interp(1, 3);
              interp(1, 3); interp(0, 2); interp(1, 2);
              break;
            case 0x05: case 0x0a:
              interp(0, 1); interp(2, 3); interp(0, 3);
              interp(0, 1); interp(1, 2); interp(2, 3);
              break;
            case 0x06: case 0x09:
              interp(0, 1); interp(1, 3); interp(2, 3);
              interp(0, 1); interp(2, 3); interp(0, 2);
              break;
          }
        }
      }
    }
  }

  const triCount = positions.length / 9;
  const posArr = new Float32Array(positions);
  const normArr = new Float32Array(posArr.length);
  const colorArr = new Float32Array(posArr.length);

  // Winding correction + smooth normals from the SDF gradient (outward by definition)
  const h = step * 0.5;
  const grad = (x: number, y: number, z: number, out: number[]) => {
    out[0] = programDist(ops, x + h, y, z, warp) - programDist(ops, x - h, y, z, warp);
    out[1] = programDist(ops, x, y + h, z, warp) - programDist(ops, x, y - h, z, warp);
    out[2] = programDist(ops, x, y, z + h, warp) - programDist(ops, x, y, z - h, warp);
    const len = Math.sqrt(out[0] ** 2 + out[1] ** 2 + out[2] ** 2) || 1;
    out[0] /= len; out[1] /= len; out[2] /= len;
  };

  const g = [0, 0, 0];
  const visible = expanded.ops.filter(o => o.mode !== 'subtract');
  const visibleCompiled = compileOps(visible);
  const colors = visible.map(o => new THREE.Color(o.color || '#7b8cfa'));
  const fallbackColor = new THREE.Color('#7b8cfa');

  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    // centroid gradient decides winding
    const cx = (posArr[o] + posArr[o + 3] + posArr[o + 6]) / 3;
    const cy = (posArr[o + 1] + posArr[o + 4] + posArr[o + 7]) / 3;
    const cz = (posArr[o + 2] + posArr[o + 5] + posArr[o + 8]) / 3;
    grad(cx, cy, cz, g);
    const ux = posArr[o + 3] - posArr[o], uy = posArr[o + 4] - posArr[o + 1], uz = posArr[o + 5] - posArr[o + 2];
    const vx = posArr[o + 6] - posArr[o], vy = posArr[o + 7] - posArr[o + 1], vz = posArr[o + 8] - posArr[o + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * g[0] + ny * g[1] + nz * g[2] < 0) {
      // swap vertices 1 and 2
      for (let c = 0; c < 3; c++) {
        const tmp = posArr[o + 3 + c];
        posArr[o + 3 + c] = posArr[o + 6 + c];
        posArr[o + 6 + c] = tmp;
      }
    }
    // per-vertex: gradient normal + nearest visible primitive color
    for (let vtx = 0; vtx < 3; vtx++) {
      const vo = o + vtx * 3;
      grad(posArr[vo], posArr[vo + 1], posArr[vo + 2], g);
      normArr[vo] = g[0]; normArr[vo + 1] = g[1]; normArr[vo + 2] = g[2];
      let best = 1e9, bestIdx = -1;
      for (let oi = 0; oi < visibleCompiled.length; oi++) {
        const d = Math.abs(primDist(visibleCompiled[oi], posArr[vo], posArr[vo + 1], posArr[vo + 2]));
        if (d < best) { best = d; bestIdx = oi; }
      }
      const col = bestIdx >= 0 ? colors[bestIdx] : fallbackColor;
      colorArr[vo] = col.r; colorArr[vo + 1] = col.g; colorArr[vo + 2] = col.b;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normArr, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));

  const material = makeSDFMaterial({ metalness: program.metalness, roughness: program.roughness });

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = program.label || 'sdf-model';
  const group = new THREE.Group();
  group.name = 'MeshForge-SDF';
  group.add(mesh);

  return { group, triangles: triCount, opCount: expanded.ops.length };
}

// ——— built-in preset programs (offline mode + few-shot examples) ———
// (The old hand-authored preset library is gone — every model is now composed,
// either by the AI provider chain or by buildPreviewProgram's heuristics. The
// former presets live on only as polygonizer fixtures in scripts/smoke-3d.ts.)

// ——— sanitizer for LLM-emitted programs ———
const PRIMS: PrimKind[] = ['sphere', 'box', 'capsule', 'torus', 'ellipsoid', 'cone', 'hex', 'octahedron'];
const MODES: CsgMode[] = ['union', 'smooth', 'subtract', 'intersect'];

function num(x: unknown, d: number, lo: number, hi: number): number {
  return typeof x === 'number' && isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d;
}
function vec3(x: unknown, d: [number, number, number], lo: number, hi: number): [number, number, number] {
  if (!Array.isArray(x) || x.length !== 3) return d;
  return [num(x[0], d[0], lo, hi), num(x[1], d[1], lo, hi), num(x[2], d[2], lo, hi)];
}

function sanitizeOps(rawOps: any, cap: number): PrimOp[] {
  const ops: PrimOp[] = [];
  if (!Array.isArray(rawOps)) return ops;
  for (const o of rawOps.slice(0, cap)) {
    if (!o || !PRIMS.includes(o.prim)) continue;
    ops.push({
      prim: o.prim,
      mode: MODES.includes(o.mode) ? o.mode : 'union',
      color: typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : '#7b8cfa',
      pos: vec3(o.pos, [0, 0, 0], -1.2, 1.2),
      rot: o.rot ? vec3(o.rot, [0, 0, 0], -180, 180) : undefined,
      r: o.r !== undefined ? num(o.r, 0.2, 0.02, 1) : undefined,
      size: o.size ? vec3(o.size, [0.3, 0.3, 0.3], -1.2, 1.2) : undefined,
      R: o.R !== undefined ? num(o.R, 0.5, 0.05, 1) : undefined,
      h: o.h !== undefined ? num(o.h, 0.5, 0.05, 1.5) : undefined,
      blend: o.blend !== undefined ? num(o.blend, 0.08, 0.01, 0.4) : undefined,
    });
  }
  // never let the first op be a subtraction from empty space
  if (ops.length && (ops[0].mode === 'subtract' || ops[0].mode === 'intersect')) ops[0].mode = 'union';
  return ops;
}

function sanitizeParts(raw: any): PartDef[] | undefined {
  const parts: PartDef[] | undefined = Array.isArray(raw) && raw.length
    ? raw.slice(0, 12).map((p: any) => ({
        name: String(p.name || 'part').slice(0, 24),
        ops: (Array.isArray(p.ops) ? p.ops : []).slice(0, 16).filter((o: any) => o && PRIMS.includes(o.prim)),
      })).filter((p: PartDef) => p.ops.length > 0)
    : undefined;
  return parts && parts.length ? parts : undefined;
}

function sanitizeSymmetries(raw: any): Symmetry[] | undefined {
  const symmetries: Symmetry[] | undefined = Array.isArray(raw) && raw.length
    ? raw.slice(0, 6).map(sanitizeSymmetry).filter((s: Symmetry | null): s is Symmetry => s !== null)
    : undefined;
  return symmetries && symmetries.length ? symmetries : undefined;
}

const MOTION_KINDS: MotionKind[] = ['spin', 'oscillate', 'piston'];
const AXES = ['x', 'y', 'z'] as const;

function sanitizeMotion(m: any): Motion | undefined {
  if (!m || typeof m !== 'object' || !MOTION_KINDS.includes(m.kind)) return undefined;
  const axis = AXES.includes(m.axis) ? m.axis : 'y';
  if (m.kind === 'spin') {
    return { kind: 'spin', axis, rpm: num(m.rpm, 10, -240, 240), phase: num(m.phase, 0, -Math.PI * 2, Math.PI * 2) };
  }
  if (m.kind === 'oscillate') {
    return { kind: 'oscillate', axis, deg: num(m.deg, 30, 1, 150), freq: num(m.freq, 1, 0.05, 8), phase: num(m.phase, 0, -Math.PI * 2, Math.PI * 2) };
  }
  return { kind: 'piston', axis, dist: num(m.dist, 0.3, 0.01, 0.8), freq: num(m.freq, 1, 0.05, 8), phase: num(m.phase, 0, -Math.PI * 2, Math.PI * 2) };
}

function sanitizeAssemblies(raw: any): Assembly[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined;
  const seen = new Set<string>();
  const out: Assembly[] = [];
  for (const a of raw.slice(0, 12)) {
    if (!a || typeof a !== 'object') continue;
    const ops = sanitizeOps(a.ops, 24);
    if (!ops.length) continue;
    let name = String(a.name || `part-${out.length + 1}`).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || `part-${out.length + 1}`;
    while (seen.has(name)) name = `${name}-2`;
    seen.add(name);
    const place = a.place && typeof a.place === 'object' ? a.place : {};
    out.push({
      name,
      ops,
      parts: sanitizeParts(a.parts),
      symmetries: sanitizeSymmetries(a.symmetries),
      place: {
        pos: vec3(place.pos, [0, 0, 0], -1.2, 1.2),
        rot: place.rot ? vec3(place.rot, [0, 0, 0], -180, 180) : undefined,
        scale: place.scale !== undefined ? num(place.scale, 0.3, 0.05, 1.5) : undefined,
      },
      motion: sanitizeMotion(a.motion),
      metalness: a.metalness !== undefined ? num(a.metalness, 0.15, 0, 1) : undefined,
      roughness: a.roughness !== undefined ? num(a.roughness, 0.55, 0, 1) : undefined,
    });
  }
  return out.length ? out : undefined;
}

export function sanitizeProgram(raw: any, fallbackLabel: string): ShapeProgram | null {
  if (!raw || typeof raw !== 'object') return null;
  const ops = sanitizeOps(raw.ops, 24);
  const assemblies = sanitizeAssemblies(raw.assemblies);
  // Valid when the static ops OR the articulated parts carry real geometry.
  const totalOps = ops.length + (assemblies?.reduce((n, a) => n + a.ops.length, 0) ?? 0);
  if (totalOps === 0) return null;

  const warp: Warp | undefined = raw.warp && typeof raw.warp === 'object'
    ? { amp: num(raw.warp.amp, 0, 0, 0.2), freq: num(raw.warp.freq, 6, 0.5, 20), octaves: raw.warp.octaves ? Math.round(num(raw.warp.octaves, 4, 1, 6)) : 4, seed: raw.warp.seed ?? 0 }
    : undefined;

  return {
    label: typeof raw.label === 'string' && raw.label ? raw.label.slice(0, 48) : fallbackLabel,
    ops,
    parts: sanitizeParts(raw.parts),
    symmetries: sanitizeSymmetries(raw.symmetries),
    warp: warp && warp.amp > 0 ? warp : undefined,
    assemblies,
    metalness: raw.metalness !== undefined ? num(raw.metalness, 0.15, 0, 1) : undefined,
    roughness: raw.roughness !== undefined ? num(raw.roughness, 0.55, 0, 1) : undefined,
  };
}

/** Total geometry ops across the static base and every assembly. */
export function totalProgramOps(p: ShapeProgram): number {
  return p.ops.length + (p.assemblies?.reduce((n, a) => n + a.ops.length, 0) ?? 0);
}

/**
 * Bake assemblies into a flat static program (motion at t=0) — exact placement
 * math (quaternion-composed rotations, uniform scale). Used by the raytracer
 * preview and any consumer that can't animate. Op count is capped at the
 * kernel budget; overflow drops trailing assembly ops (preview-only concern).
 */
export function flattenProgram(p: ShapeProgram): ShapeProgram {
  if (!p.assemblies?.length) return p;
  const ops: PrimOp[] = [...p.ops];
  const q = new THREE.Quaternion();
  const qOp = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  for (const a of p.assemblies) {
    const expanded = expandProgram({ label: a.name, ops: a.ops, parts: a.parts, symmetries: a.symmetries });
    const s = a.place.scale ?? 1;
    const pr = a.place.rot ?? [0, 0, 0];
    q.setFromEuler(e.set((pr[0] * Math.PI) / 180, (pr[1] * Math.PI) / 180, (pr[2] * Math.PI) / 180));
    for (const op of expanded.ops) {
      if (ops.length >= 64) return { ...p, ops, assemblies: undefined };
      v.set(op.pos[0] * s, op.pos[1] * s, op.pos[2] * s).applyQuaternion(q);
      const oRot = op.rot ?? [0, 0, 0];
      qOp.setFromEuler(e.set((oRot[0] * Math.PI) / 180, (oRot[1] * Math.PI) / 180, (oRot[2] * Math.PI) / 180));
      qOp.premultiply(q);
      e.setFromQuaternion(qOp);
      ops.push({
        ...op,
        pos: [v.x + a.place.pos[0], v.y + a.place.pos[1], v.z + a.place.pos[2]],
        rot: [(e.x * 180) / Math.PI, (e.y * 180) / Math.PI, (e.z * 180) / Math.PI],
        r: op.r !== undefined ? op.r * s : undefined,
        size: op.size ? [op.size[0] * s, op.size[1] * s, op.size[2] * s] : undefined,
        R: op.R !== undefined ? op.R * s : undefined,
        h: op.h !== undefined ? op.h * s : undefined,
        blend: op.blend !== undefined ? op.blend * s : undefined,
      });
    }
  }
  return { ...p, ops, assemblies: undefined };
}

function sanitizeSymmetry(s: any): Symmetry | null {
  if (!s || typeof s !== 'object') return null;
  if (s.kind === 'mirror' && ['x', 'y', 'z'].includes(s.axis)) {
    return { kind: 'mirror', axis: s.axis };
  }
  if (s.kind === 'radial' && typeof s.of === 'string') {
    return { kind: 'radial', of: s.of, count: num(s.count, 4, 2, 16), radius: num(s.radius, 0.5, 0, 1.2), axis: ['x', 'y', 'z'].includes(s.axis) ? s.axis : 'y', spin: !!s.spin };
  }
  if (s.kind === 'linear' && typeof s.of === 'string') {
    return { kind: 'linear', of: s.of, axis: ['x', 'y', 'z'].includes(s.axis) ? s.axis : 'x', count: num(s.count, 3, 2, 12), spacing: num(s.spacing, 0.2, 0.02, 1) };
  }
  if (s.kind === 'grid' && typeof s.of === 'string') {
    return { kind: 'grid', of: s.of, nx: Math.round(num(s.nx, 3, 1, 8)), nz: Math.round(num(s.nz, 3, 1, 8)), dx: num(s.dx, 0.2, 0.02, 1), dz: num(s.dz, 0.2, 0.02, 1) };
  }
  return null;
}

const COMPOSE_INSTRUCTIONS = `You are a 3D shape compiler. Convert the description into a JSON "shape program": a list of SDF primitives that compose the object like clay. Reply with ONLY the JSON object — no prose, no code fences, no markdown.

PRIMITIVES (prim field):
- sphere: r (radius)
- box: size = [half-x, half-y, half-z]
- ellipsoid: size = radii (thin Z = wings/horns/snouts)
- capsule: segment from pos to pos+size, radius r (limbs, bodies, stems)
- torus: R (major) + r (tube), lies in XZ plane (use rot to tilt)
- cone: r (base radius) + h (height, apex up along +Y) — hats, teeth, spikes, towers
- hex: size = [radial, half-height, _] — hexagonal prisms, nuts, bolts, crystals
- octahedron: r — gems, dice, crystals (8-faced, like two pyramids base-to-base)

CSG MODES (mode field, ops apply in order):
- union: add material (default)
- smooth: melt into previous shape (blend 0.06-0.15) — necks, joints, organic merges
- subtract: carve away — doors, mouths, eye sockets, holes
- intersect: keep only overlap

OPTIONAL FIELD MODIFIERS (top-level, all optional):
- "metalness": 0-1 (0 dielectric, 1 metal)
- "roughness": 0-1 (0 mirror, 1 matte)
- "warp": {"amp":0.04,"freq":7,"octaves":4,"seed":0} — adds organic fBm noise displacement. Use amp 0.03-0.08 for bark/coral/rock, 0.08-0.15 for rugged terrain. SKIP for smooth manufactured objects.

OPTIONAL SYMMETRY DSL (top-level, expands repeated parts for you — use these to avoid listing every primitive):
- "parts": [{"name":"leg","ops":[...]}] — named reusable sub-trees
- "symmetries": [
    {"kind":"mirror","axis":"x"},                              // mirror everything on +x side to -x
    {"kind":"radial","of":"petal","count":6,"radius":0.5,"axis":"y","spin":true},  // 6 petals around Y
    {"kind":"linear","of":"spike","axis":"x","count":5,"spacing":0.2},             // row of spikes
    {"kind":"grid","of":"stud","nx":4,"nz":4,"dx":0.15,"dz":0.15}                  // lego-stud grid
  ]

OPTIONAL ARTICULATED ASSEMBLIES (top-level "assemblies" — machines with moving parts):
- An assembly is a named part with its own ops, authored FULL-SIZE in its own local frame with the pivot at the origin, then placed (and shrunk) into the model by "place", and optionally animated forever by "motion":
  {"name":"second-hand","ops":[...],"place":{"pos":[0,0.09,0],"scale":0.45},"motion":{"kind":"spin","axis":"y","rpm":12},"metalness":0.9,"roughness":0.2}
- motion kinds: {"kind":"spin","axis":"y","rpm":12} — gears/hands/wheels/propellers (meshing gears alternate rpm sign, |ratio| = tooth ratio); {"kind":"oscillate","axis":"z","deg":40,"freq":1} — pendulums, levers, rockers; {"kind":"piston","axis":"y","dist":0.35,"freq":1.5,"phase":1.57} — pistons/pumps (phase staggers the firing order: k*pi/2 for cylinder k).
- The part moves about ITS OWN origin — author it centered on the pivot (a clock hand's shaft at [0,0,0] with the blade extending +x; a gear centered at [0,0,0]).
- Static housing/chassis stays in the top-level "ops"; only moving or logically-separable parts become assemblies. A gear = hex or torus body + "radial" symmetry of box teeth.

RULES:
- Everything must fit inside [-1.2, 1.2] on every axis. Y is UP. Build 6-20 ops (or fewer ops + symmetries).
- Think like a sculptor: big masses first, then details. Use "smooth" mode + blend to fuse parts.
- Use symmetries aggressively for symmetric creatures (4 legs = radial count 4), plants (petals), vehicles (mirror x).
- Pick realistic colors per part (#rrggbb hex). Crystal/gem parts can use high metalness (0.6-0.9) + low roughness (0.1-0.3).

EXAMPLE — "6-petaled flower with a stem": {"label":"flower","parts":[{"name":"petal","ops":[{"prim":"ellipsoid","mode":"union","color":"#e85a9b","pos":[0,0,0],"size":[0.35,0.05,0.18]}]}],"symmetries":[{"kind":"radial","of":"petal","count":6,"radius":0.18,"axis":"y","spin":true}],"ops":[{"prim":"capsule","mode":"union","color":"#3a8a3a","pos":[0,-0.7,0],"size":[0,0.9,0],"r":0.05},{"prim":"sphere","mode":"union","color":"#dcb35c","pos":[0,0.05,0],"r":0.12}]}

Reply with ONLY the JSON object for this description:`;

// ——— two-pass compose: plan (parts on the grid) → refine (per-part ops) ———
// Process borrowed from the owner's AssetForge factory: a planner decomposes
// the object into canonical parts with roles and motion BEFORE any geometry
// is built, then each part is refined separately. Pass 1 is pure spatial
// layout; pass 2 authors every part full-size in its local frame, so the
// placement scale multiplies its effective polygonization resolution.

const PLAN_INSTRUCTIONS = `You are the layout planner of a 3D model factory. Decompose the described object into 3-10 named parts positioned on a coordinate grid (Y is UP; the whole model fits in [-1.2,1.2] on every axis). Reply with ONLY a JSON object, no prose, no code fences:
{"label":"short name","category":"vehicle|timepiece|engine|furniture|building|creature|handheld|other","metalness":0-1,"roughness":0-1,"parts":[
  {"name":"kebab-name","role":"what this part is/does","pos":[x,y,z],"scale":0.1-1.0,"rot":[x,y,z] optional euler degrees,
   "moving":{"kind":"spin","axis":"y","rpm":12} optional — see motion rules,
   "hint":"one line describing the part's shape for the geometry pass","color":"#rrggbb","metalness":0-1 optional,"roughness":0-1 optional}]}

DECOMPOSE LIKE A FACTORY PLANNER (canonical parts per category):
- timepiece: case-ring, dial-face, hour-hand(spin y, slow), minute-hand(spin y, faster), second-hand(spin y, rpm 8-15 for visible demo), crown, 1-3 visible gears(spin, alternating sign)
- engine: engine-block(static), crankshaft(spin z), pistons as SEPARATE parts (piston y, same freq, phase k*1.57 for cylinder k), flywheel(spin z, same rpm as crankshaft), pulleys/fan(spin)
- vehicle: body-shell(static), 4 wheels as separate parts (spin x, same rpm), steering-wheel, lights/glass
- windmill/fan/turbine: tower/housing(static), blade-rotor(spin, one assembly containing ALL blades via radial symmetry)
- creature/humanoid: body masses head/torso/limbs (usually static here)
- furniture/building/handheld: frame + functional sub-parts; doors/lids may oscillate about their hinge
MOTION RULES: every mechanically-moving part MUST get "moving". Meshing gears alternate rpm sign with |ratio| = tooth ratio. Piston phase = k*1.57. Choose rpm 6-30 so motion is clearly visible. The pivot will be the part's local origin — position "pos" AT the pivot (wheel axle center, hand shaft, crank axis), not the part's visual center.
SCALE RULE: "scale" is how much the full-size part shrinks into place — a watch hand might be scale 0.4, a wheel 0.3. Small parts get small scales; the assembled result must fit [-1.2,1.2].
This is PASS 1 (layout only) — no geometry. Description:`;

const REFINE_PART_INSTRUCTIONS = `PASS 2 — you are the geometry refiner of a 3D model factory. PASS 1 planned the parts below (positions/scales/motion are FIXED — do not restate them). For EACH planned part, author its SDF ops FULL-SIZE in the part's OWN local frame: pretend the part alone fills [-1.2,1.2] and its pivot (axle/shaft/hinge) is at the origin. Also author optional top-level "ops" for the static base ONLY if the plan lists no static parts.
${''}Use the same primitive/CSG/symmetry language as the main compiler:
- prims: sphere(r) box(size=half-extents) ellipsoid(size) capsule(pos→pos+size,r) torus(R,r) cone(r,h) hex(size=[radial,halfH,_]) octahedron(r)
- modes: union | smooth(blend 0.06-0.15) | subtract | intersect — ops apply in order
- "parts"+"symmetries" DSL per assembly: e.g. a gear = hex body + {"kind":"radial","of":"tooth","count":12,"radius":0.95,"axis":"y","spin":true} over a small box tooth
Give each part 4-10 ops (hero parts up to 16). Realistic per-part colors; metals get metalness 0.7-0.95, roughness 0.15-0.4.
Reply with ONLY JSON: {"assemblies":[{"name":"<exact planned name>","ops":[...],"parts":[...] optional,"symmetries":[...] optional,"metalness":opt,"roughness":opt}, ...one per planned part...], "ops":[...optional static base ops in WORLD frame...]}`;

/**
 * Two-pass compose for complex/mechanical objects. Falls back to null on any
 * failure — the caller then tries the single-shot composeWithAI.
 */
export async function composeComplexWithAI(prompt: string): Promise<{ program: ShapeProgram; source: 'ai' } | null> {
  try {
    const plan = await aiChatSync(`${PLAN_INSTRUCTIONS} "${prompt}"`, 'sdf-shape-compiler-plan', 60000);
    const planMatch = plan.text.match(/\{[\s\S]*\}/);
    if (!planMatch) return null;
    const rawPlan = JSON.parse(planMatch[0]);
    const planned: any[] = Array.isArray(rawPlan?.parts) ? rawPlan.parts.slice(0, 12) : [];
    if (planned.length < 2) return null;

    const partList = planned.map((p: any) =>
      `- name:"${String(p.name || '')}" role:"${String(p.role || '')}" shape-hint:"${String(p.hint || '')}" color:${p.color || '#7b8cfa'}${p.moving ? ` MOVING(${p.moving.kind} ${p.moving.axis})` : ' static'}`,
    ).join('\n');
    const refined = await aiChatSync(
      `${REFINE_PART_INSTRUCTIONS}\n\nOBJECT: "${prompt}" (${String(rawPlan.label || '')}, category ${String(rawPlan.category || 'other')})\nPLANNED PARTS:\n${partList}`,
      'sdf-shape-compiler-refine-pass',
      90000,
    );
    const refMatch = refined.text.match(/\{[\s\S]*\}/);
    if (!refMatch) return null;
    const rawRefined = JSON.parse(refMatch[0]);
    const refinedByName = new Map<string, any>(
      (Array.isArray(rawRefined?.assemblies) ? rawRefined.assemblies : [])
        .filter((a: any) => a && typeof a.name === 'string')
        .map((a: any) => [a.name.toLowerCase().trim(), a]),
    );

    // Merge: plan owns placement + motion + material defaults; refine owns
    // geometry. A part the refiner skipped gets a single hint-colored
    // primitive so the layout never loses a planned part.
    const assemblies = planned.map((p: any) => {
      const r = refinedByName.get(String(p.name || '').toLowerCase().trim());
      const fallbackOp = { prim: 'box', mode: 'union', color: p.color || '#7b8cfa', pos: [0, 0, 0], size: [0.6, 0.6, 0.6] };
      return {
        name: p.name,
        ops: Array.isArray(r?.ops) && r.ops.length ? r.ops : [fallbackOp],
        parts: r?.parts,
        symmetries: r?.symmetries,
        place: { pos: p.pos, rot: p.rot, scale: p.scale },
        motion: p.moving,
        metalness: r?.metalness ?? p.metalness,
        roughness: r?.roughness ?? p.roughness,
      };
    });

    const program = sanitizeProgram({
      label: rawPlan.label || prompt.slice(0, 48),
      ops: Array.isArray(rawRefined?.ops) ? rawRefined.ops : [],
      assemblies,
      metalness: rawPlan.metalness,
      roughness: rawPlan.roughness,
    }, prompt.slice(0, 48));
    if (program && (program.assemblies?.length ?? 0) >= 2 && totalProgramOps(program) >= 4) {
      return { program, source: 'ai' };
    }
    return null;
  } catch {
    return null;
  }
}

/** Prompts that smell mechanical/composite get the two-pass factory treatment. */
export function wantsComplexCompose(prompt: string): boolean {
  return /\b(watch|clock|engine|gear|machine|motor|mechanis|robot|turbine|windmill|fan|drone|helicopter|car|truck|vehicle|piston|pump|mill|carousel|ferris|propeller|wheel|clockwork|mechanical)\b/i.test(prompt)
    || prompt.trim().length > 80;
}

/**
 * Compose a shape program via the AI provider chain. Returns null when no
 * provider produces one — callers fall back to buildPreviewProgram/parametric.
 */
export async function composeWithAI(prompt: string): Promise<{ program: ShapeProgram; source: 'ai' } | null> {
  try {
    // 60 s: composing a full shape program is a long-form generation, and the
    // chain may burn seconds on a failing provider before the one that answers.
    const { text } = await aiChatSync(
      `${COMPOSE_INSTRUCTIONS}\n\nDescription: "${prompt}"`,
      'sdf-shape-compiler',
      60000,
    );
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const program = sanitizeProgram(JSON.parse(match[0]), prompt.slice(0, 48));
      if (program && totalProgramOps(program) >= 2) return { program, source: 'ai' };
    }
  } catch { /* no provider answered */ }
  return null;
}
/**
 * LLM self-revision: hand the model its own current program plus an edit
 * instruction ("make the wings bigger") and get back a full updated program.
 */
export async function refineProgramWithAI(current: ShapeProgram, instruction: string): Promise<ShapeProgram | null> {
  try {
    const { text } = await aiChatSync(
      `${COMPOSE_INSTRUCTIONS}\n\nCURRENT PROGRAM:\n${JSON.stringify(current)}\n\nApply this modification and reply with ONLY the complete updated JSON program: "${instruction}"`,
      'sdf-shape-compiler-refine',
      60000,
    );
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const program = sanitizeProgram(JSON.parse(match[0]), current.label);
    return program && totalProgramOps(program) >= 2 ? program : null;
  } catch {
    return null;
  }
}
// (2026-07-06 audit pass: radial-symmetry placement + GPU expansion fixes verified by smoke test)

// ——— live preview: fresh ShapeProgram from text (no preset lookup) ——————————

/**
 * Build a ShapeProgram from the user's prompt text using keyword heuristics —
 * no preset library, always a fresh construction.  Used by the raymarch live
 * preview so the canvas shows something relevant as the user types, before the
 * AI compose call returns.
 *
 * Returns null when the text is too short or contains no recognisable shape
 * intent (caller can keep the previous preview or show the fallback rig).
 */
export function buildPreviewProgram(text: string): ShapeProgram | null {
  const t = text.toLowerCase().trim();
  if (t.length < 3) return null;

  // ── colour extraction ──────────────────────────────────────────────────────
  const COLOR_MAP: Record<string, string> = {
    red: '#d94040', orange: '#e07630', yellow: '#d9c440', green: '#3da854',
    blue: '#3a6ed9', purple: '#7b55d9', pink: '#d94ea5', white: '#e8e8ec',
    black: '#1a1a20', grey: '#808090', gray: '#808090', silver: '#aab0bf',
    gold: '#c9a940', brown: '#8a5c30', teal: '#3abcac', cyan: '#30bcd9',
    indigo: '#5060d9', violet: '#8040d9', magenta: '#c040c0', rose: '#e04065',
    amber: '#d98020', lime: '#82d930', coral: '#e05040', slate: '#5a6880',
  };
  let baseColor = '#7b8cfa';
  for (const [word, hex] of Object.entries(COLOR_MAP)) {
    if (t.includes(word)) { baseColor = hex; break; }
  }
  // metallic/gem materials
  const metalness = /metal|steel|iron|chrome|copper|gold|silver|titanium|shiny/.test(t) ? 0.75 : 0.15;
  const roughness = /rough|matte|stone|rock|wood|bark|clay/.test(t) ? 0.8
    : /glass|mirror|smooth|polished|crystal|gem|glossy/.test(t) ? 0.12 : 0.55;

  // ── size hints ─────────────────────────────────────────────────────────────
  const scale = /giant|huge|enormous|massive|big|large/.test(t) ? 1.25
    : /tiny|small|mini|little/.test(t) ? 0.65 : 1.0;
  const tall  = /tall|tower|pillar|spike|needle|thin|elongated/.test(t);
  const wide  = /wide|flat|disc|disk|plate|squat/.test(t);

  // ── helper to scale a position/size ───────────────────────────────────────
  const sc = (v: number) => parseFloat((v * scale).toFixed(4));
  const sv3 = (a: number, b: number, c: number): [number,number,number] =>
    [sc(a), sc(b), sc(c)];

  // ──────────────────────────────────────────────────────────────────────────
  // Shape families — build ops from scratch for each recognised category.
  // Each branch constructs a ShapeProgram with at least 2 ops so the raymarcher
  // has something interesting to show.  Colours are tinted by baseColor.
  // ──────────────────────────────────────────────────────────────────────────

  // ── torus / ring / donut ───────────────────────────────────────────────────
  if (/torus|ring|donut|doughnut|bagel/.test(t)) {
    return {
      label: t.slice(0, 32),
      metalness, roughness,
      ops: [
        { prim: 'torus',  mode: 'union', color: baseColor,  pos: [0,0,0], R: sc(0.55), r: sc(0.18) },
        { prim: 'sphere', mode: 'smooth', blend: 0.06, color: baseColor + 'cc', pos: [sc(0.55),0,0], r: sc(0.1) },
      ],
    };
  }

  // ── gem / crystal / diamond / jewel ───────────────────────────────────────
  if (/gem|diamond|jewel|faceted|amethyst|sapphire|emerald|ruby/.test(t)) {
    const gc = baseColor === '#7b8cfa' ? '#9a7de8' : baseColor;
    return {
      label: t.slice(0, 32),
      metalness: Math.max(metalness, 0.7),
      roughness: Math.min(roughness, 0.2),
      ops: [
        { prim: 'octahedron', mode: 'union',  color: gc,       pos: [0, sc(0.05), 0], r: sc(0.45) },
        { prim: 'cone',       mode: 'union',  color: gc+'bb',  pos: [0, sc(0.35), 0], r: sc(0.28), h: sc(0.45) },
        { prim: 'hex',        mode: 'union',  color: gc+'88',  pos: [0, sc(-0.38), 0], size: [sc(0.38), sc(0.08), sc(0.38)] },
      ],
    };
  }

  // ── capsule / pill / cylinder / pillar / column ───────────────────────────
  if (/capsule|pill|cylinder|pillar|column|tube|barrel/.test(t)) {
    const h = tall ? 1.1 : wide ? 0.35 : 0.7;
    return {
      label: t.slice(0, 32),
      metalness, roughness,
      ops: [
        { prim: 'capsule', mode: 'union', color: baseColor, pos: [0, sc(-h*0.5), 0], size: [0, sc(h), 0], r: sc(wide ? 0.45 : 0.28) },
        { prim: 'torus',   mode: 'union', color: baseColor, pos: [0, 0, 0], R: sc(wide ? 0.45 : 0.28), r: sc(0.06) },
      ],
    };
  }

  // ── cone / hat / spike / pyramid ───────────────────────────────────────────
  if (/cone|hat|spike|pyramid|obelisk/.test(t)) {
    return {
      label: t.slice(0, 32),
      metalness, roughness,
      ops: [
        { prim: 'cone',   mode: 'union', color: baseColor,      pos: [0, sc(-0.3), 0], r: sc(0.5), h: sc(tall ? 1.2 : 0.8) },
        { prim: 'sphere', mode: 'union', color: baseColor+'88', pos: [0, sc(-0.3), 0], r: sc(0.08) },
      ],
    };
  }

  // ── box / cube / crate / block ────────────────────────────────────────────
  if (/cube|box|crate|block|brick|chest|safe/.test(t)) {
    const sx = wide ? 0.7 : 0.38, sy = tall ? 0.85 : 0.38, sz = 0.38;
    return {
      label: t.slice(0, 32),
      metalness, roughness,
      ops: [
        { prim: 'box',    mode: 'union',    color: baseColor,      pos: [0, 0, 0], size: sv3(sx, sy, sz) },
        { prim: 'box',    mode: 'subtract', color: '#101018',      pos: [0, sc(sy*0.3), sc(sz)], size: sv3(sx*0.6, sy*0.25, sz*0.15) },
        { prim: 'sphere', mode: 'union',    color: baseColor+'aa', pos: [0, sc(sy*0.1), sc(sz)],  r: sc(0.06) },
      ],
    };
  }

  // ── sphere / ball / orb / planet ──────────────────────────────────────────
  // Use word boundaries so "ball" doesn't match inside "balloon", "basketball" etc.
  if (/\bsphere\b|\bball\b|\borb\b|\bglobe\b|\bplanet\b|\bbubble\b|\bbead\b/.test(t)) {
    const r = scale * (wide ? 0.65 : tall ? 0.4 : 0.52);
    return {
      label: t.slice(0, 32),
      metalness, roughness,
      ops: [
        { prim: 'sphere', mode: 'union', color: baseColor,      pos: [0, 0, 0], r },
        { prim: 'sphere', mode: 'union', color: baseColor+'99', pos: [sc(0.15), sc(0.2), sc(r*0.85)], r: sc(0.12) },
      ],
    };
  }

  // ── humanoid / character / person / figure ────────────────────────────────
  if (/person|human|figure|character|body|man|woman|robot/.test(t)) {
    return {
      label: t.slice(0, 32),
      metalness, roughness,
      ops: [
        { prim: 'capsule', mode: 'union',  color: baseColor,       pos: [0, sc(-0.1), 0], size: [0, sc(0.75), 0], r: sc(0.28) },
        { prim: 'sphere',  mode: 'smooth', blend: 0.1, color: baseColor, pos: [0, sc(0.72), 0], r: sc(0.24) },
        { prim: 'capsule', mode: 'union',  color: baseColor+'cc',  pos: [sc(-0.5), sc(0.25), 0], size: [sc(0.5), sc(-0.55), 0], r: sc(0.09) },
        { prim: 'capsule', mode: 'union',  color: baseColor+'cc',  pos: [sc(0.5),  sc(0.25), 0], size: [sc(-0.5), sc(-0.55), 0], r: sc(0.09) },
      ],
    };
  }

  // ── flower / plant / stem ─────────────────────────────────────────────────
  if (/flower|petal|bloom|blossom|plant|stem/.test(t)) {
    const petalColor = baseColor === '#7b8cfa' ? '#e85a9b' : baseColor;
    return {
      label: t.slice(0, 32),
      roughness: Math.max(roughness, 0.55),
      parts: [
        { name: 'petal', ops: [
          { prim: 'ellipsoid', mode: 'union', color: petalColor, pos: [0,0,0], size: [sc(0.32), sc(0.05), sc(0.16)] },
        ]},
      ],
      symmetries: [
        { kind: 'radial', of: 'petal', count: 6, radius: sc(0.18), axis: 'y', spin: true },
      ],
      ops: [
        { prim: 'capsule', mode: 'union', color: '#3a8a3a', pos: [0, sc(-0.75), 0], size: [0, sc(0.9), 0], r: sc(0.05) },
        { prim: 'sphere',  mode: 'union', color: '#dcb35c', pos: [0, sc(0.06), 0], r: sc(0.13) },
      ],
    };
  }

  // ── mushroom / toadstool ───────────────────────────────────────────────────
  if (/mushroom|toadstool|fungus/.test(t)) {
    const capColor = baseColor === '#7b8cfa' ? '#d5687f' : baseColor;
    return {
      label: t.slice(0, 32),
      roughness: Math.max(roughness, 0.6),
      ops: [
        { prim: 'capsule',   mode: 'union',  color: '#e6dfc9',   pos: [0, sc(-0.82), 0], size: [0, sc(0.75), 0], r: sc(0.32) },
        { prim: 'ellipsoid', mode: 'smooth', blend: 0.1, color: capColor, pos: [0, sc(0.22), 0], size: [sc(0.82), sc(0.48), sc(0.82)] },
        { prim: 'sphere',    mode: 'union',  color: '#e8ecf4',   pos: [sc(0.38), sc(0.42), sc(0.52)], r: sc(0.09) },
        { prim: 'sphere',    mode: 'union',  color: '#e8ecf4',   pos: [sc(-0.48), sc(0.5),  sc(0.28)], r: sc(0.12) },
      ],
    };
  }

  // ── rocket / spaceship / missile ──────────────────────────────────────────
  if (/rocket|spaceship|missile|spacecraft|shuttle/.test(t)) {
    const bodyColor = baseColor === '#7b8cfa' ? '#c6ccda' : baseColor;
    return {
      label: t.slice(0, 32),
      metalness: Math.max(metalness, 0.5), roughness: Math.min(roughness, 0.4),
      ops: [
        { prim: 'capsule',   mode: 'union',  color: bodyColor,    pos: [0, sc(-0.65), 0], size: [0, sc(1.2), 0], r: sc(0.28) },
        { prim: 'ellipsoid', mode: 'smooth', blend: 0.08, color: '#d5687f', pos: [0, sc(0.72), 0], size: [sc(0.22), sc(0.38), sc(0.22)] },
        { prim: 'box',       mode: 'union',  color: '#d5687f',    pos: [0, sc(-0.7), 0], size: [sc(0.6), sc(0.26), sc(0.04)] },
        { prim: 'box',       mode: 'union',  color: '#d5687f',    pos: [0, sc(-0.7), 0], rot: [0,90,0], size: [sc(0.6), sc(0.26), sc(0.04)] },
      ],
    };
  }

  // ── snowman / frosty ──────────────────────────────────────────────────────
  if (/snowman|snowwoman|frosty/.test(t)) {
    return {
      label: t.slice(0, 32),
      roughness: 0.7,
      ops: [
        { prim: 'sphere', mode: 'union',  color: '#dde8f0', pos: [0, sc(-0.48), 0], r: sc(0.42) },
        { prim: 'sphere', mode: 'smooth', blend: 0.08, color: '#e8f0f8', pos: [0, sc(0.22), 0], r: sc(0.32) },
        { prim: 'sphere', mode: 'smooth', blend: 0.06, color: '#e8f0f8', pos: [0, sc(0.74), 0], r: sc(0.23) },
        { prim: 'sphere', mode: 'union',  color: '#e86c2e', pos: [0, sc(0.72), sc(0.22)], r: sc(0.055) },
      ],
    };
  }

  // ── tree / bush / organic blob ────────────────────────────────────────────
  if (/tree|bush|shrub|oak|pine|fir|cactus/.test(t)) {
    const foliageColor = baseColor === '#7b8cfa' ? '#2e8a45' : baseColor;
    return {
      label: t.slice(0, 32),
      roughness: 0.75,
      warp: { amp: 0.06, freq: 6, octaves: 3 },
      ops: [
        { prim: 'capsule', mode: 'union',  color: '#6b3f1a', pos: [0, sc(-0.82), 0], size: [0, sc(0.9), 0], r: sc(0.09) },
        { prim: 'sphere',  mode: 'union',  color: foliageColor, pos: [0, sc(0.35), 0], r: sc(0.52) },
        { prim: 'sphere',  mode: 'smooth', blend: 0.1, color: foliageColor, pos: [sc(0.3), sc(0.5), sc(0.2)], r: sc(0.3) },
        { prim: 'sphere',  mode: 'smooth', blend: 0.1, color: foliageColor, pos: [sc(-0.28), sc(0.52), sc(-0.18)], r: sc(0.28) },
      ],
    };
  }

  // ── pickup truck / F-150 / van / SUV ─────────────────────────────────────
  if (/truck|pickup|f.?150|f.?250|f.?350|ram|silverado|tacoma|van|suv|4x4/.test(t)) {
    const body = baseColor === '#7b8cfa' ? '#2a4a7c' : baseColor; // default deep blue
    const wheel = '#1a1a22';
    return {
      label: t.slice(0, 32),
      metalness: Math.max(metalness, 0.55), roughness: 0.4,
      ops: [
        // bed (low, rear)
        { prim: 'box', mode: 'union', color: body,    pos: [sc(-0.3), sc(-0.35), 0],    size: [sc(0.42), sc(0.18), sc(0.45)] },
        // cab (taller, forward)
        { prim: 'box', mode: 'union', color: body,    pos: [sc(0.28), sc(-0.15), 0],    size: [sc(0.36), sc(0.35), sc(0.42)] },
        // windshield angle (carved from front of cab)
        { prim: 'box', mode: 'subtract', color: '#88aacc', pos: [sc(0.58), sc(0.2), 0], rot: [0, 0, 28], size: [sc(0.12), sc(0.3), sc(0.44)] },
        // chassis/underframe
        { prim: 'box', mode: 'union', color: '#252530', pos: [0, sc(-0.54), 0],          size: [sc(0.75), sc(0.05), sc(0.38)] },
        // front bumper
        { prim: 'box', mode: 'union', color: '#3a3a48', pos: [sc(0.65), sc(-0.4), 0],   size: [sc(0.06), sc(0.1), sc(0.42)] },
        // rear bumper
        { prim: 'box', mode: 'union', color: '#3a3a48', pos: [sc(-0.73), sc(-0.4), 0],  size: [sc(0.05), sc(0.08), sc(0.42)] },
        // wheel front-left
        { prim: 'torus', mode: 'union', color: wheel, pos: [sc(0.45), sc(-0.55), sc(0.5)],  R: sc(0.2), r: sc(0.1) },
        // wheel front-right
        { prim: 'torus', mode: 'union', color: wheel, pos: [sc(0.45), sc(-0.55), sc(-0.5)], R: sc(0.2), r: sc(0.1) },
        // wheel rear-left
        { prim: 'torus', mode: 'union', color: wheel, pos: [sc(-0.42), sc(-0.55), sc(0.5)],  R: sc(0.2), r: sc(0.1) },
        // wheel rear-right
        { prim: 'torus', mode: 'union', color: wheel, pos: [sc(-0.42), sc(-0.55), sc(-0.5)], R: sc(0.2), r: sc(0.1) },
      ],
    };
  }

  // ── car / sedan / sports car / coupe ──────────────────────────────────────
  if (/\bcar\b|sedan|coupe|sports.car|ferrari|lamborghini|mustang|corvette|vehicle|automobile/.test(t)) {
    const body = baseColor === '#7b8cfa' ? '#c03030' : baseColor; // default red
    const wheel = '#1a1a22';
    return {
      label: t.slice(0, 32),
      metalness: Math.max(metalness, 0.6), roughness: 0.35,
      ops: [
        // main body hull
        { prim: 'box', mode: 'union', color: body,    pos: [0, sc(-0.32), 0],           size: [sc(0.75), sc(0.16), sc(0.4)] },
        // cabin roof (ellipsoid for curve)
        { prim: 'ellipsoid', mode: 'smooth', blend: 0.1, color: body, pos: [sc(0.05), sc(0.05), 0], size: [sc(0.45), sc(0.22), sc(0.35)] },
        // windshield glass (subtract front slope)
        { prim: 'box', mode: 'subtract', color: '#88aacc', pos: [sc(0.45), sc(0.1), 0], rot: [0,0,32], size: [sc(0.1), sc(0.25), sc(0.36)] },
        // rear glass slope
        { prim: 'box', mode: 'subtract', color: '#88aacc', pos: [sc(-0.38), sc(0.1), 0], rot: [0,0,-28], size: [sc(0.1), sc(0.22), sc(0.36)] },
        // wheel fl
        { prim: 'torus', mode: 'union', color: wheel, pos: [sc(0.48), sc(-0.45), sc(0.44)],  R: sc(0.18), r: sc(0.09) },
        // wheel fr
        { prim: 'torus', mode: 'union', color: wheel, pos: [sc(0.48), sc(-0.45), sc(-0.44)], R: sc(0.18), r: sc(0.09) },
        // wheel rl
        { prim: 'torus', mode: 'union', color: wheel, pos: [sc(-0.48), sc(-0.45), sc(0.44)],  R: sc(0.18), r: sc(0.09) },
        // wheel rr
        { prim: 'torus', mode: 'union', color: wheel, pos: [sc(-0.48), sc(-0.45), sc(-0.44)], R: sc(0.18), r: sc(0.09) },
      ],
    };
  }

  // ── house / building / cabin / cottage ────────────────────────────────────
  if (/house|home|cabin|cottage|building|hut|bungalow|mansion|shed/.test(t)) {
    const wall = baseColor === '#7b8cfa' ? '#d4b483' : baseColor;
    const roof = '#8b3a2a';
    return {
      label: t.slice(0, 32),
      roughness: Math.max(roughness, 0.65),
      ops: [
        // walls
        { prim: 'box',  mode: 'union', color: wall,    pos: [0, sc(-0.22), 0],         size: [sc(0.65), sc(0.42), sc(0.52)] },
        // roof (cone approximated with tilted box slabs)
        { prim: 'box',  mode: 'union', color: roof,    pos: [0, sc(0.42), 0],           rot: [0,0,42],   size: [sc(0.62), sc(0.08), sc(0.56)] },
        { prim: 'box',  mode: 'union', color: roof,    pos: [0, sc(0.42), 0],           rot: [0,0,-42],  size: [sc(0.62), sc(0.08), sc(0.56)] },
        // chimney
        { prim: 'box',  mode: 'union', color: '#6b3a2a', pos: [sc(0.3), sc(0.6), sc(0.2)], size: [sc(0.08), sc(0.22), sc(0.08)] },
        // door (subtract)
        { prim: 'box',  mode: 'subtract', color: '#1a1a20', pos: [sc(0.05), sc(-0.38), sc(0.52)], size: [sc(0.1), sc(0.22), sc(0.06)] },
        // window left
        { prim: 'box',  mode: 'subtract', color: '#88aacc', pos: [sc(-0.35), sc(-0.12), sc(0.52)], size: [sc(0.12), sc(0.1), sc(0.06)] },
        // window right
        { prim: 'box',  mode: 'subtract', color: '#88aacc', pos: [sc(0.38), sc(-0.12), sc(0.52)],  size: [sc(0.12), sc(0.1), sc(0.06)] },
      ],
    };
  }

  // ── chess pawn ────────────────────────────────────────────────────────────
  if (/pawn|chess|rook|bishop|knight|queen|king/.test(t)) {
    const pc = baseColor === '#7b8cfa' ? '#d4c9a8' : baseColor;
    const isPieceType = /rook/.test(t) ? 'rook' : /bishop/.test(t) ? 'bishop' : /queen/.test(t) ? 'queen' : /king/.test(t) ? 'king' : 'pawn';
    if (isPieceType === 'rook') {
      return {
        label: t.slice(0, 32), metalness, roughness,
        ops: [
          { prim: 'capsule', mode: 'union', color: pc, pos: [0, sc(-0.65), 0], size: [0, sc(1.0), 0], r: sc(0.22) },
          { prim: 'torus',   mode: 'union', color: pc, pos: [0, sc(0.35), 0], R: sc(0.22), r: sc(0.06) },
          { prim: 'box',     mode: 'union', color: pc, pos: [0, sc(0.5), 0], size: [sc(0.24), sc(0.12), sc(0.24)] },
          { prim: 'box', mode: 'subtract', color: '#101018', pos: [sc(0.14), sc(0.58), sc(0.14)], size: [sc(0.06), sc(0.1), sc(0.06)] },
          { prim: 'box', mode: 'subtract', color: '#101018', pos: [sc(-0.14), sc(0.58), sc(-0.14)], size: [sc(0.06), sc(0.1), sc(0.06)] },
        ],
      };
    }
    // default: pawn
    return {
      label: t.slice(0, 32), metalness, roughness,
      ops: [
        // wide base
        { prim: 'torus',   mode: 'union', color: pc, pos: [0, sc(-0.6), 0], R: sc(0.28), r: sc(0.1) },
        { prim: 'capsule', mode: 'smooth', blend: 0.08, color: pc, pos: [0, sc(-0.55), 0], size: [0, sc(0.55), 0], r: sc(0.16) },
        // neck
        { prim: 'capsule', mode: 'union', color: pc, pos: [0, sc(0.02), 0], size: [0, sc(0.22), 0], r: sc(0.09) },
        // collar ring
        { prim: 'torus', mode: 'union', color: pc, pos: [0, sc(0.26), 0], R: sc(0.14), r: sc(0.05) },
        // head sphere
        { prim: 'sphere', mode: 'smooth', blend: 0.06, color: pc, pos: [0, sc(0.52), 0], r: sc(0.2) },
      ],
    };
  }

  // ── crown / tiara ─────────────────────────────────────────────────────────
  if (/crown|tiara|diadem/.test(t)) {
    const cc = baseColor === '#7b8cfa' ? '#c9a940' : baseColor;
    return {
      label: t.slice(0, 32),
      metalness: Math.max(metalness, 0.8), roughness: Math.min(roughness, 0.25),
      parts: [
        { name: 'spike', ops: [
          { prim: 'cone', mode: 'union', color: cc, pos: [0, sc(0.1), 0], r: sc(0.06), h: sc(0.42) },
        ]},
      ],
      symmetries: [
        { kind: 'radial', of: 'spike', count: 7, radius: sc(0.42), axis: 'y', spin: true },
      ],
      ops: [
        { prim: 'torus', mode: 'union', color: cc,      pos: [0, 0, 0], R: sc(0.44), r: sc(0.08) },
        { prim: 'torus', mode: 'union', color: cc+'88', pos: [0, sc(-0.12), 0], R: sc(0.42), r: sc(0.05) },
      ],
    };
  }

  // ── anchor / naval ────────────────────────────────────────────────────────
  if (/anchor|naval|nautical|ship anchor/.test(t)) {
    const ac = baseColor === '#7b8cfa' ? '#505870' : baseColor;
    return {
      label: t.slice(0, 32),
      metalness: Math.max(metalness, 0.7), roughness: 0.4,
      ops: [
        // vertical shank
        { prim: 'capsule', mode: 'union', color: ac, pos: [0, sc(-0.1), 0], size: [0, sc(1.1), 0], r: sc(0.06) },
        // top ring
        { prim: 'torus',   mode: 'union', color: ac, pos: [0, sc(0.62), 0], R: sc(0.2), r: sc(0.05) },
        // crossbar (horizontal stock)
        { prim: 'capsule', mode: 'union', color: ac, pos: [0, sc(0.38), 0], size: [sc(0.72), 0, 0], r: sc(0.05) },
        // left arm
        { prim: 'capsule', mode: 'union', color: ac, pos: [sc(-0.1), sc(-0.7), 0], size: [sc(-0.3), sc(-0.28), 0], r: sc(0.05) },
        // right arm
        { prim: 'capsule', mode: 'union', color: ac, pos: [sc(0.1),  sc(-0.7), 0], size: [sc(0.3),  sc(-0.28), 0], r: sc(0.05) },
        // left fluke
        { prim: 'sphere',  mode: 'union', color: ac, pos: [sc(-0.38), sc(-0.88), 0], r: sc(0.1) },
        // right fluke
        { prim: 'sphere',  mode: 'union', color: ac, pos: [sc(0.38),  sc(-0.88), 0], r: sc(0.1) },
      ],
    };
  }

  // ── hot air balloon ───────────────────────────────────────────────────────
  if (/balloon|hot.air|airship|blimp|zeppelin/.test(t)) {
    const envColor = baseColor === '#7b8cfa' ? '#e85040' : baseColor;
    return {
      label: t.slice(0, 32),
      roughness: 0.7,
      ops: [
        // envelope (large sphere, slightly oblate)
        { prim: 'ellipsoid', mode: 'union', color: envColor,     pos: [0, sc(0.28), 0], size: [sc(0.68), sc(0.82), sc(0.68)] },
        // vertical stripe detail (intersecting ellipsoids)
        { prim: 'ellipsoid', mode: 'union', color: '#e8c030',    pos: [sc(0.55), sc(0.28), 0], size: [sc(0.14), sc(0.8), sc(0.14)] },
        { prim: 'ellipsoid', mode: 'union', color: '#e8c030',    pos: [sc(-0.55), sc(0.28), 0], size: [sc(0.14), sc(0.8), sc(0.14)] },
        // rope bundle (thin capsule below)
        { prim: 'capsule',   mode: 'union', color: '#8a7a5a',    pos: [0, sc(-0.56), 0], size: [0, sc(0.26), 0], r: sc(0.04) },
        // basket (small box)
        { prim: 'box',       mode: 'union', color: '#a08040',    pos: [0, sc(-0.88), 0], size: [sc(0.22), sc(0.12), sc(0.22)] },
        // burner glow
        { prim: 'sphere',    mode: 'union', color: '#ff8820',    pos: [0, sc(-0.7), 0], r: sc(0.06) },
      ],
    };
  }

  // ── hourglass / egg timer ─────────────────────────────────────────────────
  if (/hourglass|egg.timer|sand.timer|sandglass/.test(t)) {
    const hc = baseColor === '#7b8cfa' ? '#c8a060' : baseColor;
    return {
      label: t.slice(0, 32),
      metalness: Math.max(metalness, 0.5), roughness: 0.35,
      ops: [
        // top bulb
        { prim: 'sphere',   mode: 'union',    color: '#d0d8e8',    pos: [0, sc(0.46), 0], r: sc(0.38) },
        // bottom bulb
        { prim: 'sphere',   mode: 'union',    color: '#d0d8e8',    pos: [0, sc(-0.46), 0], r: sc(0.38) },
        // carved pinch (subtract cylinder in middle)
        { prim: 'capsule',  mode: 'subtract', color: '#000',       pos: [0, 0, 0], size: [0, sc(0.2), 0], r: sc(0.28) },
        // frame top ring
        { prim: 'torus',    mode: 'union',    color: hc,           pos: [0, sc(0.72), 0], R: sc(0.32), r: sc(0.05) },
        // frame bottom ring
        { prim: 'torus',    mode: 'union',    color: hc,           pos: [0, sc(-0.72), 0], R: sc(0.32), r: sc(0.05) },
        // left post
        { prim: 'capsule',  mode: 'union',    color: hc,           pos: [sc(0.32), 0, 0], size: [0, sc(0.74), 0], r: sc(0.04) },
        // right post
        { prim: 'capsule',  mode: 'union',    color: hc,           pos: [sc(-0.32), 0, 0], size: [0, sc(0.74), 0], r: sc(0.04) },
      ],
    };
  }

  // ── chair / stool / armchair / throne ─────────────────────────────────────
  if (/\bchair\b|stool|throne|armchair|bench|sofa|couch/.test(t)) {
    const wood = baseColor === '#7b8cfa' ? '#8a5c30' : baseColor;
    return {
      label: t.slice(0, 32),
      roughness: Math.max(roughness, 0.65),
      ops: [
        // seat
        { prim: 'box', mode: 'union', color: wood,      pos: [0, sc(-0.1), 0],         size: [sc(0.42), sc(0.06), sc(0.4)] },
        // back rest
        { prim: 'box', mode: 'union', color: wood,      pos: [sc(-0.38), sc(0.22), 0], size: [sc(0.04), sc(0.38), sc(0.38)] },
        // leg fl
        { prim: 'capsule', mode: 'union', color: wood,  pos: [sc(0.32), sc(-0.6), sc(0.3)],  size: [0, sc(0.5), 0], r: sc(0.04) },
        // leg fr
        { prim: 'capsule', mode: 'union', color: wood,  pos: [sc(0.32), sc(-0.6), sc(-0.3)], size: [0, sc(0.5), 0], r: sc(0.04) },
        // leg rl
        { prim: 'capsule', mode: 'union', color: wood,  pos: [sc(-0.32), sc(-0.6), sc(0.3)],  size: [0, sc(0.5), 0], r: sc(0.04) },
        // leg rr
        { prim: 'capsule', mode: 'union', color: wood,  pos: [sc(-0.32), sc(-0.6), sc(-0.3)], size: [0, sc(0.5), 0], r: sc(0.04) },
      ],
    };
  }

  // ── sword / blade / dagger / katana / knife ───────────────────────────────
  if (/sword|blade|dagger|katana|sabre|saber|\bknife\b|rapier/.test(t)) {
    const metal = baseColor === '#7b8cfa' ? '#c8d0d8' : baseColor;
    return {
      label: t.slice(0, 32),
      metalness: Math.max(metalness, 0.85), roughness: Math.min(roughness, 0.2),
      ops: [
        // blade (flat box, tapers — approximated)
        { prim: 'box',     mode: 'union', color: metal,      pos: [0, sc(0.22), 0],        size: [sc(0.04), sc(0.78), sc(0.04)] },
        { prim: 'cone',    mode: 'union', color: metal,      pos: [0, sc(1.0), 0],         r: sc(0.04), h: sc(0.2) },
        // crossguard
        { prim: 'box',     mode: 'union', color: '#a87820',  pos: [0, sc(-0.18), 0],       size: [sc(0.04), sc(0.06), sc(0.38)] },
        { prim: 'sphere',  mode: 'union', color: '#a87820',  pos: [0, sc(-0.18), sc(0.38)], r: sc(0.06) },
        { prim: 'sphere',  mode: 'union', color: '#a87820',  pos: [0, sc(-0.18), sc(-0.38)], r: sc(0.06) },
        // grip / handle
        { prim: 'capsule', mode: 'union', color: '#4a2e18',  pos: [0, sc(-0.5), 0],        size: [0, sc(0.36), 0], r: sc(0.07) },
        // pommel
        { prim: 'sphere',  mode: 'union', color: '#a87820',  pos: [0, sc(-0.75), 0],       r: sc(0.1) },
      ],
    };
  }

  // ── wine glass / champagne glass / goblet ─────────────────────────────────
  if (/wine.glass|champagne|goblet|chalice|glass/.test(t)) {
    const glass = baseColor === '#7b8cfa' ? '#e8f4f8' : baseColor;
    return {
      label: t.slice(0, 32),
      metalness: 0.05, roughness: 0.08, // transparent glass material
      ops: [
        // bowl (upper sphere, carved hollow)
        { prim: 'sphere',  mode: 'union',    color: glass, pos: [0, sc(0.42), 0],        r: sc(0.38) },
        { prim: 'sphere',  mode: 'subtract', color: '#000', pos: [0, sc(0.48), 0],        r: sc(0.35) },
        // bowl base transition (smooth into stem)
        { prim: 'sphere',  mode: 'smooth', blend: 0.08, color: glass, pos: [0, sc(0.05), 0], r: sc(0.08) },
        // stem (thin cylinder)
        { prim: 'capsule', mode: 'union',    color: glass, pos: [0, sc(-0.18), 0],       size: [0, sc(0.48), 0], r: sc(0.03) },
        // base foot (wide disc)
        { prim: 'torus',   mode: 'union',    color: glass, pos: [0, sc(-0.72), 0],       R: sc(0.24), r: sc(0.08) },
        // base center (fill torus hole)
        { prim: 'sphere',  mode: 'union',    color: glass, pos: [0, sc(-0.72), 0],       r: sc(0.18) },
      ],
    };
  }

  // ── telescope / spyglass ──────────────────────────────────────────────────
  if (/telescope|spyglass|scope|binoculars/.test(t)) {
    const brass = baseColor === '#7b8cfa' ? '#b89030' : baseColor;
    return {
      label: t.slice(0, 32),
      metalness: Math.max(metalness, 0.65), roughness: 0.4,
      ops: [
        // main tube
        { prim: 'capsule', mode: 'union', color: brass,      pos: [sc(-0.5), 0, 0],        size: [sc(0.95), 0, 0], r: sc(0.12) },
        // eyepiece ring
        { prim: 'torus',   mode: 'union', color: '#3a3a48',  pos: [sc(-0.55), 0, 0],       R: sc(0.14), r: sc(0.04) },
        // objective lens housing
        { prim: 'torus',   mode: 'union', color: '#3a3a48',  pos: [sc(0.52), 0, 0],        R: sc(0.18), r: sc(0.06) },
        // lens (glass sphere inside)
        { prim: 'sphere',  mode: 'union', color: '#88aacc',  pos: [sc(0.52), 0, 0],        r: sc(0.14) },
        // tripod mount
        { prim: 'box',     mode: 'union', color: '#3a3a48',  pos: [sc(-0.1), sc(-0.16), 0], size: [sc(0.08), sc(0.06), sc(0.08)] },
      ],
    };
  }

  // ── coffee mug / cup / teacup ─────────────────────────────────────────────
  if (/\bmug\b|coffee.mug|\bcup\b|teacup/.test(t)) {
    const ceramic = baseColor === '#7b8cfa' ? '#d8c8b0' : baseColor;
    return {
      label: t.slice(0, 32),
      roughness: Math.max(roughness, 0.6),
      ops: [
        // body (cylinder approximated with capsule + carved top)
        { prim: 'capsule', mode: 'union', color: ceramic,    pos: [0, sc(-0.4), 0],        size: [0, sc(0.65), 0], r: sc(0.28) },
        { prim: 'sphere',  mode: 'subtract', color: '#000',  pos: [0, sc(0.32), 0],        r: sc(0.24) },
        // handle (torus segment)
        { prim: 'torus',   mode: 'union', color: ceramic,    pos: [sc(0.32), sc(-0.08), 0], R: sc(0.22), r: sc(0.05) },
        { prim: 'box',     mode: 'subtract', color: '#000',  pos: [sc(0.12), sc(-0.08), 0], size: [sc(0.2), sc(0.25), sc(0.08)] },
        // base ring
        { prim: 'torus',   mode: 'union', color: ceramic,    pos: [0, sc(-0.68), 0],       R: sc(0.24), r: sc(0.04) },
      ],
    };
  }

  // ── lighthouse / tower ────────────────────────────────────────────────────
  if (/lighthouse|tower|beacon|minaret|obelisk/.test(t)) {
    const stone = baseColor === '#7b8cfa' ? '#9a8a7a' : baseColor;
    return {
      label: t.slice(0, 32),
      roughness: Math.max(roughness, 0.75),
      ops: [
        // base platform
        { prim: 'box',     mode: 'union', color: stone,      pos: [0, sc(-0.8), 0],        size: [sc(0.48), sc(0.08), sc(0.48)] },
        // main tower shaft (tapered — cone base + cylinder top)
        { prim: 'capsule', mode: 'union', color: stone,      pos: [0, sc(-0.65), 0],       size: [0, sc(1.15), 0], r: sc(0.22) },
        { prim: 'capsule', mode: 'union', color: stone,      pos: [0, sc(0.52), 0],        size: [0, sc(0.18), 0], r: sc(0.26) },
        // lantern room (glass)
        { prim: 'box',     mode: 'union', color: '#e8e040',  pos: [0, sc(0.82), 0],        size: [sc(0.2), sc(0.12), sc(0.2)] },
        // roof cap (cone)
        { prim: 'cone',    mode: 'union', color: '#c03030',  pos: [0, sc(0.96), 0],        r: sc(0.28), h: sc(0.22) },
        // windows (subtract slits)
        { prim: 'box',     mode: 'subtract', color: '#000',  pos: [sc(0.24), sc(0.25), 0], size: [sc(0.06), sc(0.12), sc(0.06)] },
        { prim: 'box',     mode: 'subtract', color: '#000',  pos: [sc(-0.24), sc(0.25), 0], size: [sc(0.06), sc(0.12), sc(0.06)] },
      ],
    };
  }

  // ── barrel / keg / cask ───────────────────────────────────────────────────
  if (/barrel|\bkeg\b|cask|drum/.test(t)) {
    const wood = baseColor === '#7b8cfa' ? '#8a5c30' : baseColor;
    return {
      label: t.slice(0, 32),
      roughness: Math.max(roughness, 0.7),
      ops: [
        // body (torus-like bulge — sphere carved top/bottom)
        { prim: 'sphere',  mode: 'union', color: wood,       pos: [0, 0, 0],               r: sc(0.52) },
        { prim: 'box',     mode: 'subtract', color: '#000',  pos: [0, sc(0.45), 0],        size: [sc(0.6), sc(0.2), sc(0.6)] },
        { prim: 'box',     mode: 'subtract', color: '#000',  pos: [0, sc(-0.45), 0],       size: [sc(0.6), sc(0.2), sc(0.6)] },
        // top metal ring
        { prim: 'torus',   mode: 'union', color: '#3a3a48',  pos: [0, sc(0.32), 0],        R: sc(0.36), r: sc(0.04) },
        // bottom metal ring
        { prim: 'torus',   mode: 'union', color: '#3a3a48',  pos: [0, sc(-0.32), 0],       R: sc(0.36), r: sc(0.04) },
        // middle metal band
        { prim: 'torus',   mode: 'union', color: '#3a3a48',  pos: [0, 0, 0],               R: sc(0.42), r: sc(0.03) },
      ],
    };
  }

  // ── lamp / lantern / torch ────────────────────────────────────────────────
  if (/\blamp\b|lantern|\btorch\b|candle/.test(t)) {
    const brass = baseColor === '#7b8cfa' ? '#b89030' : baseColor;
    return {
      label: t.slice(0, 32),
      metalness: Math.max(metalness, 0.6), roughness: 0.45,
      ops: [
        // base stand
        { prim: 'torus',   mode: 'union', color: brass,      pos: [0, sc(-0.72), 0],       R: sc(0.22), r: sc(0.05) },
        { prim: 'capsule', mode: 'union', color: brass,      pos: [0, sc(-0.65), 0],       size: [0, sc(0.1), 0], r: sc(0.06) },
        // pole
        { prim: 'capsule', mode: 'union', color: brass,      pos: [0, sc(-0.25), 0],       size: [0, sc(0.7), 0], r: sc(0.04) },
        // lantern housing (box frame)
        { prim: 'box',     mode: 'union', color: brass,      pos: [0, sc(0.52), 0],        size: [sc(0.22), sc(0.28), sc(0.22)] },
        // glass panes (lighter color inside frame)
        { prim: 'box',     mode: 'union', color: '#e8e0a0',  pos: [0, sc(0.52), 0],        size: [sc(0.18), sc(0.24), sc(0.18)] },
        // flame glow
        { prim: 'sphere',  mode: 'union', color: '#ff8820',  pos: [0, sc(0.58), 0],        r: sc(0.08) },
        // top cap (cone)
        { prim: 'cone',    mode: 'union', color: brass,      pos: [0, sc(0.82), 0],        r: sc(0.2), h: sc(0.18) },
      ],
    };
  }

  // ── bell / church bell ────────────────────────────────────────────────────
  if (/\bbell\b|church.bell|chime/.test(t)) {
    const bronze = baseColor === '#7b8cfa' ? '#b87848' : baseColor;
    return {
      label: t.slice(0, 32),
      metalness: Math.max(metalness, 0.75), roughness: 0.4,
      ops: [
        // crown (top mounting piece)
        { prim: 'box',     mode: 'union', color: bronze,     pos: [0, sc(0.68), 0],        size: [sc(0.12), sc(0.08), sc(0.12)] },
        { prim: 'torus',   mode: 'union', color: bronze,     pos: [0, sc(0.72), 0],        R: sc(0.08), r: sc(0.04) },
        // bell body (inverted cone shape — sphere carved)
        { prim: 'sphere',  mode: 'union', color: bronze,     pos: [0, sc(0.15), 0],        r: sc(0.58) },
        { prim: 'sphere',  mode: 'subtract', color: '#000',  pos: [0, sc(0.22), 0],        r: sc(0.52) },
        { prim: 'box',     mode: 'subtract', color: '#000',  pos: [0, sc(0.75), 0],        size: [sc(0.7), sc(0.2), sc(0.7)] },
        // sound bow (bottom rim thickening)
        { prim: 'torus',   mode: 'union', color: bronze,     pos: [0, sc(-0.38), 0],       R: sc(0.48), r: sc(0.06) },
        // clapper (hanging inside)
        { prim: 'sphere',  mode: 'union', color: '#3a3a48',  pos: [0, sc(-0.5), 0],        r: sc(0.08) },
      ],
    };
  }

  // ── axe / hatchet / battle axe ────────────────────────────────────────────
  if (/\baxe\b|hatchet|battle.axe|tomahawk/.test(t)) {
    const metal = baseColor === '#7b8cfa' ? '#c0c8d0' : baseColor;
    return {
      label: t.slice(0, 32),
      metalness: Math.max(metalness, 0.8), roughness: 0.35,
      ops: [
        // handle/haft
        { prim: 'capsule', mode: 'union', color: '#6a4a2a',  pos: [0, sc(-0.45), 0],       size: [0, sc(0.85), 0], r: sc(0.06) },
        // axe head body (box rotated)
        { prim: 'box',     mode: 'union', color: metal,      pos: [0, sc(0.52), 0],        size: [sc(0.08), sc(0.18), sc(0.45)] },
        // blade wedge (front)
        { prim: 'box',     mode: 'union', color: metal,      pos: [sc(0.12), sc(0.52), 0], rot: [0, 0, 25], size: [sc(0.08), sc(0.16), sc(0.42)] },
        // blade wedge (back)
        { prim: 'box',     mode: 'union', color: metal,      pos: [sc(-0.12), sc(0.52), 0], rot: [0, 0, -25], size: [sc(0.08), sc(0.16), sc(0.42)] },
        // pommel (end cap)
        { prim: 'sphere',  mode: 'union', color: '#6a4a2a',  pos: [0, sc(-0.95), 0],       r: sc(0.08) },
      ],
    };
  }

  // ── campfire / bonfire ────────────────────────────────────────────────────
  if (/campfire|bonfire|fire.pit/.test(t)) {
    const wood = baseColor === '#7b8cfa' ? '#5a3a1a' : baseColor;
    return {
      label: t.slice(0, 32),
      roughness: 0.8,
      parts: [
        { name: 'log', ops: [
          { prim: 'capsule', mode: 'union', color: wood, pos: [0, 0, 0], size: [sc(0.5), 0, 0], r: sc(0.08) },
        ]},
      ],
      symmetries: [
        { kind: 'radial', of: 'log', count: 6, radius: sc(0.15), axis: 'y', spin: false },
      ],
      ops: [
        // fire (orange/yellow spheres stacked)
        { prim: 'sphere',  mode: 'union', color: '#ff6030',  pos: [0, sc(-0.1), 0],        r: sc(0.2) },
        { prim: 'sphere',  mode: 'union', color: '#ff9020',  pos: [0, sc(0.08), 0],        r: sc(0.16) },
        { prim: 'sphere',  mode: 'union', color: '#ffcc30',  pos: [0, sc(0.22), 0],        r: sc(0.12) },
        // rocks around base
        { prim: 'sphere',  mode: 'union', color: '#6a6a70',  pos: [sc(0.32), sc(-0.35), sc(0.2)],   r: sc(0.12) },
        { prim: 'sphere',  mode: 'union', color: '#6a6a70',  pos: [sc(-0.28), sc(-0.35), sc(-0.25)], r: sc(0.1) },
      ],
    };
  }

  // ── generic fallback: a simple stacked form using the detected colour ──────
  // Only returned when at least some non-trivial text was typed.
  if (t.length >= 4) {
    return {
      label: t.slice(0, 32),
      metalness, roughness,
      ops: [
        { prim: 'sphere',  mode: 'union',  color: baseColor,      pos: [0, sc(-0.08), 0], r: sc(0.42) },
        { prim: 'ellipsoid', mode: 'smooth', blend: 0.1, color: baseColor, pos: [0, sc(0.5), 0], size: [sc(tall ? 0.18 : 0.3), sc(tall ? 0.55 : 0.28), sc(0.28)] },
      ],
    };
  }

  return null;
}
