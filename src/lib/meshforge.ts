/**
 * MeshForge — a local, free text-to-3D generator.
 *
 * Borrows the key stages of commercial generators (Meshy/Luma) without the API:
 *  1. Semantic parse    : prompt → structured ShapeSpec (LLM-assisted when the
 *                         local /api/chat endpoint is up, keyword parser otherwise)
 *  2. Geometry synthesis: seeded procedural generation — superformula surfaces,
 *                         lathe profiles, fBm noise displacement, vertex jitter
 *  3. Material synthesis: procedural canvas-painted PBR textures
 *  4. Export            : real .glb via three's GLTFExporter
 *
 * Same prompt + same seed → identical mesh (deterministic RNG).
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { aiChatSync } from './ai-providers';

export interface ShapeSpec {
  base: 'organic' | 'vessel' | 'crystal' | 'planet' | 'stack' | 'ring';
  colorA: string;
  colorB: string;
  metalness: number;   // 0..1
  roughness: number;   // 0..1
  distortion: number;  // 0..1 noise amplitude
  twist: number;       // 0..1
  emissive: boolean;
  texture: 'noise' | 'stripes' | 'splatter' | 'none';
  label: string;
}

// ——— deterministic RNG ———
export function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ——— 3D value noise + fBm (seeded) ———
function makeNoise(seed: number) {
  const lattice = (x: number, y: number, z: number) => {
    let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const noise3 = (x: number, y: number, z: number): number => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = smooth(x - xi), yf = smooth(y - yi), zf = smooth(z - zi);
    let v = 0;
    for (let dx = 0; dx <= 1; dx++)
      for (let dy = 0; dy <= 1; dy++)
        for (let dz = 0; dz <= 1; dz++) {
          const w = (dx ? xf : 1 - xf) * (dy ? yf : 1 - yf) * (dz ? zf : 1 - zf);
          v += w * lattice(xi + dx, yi + dy, zi + dz);
        }
    return v * 2 - 1;
  };
  const fbm = (x: number, y: number, z: number, octaves = 4): number => {
    let sum = 0, amp = 0.5, freq = 1;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise3(x * freq, y * freq, z * freq);
      amp *= 0.5; freq *= 2.03;
    }
    return sum;
  };
  return { noise3, fbm };
}

// ——— superformula (Gielis) — the parametric core behind many organic generators ———
function superformula(angle: number, m: number, n1: number, n2: number, n3: number): number {
  const t1 = Math.pow(Math.abs(Math.cos((m * angle) / 4)), n2);
  const t2 = Math.pow(Math.abs(Math.sin((m * angle) / 4)), n3);
  return Math.pow(t1 + t2, -1 / n1);
}

// ——— keyword parser (offline fallback for the semantic stage) ———
const BASE_WORDS: Record<ShapeSpec['base'], string[]> = {
  organic: ['blob', 'creature', 'alien', 'organism', 'coral', 'flower', 'star', 'shell', 'brain', 'monster', 'cell'],
  vessel: ['vase', 'cup', 'bottle', 'pot', 'urn', 'bowl', 'goblet', 'jar', 'lamp', 'chalice', 'amphora'],
  crystal: ['crystal', 'gem', 'diamond', 'shard', 'quartz', 'jewel', 'prism', 'mineral'],
  planet: ['planet', 'asteroid', 'moon', 'rock', 'boulder', 'meteor', 'stone', 'world', 'terrain'],
  stack: ['mushroom', 'rocket', 'tower', 'tree', 'chess', 'totem', 'pawn', 'lighthouse'],
  ring: ['ring', 'donut', 'torus', 'halo', 'hoop', 'bracelet', 'wreath'],
};

const COLOR_WORDS: Record<string, string> = {
  red: '#d5687f', crimson: '#c14b5f', orange: '#cc824a', gold: '#c99d3f', yellow: '#dcb35c',
  green: '#4fb158', emerald: '#43b384', teal: '#3caca4', cyan: '#43a8ca', blue: '#5a7dd6',
  indigo: '#7b8cfa', purple: '#9e79dd', violet: '#b394e8', pink: '#d38ad3', magenta: '#c46ec4',
  white: '#e2e6ee', silver: '#b4bccc', grey: '#8b94a7', gray: '#8b94a7', black: '#242a35',
  brown: '#8a6a4a', amber: '#c99d3f', lava: '#cc4a2a', ice: '#a8d4e6',
};

export function parsePromptLocally(prompt: string): ShapeSpec {
  const p = prompt.toLowerCase();
  const rng = mulberry32(hashSeed(prompt));

  let base: ShapeSpec['base'] = 'organic';
  outer: for (const [b, words] of Object.entries(BASE_WORDS)) {
    for (const w of words) if (p.includes(w)) { base = b as ShapeSpec['base']; break outer; }
  }

  const colors = Object.keys(COLOR_WORDS).filter(c => p.includes(c)).map(c => COLOR_WORDS[c]);
  const palette = ['#7b8cfa', '#43b384', '#dcb35c', '#d5687f', '#9e79dd', '#43a8ca'];
  const colorA = colors[0] ?? palette[Math.floor(rng() * palette.length)];
  const colorB = colors[1] ?? palette[Math.floor(rng() * palette.length)];

  const metal = /metal|chrome|gold|silver|steel|bronze|copper/.test(p);
  const glow = /glow|neon|emissive|radioactive|lava|plasma/.test(p);
  const spiky = /spik|sharp|jagged|thorn|rough|gnarl/.test(p);
  const smooth = /smooth|polished|sleek|soft/.test(p);
  const twisted = /twist|spiral|swirl|helix/.test(p);

  return {
    base,
    colorA,
    colorB,
    metalness: metal ? 0.9 : 0.15 + rng() * 0.2,
    roughness: smooth ? 0.12 : metal ? 0.3 : 0.55 + rng() * 0.3,
    distortion: spiky ? 0.8 : smooth ? 0.12 : 0.3 + rng() * 0.35,
    twist: twisted ? 0.7 : 0,
    emissive: glow,
    texture: /stripe|band/.test(p) ? 'stripes' : /splat|spot|dot|camo/.test(p) ? 'splatter' : /marble|noise|cloud/.test(p) ? 'noise' : 'none',
    label: prompt.slice(0, 48),
  };
}

// ——— procedural PBR texture (canvas-painted, seeded) ———
function makeTexture(spec: ShapeSpec, seed: number): THREE.CanvasTexture | null {
  if (spec.texture === 'none') return null;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rng = mulberry32(seed);
  const { fbm } = makeNoise(seed);

  ctx.fillStyle = spec.colorA;
  ctx.fillRect(0, 0, size, size);

  if (spec.texture === 'stripes') {
    ctx.fillStyle = spec.colorB;
    const bands = 6 + Math.floor(rng() * 8);
    for (let i = 0; i < bands; i++) {
      const y = (i / bands) * size;
      ctx.fillRect(0, y, size, size / bands / 2);
    }
  } else if (spec.texture === 'splatter') {
    ctx.fillStyle = spec.colorB;
    const blobs = 60 + Math.floor(rng() * 80);
    for (let i = 0; i < blobs; i++) {
      ctx.beginPath();
      ctx.arc(rng() * size, rng() * size, 2 + rng() * 18, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // noise / marble: per-pixel fBm blend between the two colors
    const img = ctx.getImageData(0, 0, size, size);
    const a = new THREE.Color(spec.colorA), b = new THREE.Color(spec.colorB);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const t = Math.min(1, Math.max(0, 0.5 + fbm(x / 90, y / 90, 0.5, 5)));
        const i = (y * size + x) * 4;
        img.data[i] = (a.r + (b.r - a.r) * t) * 255;
        img.data[i + 1] = (a.g + (b.g - a.g) * t) * 255;
        img.data[i + 2] = (a.b + (b.b - a.b) * t) * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeMaterial(spec: ShapeSpec, seed: number): THREE.MeshStandardMaterial {
  const map = makeTexture(spec, seed);
  return new THREE.MeshStandardMaterial({
    color: map ? '#ffffff' : spec.colorA,
    ...(map ? { map } : {}),
    metalness: spec.metalness,
    roughness: spec.roughness,
    emissive: spec.emissive ? spec.colorB : '#000000',
    emissiveIntensity: spec.emissive ? 0.9 : 0,
    flatShading: spec.base === 'crystal',
    side: THREE.DoubleSide,
  });
}

// ——— geometry synthesis ———
function displace(geo: THREE.BufferGeometry, seed: number, amp: number, freq = 1.6) {
  const { fbm } = makeNoise(seed);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm(v.x * freq, v.y * freq, v.z * freq, 4);
    const d = 1 + n * amp * 0.45;
    pos.setXYZ(i, v.x * d, v.y * d, v.z * d);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

function twistGeo(geo: THREE.BufferGeometry, amount: number) {
  if (!amount) return;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const angle = v.y * amount * Math.PI;
    const c = Math.cos(angle), s = Math.sin(angle);
    pos.setXYZ(i, v.x * c - v.z * s, v.y, v.x * s + v.z * c);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

function organicGeometry(rng: () => number, spec: ShapeSpec, seed: number): THREE.BufferGeometry {
  // Superformula sphere-mapping: two superformula profiles drive the radius
  const m1 = Math.floor(rng() * 9) + 2;
  const m2 = Math.floor(rng() * 7) + 2;
  const n1 = 0.4 + rng() * 2, n2 = 0.4 + rng() * 1.6, n3 = 0.4 + rng() * 1.6;
  const geo = new THREE.SphereGeometry(1, 96, 64);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const theta = Math.atan2(v.z, v.x);
    const phi = Math.asin(Math.max(-1, Math.min(1, v.y)));
    const r1 = superformula(theta, m1, n1, n2, n3);
    const r2 = superformula(phi, m2, n1, n2, n3);
    const r = Math.max(0.05, r1 * r2);
    pos.setXYZ(i, v.x * r, v.y * r, v.z * r);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  displace(geo, seed, spec.distortion * 0.7, 2.2);
  return geo;
}

function vesselGeometry(rng: () => number, spec: ShapeSpec, seed: number): THREE.BufferGeometry {
  // Lathe a randomized profile curve — neck, belly, foot
  const points: THREE.Vector2[] = [];
  const belly = 0.5 + rng() * 0.5;
  const neck = 0.12 + rng() * 0.25;
  const height = 1.4 + rng() * 0.8;
  const raw = [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(0.3 + rng() * 0.2, 0),
    new THREE.Vector2(belly * (0.7 + rng() * 0.3), height * 0.25),
    new THREE.Vector2(belly, height * (0.4 + rng() * 0.15)),
    new THREE.Vector2(neck + rng() * 0.1, height * 0.8),
    new THREE.Vector2(neck * (1.2 + rng() * 0.8), height),
  ];
  const curve = new THREE.SplineCurve(raw);
  curve.getPoints(48).forEach(p => points.push(new THREE.Vector2(Math.max(0.001, p.x), p.y)));
  const geo = new THREE.LatheGeometry(points, 80);
  geo.translate(0, -height / 2, 0);
  if (spec.distortion > 0.5) displace(geo, seed, spec.distortion * 0.25, 3);
  twistGeo(geo, spec.twist * 0.4);
  return geo;
}

function crystalGeometry(rng: () => number, spec: ShapeSpec): THREE.BufferGeometry {
  // Jittered icosahedron cluster → faceted shards
  const geos: THREE.BufferGeometry[] = [];
  const shards = 3 + Math.floor(rng() * 4);
  for (let s = 0; s < shards; s++) {
    const g = new THREE.IcosahedronGeometry(0.35 + rng() * 0.5, 0);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const jitter = 0.15 + spec.distortion * 0.3;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i,
        pos.getX(i) * (1 + (rng() - 0.5) * jitter),
        pos.getY(i) * (1.6 + rng() * 1.2),
        pos.getZ(i) * (1 + (rng() - 0.5) * jitter));
    }
    g.rotateZ((rng() - 0.5) * 0.9);
    g.rotateY(rng() * Math.PI * 2);
    g.translate((rng() - 0.5) * 0.8, (rng() - 0.3) * 0.4, (rng() - 0.5) * 0.8);
    geos.push(g);
  }
  return mergeGeometries(geos);
}

function planetGeometry(rng: () => number, spec: ShapeSpec, seed: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 24); // 20·25² = 12.5k faces before displacement
  displace(geo, seed, 0.35 + spec.distortion * 0.8, 1.1 + rng() * 1.4);
  return geo;
}

function stackGeometry(rng: () => number, spec: ShapeSpec, seed: number): THREE.BufferGeometry {
  // Stacked solids of revolution — totems, rockets, mushrooms, pawns
  const parts: THREE.BufferGeometry[] = [];
  let y = -0.9;
  const segments = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < segments; i++) {
    const kind = rng();
    const h = 0.35 + rng() * 0.6;
    let g: THREE.BufferGeometry;
    if (kind < 0.35) g = new THREE.CylinderGeometry(0.18 + rng() * 0.3, 0.25 + rng() * 0.35, h, 40);
    else if (kind < 0.7) g = new THREE.SphereGeometry(0.3 + rng() * 0.3, 40, 24).scale(1, h, 1);
    else g = new THREE.ConeGeometry(0.3 + rng() * 0.35, h * 1.4, 40);
    g.translate(0, y + h / 2, 0);
    y += h * 0.92;
    parts.push(g);
  }
  const geo = mergeGeometries(parts);
  if (spec.distortion > 0.45) displace(geo, seed, spec.distortion * 0.2, 3.5);
  twistGeo(geo, spec.twist * 0.5);
  return geo;
}

function ringGeometry(rng: () => number, spec: ShapeSpec, seed: number): THREE.BufferGeometry {
  const geo = new THREE.TorusGeometry(0.9, 0.18 + rng() * 0.22, 32, 120);
  displace(geo, seed, spec.distortion * 0.4, 2.5);
  twistGeo(geo, spec.twist);
  return geo;
}

// Minimal geometry merge (positions + uvs, recomputed normals)
function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const nonIndexed = geos.map(g => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  nonIndexed.forEach(g => { total += g.attributes.position.count; });
  const posArr = new Float32Array(total * 3);
  const uvArr = new Float32Array(total * 2);
  let offset = 0;
  nonIndexed.forEach(g => {
    posArr.set((g.attributes.position as THREE.BufferAttribute).array as Float32Array, offset * 3);
    if (g.attributes.uv) uvArr.set((g.attributes.uv as THREE.BufferAttribute).array as Float32Array, offset * 2);
    offset += g.attributes.position.count;
  });
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  merged.computeVertexNormals();
  return merged;
}

// ——— main entry ———
export function generateModel(prompt: string, spec: ShapeSpec): { group: THREE.Group; triangles: number } {
  const seed = hashSeed(prompt);
  const rng = mulberry32(seed);

  let geo: THREE.BufferGeometry;
  switch (spec.base) {
    case 'vessel': geo = vesselGeometry(rng, spec, seed); break;
    case 'crystal': geo = crystalGeometry(rng, spec); break;
    case 'planet': geo = planetGeometry(rng, spec, seed); break;
    case 'stack': geo = stackGeometry(rng, spec, seed); break;
    case 'ring': geo = ringGeometry(rng, spec, seed); break;
    default: geo = organicGeometry(rng, spec, seed);
  }

  const mesh = new THREE.Mesh(geo, makeMaterial(spec, seed));
  mesh.name = spec.label || 'meshforge-model';
  const group = new THREE.Group();
  group.name = 'MeshForge';
  group.add(mesh);

  const posCount = geo.attributes.position.count;
  const triangles = Math.round((geo.index ? geo.index.count : posCount) / 3);
  return { group, triangles };
}

export function exportGLB(group: THREE.Group): Promise<Blob> {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      group,
      result => resolve(new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' })),
      err => reject(err),
      { binary: true },
    );
  });
}

/** Ask the AI provider chain to do the semantic parse; falls back to keywords. */
export async function parsePromptWithAI(prompt: string): Promise<{ spec: ShapeSpec; source: 'ai' | 'local' }> {
  const fallback = parsePromptLocally(prompt);
  try {
    const { text } = await aiChatSync(
      `Convert this 3D model description into JSON. Reply with ONLY a JSON object, no prose, no code fences. Schema: {"base":"organic|vessel|crystal|planet|stack|ring","colorA":"#hex","colorB":"#hex","metalness":0-1,"roughness":0-1,"distortion":0-1,"twist":0-1,"emissive":bool,"texture":"noise|stripes|splatter|none","label":"short name"}. Description: "${prompt}"`,
      '3d-generator',
      9000,
    );
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('no json');
    const raw = JSON.parse(match[0]);
    const bases: ShapeSpec['base'][] = ['organic', 'vessel', 'crystal', 'planet', 'stack', 'ring'];
    const clamp = (x: unknown, d: number) => (typeof x === 'number' && isFinite(x) ? Math.min(1, Math.max(0, x)) : d);
    const hex = (x: unknown, d: string) => (typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x) ? x : d);
    return {
      source: 'ai',
      spec: {
        base: bases.includes(raw.base) ? raw.base : fallback.base,
        colorA: hex(raw.colorA, fallback.colorA),
        colorB: hex(raw.colorB, fallback.colorB),
        metalness: clamp(raw.metalness, fallback.metalness),
        roughness: clamp(raw.roughness, fallback.roughness),
        distortion: clamp(raw.distortion, fallback.distortion),
        twist: clamp(raw.twist, fallback.twist),
        emissive: typeof raw.emissive === 'boolean' ? raw.emissive : fallback.emissive,
        texture: ['noise', 'stripes', 'splatter', 'none'].includes(raw.texture) ? raw.texture : fallback.texture,
        label: typeof raw.label === 'string' && raw.label ? raw.label.slice(0, 48) : fallback.label,
      },
    };
  } catch {
    return { spec: fallback, source: 'local' };
  }
}
