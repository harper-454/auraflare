/**
 * AuraFlare — standalone local server.
 *
 * This is the entry point for the packaged executable (AuraFlare.exe via
 * Node SEA) and for `node dist/auraflare.cjs`. It serves the built SPA from
 * ./dist plus the full local API surface (AI, filesystem, exec, gallery) —
 * everything the dev server does, without Vite.
 *
 * Keep AuraFlare.exe next to the dist/ folder (or run it from the project
 * root) so the static assets resolve.
 */
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });
import express from 'express';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

const PORT = Number(process.env.AURAFLARE_PORT || 3000);
const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const GALLERY_DIR = path.join(ROOT, '.forge-gallery');

const app = express();
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ app: 'AuraFlare', ok: true, mode: 'standalone', node: process.version });
});

// ——— filesystem + exec (local power tools, same guards as dev) ———
app.get('/api/fs/read', async (req, res) => {
  try {
    const filePath = path.join(ROOT, typeof req.query.path === 'string' ? req.query.path : '');
    if (!filePath.startsWith(ROOT)) return res.status(403).json({ error: 'Access denied' });
    const stats = await fs.promises.stat(filePath);
    if (stats.isDirectory()) {
      const files = await fs.promises.readdir(filePath, { withFileTypes: true });
      return res.json({ type: 'dir', files: files.map(f => ({ name: f.name, isDir: f.isDirectory() })) });
    }
    return res.json({ type: 'file', content: await fs.promises.readFile(filePath, 'utf8') });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/fs/write', async (req, res) => {
  try {
    const filePath = path.join(ROOT, req.body.path || '');
    if (!filePath.startsWith(ROOT)) return res.status(403).json({ error: 'Access denied' });
    await fs.promises.writeFile(filePath, req.body.content, 'utf8');
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/exec', (req, res) => {
  const cwd = path.join(ROOT, req.body.cwd || '');
  if (!cwd.startsWith(ROOT)) return res.status(403).json({ error: 'Access denied' });
  exec(req.body.command, { cwd }, (error, stdout, stderr) => {
    res.json({ stdout, stderr, error: error ? error.message : null });
  });
});

// ——— AI endpoints (Gemini via .env.local key) ———
async function gemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing — add it to .env.local next to AuraFlare');
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: 'gemini-3.1-pro-preview',
    config: { thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } },
    contents: prompt,
  });
  return response.text ?? '';
}

app.post('/api/chat', async (req, res) => {
  try {
    const { message, context } = req.body;
    const text = await gemini(`You are a helpful context-aware assistant for AuraFlare. The user is viewing the "${context}" section. Answer clearly and concisely.\n\nUser query: ${message}`);
    res.json({ text });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/deep-research', async (req, res) => {
  try {
    const { query, language } = req.body;
    const result = await gemini(`Perform a deep research analysis on: "${query}". Present findings in ${language ?? 'English'} as structured markdown with findings, sources to consult, and a technical summary.`);
    res.json({ result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/multi-agent-build', async (req, res) => {
  try {
    const { agents, architecture } = req.body;
    const result = await gemini(`Simulate a multi-agent build process. Architecture: ${architecture}. Agents: ${agents.map((a: any) => `${a.name} (${a.persona})`).join(', ')}. Return a markdown log of collaboration, conflicts, and the final consensus build plan.`);
    res.json({ result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ——— MeshForge gallery (disk-backed) ———
app.get('/api/media', async (_req, res) => {
  try {
    await fs.promises.mkdir(GALLERY_DIR, { recursive: true });
    const files = await fs.promises.readdir(GALLERY_DIR);
    const items = await Promise.all(files.filter(f => f.endsWith('.glb')).map(async f => {
      const st = await fs.promises.stat(path.join(GALLERY_DIR, f));
      return { key: f, size: st.size, uploaded: st.mtime.toISOString() };
    }));
    res.json({ items: items.sort((a, b) => b.uploaded.localeCompare(a.uploaded)) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/media/:key', express.raw({ type: '*/*', limit: '64mb' }), async (req, res) => {
  try {
    const key = req.params.key.replace(/[^\w.-]/g, '_');
    await fs.promises.mkdir(GALLERY_DIR, { recursive: true });
    await fs.promises.writeFile(path.join(GALLERY_DIR, key), req.body);
    res.json({ ok: true, key });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/media/:key', async (req, res) => {
  try {
    const key = req.params.key.replace(/[^\w.-]/g, '_');
    const buf = await fs.promises.readFile(path.join(GALLERY_DIR, key));
    res.setHeader('Content-Type', 'model/gltf-binary');
    res.send(buf);
  } catch {
    res.status(404).json({ error: 'not found' });
  }
});

app.delete('/api/media/:key', async (req, res) => {
  try {
    const key = req.params.key.replace(/[^\w.-]/g, '_');
    await fs.promises.unlink(path.join(GALLERY_DIR, key));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ——— static SPA ———
app.use(express.static(DIST));
app.get('*', (_req, res) => {
  const index = path.join(DIST, 'index.html');
  if (fs.existsSync(index)) return res.sendFile(index);
  res.status(500).send('AuraFlare: dist/ not found. Run "npm run build:standalone" first, and keep AuraFlare.exe next to the dist folder.');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n  ⚡ AuraFlare running → http://localhost:' + PORT + '\n');
});
