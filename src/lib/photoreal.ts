/**
 * Photoreal engine — true generative 3D (the model class Luma/Meshy run).
 *
 *   text  → SDXL product shot (our worker) → fal.ai image-to-3D → textured GLB
 *   photo → fal.ai image-to-3D directly    → textured GLB
 *
 * The fal call happens server-side (/api/photoreal/generate) with the user's
 * key; the finished GLB lands in R2 and loads same-origin. Output meshes carry
 * real baked textures — cloth, hair, wood, dirt — because the generator is a
 * diffusion 3D model, not a primitive compiler. Costs the user's fal credits
 * (Hunyuan3D v2.1 ≈ $0.15 textured; Trellis-2 ≈ $0.25–0.35).
 */
import { getFalKey } from './ai-providers';
import { resultFromGlbBlob, type ForgeResult } from './forge-pipeline';

export const PHOTOREAL_MODELS = [
  { id: 'fal-ai/hunyuan3d-v21', label: 'Hunyuan3D 2.1 (~$0.15, fast)' },
  { id: 'fal-ai/trellis', label: 'TRELLIS (~$0.25)' },
  { id: 'fal-ai/trellis-2', label: 'TRELLIS 2 (~$0.30, best)' },
] as const;

const PROD_ORIGIN = 'https://aura.massivenumber.com';

function absoluteMediaUrl(relative: string): string {
  // fal must be able to fetch the reference image from the public internet.
  // Media objects live in prod R2 regardless of which origin created them
  // (dev proxies /api/media/generate to prod), so the prod URL is always true.
  return relative.startsWith('http') ? relative : `${PROD_ORIGIN}${relative}`;
}

async function textToReferenceImage(prompt: string): Promise<string> {
  const res = await fetch('/api/media/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: `${prompt}, single object, centered, full view, studio product photography, plain light grey background, soft even lighting, high detail`,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `reference image ${res.status}`);
  return absoluteMediaUrl(String(data.url));
}

export type PhotorealStage = 'reference' | 'generating' | 'loading';

/**
 * Run the photoreal pipeline. `input` is a prompt (text→image→3D) or an
 * uploaded photo as a data URL (image→3D directly). Throws with a pointed
 * message when no fal key is configured.
 */
export async function forgePhotoreal(
  input: { prompt?: string; imageDataUrl?: string },
  model: string = PHOTOREAL_MODELS[0].id,
  onStage?: (stage: PhotorealStage) => void,
): Promise<ForgeResult> {
  const falKey = getFalKey();
  if (!falKey) throw new Error('Photoreal needs a fal.ai key — paste one in Settings → AI → Photoreal 3D (keys: fal.ai/dashboard/keys)');

  let imageUrl: string;
  if (input.imageDataUrl) {
    imageUrl = input.imageDataUrl; // fal accepts data URIs directly
  } else if (input.prompt) {
    onStage?.('reference');
    imageUrl = await textToReferenceImage(input.prompt);
  } else {
    throw new Error('photoreal: prompt or image required');
  }

  onStage?.('generating');
  const res = await fetch('/api/photoreal/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ falKey, model, imageUrl, textured: true }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `photoreal ${res.status}`);

  onStage?.('loading');
  const glbRes = await fetch(String(data.url));
  if (!glbRes.ok) throw new Error(`GLB fetch ${glbRes.status}`);
  const blob = await glbRes.blob();
  return resultFromGlbBlob(blob, (input.prompt ?? 'photoreal model').slice(0, 48));
}
