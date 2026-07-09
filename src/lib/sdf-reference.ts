/**
 * Reference grounding — before composing a model, pull real photos of the
 * described object from the web (Wikimedia Commons: keyless, CORS-enabled,
 * openly licensed), tile them into one contact sheet, and have the vision
 * model distill the CONSENSUS across them — the "average of photos" — into
 * terse reference notes (canonical parts, relative proportions, materials).
 * Those notes ground the plan pass, the geometry pass, and the QA critique.
 *
 * When the web yields nothing (offline, obscure subject), fall back to
 * GENERATED reference imagery (SDXL on the worker), per the owner's
 * "photos pulled online, or generated images if not online" directive.
 */

export interface ReferenceGrounding {
  notes: string | null;              // consensus notes for the LLM (null = ungrounded)
  mode: 'online' | 'generated' | 'none';
  count: number;                     // reference images actually used
  sources: string[];                 // photo URLs (attribution/debugging)
  sheet: string | null;              // contact-sheet data URL (QA reuse)
}

const NONE: ReferenceGrounding = { notes: null, mode: 'none', count: 0, sources: [], sheet: null };

const STOPWORDS = new Set(['a', 'an', 'the', 'with', 'and', 'of', 'its', 'that', 'has', 'have', 'having', 'in', 'on', 'my', 'your', 'some', 'very', 'visible', 'moving', 'spinning', 'working', 'through']);

/**
 * A full prompt ("an antique brass pocket watch with three hands…") is a
 * terrible image-search query — every term must match. Build a ladder of
 * progressively shorter subjects and use the first that returns photos:
 * head noun phrase → last 3 content words → last 2 → last 1.
 */
function searchTermLadder(prompt: string): string[] {
  const head = prompt.toLowerCase().split(/,|\bwith\b|\bthat\b|\band\b/)[0];
  const content = head.replace(/[^a-z0-9\s-]/g, '').split(/\s+/).filter(w => w && !STOPWORDS.has(w));
  const ladder = [
    content.join(' '),
    content.slice(-3).join(' '),
    content.slice(-2).join(' '),
    content.slice(-1).join(' '),
  ].filter(Boolean);
  return [...new Set(ladder)];
}

/** Search Wikimedia Commons for photo thumbnails of the subject. */
async function searchCommons(term: string, want: number, signal: AbortSignal): Promise<string[]> {
  const url = 'https://commons.wikimedia.org/w/api.php'
    + '?action=query&format=json&origin=*'
    + `&generator=search&gsrsearch=${encodeURIComponent(`filetype:bitmap ${term}`)}`
    + '&gsrlimit=10&gsrnamespace=6&prop=imageinfo&iiprop=url|mime&iiurlwidth=512';
  const res = await fetch(url, { signal });
  if (!res.ok) return [];
  const data = await res.json();
  const pages = Object.values<any>(data?.query?.pages ?? {});
  return pages
    .map(p => p?.imageinfo?.[0])
    .filter(i => i && /image\/(jpeg|png)/.test(String(i.mime)) && i.thumburl)
    .map(i => String(i.thumburl))
    .slice(0, want);
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // Commons serves CORS headers; keeps the canvas readable
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Tile up to 4 reference images into one 2×2 sheet the VLM can read at once. */
async function buildContactSheet(urls: string[]): Promise<{ sheet: string; used: string[] } | null> {
  const images = (await Promise.all(urls.map(loadImage)))
    .map((img, i) => ({ img, url: urls[i] }))
    .filter((x): x is { img: HTMLImageElement; url: string } => !!x.img);
  if (images.length < 2) return null;
  const cell = 512;
  const canvas = document.createElement('canvas');
  canvas.width = cell * 2;
  canvas.height = cell * 2;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#101318';
  g.fillRect(0, 0, canvas.width, canvas.height);
  images.slice(0, 4).forEach(({ img }, i) => {
    const x = (i % 2) * cell, y = Math.floor(i / 2) * cell;
    // cover-fit each cell so proportions stay honest
    const s = Math.max(cell / img.width, cell / img.height);
    const w = img.width * s, h = img.height * s;
    g.save();
    g.beginPath();
    g.rect(x, y, cell, cell);
    g.clip();
    g.drawImage(img, x + (cell - w) / 2, y + (cell - h) / 2, w, h);
    g.restore();
  });
  try {
    return { sheet: canvas.toDataURL('image/jpeg', 0.82), used: images.slice(0, 4).map(x => x.url) };
  } catch {
    return null; // tainted canvas (a non-CORS image slipped through)
  }
}

/** Generate reference imagery on the worker when the web has nothing. */
async function generatedReferences(term: string, signal: AbortSignal): Promise<string[]> {
  const angles = ['studio product photo, three-quarter view', 'side profile view, plain background'];
  const urls: string[] = [];
  for (const angle of angles) {
    try {
      const res = await fetch('/api/media/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({ prompt: `reference photo of ${term}, ${angle}, realistic, well lit` }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) urls.push(String(data.url));
    } catch { /* offline/dev — skip */ }
  }
  return urls;
}

const NOTES_PROMPT = 'This sheet tiles multiple reference photos of the SAME kind of object. Distill the CONSENSUS across them (ignore outliers): 1) canonical parts every example shares, 2) relative proportions as rough numbers (e.g. "dial diameter ~5x hand width"), 3) typical colors/materials, 4) which parts move and how. At most 8 terse lines, no prose.';

async function extractNotes(sheet: string, term: string): Promise<string | null> {
  try {
    const res = await fetch('/api/media/describe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: sheet, prompt: `${NOTES_PROMPT}\nThe object: "${term}"` }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) return null;
    const notes = String(data.description ?? '').trim();
    return notes || null;
  } catch {
    return null;
  }
}

/**
 * Full grounding pass. Never throws; degrades to {mode:'none'} so generation
 * proceeds ungrounded rather than blocked.
 */
export async function getReferenceGrounding(term: string, timeoutMs = 15000): Promise<ReferenceGrounding> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let mode: ReferenceGrounding['mode'] = 'online';
    let urls: string[] = [];
    for (const candidate of searchTermLadder(term)) {
      try { urls = await searchCommons(candidate, 6, controller.signal); } catch { urls = []; }
      if (urls.length >= 2) break;
    }

    let tiled = urls.length >= 2 ? await buildContactSheet(urls) : null;
    if (!tiled) {
      const gen = await generatedReferences(term, controller.signal);
      tiled = gen.length ? await buildContactSheet(gen) : null;
      mode = 'generated';
    }
    if (!tiled) return NONE;

    const notes = await extractNotes(tiled.sheet, term);
    return { notes, mode, count: tiled.used.length, sources: tiled.used, sheet: tiled.sheet };
  } catch {
    return NONE;
  } finally {
    clearTimeout(timer);
  }
}
