/**
 * 3D engine smoke test — run with `npm run smoke:3d` (tsx, no browser needed).
 *
 * Enforces the MASTERPLAN standing rule: every 3D change re-runs this suite.
 * It verifies the parts that run in Node — the CPU polygonizer, the expand/
 * sanitize DSL, and the GPU op-packing layout. The GPU render path itself needs
 * a real WebGPU browser (see the post-deploy browser check); this suite proves
 * the CPU formulations the WGSL kernel mirrors are sound, that every showcase
 * program now qualifies for the GPU fast path, and that packOps writes each
 * primitive's params into the exact float slots the WGSL kernel reads.
 */
import {
  compileProgram, evaluateFieldCPU, expandProgram,
  sanitizeProgram, flattenProgram, totalProgramOps, validateProgramFeatures, BOUND,
  type ShapeProgram, type PrimKind,
} from '../src/lib/sdf-compiler';
import { packOps, PRIM_ID } from '../src/lib/sdf-gpu';
import { buildAnimationClips, applyAnimators, type Animator } from '../src/lib/sdf-assembly';
import * as THREE from 'three';

// Fixture programs (the former UI presets — cut from the product, kept here
// because together they exercise every primitive, smooth blends, subtract,
// rotations, parts + radial symmetry, and both material extremes).
const FIXTURES: Record<string, ShapeProgram> = {
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
    label: 'crystal cluster',
    metalness: 0.85,
    roughness: 0.15,
    parts: [
      { name: 'shard', ops: [
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
    label: 'six-petal flower',
    roughness: 0.6,
    parts: [
      { name: 'petal', ops: [
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

let failures = 0;
const ok = (cond: boolean, msg: string) => {
  if (cond) { console.log(`  ✓ ${msg}`); }
  else { console.error(`  ✗ ${msg}`); failures++; }
};

const FLOATS_PER_OP = 24;
const EPS = 1e-3;
// The kernel supports all 8 prims; this mirrors compileProgramAuto's gate.
const GPU_PRIMS = new Set<PrimKind>(['sphere', 'box', 'capsule', 'torus', 'ellipsoid', 'cone', 'hex', 'octahedron']);
const gpuEligible = (p: ShapeProgram) => {
  const e = expandProgram(p);
  return e.ops.length <= 96 && e.ops.every(o => GPU_PRIMS.has(o.prim));
};

function meshPositions(group: import('three').Group): Float32Array {
  let arr: Float32Array | null = null;
  group.traverse((o: any) => { if (o.isMesh && !arr) arr = o.geometry.getAttribute('position').array; });
  if (!arr) throw new Error('no mesh in group');
  return arr;
}

// ── 1. Every fixture polygonizes cleanly on the CPU (the formulas the GPU mirrors) ──
console.log('\n[1] CPU polygonization — all fixtures');
for (const [name, program] of Object.entries(FIXTURES)) {
  const { group, triangles } = compileProgram(program, 48);
  const pos = meshPositions(group);
  let finite = true, inBounds = true;
  for (let i = 0; i < pos.length; i++) {
    if (!Number.isFinite(pos[i])) finite = false;
    if (Math.abs(pos[i]) > BOUND + EPS) inBounds = false;
  }
  ok(triangles > 100 && finite && inBounds,
    `${name}: ${triangles} tris, finite=${finite}, in-bounds=${inBounds}`);
}

// ── 2. fBm warp path (now GPU-accelerated) stays finite on the CPU reference ──
console.log('\n[2] Warp modifier — field stays finite');
const warped: ShapeProgram = {
  label: 'warped-rock',
  ops: [{ prim: 'sphere', mode: 'union', color: '#8a7a5a', pos: [0, 0, 0], r: 0.7 }],
  warp: { amp: 0.12, freq: 7, octaves: 4, seed: 3 },
};
const field = evaluateFieldCPU(warped, 40);
ok(field.every(v => Number.isFinite(v)), `warped field: ${field.length} samples all finite`);
const warpMesh = compileProgram(warped, 48);
ok(warpMesh.triangles > 100, `warped mesh: ${warpMesh.triangles} tris`);

// ── 3. GPU eligibility — the showcase programs now take the high-res GPU path ──
console.log('\n[3] GPU fast-path eligibility (was CPU-only before this change)');
ok(gpuEligible(FIXTURES.crystal), `crystal (cone+hex+octahedron) → GPU, ${expandProgram(FIXTURES.crystal).ops.length} expanded ops`);
ok(gpuEligible(FIXTURES.flower), `flower (radial symmetry) → GPU, ${expandProgram(FIXTURES.flower).ops.length} expanded ops`);
ok(gpuEligible(warped), 'warped-rock (fBm warp) → GPU');

// ── 4. packOps writes each primitive's params into the slots the WGSL kernel reads ──
console.log('\n[4] GPU op-packing layout (prim id @0, pos @4-6, params @20-23)');
const packOne = (op: any) => packOps({ label: 't', ops: [op] });
{
  const p = packOne({ prim: 'cone', mode: 'union', color: '#ffffff', pos: [0.1, 0.2, 0.3], r: 0.33, h: 0.62 });
  ok(p.length === FLOATS_PER_OP, 'cone packs to 24 floats');
  ok(p[0] === PRIM_ID.cone && p[0] === 5, 'cone prim id = 5');
  ok(Math.abs(p[4] - 0.1) < 1e-6 && Math.abs(p[5] - 0.2) < 1e-6 && Math.abs(p[6] - 0.3) < 1e-6, 'cone pos @4-6');
  ok(Math.abs(p[20] - 0.33) < 1e-6 && Math.abs(p[21] - 0.62) < 1e-6, 'cone r@20, h@21');
}
{
  const p = packOne({ prim: 'hex', mode: 'union', color: '#ffffff', pos: [0, 0, 0], size: [0.44, 0.18, 0.44] });
  ok(p[0] === PRIM_ID.hex && p[0] === 6, 'hex prim id = 6');
  ok(Math.abs(p[20] - 0.44) < 1e-6 && Math.abs(p[21] - 0.18) < 1e-6, 'hex radial@20, half-height@21');
}
{
  const p = packOne({ prim: 'octahedron', mode: 'union', color: '#ffffff', pos: [0, 0, 0], r: 0.41 });
  ok(p[0] === PRIM_ID.octahedron && p[0] === 7, 'octahedron prim id = 7');
  ok(Math.abs(p[20] - 0.41) < 1e-6, 'octahedron r@20');
}
{
  const p = packOne({ prim: 'sphere', mode: 'union', color: '#ffffff', pos: [0, 0, 0], r: 0.5 });
  ok(p[0] === 0 && Math.abs(p[20] - 0.5) < 1e-6, 'sphere regression: id 0, r@20');
}

// ── 5. Sanitizer accepts the new primitives + DSL ──
console.log('\n[5] Sanitizer round-trips new prims + symmetry DSL');
const raw = {
  label: 'gem tower',
  ops: [
    { prim: 'octahedron', mode: 'union', color: '#7b6cf0', pos: [0, 0, 0], r: 0.4 },
    { prim: 'cone', mode: 'union', color: '#9a8af5', pos: [0, 0.5, 0], r: 0.1, h: 0.4 },
    { prim: 'hex', mode: 'union', color: '#3a2e7a', pos: [0, -0.5, 0], size: [0.5, 0.12, 0.5] },
  ],
  warp: { amp: 0.05, freq: 6 },
  parts: [{ name: 'spike', ops: [{ prim: 'cone', mode: 'union', color: '#fff', pos: [0, 0, 0], r: 0.05, h: 0.2 }] }],
  symmetries: [{ kind: 'radial', of: 'spike', count: 6, radius: 0.5, axis: 'y', spin: true }],
};
const clean = sanitizeProgram(raw, 'fallback');
ok(!!clean, 'sanitize returns a program');
ok(clean!.ops.length === 3 && clean!.ops.map(o => o.prim).join(',') === 'octahedron,cone,hex', 'all 3 new prims survive');
ok(!!clean!.warp && clean!.warp.amp === 0.05, 'warp survives');
ok(!!clean!.symmetries && clean!.symmetries.length === 1, 'radial symmetry survives');
ok(gpuEligible(clean!), 'sanitized gem tower is GPU-eligible');

// ── 6. Articulated assemblies — sanitize, flatten, animate, bake clips ──
console.log('\n[6] Assemblies (moving parts)');
const rawWatch = {
  label: 'test watch',
  ops: [{ prim: 'hex', mode: 'union', color: '#c0c4cc', pos: [0, 0, 0], size: [0.9, 0.1, 0.9] }],
  assemblies: [
    {
      name: 'Second Hand!',
      ops: [{ prim: 'box', mode: 'union', color: '#d94040', pos: [0.5, 0, 0], size: [0.5, 0.03, 0.03] }],
      place: { pos: [0, 0.12, 0], scale: 0.8 },
      motion: { kind: 'spin', axis: 'y', rpm: 12 },
    },
    {
      name: 'gear-a',
      ops: [{ prim: 'hex', mode: 'union', color: '#dcb35c', pos: [0, 0, 0], size: [0.8, 0.15, 0.8] }],
      parts: [{ name: 'tooth', ops: [{ prim: 'box', mode: 'union', color: '#dcb35c', pos: [0, 0, 0], size: [0.12, 0.12, 0.08] }] }],
      symmetries: [{ kind: 'radial', of: 'tooth', count: 8, radius: 0.9, axis: 'y', spin: true }],
      place: { pos: [0.4, -0.2, 0.3], rot: [90, 0, 0], scale: 0.25 },
      motion: { kind: 'spin', axis: 'y', rpm: -24 },
      metalness: 0.85,
    },
    {
      name: 'piston-1',
      ops: [{ prim: 'capsule', mode: 'union', color: '#8b94a7', pos: [0, -0.4, 0], size: [0, 0.8, 0], r: 0.25 }],
      place: { pos: [-0.5, 0.2, -0.3], scale: 0.3 },
      motion: { kind: 'piston', axis: 'y', dist: 0.4, freq: 2, phase: 1.57 },
    },
  ],
};
const watch = sanitizeProgram(rawWatch, 'fallback');
ok(!!watch && (watch.assemblies?.length ?? 0) === 3, `sanitize keeps 3 assemblies (name slugged: "${watch?.assemblies?.[0].name}")`);
ok(watch!.assemblies![0].name === 'second-hand', 'assembly names are slugged unique');
ok(watch!.assemblies![1].motion?.kind === 'spin' && watch!.assemblies![1].motion?.rpm === -24, 'negative rpm (meshing gear) survives');
ok(totalProgramOps(watch!) === 4, `totalProgramOps counts base + assemblies (${totalProgramOps(watch!)})`);

const flat = flattenProgram(watch!);
ok(!flat.assemblies && flat.ops.length >= 4, `flatten bakes assemblies to ${flat.ops.length} static ops`);
const gearOps = flat.ops.filter(o => o.color === '#dcb35c');
ok(gearOps.length === 9, `radial gear teeth expanded + placed (${gearOps.length} ops)`);
ok(gearOps.every(o => o.pos.every(v => Math.abs(v) <= BOUND + EPS)), 'flattened gear stays in bounds');
const flatMesh = compileProgram(flat, 40);
ok(flatMesh.triangles > 100, `flattened watch polygonizes: ${flatMesh.triangles} tris`);

// Animator math: spin + piston posed at t, clips bake from the same math.
const spinObj = new THREE.Group(); spinObj.name = 'asm_second-hand';
const pistObj = new THREE.Group(); pistObj.name = 'asm_piston-1';
const anims: Animator[] = [
  { object: spinObj, motion: watch!.assemblies![0].motion!, basePos: spinObj.position.clone() },
  { object: pistObj, motion: watch!.assemblies![2].motion!, basePos: pistObj.position.clone() },
];
applyAnimators(anims, 1.25); // 12 rpm → 90° at t=1.25s
ok(Math.abs(spinObj.rotation.y - Math.PI / 2) < 1e-6, `spin pose exact: 90° at 1.25 s (got ${(spinObj.rotation.y * 180 / Math.PI).toFixed(2)}°)`);
ok(Math.abs(pistObj.position.y - 0.4 * Math.sin(2 * Math.PI * 2 * 1.25 + 1.57)) < 1e-6, 'piston pose follows its sine');
const clips = buildAnimationClips(anims);
ok(clips.length === 1 && clips[0].tracks.length === 2, `one clip, ${clips[0]?.tracks.length} tracks`);
ok(clips[0].tracks[0].name === 'asm_second-hand.quaternion' && clips[0].tracks[1].name === 'asm_piston-1.position', 'track names target the motion groups');
ok(clips[0].duration >= 4.9, `clip covers the slowest period (${clips[0].duration.toFixed(1)} s)`);

console.log('\n[7] Cylinder primitive (CPU SDF, packing, alias mapping)');
const mugFixture: ShapeProgram = {
  label: 'mug',
  ops: [
    { prim: 'cylinder', mode: 'union', color: '#f5f5f0', pos: [0, -0.1, 0], r: 0.5, h: 0.55 },
    { prim: 'cylinder', mode: 'subtract', color: '#f5f5f0', pos: [0, 0.02, 0], r: 0.43, h: 0.55 },
    { prim: 'torus', mode: 'union', color: '#f5f5f0', pos: [0.58, -0.05, 0], rot: [90, 0, 0], R: 0.26, r: 0.06 },
  ],
};
const mugMesh = compileProgram(mugFixture, 48);
ok(mugMesh.triangles > 1000, `hollow mug (cylinder+subtract+torus) polygonizes: ${mugMesh.triangles} tris`);
{
  const p = packOps({ label: 't', ops: [{ prim: 'cylinder', mode: 'union', color: '#ffffff', pos: [0, 0, 0], r: 0.35, h: 0.5 }] });
  ok(p[0] === PRIM_ID.cylinder && p[0] === 8, 'cylinder prim id = 8');
  ok(Math.abs(p[20] - 0.35) < 1e-6 && Math.abs(p[21] - 0.5) < 1e-6, 'cylinder r@20, h@21');
}
{
  // aliases resolve instead of silently dropping (the blob-mug root cause)
  const aliased = sanitizeProgram({
    label: 'alias test',
    ops: [
      { prim: 'cylinder', mode: 'union', color: '#ffffff', pos: [0, 0, 0], r: 0.4, h: 0.5 },
      { prim: 'tube', mode: 'union', color: '#ffffff', pos: [0, 0, 0], r: 0.2, h: 0.4 },
      { prim: 'cube', mode: 'union', color: '#ffffff', pos: [0, 0, 0], size: [0.2, 0.2, 0.2] },
      { prim: 'ring', mode: 'union', color: '#ffffff', pos: [0, 0, 0], R: 0.4, r: 0.1 },
      { prim: 'nonsense-shape', mode: 'union', color: '#ffffff', pos: [0, 0, 0], r: 0.3 },
    ],
  }, 'alias');
  ok(aliased!.ops.length === 4, `aliases mapped, junk dropped: ${aliased!.ops.length}/5 ops survive`);
  ok(aliased!.ops.map(o => o.prim).join(',') === 'cylinder,cylinder,box,torus', `alias kinds: ${aliased!.ops.map(o => o.prim).join(',')}`);
}

console.log('\n[8] Structural validator (the blob-mug backstop)');
{
  const blob: ShapeProgram = {
    label: 'mug',
    ops: [
      { prim: 'ellipsoid', mode: 'union', color: '#ffffff', pos: [0, 0, 0], size: [0.6, 0.4, 0.6] },
      { prim: 'capsule', mode: 'smooth', color: '#ffffff', pos: [-0.5, 0.2, 0], r: 0.1, size: [0.2, 0.6, 0] },
    ],
  };
  const blobFindings = validateProgramFeatures('a white coffee mug with a curved handle', blob);
  ok(blobFindings.length >= 2, `2-op blob-mug flagged: ${blobFindings.length} findings (cavity + handle + under-modeled)`);
  ok(blobFindings.some(f => f.includes('subtract')), 'missing cavity finding names the fix (subtract)');
  const goodFindings = validateProgramFeatures('a white coffee mug with a curved handle', { ...mugFixture, ops: [...mugFixture.ops, { prim: 'cylinder', mode: 'union', color: '#eee', pos: [0, -0.68, 0], r: 0.42, h: 0.04 }] });
  ok(goodFindings.length === 0, 'real mug program passes clean');
  ok(validateProgramFeatures('a stone sphere', { label: 's', ops: [{ prim: 'sphere', mode: 'union', color: '#888', pos: [0, 0, 0], r: 0.8 }] }).length === 0, 'simple prompt + simple program not over-flagged');
}

console.log(`\n${failures === 0 ? '✅ ALL 3D SMOKE TESTS PASSED' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
