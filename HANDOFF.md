# AuraFlare — Handoff Notes

**Last updated:** 2026-07-05
**Status:** Production live at https://aura.massivenumber.com (matches local).

This document is the map for the next operator. It captures what the app
actually is, what changed in the 2026-07-05 production-real pass, and what's
left to do.

---

## TL;DR

The app is a **Vite + React + TypeScript SPA** with two runtimes:
- **Local dev / desktop** — `server.ts` (Express on port 3000). Exposes `/api/fs/*` (read/write workspace files) and `/api/exec` (shell). These power the IDE Workspace.
- **Production edge** — `src/worker.ts` (Cloudflare Worker). Serves the SPA via Static Assets; AI routes go through Workers AI + AI Gateway with KV cache + D1 telemetry log. `/api/fs` and `/api/exec` return 501 by design (no shell in Workers).

The **MVP** is the **NCP Chat** (`src/components/NaturalConversationProgramming.tsx`) — natural-language → code, rendered with copyable code blocks. The **3D Viewport** is the secondary flagship: prompt → LLM-composed SDF shape program → WebGPU/CPU mesh → real `.glb` export.

---

## What changed in the 2026-07-05 pass

### 1. MVP chat — was silently broken, now real and local-first
- **Bug fixed:** the chat read `data.reply` but both runtimes return `data.text` → every AI message was persisted to Firestore as `"Processing error."` Now reads `data.text` + handles `data.error`.
- **Decoupled from mandatory auth.** Chat now works the instant the app opens, no Google sign-in required. Messages persist to `localStorage` (`aura-chat-history`) always; when signed in, they also mirror to Firestore (`users/{uid}/chat`) as a sync overlay.
- **Removed the blocking "Initializing Core Systems…" splash** in `AuthProvider` — app renders immediately; auth state resolves in the background.
- **Copyable code blocks** on AI messages (extracts first ``` fence, one-click copy). The MVP is "natural language → code", so code is now first-class.
- **Settings persist** (`aura-chat-settings`): provider/model/agent/project/memory.
- **Clear-chat button** + visible LOCAL-ONLY / CLOUD-SYNC badge.

### 2. 3D Viewport — was a fake demo, now routes the real engine (and the engine got deeper)
- The repo **already contained a complete real text-to-3D pipeline** in `src/lib/` (`meshforge.ts`, `sdf-compiler.ts`, `sdf-gpu.ts` — WGSL WebGPU kernel + CPU marching-tets fallback), but only the buried IDE → 3D tab exposed it. The visible "3D Viewport" sidebar item was a fake: `handleGenerate` was a 1.5s `setTimeout` that cycled Humanoid→Animal→Mech, and "Export Model" was an `alert("... (Mock)")`.
- **`Viewport3DSection.tsx` rewritten** to drive the real pipeline:
  - `composeWithAI(prompt)` → LLM emits a `ShapeProgram` (SDF primitive JSON); `sanitizeProgram` + 6 presets (`snowman`/`rocket`/`mushroom`/`dragon`/`crystal`/`flower`) + `parsePromptLocally` parametric fallback chain (deterministic-first per AGENTS.md §1).
  - `compileProgramAuto(program)` → WebGPU first @112³ for the original 5 primitives, automatic CPU fallback @60³ when the program uses cone/hex/octahedron/warp or expanded symmetries.
  - **Real `.glb` export** via `exportGLB()` → downloads a binary glTF.
  - **Refine loop** (`refineProgramWithAI`) — iterative prompt editing ("make it taller", "add a sphere on top").
  - Live stats HUD: triangles, op count, backend (gpu/cpu/preset), field ms, total ms, glb KB, source.
- Old Humanoid/Animal/Mech rigs kept as a "Rigs" view toggle (nothing lost).

#### 3D engine enhancements (the "build our own, no paid API" pass)
The SDF pipeline was extended so the LLM can describe far richer objects without writing every primitive by hand. All client-side, no API cost:
- **3 new primitives**: `cone` (IQ exact cone SDF — hats, spikes, towers), `hex` (hexagonal prism — nuts, crystals), `octahedron` (gems, dice).
- **fBm noise-warp modifier** (`warp` field) — turns flat surfaces into organic terrain, bark, coral. Deterministic value-noise + fBm, applied as a field displacement in `programDist`.
- **Symmetry/array DSL** (`parts` + `symmetries`) — `expandProgram()` runs at compile time and flattens these into ops the polygonizer already understands:
  - `mirror` (axis) — bilateral symmetry for creatures/vehicles.
  - `radial` (count, radius, axis, spin) — petals, gear teeth, legs around a body.
  - `linear` (axis, count, spacing) — rows of spikes/rivets.
  - `grid` (nx, nz, dx, dz) — lego studs, window grids.
- **Broadened `COMPOSE_INSTRUCTIONS`** now documents every primitive, mode, modifier, and the symmetry DSL with a worked flower example, so the LLM actually uses them.
- **Two new presets** showcase the new DSL: `crystal` (octahedron + cone shards via radial symmetry, high-metalness gem material) and `flower` (6 petals via radial symmetry on a thin ellipsoid).

**Result:** the prompt "a six-petal flower on a green stem" now produces a real flower mesh with 6 radially-symmetrical petals — previously impossible with the flat primitive list. "A faceted crystal cluster" produces a gem with a high-metalness material and radial shard array. The architecture is the same one TRELLIS/3D-GPT/MeshAnything use at the conceptual level (structured latent → polygonize), just declarative and free.

### 3. Shell reorganization — production feel
- **App now opens on the MVP (NCP Chat)**, not the IDE.
- **Sidebar collapsed from a 38-item flat list into 8 grouped sections** (Workspace, Spec & Planning, AI Systems, Infrastructure, Compute, Studio, Connectivity, Account) with collapsible headers.
- **10 niche sections hidden by default** (Compute + Connectivity groups) — revealable from **Settings → Features** with per-section show/hide toggles persisted to `localStorage` (`aura-sidebar-hidden`). Primary + Account always visible.
- **Removed the `max-w-5xl` pinch** that was squeezing the chat and 3D viewport. App-like surfaces (chat, 3D, IDE) now own full width/height.
- Breadcrumb hidden on app-like surfaces (they have their own headers); honest footer status (`v2 · MVP · LIVE`) instead of fake "PLANNING".
- **Single source of truth for sections** — new `src/sections.ts` registry; `Sidebar`, `CommandPalette`, `Breadcrumb`, and `SettingsPanel` all import from it. No more 4 duplicated section lists.

---

## Architecture map

```
src/
  main.tsx                  entry; mounts <AuthProvider><App/></AuthProvider>
  App.tsx                   shell: Sidebar + main + CommandPalette + SettingsPanel + FloatingAssistant
  sections.ts               ★ NEW: section registry + grouping + hidden-set helpers
  firebase.ts               Firebase init (getApps-guarded). Mirrored by lib/firebase.ts.
  worker.ts                 PROD runtime: Cloudflare Worker (Workers AI + D1 + KV + R2 + Static Assets)
  components/
    NaturalConversationProgramming.tsx   ★ MVP chat (local-first + Firestore overlay)
    Viewport3DSection.tsx                ★ 3D viewport (real LLM→SDF→GPU pipeline)
    Sidebar.tsx, Breadcrumb.tsx, CommandPalette.tsx, SettingsPanel.tsx   ★ reorganized
    FloatingAssistant.tsx                context-aware helper; reads data.text ✓
    AuthProvider.tsx                     optional auth, non-blocking
    ide/                                 self-contained IDE workspace
      Model3DView.tsx                    the OTHER real 3D surface (forge + Khronos browser + R2 gallery)
      DeployView/McpView/ClawView        dev-only (hit /api/exec); Unix-only on Windows
  lib/
    meshforge.ts            parametric text-to-3D + GLB export + AI spec parser (offline fallback)
    sdf-compiler.ts         SDF shape-program compiler; composeWithAI/refineProgramWithAI; presets
    sdf-gpu.ts              WGSL WebGPU kernel + compileProgramAuto (GPU→CPU fallback)
    storage.ts              localStorage + Firestore dual-write
    firebase.ts             Firebase init (mirror of src/firebase.ts)
server.ts                   DEV runtime: Express + Vite middleware + /api/fs + /api/exec + Gemini
wrangler.jsonc              prod config: aura.massivenumber.com custom domain, D1/KV/R2/AI bindings
```

### Two `firebase.ts` files
`src/firebase.ts` and `src/lib/firebase.ts` both exist and both init Firebase
(`getApps()`-guarded, so no duplicate-app crash). Imports are split across
components. **Consolidating is a known follow-up** — low risk today, both work.

### Dev server vs Worker
| Route | `server.ts` (dev) | `worker.ts` (prod) |
|---|---|---|
| `/api/chat` | Gemini (GEMINI_API_KEY) | Workers AI via AI Gateway + KV cache |
| `/api/deep-research`, `/api/multi-agent-build` | Gemini | Workers AI |
| `/api/spec` (GET/PUT) | — | D1 `spec_data` |
| `/api/ai-stats` | — | D1 `ai_log` aggregate |
| `/api/media/*` | disk `.forge-gallery/` | R2 `BUCKET` |
| `/api/fs/*`, `/api/exec` | real (workspace files + shell) | **501 by design** |

So the **IDE Workspace** (file browser, terminal, git, Deploy/MCP/Claw views) is dev-only. In production those sub-views degrade gracefully (501 errors). This is intentional — the IDE is a local power tool.

---

## How to run

```bash
npm install
npm run dev          # dev server at http://localhost:3000 (full IDE power tools)
npm run build        # type-check via tsc + vite build → dist/
npm run deploy:cf    # vite build + wrangler deploy → aura.massivenumber.com
```

**Windows desktop launcher:** double-click `AuraFlare.cmd` (builds once, serves at :3000, opens browser). The `AuraFlare.exe` (Node single-executable) is unreliable — use the `.cmd`.

**First-time Cloudflare deploy:** `npx wrangler login` once, then `npm run deploy:cf`.

---

## Known follow-ups (not done this pass)

1. **Consolidate `src/firebase.ts` and `src/lib/firebase.ts`** into one module. Both are guarded against the duplicate-app crash; pick one and update imports.
2. **Workers AI has no native text-to-3D model** (verified July 2026). The current "LLM-driven" path is LLM-→-structured-SDF-program-→-polygonize, which is honest and works offline. A true generative 3D foundation model would need a third-party provider (Fal.ai, Meshy, Rodin) — that's a product/budget decision, not a bug.
3. **`ClawView`/`DeployView`/`McpView`** call Unix-only shell commands (`free -m`, `df -h`, `ps aux`). On Windows dev they return errors. Either branch on platform or mark them Linux-only in the UI.
4. **Bundle size** — `dist/assets/index-*.js` is ~3.4 MB (three.js + monaco + xterm + pixi + tone). Code-splitting with dynamic `import()` for the heavy editors would help first paint significantly.
5. **Chat history** mirrors to Firestore on send but doesn't dedupe perfectly across devices if both write simultaneously. Acceptable for now; a server-side timestamp authority would make it strict.
6. **D1 chat persistence** — `/api/spec` (D1) exists but chat still uses Firestore. If you want to drop Firebase entirely, mirror chat into D1 too.

---

## Git state at handoff

- Branch: `main`
- Two remotes: `auraflare` (harper-454/auraflare — the deploy source) and `origin` (harper-454/ETHAN — backup).
- The 2026-07-05 pass was committed in logical chunks; see `git log --oneline`.
- `.env.local` holds `GEMINI_API_KEY` (gitignored). For production, the Worker uses Workers AI by default; set `GEMINI_API_KEY` via `npx wrangler secret put` only if you want BYOK Gemini at the edge.

---

## Pointers for common next tasks

- **"Make the 3D generate real models like Meshy"** → integrate Fal.ai/Meshy API in `sdf-compiler.ts:composeWithAI` as a higher-tier path before the SDF fallback. Keep SDF as the offline/cheap default.
- **"Add real auth-gated features"** → `useAuth()` is wired; gate specific sections in `App.tsx:renderContent` based on `user`.
- **"Add a new section"** → add to `src/sections.ts` (group + icon + optional `hiddenByDefault`), add a `case` in `App.tsx:renderContent`, add the component. The sidebar, palette, breadcrumb, and settings update automatically.
- **"Speed up first paint"** → dynamic-import `@monaco-editor/react`, `xterm`, `three`, `pixi.js`, `tone` in their respective sections.
