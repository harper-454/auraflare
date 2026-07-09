/**
 * GLSL code generator for the SDF shape-program compiler.
 *
 * Takes a ShapeProgram and returns a self-contained GLSL snippet defining:
 *   float sdf(vec3 p)      — signed distance (identical to CPU/GPU kernels)
 *   vec3  sdfColor(vec3 p) — surface color at nearest primitive
 *
 * Used by SDFRaytracer for the real-time sphere-tracing preview (3D-2).
 */

import * as THREE from 'three';
import { expandProgram, type ShapeProgram, type PrimOp, type Warp } from './sdf-compiler';

// ── helpers ────────────────────────────────────────────────────────────────

function f(n: number): string { return n.toFixed(7); }
function v3(v: [number, number, number]): string {
  return `vec3(${f(v[0])},${f(v[1])},${f(v[2])})`;
}

/** Inverse-rotation mat3 for a PrimOp, as a GLSL column-major constructor. */
function invRotMat3(rot: [number, number, number]): string {
  const e = new THREE.Euler(
    (rot[0] * Math.PI) / 180,
    (rot[1] * Math.PI) / 180,
    (rot[2] * Math.PI) / 180,
  );
  // column-major elements
  const el = new THREE.Matrix4().makeRotationFromEuler(e).invert().elements;
  const r = (n: number) => n.toFixed(7);
  return (
    `mat3(${r(el[0])},${r(el[1])},${r(el[2])},` +
    `${r(el[4])},${r(el[5])},${r(el[6])},` +
    `${r(el[8])},${r(el[9])},${r(el[10])})`
  );
}

function cssToVec3(css: string): string {
  try {
    const c = new THREE.Color(css);
    return `vec3(${f(c.r)},${f(c.g)},${f(c.b)})`;
  } catch {
    return 'vec3(0.78,0.78,0.82)';
  }
}

// ── per-op unified block (prim compute + CSG combine inside one scope) ─────
//
// All local names live inside a single {} so there is no scoping issue.
// The outermost `d` and `col` accumulators are declared before the first block.

function emitOpBlock(op: PrimOp, isFirst: boolean): string {
  const hasRot = op.rot && (op.rot[0] !== 0 || op.rot[1] !== 0 || op.rot[2] !== 0);
  const lpExpr = hasRot
    ? `${invRotMat3(op.rot!)} * (p - ${v3(op.pos)})`
    : `p - ${v3(op.pos)}`;

  const colorLit = cssToVec3(op.color);
  const lines: string[] = [`vec3 lp = ${lpExpr};`];

  // ── primitive SDF ───────────────────────────────────────────────────────
  switch (op.prim) {
    case 'sphere':
      lines.push(`float di = length(lp) - ${f(op.r ?? 0.3)};`);
      break;

    case 'box': {
      const s = op.size ?? [0.3, 0.3, 0.3];
      lines.push(
        `vec3 bq = abs(lp) - ${v3(s as [number, number, number])};`,
        `float di = length(max(bq, vec3(0.0))) + min(max(bq.x, max(bq.y, bq.z)), 0.0);`,
      );
      break;
    }

    case 'capsule': {
      const b = op.size ?? [0, 0.5, 0];
      const r = op.r ?? 0.15;
      lines.push(
        `vec3 cb = ${v3(b as [number, number, number])};`,
        `float cbb = max(dot(cb, cb), 1e-6);`,
        `float cht = clamp(dot(lp, cb) / cbb, 0.0, 1.0);`,
        `float di = length(lp - cb * cht) - ${f(r)};`,
      );
      break;
    }

    case 'torus': {
      const R = op.R ?? 0.5, r = op.r ?? 0.12;
      lines.push(
        `float tqr = sqrt(lp.x*lp.x + lp.z*lp.z) - ${f(R)};`,
        `float di = sqrt(tqr*tqr + lp.y*lp.y) - ${f(r)};`,
      );
      break;
    }

    case 'ellipsoid': {
      const s = op.size ?? [0.3, 0.2, 0.3];
      lines.push(
        `vec3 es = ${v3(s as [number, number, number])};`,
        `float ek0 = length(vec3(lp.x/es.x, lp.y/es.y, lp.z/es.z));`,
        `float ek1 = length(vec3(lp.x/(es.x*es.x), lp.y/(es.y*es.y), lp.z/(es.z*es.z)));`,
        `float di = ek1 > 1e-9 ? (ek0*(ek0-1.0))/ek1 : -min(es.x, min(es.y, es.z));`,
      );
      break;
    }

    case 'cone': {
      // IQ exact cone: circular base radius r, apex at (0,h,0)
      const r = op.r ?? 0.3, h = op.h ?? 0.6;
      lines.push(
        `float cwx = sqrt(lp.x*lp.x + lp.z*lp.z);`,
        `float cwy = lp.y - ${f(h)};`,
        `vec2 ccq = vec2(${f(r)}, ${f(-h)});`,
        `float cct = clamp((cwx*ccq.x + cwy*ccq.y) / dot(ccq,ccq), 0.0, 1.0);`,
        `float cax = cwx - ccq.x*cct, cay = cwy - ccq.y*cct;`,
        `float cbx = cwx - ccq.x*clamp(cwx/ccq.x, 0.0, 1.0), cby = cwy - ccq.y;`,
        `float di = sqrt(min(cax*cax+cay*cay, cbx*cbx+cby*cby))`,
        `         * sign(max(-(cwx*ccq.y - cwy*ccq.x), -(cwy-ccq.y)));`,
      );
      break;
    }

    case 'hex': {
      // IQ hexagonal prism: size[0]=radial, size[1]=half-height
      const s = op.size ?? [0.35, 0.3, 0.3];
      lines.push(
        `float hpx = abs(lp.x), hpz = abs(lp.z);`,
        `float hx2 = hpz*0.8660254 + hpx*0.5;`,
        `float hd2 = max(hx2, hpz) - ${f(s[0])};`,
        `hd2 = max(hd2, hpx - ${f(s[0])});`,
        `float di = max(hd2, abs(lp.y) - ${f(s[1])});`,
      );
      break;
    }

    case 'octahedron': {
      const r = op.r ?? 0.4;
      lines.push(`float di = (abs(lp.x)+abs(lp.y)+abs(lp.z) - ${f(r)}) * 0.5773503;`);
      break;
    }

    case 'cylinder': {
      // capped cylinder along Y: r = radius, h = half-height (matches CPU/WGSL)
      const r = op.r ?? 0.3, h = op.h ?? 0.4;
      lines.push(
        `float cyd = sqrt(lp.x*lp.x + lp.z*lp.z) - ${f(r)};`,
        `float cyy = abs(lp.y) - ${f(h)};`,
        `float di = min(max(cyd, cyy), 0.0) + length(max(vec2(cyd, cyy), vec2(0.0)));`,
      );
      break;
    }

    default:
      lines.push(`float di = 1e9;`);
  }

  // ── CSG combination (same variable `di` in scope) ──────────────────────
  if (isFirst) {
    lines.push(`d = di; col = ${colorLit};`);
  } else {
    switch (op.mode) {
      case 'smooth': {
        const k = f(Math.max(0.001, op.blend ?? 0.08));
        lines.push(
          `float sw = clamp(0.5 + 0.5*(d - di)/${k}, 0.0, 1.0);`,
          `col = mix(${colorLit}, col, sw);`,
          `d = mix(d, di, sw) - ${k}*sw*(1.0-sw);`,
        );
        break;
      }
      case 'subtract':
        lines.push(`d = max(d, -di);  // subtract: keep base colour`);
        break;
      case 'intersect':
        lines.push(`if (di > d) { d = di; col = ${colorLit}; }`);
        break;
      default: // union
        lines.push(`if (di < d) { d = di; col = ${colorLit}; }`);
    }
  }

  // Wrap in a block so all local names are scoped — no cross-op collisions.
  return '  {\n    ' + lines.join('\n    ') + '\n  }';
}

// ── fBm warp (verbatim port of sdf-compiler.ts) ────────────────────────────

const FBM_GLSL = /* glsl */ `
float _hash3(vec3 p, float seed) {
  float h = p.x*127.1 + p.y*311.7 + p.z*74.7 + seed*53.3;
  return fract(sin(h) * 43758.5453);
}
float _vNoise(vec3 p, float seed) {
  vec3 i = floor(p); vec3 f = fract(p);
  vec3 u = f*f*(3.0-2.0*f);
  float c000=_hash3(i,             seed), c100=_hash3(i+vec3(1,0,0),seed);
  float c010=_hash3(i+vec3(0,1,0), seed), c110=_hash3(i+vec3(1,1,0),seed);
  float c001=_hash3(i+vec3(0,0,1), seed), c101=_hash3(i+vec3(1,0,1),seed);
  float c011=_hash3(i+vec3(0,1,1), seed), c111=_hash3(i+vec3(1,1,1),seed);
  float x00=mix(c000,c100,u.x), x10=mix(c010,c110,u.x);
  float x01=mix(c001,c101,u.x), x11=mix(c011,c111,u.x);
  return mix(mix(x00,x10,u.y), mix(x01,x11,u.y), u.z);
}
float _fbm(vec3 p, float freq, int oct, float seed) {
  float sum=0.0, norm=0.0, a=0.5; p*=freq;
  for (int i=0; i<8; i++) {
    if (i>=oct) break;
    sum += a*_vNoise(p, seed+float(i)*17.0);
    norm += a; p *= 2.0; a *= 0.5;
  }
  return norm>0.0 ? sum/norm : 0.5;
}
`.trim();

function emitWarp(warp: Warp): string {
  return [
    `  {`,
    `    float wn = _fbm(p, ${f(warp.freq)}, ${Math.max(1, Math.min(8, warp.octaves ?? 4))}, ${f(warp.seed ?? 0)});`,
    `    d -= ${f(warp.amp)} * (wn - 0.5) * 2.0;`,
    `  }`,
  ].join('\n');
}

// ── public API ─────────────────────────────────────────────────────────────

export interface CompiledGLSL {
  /** Drop this block verbatim before main() in the fragment shader. */
  glsl: string;
  metalness: number;
  roughness: number;
}

export function compileSdfGLSL(program: ShapeProgram): CompiledGLSL {
  const expanded = expandProgram(program);
  const ops = expanded.ops;
  const warp = expanded.warp;
  const needsFbm = warp && warp.amp > 0;

  const out: string[] = [];

  if (needsFbm) { out.push(FBM_GLSL, ''); }

  out.push('vec4 _sdfFull(vec3 p) {');
  out.push('  float d = 1e9;');
  out.push('  vec3 col = vec3(0.78, 0.78, 0.82);');

  ops.forEach((op, i) => {
    out.push(`  // op ${i}: ${op.prim} (${op.mode ?? 'union'})`);
    out.push(emitOpBlock(op, i === 0));
  });

  if (needsFbm) {
    out.push('  // fBm warp');
    out.push(emitWarp(warp!));
  }

  out.push('  return vec4(d, col);');
  out.push('}');
  out.push('');
  out.push('float sdf(vec3 p)      { return _sdfFull(p).x; }');
  out.push('vec3  sdfColor(vec3 p) { return _sdfFull(p).yzw; }');

  return {
    glsl: out.join('\n'),
    metalness: program.metalness ?? 0.15,
    roughness: program.roughness ?? 0.55,
  };
}
