/**
 * Procedural PBR texture packs — real material character (wood grain, brushed
 * metal, cloth weave, plastic, stone, dirt) generated in-canvas at runtime.
 * Zero downloads, zero AI calls, deterministic per family; applied to the
 * UV-less SDF meshes through the triplanar shader (albedo + roughness).
 */
import * as THREE from 'three';

export type MaterialFamily = 'wood' | 'metal' | 'cloth' | 'plastic' | 'stone' | 'dirt';

export const MATERIAL_FAMILIES: MaterialFamily[] = ['wood', 'metal', 'cloth', 'plastic', 'stone', 'dirt'];

export interface TexturePack {
  map: THREE.Texture;
  roughnessMap: THREE.Texture;
  /** Base PBR knobs the pack expects (overridable by the program). */
  metalness: number;
  roughness: number;
  /** World units per tile for triplanar projection. */
  scale: number;
}

// ── deterministic value noise (no Math.random — packs must be reproducible) ──

function makeNoise(seed: number): (x: number, y: number) => number {
  const hash = (ix: number, iy: number) => {
    let h = (ix * 374761393 + iy * 668265263 + seed * 1442695040888963407) | 0;
    h = (h ^ (h >> 13)) | 0;
    h = Math.imul(h, 1274126177);
    return (((h ^ (h >> 16)) >>> 0) % 10000) / 10000;
  };
  return (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

function fbm(noise: (x: number, y: number) => number, x: number, y: number, octaves = 4): number {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) {
    v += amp * noise(x * f, y * f);
    amp *= 0.5;
    f *= 2;
  }
  return v;
}

// ── pack painters ─────────────────────────────────────────────────────────────

type Painter = (albedo: CanvasRenderingContext2D, rough: CanvasRenderingContext2D, size: number) => { metalness: number; roughness: number; scale: number };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function paintPixels(
  ctx: CanvasRenderingContext2D,
  size: number,
  fn: (x: number, y: number) => [number, number, number],
): void {
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * size + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

const PAINTERS: Record<MaterialFamily, Painter> = {
  wood: (albedo, rough, size) => {
    const noise = makeNoise(11);
    paintPixels(albedo, size, (x, y) => {
      // Long-grain rings: stretched fBm warped along x, quantized into growth bands.
      const g = fbm(noise, x / (size * 0.9), y / (size * 0.08), 4);
      const ring = 0.5 + 0.5 * Math.sin(g * 26 + y * 0.015);
      const streak = fbm(noise, x / 7, y / 90, 3);
      const tone = clamp01(0.42 + ring * 0.22 + streak * 0.16);
      return [Math.round(150 * tone + 60), Math.round(96 * tone + 34), Math.round(52 * tone + 14)];
    });
    paintPixels(rough, size, (x, y) => {
      const v = Math.round(190 + fbm(noise, x / 24, y / 6, 3) * 55);
      return [v, v, v];
    });
    return { metalness: 0.0, roughness: 1.0, scale: 1.1 };
  },

  metal: (albedo, rough, size) => {
    const noise = makeNoise(23);
    paintPixels(albedo, size, (x, y) => {
      // Brushed anisotropic streaks + faint machining bands.
      const streak = fbm(noise, x / 2.2, y / 140, 4);
      const band = 0.04 * Math.sin(y * 0.35);
      const tone = clamp01(0.72 + streak * 0.16 + band);
      const v = Math.round(tone * 205);
      return [v, v + 3, v + 6];
    });
    paintPixels(rough, size, (x, y) => {
      const v = Math.round(70 + fbm(noise, x / 2.5, y / 120, 3) * 70);
      return [v, v, v];
    });
    return { metalness: 0.9, roughness: 1.0, scale: 0.9 };
  },

  cloth: (albedo, rough, size) => {
    const noise = makeNoise(37);
    paintPixels(albedo, size, (x, y) => {
      // Plain-weave crosshatch: alternating warp/weft threads + fiber fuzz.
      const warp = 0.5 + 0.5 * Math.sin(x * Math.PI / 3.2);
      const weft = 0.5 + 0.5 * Math.sin(y * Math.PI / 3.2);
      const over = ((Math.floor(x / 3.2) + Math.floor(y / 3.2)) % 2) ? warp : weft;
      const fuzz = fbm(noise, x / 5, y / 5, 3) * 0.18;
      const tone = clamp01(0.55 + over * 0.28 + fuzz);
      return [Math.round(178 * tone + 40), Math.round(172 * tone + 38), Math.round(168 * tone + 40)];
    });
    paintPixels(rough, size, (x, y) => {
      const v = Math.round(215 + fbm(noise, x / 3, y / 3, 2) * 35);
      return [v, v, v];
    });
    return { metalness: 0.0, roughness: 1.0, scale: 0.45 };
  },

  plastic: (albedo, rough, size) => {
    const noise = makeNoise(51);
    paintPixels(albedo, size, (x, y) => {
      // Near-uniform with faint injection-mold flow lines.
      const flow = fbm(noise, x / 160, y / 30, 3) * 0.05;
      const v = Math.round(clamp01(0.93 + flow) * 235);
      return [v, v, v];
    });
    paintPixels(rough, size, (x, y) => {
      const speck = fbm(noise, x / 4, y / 4, 2);
      const v = Math.round(70 + speck * 45);
      return [v, v, v];
    });
    return { metalness: 0.02, roughness: 1.0, scale: 0.8 };
  },

  stone: (albedo, rough, size) => {
    const noise = makeNoise(67);
    paintPixels(albedo, size, (x, y) => {
      // Granite-ish blotches + darker veins where fBm crosses a threshold.
      const base = fbm(noise, x / 40, y / 40, 5);
      const vein = Math.abs(fbm(noise, x / 90 + 7, y / 90, 4) - 0.5) < 0.02 ? -0.22 : 0;
      const grit = fbm(noise, x / 4, y / 4, 2) * 0.12;
      const tone = clamp01(0.5 + base * 0.3 + vein + grit);
      const v = Math.round(tone * 190);
      return [v, v, Math.round(v * 0.96)];
    });
    paintPixels(rough, size, (x, y) => {
      const v = Math.round(180 + fbm(noise, x / 12, y / 12, 3) * 60);
      return [v, v, v];
    });
    return { metalness: 0.0, roughness: 1.0, scale: 1.3 };
  },

  dirt: (albedo, rough, size) => {
    const noise = makeNoise(83);
    paintPixels(albedo, size, (x, y) => {
      // Patchy soil: broad damp/dry blotches + pebbly speckle.
      const patch = fbm(noise, x / 55, y / 55, 4);
      const speck = fbm(noise, x / 3, y / 3, 2);
      const tone = clamp01(0.34 + patch * 0.3 + (speck > 0.72 ? 0.18 : 0));
      return [Math.round(128 * tone + 42), Math.round(96 * tone + 30), Math.round(66 * tone + 20)];
    });
    paintPixels(rough, size, (x, y) => {
      const v = Math.round(210 + fbm(noise, x / 8, y / 8, 2) * 45);
      return [v, v, v];
    });
    return { metalness: 0.0, roughness: 1.0, scale: 1.4 };
  },
};

// ── public API ────────────────────────────────────────────────────────────────

const packCache = new Map<MaterialFamily, TexturePack>();

export function getTexturePack(family: MaterialFamily, size = 256): TexturePack {
  const hit = packCache.get(family);
  if (hit) return hit;

  const albedoCanvas = document.createElement('canvas');
  const roughCanvas = document.createElement('canvas');
  albedoCanvas.width = albedoCanvas.height = size;
  roughCanvas.width = roughCanvas.height = size;
  const knobs = PAINTERS[family](albedoCanvas.getContext('2d')!, roughCanvas.getContext('2d')!, size);

  const map = new THREE.CanvasTexture(albedoCanvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;

  const pack: TexturePack = { map, roughnessMap, ...knobs };
  packCache.set(family, pack);
  return pack;
}

/** Guess a material family from free text (part role, hint, color name, prompt). */
export function inferMaterialFamily(text: string): MaterialFamily | null {
  const t = text.toLowerCase();
  if (/\b(wood|oak|pine|walnut|timber|plank|bark|mahogany|birch)\b/.test(t)) return 'wood';
  if (/\b(metal|steel|iron|brass|copper|chrome|aluminum|aluminium|bronze|silver|gold|titanium)\b/.test(t)) return 'metal';
  if (/\b(cloth|fabric|canvas|linen|cotton|wool|denim|silk|leather|clothing|shirt|dress|curtain)\b/.test(t)) return 'cloth';
  if (/\b(plastic|polymer|rubber|vinyl|acrylic)\b/.test(t)) return 'plastic';
  if (/\b(stone|rock|granite|marble|concrete|brick|ceramic|porcelain)\b/.test(t)) return 'stone';
  if (/\b(dirt|soil|mud|sand|earth|ground|rust|weathered)\b/.test(t)) return 'dirt';
  return null;
}
