/**
 * Articulated-assembly compiler — the "moving parts" layer on top of the SDF
 * pipeline. A ShapeProgram with `assemblies` compiles into a THREE.Group tree:
 *
 *   root
 *   ├─ base mesh                      (the program's static top-level ops)
 *   └─ place_<name>  (pos/rot/scale)  one per assembly
 *      └─ asm_<name>  (animated)      motion mutates THIS group each frame
 *         └─ polygonized part mesh
 *
 * Every assembly is polygonized SEPARATELY through compileProgramAuto, so:
 *   - each part gets its own full 144³ lattice — a part placed at scale 0.3
 *     carries ~3× the effective surface resolution of world-frame geometry;
 *   - each part gets its own material (brass gears inside a steel case);
 *   - each part can move without re-polygonizing anything.
 *
 * Motion runs two ways from ONE spec:
 *   - live: applyAnimators(animators, tSeconds) inside the viewport's useFrame;
 *   - baked: buildAnimationClips() emits THREE.AnimationClips sampled from the
 *     same math, exported into the .glb — the downloaded watch ticks in any
 *     glTF viewer.
 */
import * as THREE from 'three';
import type { Assembly, Motion, ShapeProgram } from './sdf-compiler';
import { compileProgramAuto } from './sdf-gpu';

export interface Animator {
  /** The asm_<name> group the motion mutates (child of the placement group). */
  object: THREE.Object3D;
  motion: Motion;
  /** Rest position — pistons offset from here so cycles never drift. */
  basePos: THREE.Vector3;
}

export interface AssemblyCompileResult {
  group: THREE.Group;
  animators: Animator[];
  clips: THREE.AnimationClip[];
  triangles: number;
  opCount: number;
  backend: 'gpu' | 'cpu';
  resolution: number;
  fieldMs: number;
  partCount: number;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'part';

/** Compile a program's static base + every assembly into one articulated group. */
export async function compileAssemblies(program: ShapeProgram): Promise<AssemblyCompileResult> {
  const root = new THREE.Group();
  root.name = (program.label || 'assembly-model').replace(/\W+/g, '-');

  let triangles = 0;
  let opCount = 0;
  let fieldMs = 0;
  let backend: 'gpu' | 'cpu' = 'gpu';
  let resolution = 0;
  let partCount = 0;

  if (program.ops.length) {
    const base = await compileProgramAuto({ ...program, assemblies: undefined });
    base.group.name = 'base';
    root.add(base.group);
    triangles += base.triangles;
    opCount += base.opCount;
    fieldMs += base.fieldMs;
    if (base.backend === 'cpu') backend = 'cpu';
    resolution = Math.max(resolution, base.resolution);
    partCount++;
  }

  const animators: Animator[] = [];
  for (const a of program.assemblies ?? []) {
    const sub = await compileProgramAuto({
      label: a.name,
      ops: a.ops,
      parts: a.parts,
      symmetries: a.symmetries,
      metalness: a.metalness ?? program.metalness,
      roughness: a.roughness ?? program.roughness,
    });

    // Inner group = the animation target, spinning about the part's local
    // origin (the pivot the planner placed). Outer group = static placement.
    const motionGroup = new THREE.Group();
    motionGroup.name = `asm_${slug(a.name)}`;
    motionGroup.add(sub.group);

    const placeGroup = new THREE.Group();
    placeGroup.name = `place_${slug(a.name)}`;
    placeGroup.position.set(a.place.pos[0], a.place.pos[1], a.place.pos[2]);
    if (a.place.rot) {
      placeGroup.rotation.set(
        (a.place.rot[0] * Math.PI) / 180,
        (a.place.rot[1] * Math.PI) / 180,
        (a.place.rot[2] * Math.PI) / 180,
      );
    }
    placeGroup.scale.setScalar(a.place.scale ?? 1);
    placeGroup.add(motionGroup);
    root.add(placeGroup);

    triangles += sub.triangles;
    opCount += sub.opCount;
    fieldMs += sub.fieldMs;
    if (sub.backend === 'cpu') backend = 'cpu';
    resolution = Math.max(resolution, sub.resolution);
    partCount++;

    if (a.motion) {
      animators.push({ object: motionGroup, motion: a.motion, basePos: motionGroup.position.clone() });
    }
  }

  return {
    group: root,
    animators,
    clips: buildAnimationClips(animators),
    triangles,
    opCount,
    backend,
    resolution,
    fieldMs: Math.round(fieldMs * 10) / 10,
    partCount,
  };
}

/** Pose one animator at absolute time t (seconds). Pure function of t — safe to call every frame. */
function poseAt(a: Animator, t: number): void {
  const m = a.motion;
  if (m.kind === 'spin') {
    const angle = ((2 * Math.PI * (m.rpm ?? 10)) / 60) * t + (m.phase ?? 0);
    a.object.rotation.set(0, 0, 0);
    a.object.rotation[m.axis] = angle;
  } else if (m.kind === 'oscillate') {
    const angle = (((m.deg ?? 30) * Math.PI) / 180) * Math.sin(2 * Math.PI * (m.freq ?? 1) * t + (m.phase ?? 0));
    a.object.rotation.set(0, 0, 0);
    a.object.rotation[m.axis] = angle;
  } else {
    const off = (m.dist ?? 0.3) * Math.sin(2 * Math.PI * (m.freq ?? 1) * t + (m.phase ?? 0));
    a.object.position.copy(a.basePos);
    a.object.position[m.axis] += off;
  }
}

/** Drive every animator to time t — call from useFrame with clock.elapsedTime. */
export function applyAnimators(animators: Animator[], t: number): void {
  for (const a of animators) poseAt(a, t);
}

/**
 * Bake the animators into AnimationClips for glTF export. All motions share
 * one clip ("motion") so every viewer that auto-plays the first clip plays
 * everything. Sampled numerically at 30 Hz from the same poseAt() math that
 * drives the live viewport, over a duration covering each motion's period.
 */
export function buildAnimationClips(animators: Animator[]): THREE.AnimationClip[] {
  if (!animators.length) return [];

  const periodOf = (m: Motion): number => {
    if (m.kind === 'spin') return 60 / Math.max(0.5, Math.abs(m.rpm ?? 10));
    return 1 / Math.max(0.05, m.freq ?? 1);
  };
  // Long enough that slow parts complete a cycle, capped so files stay small.
  const duration = Math.min(12, Math.max(...animators.map(a => periodOf(a.motion)), 1));
  const fps = 30;
  const frames = Math.max(2, Math.round(duration * fps));

  const tracks: THREE.KeyframeTrack[] = [];
  const times = new Float32Array(frames + 1);
  for (let f = 0; f <= frames; f++) times[f] = (f / frames) * duration;

  const euler = new THREE.Euler();
  const quat = new THREE.Quaternion();
  for (const a of animators) {
    const isPiston = a.motion.kind === 'piston';
    const values = new Float32Array((frames + 1) * (isPiston ? 3 : 4));
    for (let f = 0; f <= frames; f++) {
      poseAt(a, times[f]);
      if (isPiston) {
        values[f * 3] = a.object.position.x;
        values[f * 3 + 1] = a.object.position.y;
        values[f * 3 + 2] = a.object.position.z;
      } else {
        euler.copy(a.object.rotation);
        quat.setFromEuler(euler);
        values[f * 4] = quat.x;
        values[f * 4 + 1] = quat.y;
        values[f * 4 + 2] = quat.z;
        values[f * 4 + 3] = quat.w;
      }
    }
    poseAt(a, 0); // leave the scene at rest pose
    tracks.push(
      isPiston
        ? new THREE.VectorKeyframeTrack(`${a.object.name}.position`, times as unknown as number[], values as unknown as number[])
        : new THREE.QuaternionKeyframeTrack(`${a.object.name}.quaternion`, times as unknown as number[], values as unknown as number[]),
    );
  }

  return [new THREE.AnimationClip('motion', duration, tracks)];
}
