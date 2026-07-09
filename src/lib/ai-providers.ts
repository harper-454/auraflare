/**
 * Client-side AI provider system for single-shot completions (3D compose /
 * refine, prompt parsing). The user brings their own model access as a list of
 * providers, tried in order — nothing is hardcoded to one vendor:
 *
 *   0. Gemini via Google OAuth — "Sign in with Google" (Settings → AI). The
 *      popup requests the generative-language scope; we call Gemini REST with
 *      the Bearer token. Always tried first when a token is present (owner
 *      rule: OAuth first, API keys second).
 *   1. The user's provider list, in order. Each entry is one of three wire
 *      formats: 'gemini' (Google REST), 'openai' (any OpenAI-compatible
 *      endpoint — ChatGPT, Openference, Ollama, LM Studio, vLLM, …), or
 *      'anthropic' (Claude Messages API with the CORS opt-in header).
 *      Templates for the common ones ship in PROVIDER_TEMPLATES; "Custom"
 *      is a blank openai-compatible entry, which also covers local LLMs.
 *   2. AuraFlare Cloud — the app's own server (/api/chat-sync → Workers AI:
 *      llama-3.3-70b-fast for structured 3D tasks, kimi-k2.6 for chat). The
 *      zero-config default and the always-on fallback. (Training our own
 *      model is the roadmap; this is "our model" until then.)
 *
 * Config persists in localStorage; the OAuth token in sessionStorage (Google
 * access tokens live ~1h — dropped on 401/403 so the chain moves on).
 */

export type ProviderKind = 'gemini' | 'openai' | 'anthropic';

export interface CustomProvider {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey?: string;
  model: string;
  enabled: boolean;
}

export interface ProviderSettings {
  providers: CustomProvider[];
  /** fal.ai key for the Photoreal 3D engine (image → textured GLB). */
  falKey?: string;
  /** Preferred photoreal model id (fal endpoint id). */
  photorealModel?: string;
}

const SETTINGS_KEY = 'aura-ai-providers-v2';
const LEGACY_KEY = 'aura-ai-providers';
const OAUTH_TOKEN_KEY = 'aura-gemini-oauth-token';

/** Prefill templates for the "Add provider" picker. `apiKey` left for the user. */
export const PROVIDER_TEMPLATES: Array<Omit<CustomProvider, 'id' | 'enabled' | 'apiKey'> & { hint: string; needsKey: boolean }> = [
  { name: 'Google Gemini', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-3.1-pro-preview', hint: 'API key from aistudio.google.com — or skip the key and use Sign in with Google above.', needsKey: true },
  { name: 'ChatGPT (OpenAI)', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.1', hint: 'API key from platform.openai.com.', needsKey: true },
  { name: 'Claude (Anthropic)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5', hint: 'API key from console.anthropic.com.', needsKey: true },
  { name: 'Openference', kind: 'openai', baseUrl: 'https://api.openference.com/v1', model: 'GLM-5.2', hint: 'Open-source models, one endpoint — key from openference.com → API Keys.', needsKey: true },
  { name: 'Ollama (local)', kind: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'llama3.3', hint: 'Local LLM — no key needed, just `ollama serve`.', needsKey: false },
  { name: 'LM Studio (local)', kind: 'openai', baseUrl: 'http://localhost:1234/v1', model: 'local-model', hint: 'Local LLM — enable the local server in LM Studio.', needsKey: false },
];

export function getProviderSettings(): ProviderSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.providers)) return parsed;
    }
  } catch { /* fall through to migration/default */ }

  // One-time migration from the v1 shape (single gemini/openference keys).
  const migrated: CustomProvider[] = [];
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || '{}');
    if (legacy.geminiApiKey) {
      migrated.push({ id: newId(), name: 'Google Gemini', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', apiKey: legacy.geminiApiKey, model: legacy.geminiModel || 'gemini-3.1-pro-preview', enabled: true });
    }
    if (legacy.openferenceKey) {
      migrated.push({ id: newId(), name: 'Openference', kind: 'openai', baseUrl: (legacy.openferenceBaseUrl || 'https://api.openference.com/v1'), apiKey: legacy.openferenceKey, model: legacy.openferenceModel || 'GLM-5.2', enabled: true });
    }
  } catch { /* ignore corrupt legacy config */ }
  const settings = { providers: migrated };
  if (migrated.length) localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  return settings;
}

export function saveProviderSettings(settings: ProviderSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function getFalKey(): string | null {
  return getProviderSettings().falKey?.trim() || null;
}

export function setFalKey(key: string | undefined): void {
  const s = getProviderSettings();
  saveProviderSettings({ ...s, falKey: key?.trim() || undefined });
}

export function getPhotorealModel(): string | null {
  return getProviderSettings().photorealModel || null;
}

export function setPhotorealModel(id: string | undefined): void {
  const s = getProviderSettings();
  saveProviderSettings({ ...s, photorealModel: id || undefined });
}

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `p-${Math.random().toString(36).slice(2, 10)}`;
}

export function setGeminiOAuthToken(token: string | null): void {
  if (token) sessionStorage.setItem(OAUTH_TOKEN_KEY, token);
  else sessionStorage.removeItem(OAUTH_TOKEN_KEY);
}

export function getGeminiOAuthToken(): string | null {
  return sessionStorage.getItem(OAUTH_TOKEN_KEY);
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try { return await run(controller.signal); } finally { clearTimeout(timer); }
}

async function callGemini(message: string, baseUrl: string, model: string, auth: { bearer?: string; apiKey?: string }, ms: number): Promise<string> {
  return withTimeout(ms, async signal => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth.bearer) headers['Authorization'] = `Bearer ${auth.bearer}`;
    if (auth.apiKey) headers['x-goog-api-key'] = auth.apiKey;
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers, signal,
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: message }] }] }),
    });
    if (!res.ok) throw new Error(`gemini ${res.status}`);
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('');
    if (!text.trim()) throw new Error('gemini empty reply');
    return text;
  });
}

async function callOpenAICompatible(message: string, p: CustomProvider, ms: number): Promise<string> {
  try {
    return await withTimeout(ms, async signal => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (p.apiKey) headers['Authorization'] = `Bearer ${p.apiKey}`;
      const res = await fetch(`${p.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', headers, signal,
        body: JSON.stringify({ model: p.model, messages: [{ role: 'user', content: message }] }),
      });
      if (!res.ok) throw new Error(`${p.name} ${res.status}`);
      const data = await res.json();
      const text = String(data?.choices?.[0]?.message?.content ?? '');
      if (!text.trim()) throw new Error(`${p.name} empty reply`);
      return text;
    });
  } catch (e: any) {
    // fetch throws a TypeError on CORS/network failure (no HTTP status). Hosted
    // providers that block browser origins get one retry through the app
    // server's relay; localhost (Ollama/LM Studio) is browser-reachable and an
    // https-only relay couldn't reach it anyway, so surface those errors as-is.
    const networkLevel = e instanceof TypeError || /Failed to fetch|NetworkError/i.test(String(e?.message));
    if (!networkLevel || !p.baseUrl.startsWith('https://')) throw e;
    return withTimeout(ms, async signal => {
      const res = await fetch('/api/providers/relay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({ baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(`${p.name} relay: ${data.error || res.status}`);
      const text = String(data.text ?? '');
      if (!text.trim()) throw new Error(`${p.name} relay empty reply`);
      return text;
    });
  }
}

async function callAnthropic(message: string, p: CustomProvider, ms: number): Promise<string> {
  return withTimeout(ms, async signal => {
    const res = await fetch(`${p.baseUrl.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': p.apiKey ?? '',
        'anthropic-version': '2023-06-01',
        // Anthropic requires an explicit opt-in for browser-origin requests.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      signal,
      body: JSON.stringify({ model: p.model, max_tokens: 4096, messages: [{ role: 'user', content: message }] }),
    });
    if (!res.ok) throw new Error(`${p.name} ${res.status}`);
    const data = await res.json();
    const text = (Array.isArray(data?.content) ? data.content : []).map((b: any) => b?.text ?? '').join('');
    if (!text.trim()) throw new Error(`${p.name} empty reply`);
    return text;
  });
}

/** One provider entry, any kind, one call. */
async function callProvider(p: CustomProvider, message: string, timeoutMs: number): Promise<string> {
  if (p.kind === 'gemini') return callGemini(message, p.baseUrl, p.model, { apiKey: p.apiKey }, timeoutMs);
  if (p.kind === 'anthropic') return callAnthropic(message, p, timeoutMs);
  return callOpenAICompatible(message, p, timeoutMs);
}

async function callCloud(message: string, context: string, timeoutMs: number): Promise<string> {
  return withTimeout(timeoutMs, async signal => {
    const res = await fetch('/api/chat-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({ message, context }),
    });
    if (!res.ok) throw new Error(`server ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(String(data.error));
    const text = String(data.text ?? '');
    if (!text.trim()) throw new Error('server empty reply');
    return text;
  });
}

// ── preferred provider (the Studio/chat selector) ────────────────────────────
// 'auto' = full chain (OAuth → list → Cloud). A provider id, 'oauth', or
// 'cloud' forces that single rung — STRICT, no silent fallback, so selecting a
// provider doubles as testing it: if it fails you see the real error.

const PREFERRED_KEY = 'aura-ai-preferred-provider';
export type PreferredProvider = 'auto' | 'oauth' | 'cloud' | string;

export function getPreferredProvider(): PreferredProvider {
  return localStorage.getItem(PREFERRED_KEY) || 'auto';
}
export function setPreferredProvider(id: PreferredProvider): void {
  if (id === 'auto') localStorage.removeItem(PREFERRED_KEY);
  else localStorage.setItem(PREFERRED_KEY, id);
}

/** The selectable rungs, for building picker UIs. */
export function listSelectableProviders(): Array<{ id: PreferredProvider; name: string }> {
  const out: Array<{ id: PreferredProvider; name: string }> = [{ id: 'auto', name: 'Auto (chain)' }];
  if (getGeminiOAuthToken()) out.push({ id: 'oauth', name: 'Gemini (Google sign-in)' });
  for (const p of getProviderSettings().providers) {
    if (p.enabled && p.baseUrl && p.model) out.push({ id: p.id, name: `${p.name} · ${p.model}` });
  }
  out.push({ id: 'cloud', name: 'AuraFlare Cloud (built-in)' });
  return out;
}

/**
 * Health-check one rung with a trivial prompt. Returns latency + a reply
 * snippet on success, the real error message on failure.
 */
export async function testProvider(
  id: PreferredProvider,
  timeoutMs = 25000,
): Promise<{ ok: boolean; ms: number; reply?: string; error?: string }> {
  const started = Date.now();
  const probe = 'Reply with exactly: OK';
  try {
    let text: string;
    if (id === 'oauth') {
      const token = getGeminiOAuthToken();
      if (!token) throw new Error('no Google sign-in token this session');
      text = await callGemini(probe, 'https://generativelanguage.googleapis.com', 'gemini-3.1-pro-preview', { bearer: token }, timeoutMs);
    } else if (id === 'cloud' || id === 'auto') {
      text = await callCloud(probe, 'provider-test', timeoutMs);
    } else {
      const p = getProviderSettings().providers.find(x => x.id === id);
      if (!p) throw new Error('provider not found');
      if (!p.baseUrl || !p.model) throw new Error('base URL and model are required');
      text = await callProvider(p, probe, timeoutMs);
    }
    return { ok: true, ms: Date.now() - started, reply: text.trim().slice(0, 60) };
  } catch (e: any) {
    return { ok: false, ms: Date.now() - started, error: String(e?.message ?? e).slice(0, 200) };
  }
}

/**
 * Single-shot completion. Default ('auto'): the chain — Gemini OAuth → user
 * providers in order → AuraFlare Cloud; throws only if every rung fails
 * (callers keep their offline fallbacks). When the user has SELECTED a
 * provider (Studio/chat picker), only that rung runs and its real error
 * propagates — an explicit choice should never be silently substituted.
 */
export async function aiChatSync(
  message: string,
  context: string,
  timeoutMs = 20000,
): Promise<{ text: string; provider: string }> {
  const preferred = getPreferredProvider();

  if (preferred !== 'auto') {
    if (preferred === 'oauth') {
      const token = getGeminiOAuthToken();
      if (!token) throw new Error('Google sign-in expired — sign in again in Settings → AI, or switch the provider selector');
      const text = await callGemini(message, 'https://generativelanguage.googleapis.com', 'gemini-3.1-pro-preview', { bearer: token }, timeoutMs);
      return { text, provider: 'Gemini (Google sign-in)' };
    }
    if (preferred === 'cloud') {
      return { text: await callCloud(message, context, timeoutMs), provider: 'AuraFlare Cloud' };
    }
    const p = getProviderSettings().providers.find(x => x.id === preferred);
    if (!p || !p.enabled || !p.baseUrl || !p.model) {
      throw new Error('selected provider is missing or disabled — pick another in the provider selector');
    }
    return { text: await callProvider(p, message, timeoutMs), provider: p.name };
  }

  const oauth = getGeminiOAuthToken();
  if (oauth) {
    try {
      const text = await callGemini(message, 'https://generativelanguage.googleapis.com', 'gemini-3.1-pro-preview', { bearer: oauth }, timeoutMs);
      return { text, provider: 'Gemini (Google sign-in)' };
    } catch (e: any) {
      if (/40[13]/.test(String(e?.message))) setGeminiOAuthToken(null);
    }
  }

  for (const p of getProviderSettings().providers) {
    if (!p.enabled || !p.baseUrl || !p.model) continue;
    try {
      return { text: await callProvider(p, message, timeoutMs), provider: p.name };
    } catch { /* next provider */ }
  }

  return { text: await callCloud(message, context, timeoutMs), provider: 'AuraFlare Cloud' };
}
