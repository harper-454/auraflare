/**
 * The forge pipeline as a reusable module — ONE code path shared by the
 * interactive viewport, the Batch Forge queue, the program cache, and
 * gallery reloads. This is the "stop burning credits" layer:
 *
 *   - Program cache: any prompt forged before recompiles from localStorage
 *     with ZERO AI calls (the SDF program is tiny JSON — the mesh is derived).
 *   - Batch mode runs the whole grounded factory per prompt unattended and
 *     persists every artifact (animated .glb + snapshot + program + QA report)
 *     to the media gallery (R2 in prod, disk in dev) — results accumulate
 *     into a library instead of evaporating on reload.
 *   - fast mode (qa:false) halves the AI spend per model when quantity
 *     matters more than the inspection round.
 */
import * as THREE from 'three';
import {
  composeWithAI, composeComplexWithAI, wantsComplexCompose, buildPreviewProgram,
  sanitizeProgram, type ShapeProgram,
} from './sdf-compiler';
import { compileProgramAuto } from './sdf-gpu';
import { compileAssemblies, type Animator } from './sdf-assembly';
import { qaReviewProgram, renderSnapshot } from './sdf-qa';
import { getReferenceGrounding } from './sdf-reference';
import { exportGLB } from './meshforge';

export type ForgeStage = 'cache' | 'referencing' | 'composing' | 'compiling' | 'inspecting' | 'exporting';

export interface ForgeOptions {
  ground?: boolean;   // pull reference photos (default true)
  qa?: boolean;       // pre-delivery inspection round (default true)
  useCache?: boolean; // reuse/store the program cache (default true)
}

export interface ForgeResult {
  program: ShapeProgram | null;
  group: THREE.Group;
  animators: Animator[];
  clips: THREE.AnimationClip[];
  blob: Blob;
  snapshot: string | null;
  label: string;
  source: 'ai' | 'local' | 'cached';
  triangles: number;
  opCount: number;
  backend: 'gpu' | 'cpu';
  resolution: number;
  fieldMs: number;
  parts?: number;
  moving?: number;
  qa?: 'passed' | 'revised' | 'skipped';
  ref?: string;
  qaFindings: string[];
}

// ── program cache ─────────────────────────────────────────────────────────────

const CACHE_KEY = 'aura-program-cache-v1';
const CACHE_MAX = 48;

function cacheKeyFor(prompt: string): string {
  return prompt.trim().toLowerCase().replace(/\s+/g, ' ');
}

function readCache(): Record<string, ShapeProgram> {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
}

export function cachedProgram(prompt: string): ShapeProgram | null {
  const hit = readCache()[cacheKeyFor(prompt)];
  return hit ? sanitizeProgram(hit, prompt.slice(0, 48)) : null;
}

export function storeCachedProgram(prompt: string, program: ShapeProgram): void {
  try {
    const cache = readCache();
    const keys = Object.keys(cache);
    if (keys.length >= CACHE_MAX) delete cache[keys[0]]; // oldest-insertion eviction
    cache[cacheKeyFor(prompt)] = program;
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch { /* quota — the cache is a luxury */ }
}

// ── compile (static or articulated) ──────────────────────────────────────────

export async function compileAnyProgram(p: ShapeProgram) {
  if (p.assemblies?.length) {
    const c = await compileAssemblies(p);
    return {
      group: c.group, triangles: c.triangles, opCount: c.opCount, backend: c.backend,
      resolution: c.resolution, fieldMs: c.fieldMs,
      parts: c.partCount as number | undefined, moving: c.animators.length as number | undefined,
      animators: c.animators, clips: c.clips,
    };
  }
  const c = await compileProgramAuto(p);
  return {
    group: c.group, triangles: c.triangles, opCount: c.opCount, backend: c.backend,
    resolution: c.resolution, fieldMs: c.fieldMs,
    parts: undefined as number | undefined, moving: undefined as number | undefined,
    animators: [] as Animator[], clips: [] as THREE.AnimationClip[],
  };
}

/** Compile a known program (cache/gallery) into a full ForgeResult — zero AI calls. */
export async function forgeFromProgram(program: ShapeProgram, source: ForgeResult['source']): Promise<ForgeResult> {
  const compiled = await compileAnyProgram(program);
  const blob = await exportGLB(compiled.group, compiled.clips);
  return {
    program, source, blob,
    snapshot: renderSnapshot(compiled.group),
    label: program.label,
    group: compiled.group, animators: compiled.animators, clips: compiled.clips,
    triangles: compiled.triangles, opCount: compiled.opCount, backend: compiled.backend,
    resolution: compiled.resolution, fieldMs: compiled.fieldMs,
    parts: compiled.parts, moving: compiled.moving,
    qaFindings: [],
  };
}

// ── the full pipeline ─────────────────────────────────────────────────────────

export async function forgeModel(
  prompt: string,
  opts: ForgeOptions = {},
  onStage?: (stage: ForgeStage) => void,
): Promise<ForgeResult> {
  const { ground = true, qa = true, useCache = true } = opts;

  if (useCache) {
    const hit = cachedProgram(prompt);
    if (hit) {
      onStage?.('cache');
      return forgeFromProgram(hit, 'cached');
    }
  }

  let refNotes: string | null = null;
  let refInfo: string | undefined;
  if (ground) {
    onStage?.('referencing');
    try {
      const g = await getReferenceGrounding(prompt);
      refNotes = g.notes;
      if (g.mode !== 'none') refInfo = `${g.mode} · ${g.count} photo${g.count === 1 ? '' : 's'}${g.notes ? '' : ' (notes unavailable)'}`;
    } catch { /* ungrounded is fine */ }
  }

  onStage?.('composing');
  const composed = (wantsComplexCompose(prompt) ? await composeComplexWithAI(prompt, refNotes) : null)
    ?? await composeWithAI(prompt, refNotes);
  let program = composed?.program ?? buildPreviewProgram(prompt);
  if (!program) throw new Error('no composer produced a program');

  onStage?.('compiling');
  let compiled = await compileAnyProgram(program);

  let verdict: ForgeResult['qa'];
  let qaFindings: string[] = [];
  if (qa && composed) {
    onStage?.('inspecting');
    try {
      const review = await qaReviewProgram(prompt, program, compiled.group, refNotes);
      verdict = review.verdict;
      qaFindings = review.findings;
      if (review.program) {
        program = review.program;
        compiled = await compileAnyProgram(program);
      }
    } catch { verdict = 'skipped'; }
  }

  if (composed) storeCachedProgram(prompt, program);

  onStage?.('exporting');
  const blob = await exportGLB(compiled.group, compiled.clips);
  return {
    program, blob,
    snapshot: renderSnapshot(compiled.group),
    label: program.label,
    source: composed ? 'ai' : 'local',
    group: compiled.group, animators: compiled.animators, clips: compiled.clips,
    triangles: compiled.triangles, opCount: compiled.opCount, backend: compiled.backend,
    resolution: compiled.resolution, fieldMs: compiled.fieldMs,
    parts: compiled.parts, moving: compiled.moving,
    qa: verdict, ref: refInfo, qaFindings,
  };
}

// ── gallery persistence (R2 in prod, disk in dev) ─────────────────────────────

export interface GalleryEntry {
  name: string;
  jsonKey: string;
  glbKey: string;
  jpgKey: string;
  created?: string;
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'model';

async function putMedia(key: string, body: Blob | string, type: string): Promise<void> {
  const res = await fetch(`/api/media/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': type },
    body,
  });
  if (!res.ok) throw new Error(`save ${key}: ${res.status}`);
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',');
  const mime = head.match(/data:(.*?);/)?.[1] ?? 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Persist a forged model's artifacts. Returns the gallery entry. */
export async function saveModelArtifacts(prompt: string, r: ForgeResult): Promise<GalleryEntry> {
  const base = `models/${slugify(r.label || prompt)}-${Date.now().toString(36)}`;
  const entry: GalleryEntry = { name: r.label || prompt, jsonKey: `${base}.json`, glbKey: `${base}.glb`, jpgKey: `${base}.jpg` };
  await putMedia(entry.glbKey, r.blob, 'model/gltf-binary');
  if (r.snapshot) await putMedia(entry.jpgKey, dataUrlToBlob(r.snapshot), 'image/jpeg');
  // octet-stream, NOT application/json: the dev server's global express.json()
  // middleware would consume a json-typed body before the raw file handler
  // runs, silently dropping the manifest.
  await putMedia(entry.jsonKey, JSON.stringify({
    prompt,
    name: entry.name,
    program: r.program,
    created: new Date().toISOString(),
    stats: {
      triangles: r.triangles, opCount: r.opCount, backend: r.backend, resolution: r.resolution,
      parts: r.parts, moving: r.moving, qa: r.qa, ref: r.ref, source: r.source,
    },
    qaFindings: r.qaFindings,
  }), 'application/octet-stream');
  return entry;
}

/** List saved models. Tolerates the dev server's flattened key names (models_x). */
export async function listGalleryModels(): Promise<GalleryEntry[]> {
  const res = await fetch('/api/media');
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({ items: [] }));
  const keys: string[] = (data.items ?? []).map((i: any) => String(i.key));
  return keys
    .filter(k => /^models[/_].*\.json$/.test(k))
    .map(jsonKey => {
      const stem = jsonKey.slice(0, -'.json'.length);
      return {
        name: stem.replace(/^models[/_]/, '').replace(/-[a-z0-9]+$/, '').replace(/-/g, ' '),
        jsonKey,
        glbKey: keys.includes(`${stem}.glb`) ? `${stem}.glb` : `${stem}.glb`,
        jpgKey: `${stem}.jpg`,
      };
    })
    .reverse();
}

/** Reload a saved model — recompiles from its stored program. Zero AI calls. */
export async function loadGalleryModel(jsonKey: string): Promise<{ result: ForgeResult; prompt: string } | null> {
  const res = await fetch(`/api/media/${encodeURIComponent(jsonKey)}`);
  if (!res.ok) return null;
  const text = await res.text();
  let saved: any;
  try { saved = JSON.parse(text); } catch { return null; }
  const program = sanitizeProgram(saved?.program, String(saved?.name ?? 'model'));
  if (!program) return null;
  const result = await forgeFromProgram(program, 'cached');
  return { result, prompt: String(saved?.prompt ?? program.label) };
}
