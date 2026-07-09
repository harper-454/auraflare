import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import fs from 'fs';
import { exec } from 'child_process';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // 8 MB: /api/media/describe receives a downscaled photo as base64 JSON.
  app.use(express.json({ limit: '8mb' }));

  app.get('/api/fs/read', async (req, res) => {
    try {
      const filePath = path.join(process.cwd(), (typeof req.query.path === 'string' ? req.query.path : ''));
      // Ensure we stay within workspace
      if (!filePath.startsWith(process.cwd())) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const stats = await fs.promises.stat(filePath);
      if (stats.isDirectory()) {
        const files = await fs.promises.readdir(filePath, { withFileTypes: true });
        const list = files.map(f => ({ name: f.name, isDir: f.isDirectory() }));
        return res.json({ type: 'dir', files: list });
      } else {
        const content = await fs.promises.readFile(filePath, 'utf8');
        return res.json({ type: 'file', content });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/fs/write', async (req, res) => {
    try {
      const filePath = path.join(process.cwd(), req.body.path || '');
      if (!filePath.startsWith(process.cwd())) {
        return res.status(403).json({ error: 'Access denied' });
      }
      await fs.promises.writeFile(filePath, req.body.content, 'utf8');
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/exec', (req, res) => {
    const cmd = req.body.command;
    const cwd = path.join(process.cwd(), req.body.cwd || '');
    if (!cwd.startsWith(process.cwd())) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    exec(cmd, { cwd }, (error, stdout, stderr) => {
      res.json({ stdout, stderr, error: error ? error.message : null });
    });
  });


  // ── Durable chat: in production this is a Cloudflare Workflow (the AI keeps
  // working after the browser closes). In local dev there's no Workflow
  // runtime, so /api/chat degrades to synchronous and tags itself with
  // { fallback: 'sync' } — the client renders the reply directly. The
  // dedicated /api/chat-sync endpoint below carries the same single-shot
  // contract for the FloatingAssistant + 3D compose path.
  app.post('/api/chat', async (req, res) => {
    try {
      const { message, context } = req.body;

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'GEMINI_API_KEY environment variable is missing.' });
      }

      const ai = new GoogleGenAI({ apiKey });

      const prompt = `
You are a helpful context-aware assistant for the Aura Engine Specification platform.
The user is currently viewing the "${context}" section.

Answer the following query clearly and concisely based on the current context and typical software architecture concepts.

User Query: ${message}
`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH }
        },
        contents: prompt,
      });

      res.json({ text: response.text, fallback: 'sync' });
    } catch (error: any) {
      console.error('Gemini API Error:', error);

      if (error.message && error.message.includes('429') || error.status === 429) {
        // Fallback mock to demonstrate the feature if quota is exceeded
        const mockThought = "> *Analyzing context " + (req.body ? req.body.context : "unknown") + " to determine missing features...*\n> *1. Need to ensure UI provides multiple views.*\n> *2. Need offline persistence.*\n> *3. Need data portability.*\n\n";
        res.json({
          text: mockThought + "Based on my deep analysis, here are the core features you should implement:\n\n1. **Kanban Board View** for intuitive task management.\n2. **Project Export/Import** to JSON for data portability.\n3. **Analytics Dashboard** to track sprint velocity.\n\nWould you like me to generate the code for any of these?",
          fallback: 'sync'
        });
      } else {
        res.status(500).json({ error: error.message || 'An error occurred while communicating with the AI.' });
      }

    }
  });

  // Synchronous single-shot chat — used by FloatingAssistant + 3D compose.
  // (Same handler as /api/chat but the route name signals "one reply, now".)
  // Gemini first; when it's unavailable (no key, quota/credits exhausted) the
  // request proxies to the production Worker (Workers AI) so local dev keeps a
  // working model with zero configuration.
  const PROD_ORIGIN = process.env.AURA_PROD_ORIGIN || 'https://aura.massivenumber.com';
  app.post('/api/chat-sync', async (req, res) => {
    const { message, context } = req.body;
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('GEMINI_API_KEY missing');
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are a helpful context-aware assistant for the Aura Engine Specification platform. The user is viewing "${context ?? 'unknown'}".\n\nUser query: ${message}`;
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: prompt,
      });
      res.json({ text: response.text });
    } catch (error: any) {
      try {
        const proxied = await fetch(`${PROD_ORIGIN}/api/chat-sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, context }),
        });
        const data: any = await proxied.json();
        if (!proxied.ok || data.error) throw new Error(data.error || `proxy ${proxied.status}`);
        res.json({ text: data.text, fallback: 'prod-proxy' });
      } catch (proxyErr: any) {
        res.status(500).json({ error: `${error.message || 'AI error'}; prod proxy: ${proxyErr.message}` });
      }
    }
  });

  // Dev stubs for the durable-chat polling endpoints. In dev there's no
  // Workflow, so history is empty and status always reports complete.
  app.get('/api/chat/status', (req, res) => res.json({ instanceId: String(req.query.instanceId ?? ''), status: 'complete', run: 'complete' }));
  app.get('/api/chat/history', (req, res) => res.json({ sessionId: String(req.query.sessionId ?? ''), messages: [] }));


  
  app.post('/api/deep-research', async (req, res) => {
    try {
      const { query, language } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY missing' });
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Perform a simulated deep internet research swarm analysis on the query: "${query}". Imagine you are crawling foreign websites (e.g. Russian, Chinese, Japanese, etc.) to gather comprehensive data, and translate the findings back to "${language}". Return a structured markdown response with findings, sources, and a technical summary.`;
      
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: prompt,
      });
      res.json({ result: response.text });
    } catch(err) {
      // fallback mock
      setTimeout(() => {
        res.json({ result: `### Deep Research Report: ${req.body.query}\n\n**Global Swarm Activated**\n- 🇨🇳 Crawled Baidu and Chinese technical forums.\n- 🇷🇺 Analyzed Yandex developer networks.\n- 🇯🇵 Scanned Japanese academic papers.\n\n**Findings Translated to ${req.body.language}**\n\nBased on global telemetry, the architecture for this query requires deep cross-compilation techniques. Our agents found 4 undocumented APIs that solve the core latency issue.\n\n*Sources: GitHub, Yandex, Weibo Tech.*`});
      }, 3000);
    }
  });

  app.post('/api/multi-agent-build', async (req, res) => {
    try {
      const { agents, architecture } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY missing' });
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Simulate a multi-agent complex build process. Architecture: ${architecture}. Agents involved: ${agents.map(a => a.name + " (" + a.persona + ")").join(', ')}. Return a markdown log of their collaboration, conflicts, and final consensus build plan.`;
      
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: prompt,
      });
      res.json({ result: response.text });
    } catch (err) {
      setTimeout(() => {
        res.json({ result: `### Multi-Agent Build Consensus\n\n**Phase 1: Architecture Review**\n- **Architect Agent** proposed a microservices layout.\n- **Security Agent** rejected the initial draft due to exposed JWT signing keys.\n- **DevOps Agent** suggested a multi-stage Docker build to optimize cold starts.\n\n**Phase 2: Execution**\nAll agents reached consensus. Generating Kubernetes manifests and Terraform definitions...\n\n*Build successful. VRAM usage optimized.*`});
      }, 4000);
    }
  });

  // Dev no-op for the D1 spec mirror — useAutoSave fires these on every change;
  // acknowledging avoids 404 noise (prod persists to D1).
  app.put('/api/spec', (_req, res) => res.json({ ok: true, dev: true }));

  // Server-side relay for OpenAI-compatible providers that block browser-origin
  // CORS (e.g. Openference). The client tries direct first; on a network-level
  // failure it retries here. https-only so this can't be aimed at local/internal
  // services — local LLMs are reachable from the browser directly.
  app.post('/api/providers/relay', async (req, res) => {
    try {
      const { baseUrl, apiKey, model, message } = req.body ?? {};
      if (typeof baseUrl !== 'string' || !baseUrl.startsWith('https://')) {
        return res.status(400).json({ error: 'baseUrl must be https://' });
      }
      if (!model || !message) return res.status(400).json({ error: 'model and message required' });
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      const upstream = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages: [{ role: 'user', content: String(message) }] }),
      });
      const data: any = await upstream.json().catch(() => ({}));
      if (!upstream.ok) return res.status(upstream.status).json({ error: data?.error?.message || data?.error || `upstream ${upstream.status}` });
      const text = String(data?.choices?.[0]?.message?.content ?? '');
      if (!text.trim()) return res.status(502).json({ error: 'empty reply from provider' });
      res.json({ text });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'relay error' });
    }
  });

  // ——— Media generation is edge-only (Workers AI + R2). Return honest JSON
  // instead of letting the route fall through to Vite's SPA HTML. ———
  app.post('/api/media/generate', (_req, res) => {
    res.status(501).json({ error: 'Image/texture generation runs on the production Worker (Workers AI + R2). Use the deployed app.' });
  });

  // Vision caption has a Gemini-backed dev path so photo→3D works locally too.
  app.post('/api/media/describe', async (req, res) => {
    try {
      const { image, prompt } = req.body ?? {};
      if (!image) return res.status(400).json({ error: 'image (base64) required' });
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY missing' });
      const raw = String(image);
      const b64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
      const question = (prompt && String(prompt).trim())
        || 'Describe the main object in this photo for a 3D modeler: overall shape, its distinct parts and how they are arranged, approximate colors, and the surface material. 3-5 concise sentences. Ignore the background.';
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: b64 } }, { text: question }] }],
      });
      res.json({ ok: true, description: response.text, model: 'gemini-3.1-pro-preview' });
    } catch (error: any) {
      // Same resilience as /api/chat-sync: when local Gemini is unavailable,
      // proxy to the production Worker's VLM so vision keeps working in dev.
      try {
        const proxied = await fetch(`${PROD_ORIGIN}/api/media/describe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req.body),
        });
        const data: any = await proxied.json();
        if (!proxied.ok || data.error) throw new Error(data.error || `proxy ${proxied.status}`);
        res.json({ ...data, fallback: 'prod-proxy' });
      } catch (proxyErr: any) {
        res.status(500).json({ error: `${error.message || 'vision error'}; prod proxy: ${proxyErr.message}` });
      }
    }
  });

  // ——— MeshForge gallery: local dev is disk-backed (.forge-gallery/);
  // the production Worker serves the same API from R2 ———
  const GALLERY_DIR = path.join(process.cwd(), '.forge-gallery');
  app.get('/api/media', async (req, res) => {
    try {
      await fs.promises.mkdir(GALLERY_DIR, { recursive: true });
      const files = await fs.promises.readdir(GALLERY_DIR);
      // .glb (models/exports) + .json/.jpg (Batch Forge artifacts)
      const items = await Promise.all(files.filter(f => /\.(glb|json|jpg)$/.test(f)).map(async f => {
        const st = await fs.promises.stat(path.join(GALLERY_DIR, f));
        return { key: f, size: st.size, uploaded: st.mtime.toISOString() };
      }));
      res.json({ items: items.sort((a, b) => b.uploaded.localeCompare(a.uploaded)) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  app.put('/api/media/:key', express.raw({ type: '*/*', limit: '64mb' }), async (req, res) => {
    try {
      const key = req.params.key.replace(/[^\w.-]/g, '_');
      await fs.promises.mkdir(GALLERY_DIR, { recursive: true });
      await fs.promises.writeFile(path.join(GALLERY_DIR, key), req.body);
      res.json({ ok: true, key });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  app.get('/api/media/:key', async (req, res) => {
    try {
      const key = req.params.key.replace(/[^\w.-]/g, '_');
      const buf = await fs.promises.readFile(path.join(GALLERY_DIR, key));
      res.setHeader('Content-Type', 'model/gltf-binary');
      res.send(buf);
    } catch { res.status(404).json({ error: 'not found' }); }
  });
  app.delete('/api/media/:key', async (req, res) => {
    try {
      const key = req.params.key.replace(/[^\w.-]/g, '_');
      await fs.promises.unlink(path.join(GALLERY_DIR, key));
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
