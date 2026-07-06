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

export interface ShapeProgram {
  label: string;
  ops: PrimOp[];
  parts?: PartDef[];      // named reusable sub-trees (referenced by symmetries)
  symmetries?: Symmetry[]; // expand-time transforms (no kernel cost)
  warp?: Warp;            // optional field displacement
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

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    metalness: program.metalness ?? 0.15,
    roughness: program.roughness ?? 0.55,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = program.label || 'sdf-model';
  const group = new THREE.Group();
  group.name = 'MeshForge-SDF';
  group.add(mesh);

  return { group, triangles: triCount, opCount: expanded.ops.length };
}

// ——— built-in preset programs (offline mode + few-shot examples) ———
export const PRESET_PROGRAMS: Record<string, ShapeProgram> = {
  snowman: {
    label: 'snowman',
    roughness: 0.7,
    ops: [
      { prim: 'sphere', mode: 'union', color: '#e8ecf4', pos: [0, -0.55, 0], r: 0.5 },
      { prim: 'sphere', mode: 'smooth', blend: 0.1, color: '#e8ecf4', pos: [0, 0.1, 0], r: 0.36 },
      { prim: 'sphere', mode: 'smooth', blend: 0.08, color: '#e8ecf4', pos: [0, 0.62, 0], r: 0.26 },
      { prim: 'ellipsoid', mode: 'union', color: '#cc824a', pos: [0, 0.62, 0.33], size: [0.05, 0.05, 0.16] },
      { prim: 'sphere', mode: 'union', color: '#1a1e28', pos: [-0.09, 0.7, 0.22], r: 0.035 },
      { prim: 'sphere', mode: 'union', color: '#1a1e28', pos: [0.09, 0.7, 0.22], r: 0.035 },
      { prim: 'box', mode: 'union', color: '#1a1e28', pos: [0, 0.88, 0], size: [0.28, 0.02, 0.28] },
      { prim: 'box', mode: 'union', color: '#1a1e28', pos: [0, 1.02, 0], size: [0.16, 0.14, 0.16] },
    ],
  },
  rocket: {
    label: 'rocket ship',
    metalness: 0.6,
    roughness: 0.35,
    ops: [
      { prim: 'capsule', mode: 'union', color: '#c6ccda', pos: [0, -0.7, 0], size: [0, 1.3, 0], r: 0.3 },
      { prim: 'ellipsoid', mode: 'smooth', blend: 0.08, color: '#d5687f', pos: [0, 0.75, 0], size: [0.24, 0.42, 0.24] },
      { prim: 'sphere', mode: 'union', color: '#43a8ca', pos: [0, 0.05, 0.27], r: 0.1 },
      { prim: 'box', mode: 'union', color: '#d5687f', pos: [0, -0.75, 0], rot: [0, 0, 0], size: [0.62, 0.28, 0.045] },
      { prim: 'box', mode: 'union', color: '#d5687f', pos: [0, -0.75, 0], rot: [0, 90, 0], size: [0.62, 0.28, 0.045] },
      { prim: 'torus', mode: 'union', color: '#8b94a7', pos: [0, -1.02, 0], R: 0.2, r: 0.07 },
    ],
  },
  mushroom: {
    label: 'mushroom house',
    roughness: 0.65,
    ops: [
      { prim: 'capsule', mode: 'union', color: '#e6dfc9', pos: [0, -0.9, 0], size: [0, 0.85, 0], r: 0.38 },
      { prim: 'ellipsoid', mode: 'smooth', blend: 0.1, color: '#d5687f', pos: [0, 0.25, 0], size: [0.85, 0.5, 0.85] },
      { prim: 'sphere', mode: 'union', color: '#e8ecf4', pos: [0.4, 0.42, 0.55], r: 0.1 },
      { prim: 'sphere', mode: 'union', color: '#e8ecf4', pos: [-0.5, 0.5, 0.3], r: 0.13 },
      { prim: 'sphere', mode: 'union', color: '#e8ecf4', pos: [0.1, 0.55, -0.6], r: 0.11 },
      { prim: 'box', mode: 'subtract', color: '#5a4634', pos: [0, -0.72, 0.36], size: [0.16, 0.24, 0.2] },
      { prim: 'sphere', mode: 'union', color: '#dcb35c', pos: [0.28, -0.62, 0.3], r: 0.045 },
    ],
  },
  dragon: {
    label: 'baby dragon',
    roughness: 0.5,
    ops: [
      { prim: 'capsule', mode: 'union', color: '#43b384', pos: [-0.5, -0.3, 0], size: [0.95, 0.25, 0], r: 0.26 },
      { prim: 'capsule', mode: 'smooth', blend: 0.12, color: '#43b384', pos: [0.45, -0.05, 0], size: [0.3, 0.35, 0], r: 0.16 },
      { prim: 'ellipsoid', mode: 'smooth', blend: 0.08, color: '#43b384', pos: [0.85, 0.42, 0], size: [0.26, 0.2, 0.2] },
      { prim: 'ellipsoid', mode: 'smooth', blend: 0.06, color: '#5fc99a', pos: [1.08, 0.36, 0], size: [0.14, 0.09, 0.11] },
      { prim: 'sphere', mode: 'union', color: '#1a1e28', pos: [0.95, 0.52, 0.13], r: 0.035 },
      { prim: 'sphere', mode: 'union', color: '#1a1e28', pos: [0.95, 0.52, -0.13], r: 0.035 },
      { prim: 'ellipsoid', mode: 'union', color: '#dcb35c', pos: [0.78, 0.62, 0.07], rot: [0, 0, -25], size: [0.035, 0.12, 0.035] },
      { prim: 'ellipsoid', mode: 'union', color: '#dcb35c', pos: [0.78, 0.62, -0.07], rot: [0, 0, -25], size: [0.035, 0.12, 0.035] },
      { prim: 'ellipsoid', mode: 'union', color: '#3caca4', pos: [-0.1, 0.25, 0.3], rot: [30, 0, 20], size: [0.4, 0.02, 0.22] },
      { prim: 'ellipsoid', mode: 'union', color: '#3caca4', pos: [-0.1, 0.25, -0.3], rot: [-30, 0, 20], size: [0.4, 0.02, 0.22] },
      { prim: 'capsule', mode: 'smooth', blend: 0.1, color: '#43b384', pos: [-1.3, -0.25, 0], size: [-0.5, 0.35, 0], r: 0.08 },
      { prim: 'capsule', mode: 'union', color: '#43b384', pos: [-0.25, -0.55, 0.18], size: [0, -0.3, 0], r: 0.08 },
      { prim: 'capsule', mode: 'union', color: '#43b384', pos: [-0.25, -0.55, -0.18], size: [0, -0.3, 0], r: 0.08 },
      { prim: 'capsule', mode: 'union', color: '#43b384', pos: [0.35, -0.55, 0.16], size: [0, -0.3, 0], r: 0.08 },
      { prim: 'capsule', mode: 'union', color: '#43b384', pos: [0.35, -0.55, -0.16], size: [0, -0.3, 0], r: 0.08 },
    ],
  },
  crystal: {
    // Showcases: new octahedron + cone primitives, radial symmetry DSL,
    // high metalness gem material. Generated from 3 authored ops + 1 symmetry.
    label: 'crystal cluster',
    metalness: 0.85,
    roughness: 0.15,
    parts: [
      { name: 'shard', ops: [
        // Authored at the origin; the radial symmetry's `radius` places the
        // ring. (Previously pre-offset in z to mask the old translate-along-axis
        // bug, which also lifted shards +0.5 in Y and clipped them at the bound.)
        { prim: 'octahedron', mode: 'union', color: '#7b6cf0', pos: [0, 0.45, 0], r: 0.16 },
        { prim: 'cone', mode: 'union', color: '#9a8af5', pos: [0, 0.7, 0], r: 0.07, h: 0.35 },
      ] },
    ],
    symmetries: [
      { kind: 'radial', of: 'shard', count: 5, radius: 0.5, axis: 'y', spin: true },
    ],
    ops: [
      { prim: 'octahedron', mode: 'union', color: '#5a4ad6', pos: [0, -0.35, 0], r: 0.42 },
      { prim: 'hex', mode: 'union', color: '#3a2e7a', pos: [0, -0.7, 0], size: [0.55, 0.12, 0.55] },
    ],
  },
  flower: {
    // Showcases: radial symmetry for petals, ellipsoid thin-form for petal shape.
    label: 'six-petal flower',
    roughness: 0.6,
    parts: [
      { name: 'petal', ops: [
        // Canonical DSL usage: part authored at the origin, ring placed by `radius`.
        { prim: 'ellipsoid', mode: 'union', color: '#e85a9b', pos: [0, 0.05, 0], rot: [0, 0, -15], size: [0.32, 0.04, 0.16] },
      ] },
    ],
    symmetries: [
      { kind: 'radial', of: 'petal', count: 6, radius: 0.42, axis: 'y', spin: true },
    ],
    ops: [
      { prim: 'capsule', mode: 'union', color: '#3a8a3a', pos: [0, -0.65, 0], size: [0, 0.85, 0], r: 0.045 },
      { prim: 'sphere', mode: 'union', color: '#dcb35c', pos: [0, 0.05, 0], r: 0.13 },
    ],
  },
};

const PRESET_KEYWORDS: Record<string, string[]> = {
  snowman: ['snowman', 'snow man', 'frosty'],
  rocket: ['rocket', 'spaceship', 'space ship', 'missile'],
  mushroom: ['mushroom house', 'mushroom home', 'toadstool'],
  dragon: ['dragon', 'wyvern', 'drake'],
  crystal: ['crystal', 'gem', 'diamond cluster', 'amethyst'],
  flower: ['flower', 'daisy', 'sunflower', 'tulip', 'rose'],
};

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

export function sanitizeProgram(raw: any, fallbackLabel: string): ShapeProgram | null {
  if (!raw || !Array.isArray(raw.ops) || raw.ops.length === 0) return null;
  const ops: PrimOp[] = [];
  for (const o of raw.ops.slice(0, 24)) {
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
  if (ops.length === 0) return null;
  // never let the first op be a subtraction from empty space
  if (ops[0].mode === 'subtract' || ops[0].mode === 'intersect') ops[0].mode = 'union';

  // parts + symmetries (DSL layer) — passed through; expandProgram handles them.
  const parts: PartDef[] | undefined = Array.isArray(raw.parts) && raw.parts.length
    ? raw.parts.slice(0, 12).map((p: any) => ({
        name: String(p.name || 'part').slice(0, 24),
        ops: (Array.isArray(p.ops) ? p.ops : []).slice(0, 16).filter((o: any) => o && PRIMS.includes(o.prim)),
      })).filter((p: PartDef) => p.ops.length > 0)
    : undefined;

  const symmetries: Symmetry[] | undefined = Array.isArray(raw.symmetries) && raw.symmetries.length
    ? raw.symmetries.slice(0, 6).map(sanitizeSymmetry).filter((s: Symmetry | null): s is Symmetry => s !== null)
    : undefined;

  const warp: Warp | undefined = raw.warp && typeof raw.warp === 'object'
    ? { amp: num(raw.warp.amp, 0, 0, 0.2), freq: num(raw.warp.freq, 6, 0.5, 20), octaves: raw.warp.octaves ? Math.round(num(raw.warp.octaves, 4, 1, 6)) : 4, seed: raw.warp.seed ?? 0 }
    : undefined;

  return {
    label: typeof raw.label === 'string' && raw.label ? raw.label.slice(0, 48) : fallbackLabel,
    ops,
    parts: parts && parts.length ? parts : undefined,
    symmetries: symmetries && symmetries.length ? symmetries : undefined,
    warp: warp && warp.amp > 0 ? warp : undefined,
    metalness: raw.metalness !== undefined ? num(raw.metalness, 0.15, 0, 1) : undefined,
    roughness: raw.roughness !== undefined ? num(raw.roughness, 0.55, 0, 1) : undefined,
  };
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

RULES:
- Everything must fit inside [-1.2, 1.2] on every axis. Y is UP. Build 6-20 ops (or fewer ops + symmetries).
- Think like a sculptor: big masses first, then details. Use "smooth" mode + blend to fuse parts.
- Use symmetries aggressively for symmetric creatures (4 legs = radial count 4), plants (petals), vehicles (mirror x).
- Pick realistic colors per part (#rrggbb hex). Crystal/gem parts can use high metalness (0.6-0.9) + low roughness (0.1-0.3).

EXAMPLE — "6-petaled flower with a stem": {"label":"flower","parts":[{"name":"petal","ops":[{"prim":"ellipsoid","mode":"union","color":"#e85a9b","pos":[0,0,0],"size":[0.35,0.05,0.18]}]}],"symmetries":[{"kind":"radial","of":"petal","count":6,"radius":0.18,"axis":"y","spin":true}],"ops":[{"prim":"capsule","mode":"union","color":"#3a8a3a","pos":[0,-0.7,0],"size":[0,0.9,0],"r":0.05},{"prim":"sphere","mode":"union","color":"#dcb35c","pos":[0,0.05,0],"r":0.12}]}

Reply with ONLY the JSON object for this description:`;

/**
 * Compose a shape program: LLM first, preset library as offline fallback.
 * Returns null when neither produces a program (caller falls back to parametric).
 */
export async function composeWithAI(prompt: string): Promise<{ program: ShapeProgram; source: 'ai' | 'preset' } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch('/api/chat-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        context: 'sdf-shape-compiler',
        message: `${COMPOSE_INSTRUCTIONS}\n\nDescription: "${prompt}"`,
      }),
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const match = String(data.text ?? '').match(/\{[\s\S]*\}/);
      if (match) {
        const program = sanitizeProgram(JSON.parse(match[0]), prompt.slice(0, 48));
        if (program && program.ops.length >= 2) return { program, source: 'ai' };
      }
    }
  } catch { /* fall through to presets */ }

  const p = prompt.toLowerCase();
  for (const [key, words] of Object.entries(PRESET_KEYWORDS)) {
    if (words.some(w => p.includes(w))) return { program: PRESET_PROGRAMS[key], source: 'preset' };
  }
  return null;
}
/**
 * LLM self-revision: hand the model its own current program plus an edit
 * instruction ("make the wings bigger") and get back a full updated program.
 */
export async function refineProgramWithAI(current: ShapeProgram, instruction: string): Promise<ShapeProgram | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch('/api/chat-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        context: 'sdf-shape-compiler-refine',
        message: `${COMPOSE_INSTRUCTIONS}\n\nCURRENT PROGRAM:\n${JSON.stringify(current)}\n\nApply this modification and reply with ONLY the complete updated JSON program: "${instruction}"`,
      }),
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const match = String(data.text ?? '').match(/\{[\s\S]*\}/);
    if (!match) return null;
    const program = sanitizeProgram(JSON.parse(match[0]), current.label);
    return program && program.ops.length >= 2 ? program : null;
  } catch {
    return null;
  }
}
// (2026-07-06 audit pass: radial-symmetry placement + GPU expansion fixes verified by smoke test)
