/**
 * Aura Engine Spec — Cloudflare Worker (production)
 *
 * Uses your paid Cloudflare stack:
 *  - AI Gateway  : all inference routed through env.AI.run({ gateway }) →
 *                  observability, caching, rate/spend limits in your dashboard
 *  - Workers AI  : @cf frontier models as primary serverless inference
 *  - D1          : durable spec/task persistence + AI request log
 *  - KV          : hot cache for AI responses and session state
 *  - R2          : media/exports storage (Audio Studio, form exports)
 *  - Static Assets: serves the built SPA at the edge
 *
 * The Node/Express server (server.ts) remains the local-dev runtime;
 * /api/fs and /api/exec are dev-only and return 501 here by design.
 */

export interface Env {
  AI: Ai;
  DB: D1Database;
  KV: KVNamespace;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  AI_GATEWAY_ID: string;
  WORKERS_AI_MODEL: string;
  GEMINI_API_KEY?: string; // optional: BYOK Gemini via AI Gateway (wrangler secret)
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

async function runInference(
  env: Env,
  prompt: string,
  opts: { cacheTtl?: number; metadata?: Record<string, string> } = {},
): Promise<{ text: string; model: string; cached: boolean; latencyMs: number }> {
  const started = Date.now();

  // KV hot-cache in front of the gateway (cheap + instant for repeat prompts)
  const cacheKey = `ai:${await sha256(prompt)}`;
  if (opts.cacheTtl) {
    const hit = await env.KV.get(cacheKey);
    if (hit) return { text: hit, model: 'kv-cache', cached: true, latencyMs: Date.now() - started };
  }

  // Workers AI through AI Gateway — shows up in your gateway analytics,
  // honors gateway-level caching, rate limits, and spend limits
  const result = (await env.AI.run(
    env.WORKERS_AI_MODEL as Parameters<Ai['run']>[0],
    { messages: [{ role: 'user', content: prompt }], max_tokens: 2048 } as never,
    {
      gateway: {
        id: env.AI_GATEWAY_ID,
        skipCache: !opts.cacheTtl,
        cacheTtl: opts.cacheTtl,
        metadata: opts.metadata,
      },
    },
  )) as { response?: string };

  const text = result.response ?? JSON.stringify(result);
  if (opts.cacheTtl) {
    await env.KV.put(cacheKey, text, { expirationTtl: Math.max(60, opts.cacheTtl) });
  }
  return { text, model: env.WORKERS_AI_MODEL, cached: false, latencyMs: Date.now() - started };
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function logAi(env: Env, endpoint: string, model: string, cached: boolean, latencyMs: number) {
  try {
    await env.DB.prepare(
      'INSERT INTO ai_log (endpoint, model, cached, latency_ms) VALUES (?, ?, ?, ?)',
    ).bind(endpoint, model, cached ? 1 : 0, latencyMs).run();
  } catch { /* logging must never break the request */ }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    // ——— AI endpoints (same contract as the dev server) ———
    if (request.method === 'POST' && pathname === '/api/chat') {
      const { message, context } = await request.json<{ message: string; context?: string }>();
      const prompt = `You are a helpful context-aware assistant for the Aura Engine Specification platform. The user is viewing the "${context ?? 'unknown'}" section. Answer clearly and concisely.\n\nUser query: ${message}`;
      try {
        const r = await runInference(env, prompt, { cacheTtl: 300, metadata: { endpoint: 'chat', section: context ?? '' } });
        ctx.waitUntil(logAi(env, 'chat', r.model, r.cached, r.latencyMs));
        return json({ text: r.text, model: r.model, cached: r.cached });
      } catch (e: any) {
        return json({ error: e.message }, 502);
      }
    }

    if (request.method === 'POST' && pathname === '/api/deep-research') {
      const { query, language } = await request.json<{ query: string; language?: string }>();
      const prompt = `Perform a deep research analysis on: "${query}". Present findings in ${language ?? 'English'} as structured markdown with sections for findings, sources to consult, and a technical summary.`;
      try {
        const r = await runInference(env, prompt, { cacheTtl: 3600, metadata: { endpoint: 'deep-research' } });
        ctx.waitUntil(logAi(env, 'deep-research', r.model, r.cached, r.latencyMs));
        return json({ result: r.text });
      } catch (e: any) {
        return json({ error: e.message }, 502);
      }
    }

    if (request.method === 'POST' && pathname === '/api/multi-agent-build') {
      const { agents, architecture } = await request.json<{ agents: { name: string; persona: string }[]; architecture: string }>();
      const prompt = `Simulate a multi-agent build process. Architecture: ${architecture}. Agents: ${agents.map(a => `${a.name} (${a.persona})`).join(', ')}. Return a markdown log of collaboration, conflicts, and the final consensus build plan.`;
      try {
        const r = await runInference(env, prompt, { metadata: { endpoint: 'multi-agent-build' } });
        ctx.waitUntil(logAi(env, 'multi-agent-build', r.model, r.cached, r.latencyMs));
        return json({ result: r.text });
      } catch (e: any) {
        return json({ error: e.message }, 502);
      }
    }

    // ——— D1-backed spec persistence (cloud twin of localStorage autosave) ———
    if (pathname === '/api/spec' && request.method === 'GET') {
      const key = url.searchParams.get('key');
      if (key) {
        const row = await env.DB.prepare('SELECT value, updated_at FROM spec_data WHERE key = ?').bind(key).first();
        return json(row ?? { value: null });
      }
      const { results } = await env.DB.prepare('SELECT key, updated_at FROM spec_data ORDER BY key').all();
      return json({ keys: results });
    }
    if (pathname === '/api/spec' && request.method === 'PUT') {
      const { key, value } = await request.json<{ key: string; value: unknown }>();
      if (!key) return json({ error: 'key required' }, 400);
      await env.DB.prepare(
        "INSERT INTO spec_data (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
      ).bind(key, JSON.stringify(value)).run();
      return json({ ok: true });
    }

    // ——— AI usage stats from D1 (real gateway-side telemetry) ———
    if (pathname === '/api/ai-stats' && request.method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT endpoint, COUNT(*) as calls, AVG(latency_ms) as avg_ms, SUM(cached) as cache_hits FROM ai_log GROUP BY endpoint ORDER BY calls DESC',
      ).all();
      return json({ stats: results });
    }

    // ——— R2 media gallery ———
    if (pathname === '/api/media' && request.method === 'GET') {
      const list = await env.BUCKET.list({ limit: 200 });
      return json({ items: list.objects.map(o => ({ key: o.key, size: o.size, uploaded: o.uploaded })) });
    }
    if (pathname.startsWith('/api/media/') && request.method === 'DELETE') {
      await env.BUCKET.delete(decodeURIComponent(pathname.slice('/api/media/'.length)));
      return json({ ok: true });
    }

    // ——— R2 media exports ———
    if (pathname.startsWith('/api/media/') && request.method === 'PUT') {
      const objectKey = decodeURIComponent(pathname.slice('/api/media/'.length));
      if (!objectKey) return json({ error: 'key required' }, 400);
      await env.BUCKET.put(objectKey, request.body, {
        httpMetadata: { contentType: request.headers.get('Content-Type') ?? 'application/octet-stream' },
      });
      return json({ ok: true, key: objectKey });
    }
    if (pathname.startsWith('/api/media/') && request.method === 'GET') {
      const objectKey = decodeURIComponent(pathname.slice('/api/media/'.length));
      const obj = await env.BUCKET.get(objectKey);
      if (!obj) return json({ error: 'not found' }, 404);
      return new Response(obj.body, {
        headers: { 'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream' },
      });
    }

    // ——— Dev-only endpoints: shell/fs access does not exist at the edge ———
    if (pathname === '/api/exec' || pathname.startsWith('/api/fs/')) {
      return json({
        error: 'This endpoint runs only on the local dev server (npm run dev). The edge deployment intentionally has no shell or filesystem access.',
      }, 501);
    }

    // ——— SPA + static assets ———
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
