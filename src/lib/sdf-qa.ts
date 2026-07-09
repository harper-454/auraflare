/**
 * Pre-delivery QA pass — the model inspects its own output before the user
 * sees it (AssetForge doctrine: QA is the promotion blocker).
 *
 *   compile → offscreen render → lint (deterministic) → AI critique (vision
 *   when available, text otherwise) → refine with the findings → recompile
 *
 * One revision round, then ship whatever we have — QA improves the model,
 * it never blocks delivery.
 */
import * as THREE from 'three';
import {
  expandProgram, refineProgramWithAI, flattenProgram,
  type Assembly, type ShapeProgram, type PrimOp,
} from './sdf-compiler';
import { aiChatSync } from './ai-providers';

// ── offscreen snapshot ────────────────────────────────────────────────────────

/**
 * Render an unmounted group to a JPEG data URL (3/4 view). Must be called
 * BEFORE the group is added to the live scene. Returns null when WebGL is
 * unavailable (QA then runs text-only).
 */
export function renderSnapshot(group: THREE.Group, size = 448): string | null {
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(size, size);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#182032');
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(5, 6, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x8899ff, 0.5);
    fill.position.set(-4, -2, -5);
    scene.add(fill);
    scene.add(group);
    const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    cam.position.set(2.6, 2.0, 3.2);
    cam.lookAt(0, 0, 0);
    renderer.render(scene, cam);
    const url = renderer.domElement.toDataURL('image/jpeg', 0.82);
    scene.remove(group); // hand the group back untouched
    return url;
  } catch {
    return null;
  } finally {
    renderer?.dispose();
  }
}

// ── deterministic lint ────────────────────────────────────────────────────────

interface Box { min: THREE.Vector3; max: THREE.Vector3 }

function opRadius(op: PrimOp): number {
  if (op.size) return Math.max(Math.abs(op.size[0]), Math.abs(op.size[1]), Math.abs(op.size[2]));
  if (op.prim === 'torus') return (op.R ?? 0.5) + (op.r ?? 0.12);
  if (op.prim === 'cone') return Math.max(op.r ?? 0.3, op.h ?? 0.5);
  return op.r ?? 0.3;
}

function opsBox(ops: PrimOp[], scale = 1, offset: [number, number, number] = [0, 0, 0]): Box {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const op of ops) {
    const r = opRadius(op) * scale;
    for (let i = 0; i < 3; i++) {
      const c = op.pos[i] * scale + offset[i];
      min.setComponent(i, Math.min(min.getComponent(i), c - r));
      max.setComponent(i, Math.max(max.getComponent(i), c + r));
    }
  }
  return { min, max };
}

function contains(outer: Box, inner: Box): boolean {
  return inner.min.x >= outer.min.x && inner.max.x <= outer.max.x
    && inner.min.y >= outer.min.y && inner.max.y <= outer.max.y
    && inner.min.z >= outer.min.z && inner.max.z <= outer.max.z;
}

function assemblyBox(a: Assembly): Box {
  const expanded = expandProgram({ label: a.name, ops: a.ops, parts: a.parts, symmetries: a.symmetries });
  return opsBox(expanded.ops, a.place.scale ?? 1, a.place.pos);
}

/** Cheap, deterministic defect scan — no AI, runs in microseconds. */
export function lintProgram(program: ShapeProgram): string[] {
  const findings: string[] = [];
  const asms = program.assemblies ?? [];

  const flat = flattenProgram(program);
  const whole = opsBox(flat.ops);
  const overshoot = Math.max(
    Math.abs(whole.min.x), Math.abs(whole.max.x),
    Math.abs(whole.min.y), Math.abs(whole.max.y),
    Math.abs(whole.min.z), Math.abs(whole.max.z),
  );
  if (overshoot > 1.35) findings.push(`geometry overshoots the [-1.2,1.2] build volume (extent ${overshoot.toFixed(2)}) — scale placements down`);

  if (asms.length) {
    const baseBox = program.ops.length ? opsBox(program.ops) : null;
    const boxes = asms.map(assemblyBox);
    asms.forEach((a, i) => {
      if (a.motion && baseBox && contains(baseBox, boxes[i])) {
        findings.push(`moving part "${a.name}" is entirely inside the static base — invisible motion; move it proud of the surface or carve a window`);
      }
    });
    for (let i = 0; i < asms.length; i++) {
      for (let j = i + 1; j < asms.length; j++) {
        const d = Math.hypot(
          asms[i].place.pos[0] - asms[j].place.pos[0],
          asms[i].place.pos[1] - asms[j].place.pos[1],
          asms[i].place.pos[2] - asms[j].place.pos[2],
        );
        if (d < 0.02) findings.push(`parts "${asms[i].name}" and "${asms[j].name}" share the same placement — separate them`);
      }
    }
    const pistons = asms.filter(a => a.motion?.kind === 'piston');
    if (pistons.length >= 2 && new Set(pistons.map(p => (p.motion!.phase ?? 0).toFixed(2))).size === 1) {
      findings.push(`all ${pistons.length} pistons share one phase — stagger phases (k*1.57) for a firing order`);
    }
    const spinning = asms.filter(a => a.motion?.kind === 'spin');
    if (spinning.length >= 2 && new Set(spinning.map(s => Math.sign(s.motion!.rpm ?? 1))).size === 1 && /gear/i.test(spinning.map(s => s.name).join(' '))) {
      findings.push('meshing gears all spin the same direction — alternate rpm signs');
    }
  }
  return findings;
}

// ── AI critique + revision ────────────────────────────────────────────────────

const CRITIQUE_PROMPT = `You are the QA inspector of a 3D model factory. The image is a render of a procedurally generated model. Judge it against the request and list ONLY concrete, fixable defects — wrong proportions, missing or invisible parts, parts floating disconnected, moving parts hidden inside the body, too little surface detail. If it faithfully represents the request, reply exactly PASS. Otherwise reply with at most 5 terse numbered defects (no praise, no prose).`;

async function critiqueWithVision(promptText: string, snapshot: string): Promise<string | null> {
  try {
    const res = await fetch('/api/media/describe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: snapshot, prompt: `${CRITIQUE_PROMPT}\n\nTHE REQUEST: "${promptText}"` }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) return null;
    return String(data.description ?? '').trim() || null;
  } catch {
    return null;
  }
}

async function critiqueTextOnly(promptText: string, program: ShapeProgram): Promise<string | null> {
  try {
    const { text } = await aiChatSync(
      `You are the QA inspector of a 3D model factory. Below is the shape-program JSON for the request "${promptText}". List ONLY concrete defects (bad proportions vs reality, missing canonical parts, moving parts that can't be seen, motion specs that make no mechanical sense). Reply exactly PASS if acceptable, else at most 5 terse numbered defects.\n\n${JSON.stringify(program)}`,
      'sdf-qa-critique',
      45000,
    );
    return text.trim() || null;
  } catch {
    return null;
  }
}

export interface QAResult {
  program: ShapeProgram | null; // revised program, or null when the original passed/QA unavailable
  verdict: 'passed' | 'revised' | 'skipped';
  findings: string[];
}

/**
 * One QA round: lint + critique the compiled result, and when there are real
 * findings, ask the refine chain for a corrected program. Never throws.
 */
export async function qaReviewProgram(
  promptText: string,
  program: ShapeProgram,
  compiledGroup: THREE.Group,
): Promise<QAResult> {
  const findings = lintProgram(program);

  const snapshot = renderSnapshot(compiledGroup);
  const critique = snapshot ? await critiqueWithVision(promptText, snapshot) : null;
  const aiCritique = critique ?? await critiqueTextOnly(promptText, program);
  if (aiCritique && !/^\s*PASS\b/i.test(aiCritique)) {
    for (const line of aiCritique.split('\n').map(s => s.trim()).filter(s => /^\d/.test(s)).slice(0, 5)) {
      findings.push(line);
    }
  }

  if (!findings.length) return { program: null, verdict: aiCritique ? 'passed' : 'skipped', findings };

  const revised = await refineProgramWithAI(
    program,
    `QA found these defects — fix ALL of them, keep everything that already works, aim for maximum believable detail and correct rigging: ${findings.join('; ')}`,
  );
  return revised
    ? { program: revised, verdict: 'revised', findings }
    : { program: null, verdict: 'skipped', findings };
}
