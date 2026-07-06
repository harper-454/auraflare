/**
 * Aura Engine Spec — Cloudflare Worker (production)
 *
 * Uses your paid Cloudflare stack:
 *  - Workflows   : durable, multi-step chat execution that survives the
 *                  originating request — the AI keeps working after the user
 *                  closes the browser, loops until done or blocked, and
 *                  persists every correctly-attributed message to D1.
 *  - AI Gateway  : all inference routed through env.AI.run({ gateway })
 *  - Workers AI  : @cf frontier models as primary serverless inference
 *  - D1          : chat history + spec/task persistence + AI request log
 *  - KV          : hot cache for AI responses and session state
 *  - R2          : media/exports storage
 *  - Static Assets: serves the built SPA at the edge
 *
 * The Node/Express server (server.ts) remains the local-dev runtime;
 * /api/fs and /api/exec are dev-only and return 501 here by design.
 */

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

export interface Env {
  AI: Ai;
  DB: D1Database;
  KV: KVNamespace;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  CHAT_WORKFLOW: Workflow;
  AI_GATEWAY_ID: string;
  WORKERS_AI_MODEL: string;
  GEMINI_API_KEY?: string;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

// ───────────────────────────────────────────────────────────────────────────
// Inference helpers (shared by sync + workflow paths)
// ───────────────────────────────────────────────────────────────────────────

async function runInference(
  env: Env,
  prompt: string,
  opts: { cacheTtl?: number; metadata?: Record<string, string>; messages?: any[] } = {},
): Promise<{ text: string; model: string; cached: boolean; latencyMs: number }> {
  const started = Date.now();
  const cacheKey = `ai:${await sha256(prompt)}`;
  if (opts.cacheTtl) {
    const hit = await env.KV.get(cacheKey);
    if (hit) return { text: hit, model: 'kv-cache', cached: true, latencyMs: Date.now() - started };
  }

  const isChatModel = !!opts.messages;
  const result: any = await env.AI.run(
    env.WORKERS_AI_MODEL as Parameters<Ai['run']>[0],
    isChatModel
      ? { messages: opts.messages, max_tokens: 2048 }
      : { messages: [{ role: 'user', content: prompt }], max_tokens: 2048 },
    {
      gateway: {
        id: env.AI_GATEWAY_ID,
        skipCache: !opts.cacheTtl,
        cacheTtl: opts.cacheTtl,
        metadata: opts.metadata,
      },
    } as never,
  );

  // Workers AI returns different shapes depending on model + invocation:
  //   - text models:             { response: "..." }
  //   - some chat models:        { message: { content: "..." } }
  //   - OpenAI-compat (kimi etc):{ choices: [{ message: { content: "..." } }] }
  //   - raw fallback:            JSON.stringify(result)
  // Try each in turn so we always persist the actual answer text, not the envelope.
  const extractText = (r: any): string => {
    if (typeof r?.response === 'string' && r.response) return r.response;
    if (typeof r?.message?.content === 'string') return r.message.content;
    if (Array.isArray(r?.choices) && r.choices.length > 0) {
      const c = r.choices[0];
      if (typeof c?.message?.content === 'string') return c.message.content;
      if (typeof c?.text === 'string') return c.text;
    }
    if (typeof r === 'string') return r;
    return JSON.stringify(r);
  };
  const text = extractText(result);
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

// ───────────────────────────────────────────────────────────────────────────
// Durable chat Workflow — keeps working after the browser closes.
//
// Lifecycle: persistUserMessage → runTurn → selfEvaluate → loop or pause.
// Every message is written to D1 with its real role as it happens, so the
// client can disconnect and reconnect to a complete, correctly-attributed
// history at any time.
// ───────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Aura, the AI engineering partner in the AuraFlare platform. You help users design systems, write code, and reason about architecture. Be concrete and practical. When you produce code, use fenced code blocks with the language tag. You are running in a durable workflow — you can take multiple turns to fully address a request.`;

const MAX_TURNS = 6;

interface ChatParams {
  sessionId: string;
  message: string;
  context?: string;
}

interface TurnDecision {
  done: boolean;       // true = the task is complete
  blocked: boolean;    // true = need user input to continue
  question?: string;   // when blocked, the question to ask the user
}

export class ChatWorkflow extends WorkflowEntrypoint<Env, ChatParams> {
  async run(event: Readonly<WorkflowEvent<ChatParams>>, step: WorkflowStep) {
    const { sessionId, message, context } = event.payload;

    // Step 1 — durably persist the user's message. This is idempotent on retry:
    // if the Workflow retries after a transient failure, the step does not
    // re-run, so we never get duplicate user messages.
    await step.do('persist user message', async () => {
      await this.env.DB.prepare(
        "INSERT INTO chat_messages (id, session_id, instance_id, role, content, created_at) VALUES (?, ?, ?, 'user', ?, datetime('now'))",
      ).bind(crypto.randomUUID(), sessionId, event.instanceId, message).run();
      await this.env.DB.prepare(
        "INSERT INTO chat_runs (instance_id, session_id, status, prompt, created_at) VALUES (?, ?, 'running', ?, datetime('now')) ON CONFLICT(instance_id) DO UPDATE SET status='running'",
      ).bind(event.instanceId, sessionId, message.slice(0, 200)).run();
      return { saved: true };
    });

    // Steps 2..N — autonomous turn loop. Each turn: AI responds, then a
    // separate self-evaluation step decides done / continue / blocked.
    let turn = 0;
    let lastDecision: TurnDecision = { done: false, blocked: false };

    while (turn < MAX_TURNS && !lastDecision.done && !lastDecision.blocked) {
      turn++;

      // ── Run the AI turn ──
      const turnResult = await step.do(`turn ${turn}: respond`, async () => {
        // Load the full conversation so the model has context across turns.
        const { results } = await this.env.DB.prepare(
          "SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC, id ASC",
        ).bind(sessionId).all();

        const convo: any[] = [{ role: 'system', content: SYSTEM_PROMPT }];
        for (const row of results as any[]) {
          // map DB roles → chat roles ('ai' → 'assistant')
          const role = row.role === 'user' ? 'user' : row.role === 'system' ? 'system' : 'assistant';
          convo.push({ role, content: String(row.content) });
        }

        const r = await runInference(this.env, '', {
          messages: convo,
          metadata: { endpoint: 'chat-turn', session: sessionId, turn: String(turn) },
        });

        // Persist this AI reply with role='ai' — never conflated with user.
        const replyText = r.text || '*(no response)*';
        await this.env.DB.prepare(
          "INSERT INTO chat_messages (id, session_id, instance_id, role, content, created_at) VALUES (?, ?, ?, 'ai', ?, datetime('now'))",
        ).bind(crypto.randomUUID(), sessionId, event.instanceId, replyText).run();
        return { turn, chars: replyText.length, cached: r.cached };
      });

      // ── Self-evaluate: done, continue, or blocked? ──
      lastDecision = await step.do(`turn ${turn}: evaluate`, async () => {
        const { results } = await this.env.DB.prepare(
          "SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC, id ASC",
        ).bind(sessionId).all();
        const convo: any[] = [{ role: 'system', content: SYSTEM_PROMPT }];
        for (const row of results as any[]) {
          const role = row.role === 'user' ? 'user' : row.role === 'system' ? 'system' : 'assistant';
          convo.push({ role, content: String(row.content) });
        }
        // Force a terse JSON decision so we can parse it reliably.
        convo.push({
          role: 'user',
          content: 'Decide: is your work on this request COMPLETE, do you NEED_MORE_TURNS to fully address it, or are you BLOCKED needing input from me? Reply with ONLY JSON: {"status":"complete"|"more"|"blocked", "question":"the question if blocked"}. Use "more" sparingly — only when one more turn will materially help.',
        });
        const r = await runInference(this.env, '', {
          messages: convo,
          metadata: { endpoint: 'chat-eval', session: sessionId, turn: String(turn) },
        });
        const m = String(r.text).match(/\{[\s\S]*\}/);
        let decision: TurnDecision = { done: true, blocked: false }; // default: stop, to bound cost
        if (m) {
          try {
            const parsed = JSON.parse(m[0]);
            if (parsed.status === 'more' && turn < MAX_TURNS) decision = { done: false, blocked: false };
            else if (parsed.status === 'blocked') decision = { done: false, blocked: true, question: String(parsed.question ?? 'I need a bit more information to continue — could you clarify?' ) };
            else decision = { done: true, blocked: false };
          } catch { /* malformed → default done */ }
        }
        // If blocked, write the question as a system message for the user.
        if (decision.blocked && decision.question) {
          await this.env.DB.prepare(
            "INSERT INTO chat_messages (id, session_id, instance_id, role, content, created_at) VALUES (?, ?, ?, 'system', ?, datetime('now'))",
          ).bind(crypto.randomUUID(), sessionId, event.instanceId, `🛑 ${decision.question}`).run();
        }
        return decision;
      });
    }

    // Mark the run complete (or paused-on-block). The client polls this status.
    await step.do('finalize run', async () => {
      const status = lastDecision.blocked ? 'paused' : 'complete';
      await this.env.DB.prepare(
        "UPDATE chat_runs SET status = ?, completed_at = datetime('now') WHERE instance_id = ?",
      ).bind(status, event.instanceId).run();
      return { status, turns: turn };
    });

    return { turns: turn, blocked: lastDecision.blocked };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// HTTP handler
// ───────────────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    // ── Chat: durable async workflow ──
    // POST creates a Workflow instance and returns immediately. The AI keeps
    // working server-side after the client disconnects; the client polls
    // /api/chat/status and reads /api/chat/history.
    if (request.method === 'POST' && pathname === '/api/chat') {
      const body = await request.json<{ message: string; context?: string; sessionId?: string }>().catch(() => ({} as any));
      if (!body.message || !body.message.trim()) return json({ error: 'message required' }, 400);
      const sessionId = body.sessionId || crypto.randomUUID();
      try {
        const instance = await env.CHAT_WORKFLOW.create({
          id: crypto.randomUUID(),
          params: { sessionId, message: body.message, context: body.context },
        });
        return json({ instanceId: instance.id, sessionId, status: 'queued' });
      } catch (e: any) {
        // Workflow creation can fail if the schema isn't migrated yet; fall
        // back to the legacy synchronous path so chat keeps working.
        const prompt = `You are a helpful context-aware assistant for the Aura Engine Specification platform. The user is viewing the "${body.context ?? 'unknown'}" section.\n\nUser query: ${body.message}`;
        try {
          const r = await runInference(env, prompt, { cacheTtl: 300, metadata: { endpoint: 'chat', section: body.context ?? '' } });
          ctx.waitUntil(logAi(env, 'chat', r.model, r.cached, r.latencyMs));
          return json({ text: r.text, model: r.model, cached: r.cached, fallback: 'sync' });
        } catch (e2: any) {
          return json({ error: e2.message }, 502);
        }
      }
    }

    // GET /api/chat/status?instanceId=...  → poll a single run
    if (request.method === 'GET' && pathname === '/api/chat/status') {
      const instanceId = url.searchParams.get('instanceId');
      if (!instanceId) return json({ error: 'instanceId required' }, 400);
      try {
        const instance = await env.CHAT_WORKFLOW.get(instanceId);
        const status = await instance.status();
        // Also surface the run row from D1 so the client knows paused-vs-complete.
        const run: any = await env.DB.prepare(
          'SELECT status, prompt, created_at, completed_at FROM chat_runs WHERE instance_id = ?',
        ).bind(instanceId).first();
        return json({ instanceId, status: status.status, run: run?.status ?? null });
      } catch {
        return json({ instanceId, status: 'unknown' });
      }
    }

    // GET /api/chat/history?sessionId=...&since=... → full thread since a timestamp
    // This is what the client reads to render the durable, correctly-attributed
    // conversation — whether the user stayed on the page or left and came back.
    if (request.method === 'GET' && pathname === '/api/chat/history') {
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) return json({ error: 'sessionId required' }, 400);
      const sinceId = url.searchParams.get('sinceId'); // optional: only messages after this id
      let rows;
      if (sinceId) {
        // ordered cursor: fetch everything newer than the last seen id
        rows = await env.DB.prepare(
          `SELECT id, role, content, instance_id, created_at FROM chat_messages
           WHERE session_id = ? AND id > ? ORDER BY id ASC`,
        ).bind(sessionId, sinceId).all();
      } else {
        rows = await env.DB.prepare(
          'SELECT id, role, content, instance_id, created_at FROM chat_messages WHERE session_id = ? ORDER BY id ASC',
        ).bind(sessionId).all();
      }
      return json({ sessionId, messages: rows.results });
    }

    // ── Legacy / fallback sync AI endpoints (kept for FloatingAssistant + 3D compose) ──
    if (request.method === 'POST' && pathname === '/api/chat-sync') {
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

    // ── D1-backed spec persistence (cloud twin of localStorage autosave) ──
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

    // ── AI usage stats from D1 (real gateway-side telemetry) ──
    if (pathname === '/api/ai-stats' && request.method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT endpoint, COUNT(*) as calls, AVG(latency_ms) as avg_ms, SUM(cached) as cache_hits FROM ai_log GROUP BY endpoint ORDER BY calls DESC',
      ).all();
      return json({ stats: results });
    }

    // ── R2 media gallery ──
    if (pathname === '/api/media' && request.method === 'GET') {
      const list = await env.BUCKET.list({ limit: 200 });
      return json({ items: list.objects.map(o => ({ key: o.key, size: o.size, uploaded: o.uploaded })) });
    }
    if (pathname.startsWith('/api/media/') && request.method === 'DELETE') {
      await env.BUCKET.delete(decodeURIComponent(pathname.slice('/api/media/'.length)));
      return json({ ok: true });
    }

    // ── R2 media exports ──
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

    // ── Dev-only endpoints: shell/fs access does not exist at the edge ──
    if (pathname === '/api/exec' || pathname.startsWith('/api/fs/')) {
      return json({
        error: 'This endpoint runs only on the local dev server (npm run dev). The edge deployment intentionally has no shell or filesystem access.',
      }, 501);
    }

    // ── SPA + static assets ──
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
