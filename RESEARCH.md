# AuraFlare — Feature Research & Upgrade Roadmap

**Date:** 2026-07-05
**Status:** Research complete. Implementation pending your approval.

This document is the consolidated output of a full SOTA sweep across every sidebar feature (current as of July 2026 — no stale data). Each feature gets: what's there now, what 2026 best-in-class actually looks like, an honest verdict (keep / reframe / cut / merge), and a concrete code-ready upgrade plan ranked by impact and effort.

The 3D Viewport and the MVP chat were already upgraded in prior sessions using this same pattern; this brief covers **everything else**.

A companion **Implementation Roadmap** at the bottom ranks all upgrades into ship-now / next / defer tiers so you can decide where the next coding pass goes.

---

## The one meta-finding that shapes everything

Across ~25 features researched, three patterns repeat:

1. **The codebase is more real than the UI admits.** Many "decorative" components contain genuine implementations (real WGSL kernels, real WebRTC negotiation, real quantum statevectors, real R3F scenes). The upgrade is usually *surfacing real telemetry and wiring real data* — not building from scratch.
2. **Several features are misnamed or redundant.** A handful of sections (Fleet Health MDM, NPU, Satellite Uplink, WebGL Game Engine, Swarm Monitor) wear labels that overpromise what the browser can do or duplicate other sections. Honest reframing (or cutting) is itself a high-leverage move.
3. **A small number of "free wins" exist across the stack.** `/api/ai-stats` already aggregates real AI usage but no dashboard reads it. `/api/spec` D1 endpoints exist but no client calls them. `wrangler.jsonc` declares real infra but the IaC section shows fake "PostgreSQL" + "3 workers." Fixing these is hours, not weeks.

The roadmap at the bottom front-loads those free wins.

---

## Feature verdicts (summary table)

| # | Feature | Current state | Verdict | Top action |
|---|---------|--------------|---------|-----------|
| ✅ | NCP Chat (MVP) | Durable Workflow (done) | **Done** | — |
| ✅ | 3D Viewport | Real LLM→SDF→WebGPU (done) | **Done** | — |
| 1 | IDE Workspace | Monaco + xterm + /api/exec (dev-only) | **Upgrade** | AI inline-edit (NCP→diff), isomorphic-git, OPFS, WebContainers |
| 2 | Deep Research | Single fake "swarm crawl" prompt | **Rebuild** | Real Workflow: Tavily search + fetch + extract + cite |
| 3 | Multi-Agent Builder | Single "simulate agents" prompt | **Rebuild** | Anthropic orchestrator pattern on Cloudflare Agents SDK |
| 4 | Automated Workflows | Firestore config; Force Execute has no handler | **Build engine** | Scheduled Workflow (cron) + Queue + sweep primitives |
| 5 | Real-time Analytics | Reads localStorage; ignores /api/ai-stats | **Wire to real data** | Fetch /api/ai-stats; SSE push; widen ai_log schema |
| 6 | AI Media Studio | Mic recorder + waveform + OS TTS | **Add real gen** | Workers AI image gen (FLUX.2 klein) + Tone.js synth |
| 7 | Cloudflare Edge Matrix | Decorative grid + /api/exec (broken in prod) | **Wire to real data** | GraphQL Analytics API proxy; live DNS/zones |
| 8 | Deploy (IDE tab) | Runs `npx <cli> --version` via /api/exec | **Rebuild** | Cloudflare REST deploy + GitHub workflow_dispatch |
| 9 | WebGPU Compute | Real WGSL kernel (trivial 64-float demo) | **Surface real workloads** | SDF telemetry + real convolution/FFT demos |
| 10 | P2P WASM Compute | Real local-core WASM benchmark (not P2P) | **Reframe** | Honest "WASM Workers" or multi-tab partitioned-render lab |
| 11 | ML Pipelines | Real 1-16-1 MLP trainer | **Reframe** | Split: Backprop Playground + curated RAG/inference pipelines |
| 12 | Database & Schema | localStorage inspector | **Wire to real D1** | Introspect via PRAGMA + react-flow ER diagram |
| 13 | Identity / Passkey | Firebase popup; WebAuthn is client-only (forgeable) | **Rebuild auth** | Better Auth on D1 + server-verified passkeys |
| 14 | Edge Functions | Browser Worker shim (not Cloudflare) | **Rebuild** | Real Workers Versions API management + templates |
| 15 | API Gateway | Probes Express (not Cloudflare) | **Wire to real data** | Real AI Gateway log explorer + multi-provider routing |
| 16 | CI/CD Pipelines | Real local typecheck/audit/build; no actual CI | **Add real CI** | GitHub Actions + wrangler-action + rollback UI |
| 17 | IaC Provisioning | Mock echo; claims "PostgreSQL" + "3 workers" | **Make honest** | Read wrangler.jsonc; thin Terraform for gateway+DNS |
| 18 | Quantum Emulator | Real 3-qubit statevector | **Keep + enhance** | Add Grover/teleport/QFT presets; optionally Qukit (WASM, 20+ q) |
| 19 | NPU / Neuromorphic | Real WebGPU FMA benchmark | **Reframe** | Rename; wire WebNN/ONNX Runtime for real on-device inference |
| 20 | VoIP WebRTC | Real loopback call (SDP/ICE/stats) | **Keep + upgrade** | Real two-peer call via PeerJS/LiveKit; AV1 codec pref |
| 21 | IoT Edge | Real device APIs (battery/net/gamepad) | **Keep + upgrade** | Add Web Serial (Arduino) + Web Bluetooth sensor |
| 22 | Satellite Link | Real ISS tracker (wheretheiss.at) | **Reframe** | Drop "Uplink"; add satellite-js SGP4 pass predictor |
| 23 | AR/VR Bridge | Capability detect only (no rendered scene) | **Keep + upgrade** | Render the 3D viewport into a WebXR session |
| 24 | Time-Travel Debugger | Real localStorage snapshots + rewind | **Keep + upgrade** | Zustand+Zundo for in-memory undo; add action log |
| 25 | Agent Swarm Monitor | Real host CPU/mem telemetry, mislabeled | **Reframe** | Rename "System Telemetry"; add /api/ai-stats card |
| 26 | Spec sections (5) | Real but localStorage-only; D1 unwired | **Consolidate + wire D1** | One "Spec" workspace; cut hallucinated Architecture cards |
| 27 | Dynamic Forms | Real schema-driven builder, no validation/submit | **Reframe or cut** | Adopt RJSF, or delete (Tasks covers it) |
| 28 | WebGL Game Engine | Real R3F scene demo, not a game engine | **Cut/merge** | Merge StatsProbe into 3D Viewport; remove section |
| 29 | Fleet Health MDM | 100% decorative mock | **Cut entirely** | Route concerns to Analytics + AutomatedWorkflows |
| 30 | Billing | Decorative pricing cards (no Stripe) | **Rebuild** | Stripe on Workers; remove fictional features |
| 31 | Account Mgmt | Real Firebase auth + crypto API keys | **Keep (light polish)** | D1/KV-synced keys; entitlement badge |
| 32 | Docs & Support | Real Firestore tickets, no triage/escalation | **Rebuild** | LLM triage → auto-fix trivial / email volcomman7 for major |

**Net: 2 done, 12 rebuild/upgrade, 7 reframe, 3 cut, 8 keep-and-polish.**

---

## PER-FEATURE BRIEFS

> Each brief below is the condensed, code-ready summary. The full research with citations lives in the research-agent outputs; the references are listed per feature.

---

### 1. IDE Workspace — upgrade to a real AI-native IDE

**Now:** Monaco `<Editor>` controlled via `value`/`onChange` (no LSP, no diff view, no AI edits). `xterm ^5.3.0` (the deprecated unscoped package) round-trips each keystroke to `/api/exec`. `yjs` is in deps but `y-monaco` is NOT installed — the "Yjs Sync Active" badge is decorative. `/api/exec` returns 501 in prod, so editor/git/terminal/deploy/claw all silently break at the edge.

**SOTA (2026):**
- **Monaco 0.55.x** is correct (ESM canonical). The biggest 2026 upgrade is `@codingame/monaco-vscode-api` + `monaco-languageclient` for *real* VS Code language services (hover, go-to-def, rename) over a MessageReader. ([TypeFox/monaco-languageclient](https://github.com/TypeFox/monaco-languageclient))
- **`@marimo-team/codemirror-ai`** is the production-grade AI-inline-edit extension (CM6 only). For Monaco, build the equivalent with `monaco.diffEditor` + a custom diff-apply protocol.
- **OPFS** is the 2026 default for in-browser persistent FS (works in Chrome/Edge/Firefox/Safari; no permission prompt; sync I/O in workers). **File System Access API** (`showDirectoryPicker`) for "mount my real folder" on Chromium, with `browser-fs-access` fallback.
- **WebContainers** (StackBlitz) run real `npm install`/`vite` in-browser on Chromium — kills the `/api/exec` dependency for code execution.
- **`isomorphic-git`** does clone/commit/push in pure JS against OPFS — works in prod with no shell. CORS proxy needed for GitHub remotes (self-hosted on a Worker).
- **`y-monaco`** + Yjs over `y-websocket` hosted in a **Durable Object with WebSocket Hibernation** (idle connections nearly free) — real multiplayer, no separate server.
- **`@xterm/xterm` + `@xterm/addon-webgl`** — the maintained line; WebGL2 renderer cuts CPU noticeably.
- **Continue.dev / Cline patterns**: select code → instruction → streamed diff with Tab=accept / Esc=reject. Multi-file agent edits with shadow-git checkpoints.

**Ranked plan:**
| # | Upgrade | Impact | Effort |
|---|---|---|---|
| **U1** | **AI inline-edit: NCP chat generates code → Monaco diff editor with Tab/Esc accept/reject** (the missing "Cursor in browser" feel) | 🔥🔥🔥 | M |
| **U2** | **`isomorphic-git` replaces all git `/api/exec` calls** (works in prod) | 🔥🔥🔥 | S |
| **U3** | **OPFS-backed VirtualFs** (`/api/fs` becomes fallback) | 🔥🔥🔥 | M |
| **U4** | **Migrate `xterm` → `@xterm/xterm` + `@xterm/addon-webgl`** | 🔥🔥 | S |
| **U5** | **Real Yjs collab: `y-monaco` + DO WebSocket Hibernation** | 🔥🔥 | M |
| **U6** | **Pluggable ShellProvider: WebContainer → pty-WS → http-exec** | 🔥🔥🔥 | L |
| **U7** | **`monaco-languageclient` for real TS LSP** in a worker | 🔥🔥 | L |

**Sources:** [microsoft/monaco-editor](https://github.com/microsoft/monaco-editor), [TypeFox/monaco-languageclient](https://github.com/TypeFox/monaco-languageclient), [@marimo-team/codemirror-ai](https://github.com/marimo-team/codemirror-ai), [stackblitz/webcontainer-core](https://github.com/stackblitz/webcontainer-core), [isomorphic-git](https://github.com/isomorphic-git/isomorphic-git), [y-monaco docs](https://docs.yjs.dev/ecosystem/editor-bindings/monaco), [DO WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websocket-hibernation/), [GoogleChromeLabs/browser-fs-access](https://github.com/GoogleChromeLabs/browser-fs-access).

---

### 2. Deep Research — make the swarm real

**Now:** `DeepResearchSection.tsx` + `/api/deep-research` send one prompt that says *"Imagine you are crawling foreign websites"* to the LLM and ship back hallucinated markdown with a fake "1,204 Proxy Nodes / Bypass Logic Enabled" telemetry panel.

**SOTA (2026):** OpenAI Deep Research, Gemini Deep Research, Perplexity Sonar, Grok DeepSearch all converge on: **long-running (2–45 min) multi-pass agent loop issuing 20–50 real web searches, reading ~40 pages, emitting a long structured report with inline citations**. The shared contract for credibility: real fetched URLs, an agent loop with visible progress, a long structured report.

**The Cloudflare-native architecture:**
- **Search API**: Tavily (1,000 free credits/mo, purpose-built for agents — returns answer + snippets + `raw_content`) is the recommended primary. Exa, Serper, Brave are alternatives. Routed through your AI Gateway for caching/limits.
- **Page fetch + extract**: Worker `fetch()` + `@mozilla/readability` + `linkedom` for 90% of pages. Cloudflare Browser Rendering as a JS-rendered fallback (~$0.09/hr, 10 min/day free).
- **Agent loop**: a new `DeepResearchWorkflow extends WorkflowEntrypoint` mirroring the proven `ChatWorkflow` shape — `plan → search (parallel) → triage → fetch (parallel) → reflect → loop or synthesize`. Capped at 4 turns. Free tier supports ~150–300 full runs/day.
- **Citations**: every `^[n]^` resolves to a row in a new `research_sources` D1 table. **If the URL wasn't actually fetched, it must not appear.** Source cards with favicon + title + URL.
- **The multilingual gimmick is mostly wrong.** Search engines rank by authority regardless of language; foreign-language crawl usually returns *worse* results. Keep an "Output language" picker (real translation via `@cf/meta/m2m100-1.2b`), but make foreign-language search query-driven, not the headline feature.

**Honest ceiling:** you will not match o3-deep-research quality (RL-trained end-to-end). You can credibly beat the open-source field (GPT-Researcher, Perplexica, open-deep-research) on **durability** (Workflows survive browser close — they can't) and tie them on quality.

**Sources:** [openai.com/index/openai-deep-research](https://openai.com/index/openai-deep-research/), [Perplexica](https://github.com/ItzCrazyKn/Perplexica), [gpt-researcher](https://github.com/assafelovic/gpt-researcher), [open-deep-research](https://github.com/langchain-ai/open-deep-research), [Cloudflare AI Gateway web search](https://developers.cloudflare.com/ai-gateway/usage/web-search/), [Tavily](https://tavily.com).

---

### 3. Multi-Agent Builder — real orchestration, not a simulation

**Now:** one prompt: *"Simulate a multi-agent build process… Return a markdown log of their collaboration."* Plus a fake "consensus" output.

**SOTA (2026):** Anthropic's orchestrator-worker pattern is the canonical reference — LeadAgent (Opus) plans → 3–5 parallel subagents (Sonnet) with isolated context windows → separate CitationAgent attributes claims. **90.2% better than single-agent on their research eval, ~15× token cost.** The honest consensus: multi-agent is worth it ONLY when (a) the task spans multiple domains AND (b) parallelization gives measurable gains. Below 2 distractor domains, single-agent wins.

**Cloudflare-native architecture (the right way):**
- Adopt the **Cloudflare Agents SDK** (`cloudflare/agents`, v0.7+ GA). `Agent`/`AIChatAgent` classes extend **Durable Objects**. First-class multi-agent primitives: `agentTool()` (declare an agent as a tool), `runAgentTool()` (imperative fan-out, **idempotent by runId**), `detached` background runs with `maxBudgetMs` + `noProgressBudgetMs` (your built-in anti-runaway-cost guardrail), `reportProgress()` milestones, `useAgentToolEvents()` React hook for per-agent streaming timelines.
- Add bindings: `durable_objects` (orchestrator), `vectorize_indexes` (semantic memory per-agent via metadata filter `{agentId}`).
- **Pattern to ship:** Orchestrator DO → plans briefs → `Promise.allSettled` of `runAgentTool(Specialist, brief)` for each persona → `SynthesisAgent` (separate context window) reconciles. Stream `agent-tool-event` frames over a WebSocket the UI subscribes to. Hard-cap every run with `maxBudgetMs` + `stepCountIs(N)`.
- **Honest verdict for the current "build a markdown plan" use case:** overkill — a single strong agent with a good plan prompt produces comparable output for ~1/15 the tokens. Worth it only if "Multi-Agent Build" expands to genuine parallel work (each specialist queries memory+tools, produces its own artifact) OR for the UX differentiation (live per-agent timelines, drill-in, resumable builds). If kept as one-shot, drop multi-agent and use a single plan-and-execute loop.

**Sources:** [Anthropic multi-agent research](https://www.anthropic.com/engineering/multi-agent-research-system), [Cloudflare Agents SDK](https://github.com/cloudflare/agents), [agent-tools.md](https://github.com/cloudflare/agents/blob/main/docs/agents/agent-tools.md), [LangGraph supervisor](https://www.langchain.com/blog/benchmarking-multi-agent-architectures).

---

### 4. Automated Workflows — build the actual sweep engine

**Now:** Firestore `users/{uid}/workflows` config storage; the **"Force Execute" button has no `onClick` handler**. AGENTS.md directive #3 (multi-time-per-day sweep) and #4 (auto-fix trivial / alert major) are unimplemented.

**SOTA (2026):** **Cloudflare Workflows gained direct cron schedules in June 2026** — a `schedules` array on a Workflow binding in `wrangler.jsonc` creates instances automatically on a cadence (no `scheduled()` handler needed). Pair with **Queues** for remediation fan-out and **AI Gateway spend limits** (returns HTTP 429 on over-budget) as the hard cost backstop.

**What can actually be swept (honest inventory):**
1. **D1 bloat** (chat_messages/ai_log/chat_runs append-only, no VACUUM, 10 GB cap) — highest value
2. **AI spend anomaly** (your `ai_log` already records every call — compute 1h vs 7-day baseline)
3. **R2 orphans** (diff referenced keys vs `BUCKET.list()`)
4. **KV staleness** (mostly handled by native TTL)
5. **p95 latency regression** (from ai_log + Workflow durations)
6. **Memory leaks** — N/A at the edge (per-request runtime); translate to latency/error regression.

**The plan:** New `MaintenanceSweepWorkflow` with steps: `collect d1 metrics` → `detect ai spend anomaly` → `scan r2 orphans` → `route outcomes` (auto-remediate via Queue or alert via Cloudflare Email). Bind it on a 4-hour schedule. Decision framework: trivial (R2 orphan, KV stale) = auto-fix; medium (D1 80% full) = archive + alert; high (spend 3σ, p95 2× regression, anything payments) = alert only — never auto-touch AccountManagement.

**Prereq:** widen the `ai_log` schema — it currently lacks `created_at`, `tokens_in/out`, `cost_usd`, `status`. Without timestamps you cannot do time-windowed anomaly detection.

**Sources:** [Trigger Workflows (scheduled)](https://developers.cloudflare.com/workflows/build/trigger-workflows/), [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/), [AI Gateway spend limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/), [Cloudflare Queues](https://developers.cloudflare.com/queues/), [D1 has no auto-VACUUM](https://github.com/cloudflare/cloudflare-docs/issues/1618).

---

### 5. Real-time Analytics — connect to data that already exists

**Now:** `AnalyticsDashboard.tsx` reads `localStorage` (real client FPS/heap/localStorage footprint) but **never calls `/api/ai-stats`**, which already aggregates `ai_log` by endpoint (calls, avg latency, cache hits). The most valuable metrics are invisible.

**SOTA (2026):** Stay on **recharts 3.x** (React 19 compatible, already shipped; ECharts/Tremor would be a vanity rewrite). For real-time push, **Server-Sent Events** is the right default (one-way, native EventSource, survives reconnects). The 2026 gotcha: Cloudflare's HTTP edge returns **524 after ~100s**, so SSE needs a heartbeat every ~30s OR a Durable Object holding the stream past the edge boundary.

**Honest scope:** this is **infra + AI usage**, not product analytics. There is no event instrumentation for cohort/funnel/retention — pretending otherwise would hallucinate data. Real available metrics: AI calls/cache/latency/spend over time, Workflow run status + duration p50/p95, D1/R2/KV growth (via GraphQL Analytics API), client FPS/heap.

**Plan:** Tier 1 — swap localStorage reads for `/api/ai-stats`, add Workflow status donut + duration sparkline + cache-hit gauge. Tier 2 — SSE `/api/metrics/stream` with DO holding the connection; EventSource on the client replaces the 2s poll. Tier 3 — four honest panels (AI Usage / Workflow Health / Infra Health / Client Diagnostics). **Depends on the ai_log migration.**

**Sources:** [Recharts v3 vs Tremor vs Nivo 2026](https://www.pkgpulse.com/guides/recharts-v3-vs-tremor-vs-nivo-react-charting-2026), [shadcn/ui charts](https://ui.shadcn.com/charts), [D1 GraphQL Analytics](https://developers.cloudflare.com/d1/observability/metrics-analytics/), [R2 metrics](https://developers.cloudflare.com/r2/platform/metrics-analytics/).

---

### 6. AI Media Studio — free Workers AI image gen is the headline

**Now:** Mic recorder + waveform + OS TTS. The `tone` and `pixi.js` deps are installed but **unused**. No image-gen endpoint exists despite Workers AI offering FLUX models free under your plan.

**SOTA (2026):**
- **Image gen via Workers AI** — `@cf/black-forest-labs/flux-2-klein-4b` (launched 2026-01-15, fixed 4-step, lowest latency, up to 4 reference images) is the right default. Call `env.AI.run("@cf/...flux-2-klein-4b", {prompt})` → returns a **binary PNG `ReadableStream`** (note: image models return a stream, NOT the `{response}` JSON envelope). Stream into `env.BUCKET.put()`. Free under your AI Gateway. ([FLUX.2 changelog](https://developers.cloudflare.com/changelog/post/2026-01-15-flux-2-klein-4b-workers-ai/))
- **Tone.js v15** — real synth studio: `PolySynth` + FX chain (`Reverb`, `FeedbackDelay`) + `Tone.Sequence` 16-step grid + `Tone.Recorder` → upload Blob to `/api/media`. ~1–2 days to a playable synth+sequencer.
- **PixiJS v8** — filter rack (`ColorMatrixFilter`, `BlurFilter`, custom GLSL) over a generated image Sprite; brushes via Graphics+pointer events. No new deps.
- **Photopea embed** (`<iframe src="https://www.photopea.com">` + postMessage) — borrow a Photoshop clone for ~20 lines for power users.
- **Remotion 4.0** `@remotion/web-renderer` — true in-browser video render; only if timed video composition is a real goal.
- **WebCodecs** ~95.5% support — `canvas.captureStream()` + `MediaRecorder` for short clip export (10-line answer).

**Plan:** A-1 (image gen endpoint, **highest ROI in the whole brief**) → A-2 (Tone.js synth) → A-3 (PixiJS editor) → A-4 (Photopea embed) → A-5 (canvas video export). All use existing deps + Workers AI; no paid APIs.

**Sources:** [FLUX.2 klein 4B](https://developers.cloudflare.com/changelog/post/2026-01-15-flux-2-klein-4b-workers-ai/), [FLUX.2 on Workers AI blog](https://blog.cloudflare.com/flux-2-workers-ai/), [Tone.js](https://tonejs.github.io/), [PixiJS v8 filters](https://pixijs.com/8.x/guides/components/filters), [Remotion 4.0](https://www.remotion.dev/blog/4-0), [Photopea API](https://www.photopea.com/api/).

---

### 7. Cloudflare Edge Matrix + 8. Deploy — wire to the real Cloudflare account

**Now:** Both rely on `/api/exec` (returns 501 in prod → broken at the edge). Edge Matrix shows `cdn-cgi/trace` via a Node shell hack + browser latency probes. DeployView stubs 9 targets but only runs `npx <cli> --version`. None of it is about *your* actual deployment.

**SOTA (2026):** The **Cloudflare GraphQL Analytics API** (`POST api.cloudflare.com/client/v4/graphql`, bearer-token) exposes the same datasets the CF dashboard uses: `workersInvocationsAdaptive` (requests/errors by scriptName), `d1QueriesAdaptiveGroups` (rowsRead/Written, query latency), `r2StorageAdaptiveGroups` (bucket size), `d1StorageAdaptiveGroups`. Add a server-side proxy endpoint (`POST /api/edge/analytics` with `CF_API_TOKEN` secret) to keep the token out of the browser.

**Deploy (real, in 2026):**
- **GitHub `workflow_dispatch`** → Actions runs `npm run deploy:cf` is the safe 2026 pattern (no destructive token in the browser; audit trail in Actions).
- Or direct REST for single-tenant: `PUT /accounts/{id}/workers/scripts/{name}` (multipart) + the new Beta **Versions/Deployments API** (2025-09-03) for upload-then-promote and instant rollback (100 retained versions).
- Of the 9 deploy targets, only **Cloudflare, Vercel, Render, Railway** are worth real implementation. Relabel GitHub/GitLab as "repo sync." **Drop ngrok and dogpu.**

**Plan:** B-1 GraphQL proxy + live DNS/zones/certs (single `CF_API_TOKEN` secret) → B-2 fix cdn-cgi/trace server-side → B-3 real deploy via workflow_dispatch → B-4 prune to 4 targets. The single biggest credibility win: delete the `/api/exec`-based hacks that silently 501 in prod.

**Sources:** [GraphQL Analytics API](https://developers.cloudflare.com/analytics/graphql-api/), [new Workers REST API Beta (2025-09-03)](https://developers.cloudflare.com/changelog/post/2025-09-03-new-workers-api/), [Workers rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/), [Vercel REST](https://vercel.com/docs/rest-api), [Render API](https://render.com/docs/api).

---

### 9. WebGPU Compute — surface the real kernel you already have

**Now:** A real WGSL compute pipeline drives a 64-float VRAM grid (trivial). The static "1.24 TFLOPS / 8,192 shaders" readouts are theater. Meanwhile `src/lib/sdf-gpu.ts` is a genuinely sophisticated fused WGSL kernel (SDF eval + marching tets + atomic allocation + gradient normals) — the strongest real compute asset in the repo.

**SOTA (2026):** WebGPU is now production-ready and **shipping by default in all four major browsers** (Chrome/Edge always; Safari 26 Apple Silicon; Firefox 141+ Windows). ~70% global support. Real compute workloads worth exposing: image convolution, FFT (`wgsl-fft`), particle/fluid sims, ML inference. **TypeGPU** is the standout TS↔WGSL type-safety toolkit.

**Verdict:** Defensible as a standalone "Compute Lab" — but only if it stops being one trivial demo. Surface real SDF-GPU telemetry (triangle count, dispatch ms, backend, workgroup size), add 2–3 genuine demos (convolution, FFT, particles), and replace the static TFLOPS with measured numbers from `adapter.requestAdapterInfo()` + a real microbenchmark.

**Sources:** [gpuweb Implementation Status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status), [TypeGPU](https://docs.swmansion.com/TypeGPU/), [wgpu 26](https://github.com/gfx-rs/wgpu), [wgsl-fft](https://crates.io/crates/wgsl-fft), [Joan León WebGPU image processing](https://joanleon.dev/en/webgpu-image-processing/).

---

### 10. P2P WASM Compute — be brutal, this is mostly theater

**Now:** Real hand-assembled WASM module across real Web Workers benchmarking WASM-vs-JS — but it's **local-core, not P2P**. The "P2P" and "decentralized" framing is unsupported by the code.

**SOTA (2026):** WASM 3.0 shipped 2025 (GC, exception handling, SIMD, threads all broad browser support). Component Model momentum has stalled in browsers — bridge today is `jco transpile` at build time. WebRTC is the only browser P2P transport; **always needs a signaling server** (no true serverless browser-to-browser).

**The hard truth:** P2P browser compute does not make sense for almost any real workload. Background-tab throttling (Chrome M87+ throttles to once-per-minute), tab eviction under memory pressure, WebRTC overhead vs WASM throughput, battery drain ethics, and the signaling-server requirement all conspire. **Real distributed-compute projects (BOINC, Folding@home) fled the browser** for native clients years ago.

**Defensible scope:** either (a) honestly rebrand as "WASM Workers" (the local-core benchmark is already real and measures real speedup), or (b) ship a multi-tab partitioned-render *lab demo* (WebRTC mesh across 2–3 of the user's own tabs, one renders left half, another right half) with an explicit "research demo" disclaimer. **Do not ship a "decentralized browser compute network" — that claim is not defensible in 2026.**

**Sources:** [State of WASM 2026](https://devnewsletter.com/p/state-of-webassembly-2026/), [WASM features](https://webassembly.org/features/), [PeerJS](https://peerjs.com/), [Chromium tab throttling M87](https://blog.chromium.org/2020/11/tab-throttling-and-more-performance.html), [BOINC](https://boinc.berkeley.edu/), [Folding@home](https://foldingathome.org/).

---

### 11. ML Pipelines — split the toy from the real

**Now:** `MLPipelines.tsx` runs a **real** 1-16-1 MLP trainer (genuine backprop) at toy scale. The decorative pipeline graph implies more.

**SOTA (2026):** In-browser ML is **inference-first, not training.** Transformers.js **v4** (released 2026, C++ WebGPU runtime, 8B+ models in-browser). ONNX Runtime Web v1.25 first-class WebGPU. MediaPipe Tasks Web. TF.js WebGPU backend. Real latency: Llama 3.1 8B (4-bit) ~41 tok/s on M3 Max. Workers AI: `@cf/meta/llama-3.1-8b-instruct` ($0.011/1k Neurons, free allocation). **Vectorize** for RAG (Cloudflare's vector DB) + AutoRAG managed RAG.

**Verdict — split the section:**
- Keep the MLP trainer as an honest **"Backprop Playground"** micro-demo (real math, great loss-curve viz) — just rename and reframe.
- Build the real "ML Pipelines" around **curated inference pipelines**, not a visual node-graph builder (Langflow/Flowise/n8n own that market; you won't out-build them):
  - **RAG**: doc → Workers AI embeddings → Vectorize → Llama 3.1 answer (uses Cloudflare infra you have).
  - **Transcribe → Summarize → Translate**: in-browser Whisper (Transformers.js v4 WebGPU, privacy win) → Llama summary → translation model.
  - **Image → Caption → Tag**: image model → Llama caption → embedding into Vectorize.

**Sources:** [Transformers.js v4](https://huggingface.co/blog/transformersjs-v4), [ONNX Runtime Web roadmap](https://onnxruntime.ai/roadmap), [MediaPipe Tasks Web](https://developers.google.com/edge/mediapipe/solutions/tasks), [Workers AI Llama 3.1](https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct/), [Vectorize RAG tutorial](https://developers.cloudflare.com/workers-ai/guides/tutorials/build-a-retrieval-augmented-generation-ai/), [AutoRAG](https://blog.cloudflare.com/introducing-autorag-on-cloudflare/).

---

### 12. Database & Schema Visualizer — wire to real D1

**Now:** Reads localStorage. Has zero awareness of D1 despite "LIVE" badge.

**SOTA (2026):** D1 GA since April 2024. **10 GB cap, no auto-VACUUM.** **Time Travel** (GA) — point-in-time recovery to any minute in last 30 days. **Global read replication PUBLIC BETA** (free, sequential consistency via Sessions API). Schema introspection via `sqlite_master` + PRAGMAs (`table_info`, `foreign_key_list`, `index_list`) — no `information_schema`. Query analytics via GraphQL Analytics API (`d1QueriesAdaptiveGroups`). `@xyflow/react` (react-flow v12) ships a purpose-built Database Schema node example. `wrangler d1 migrations` is the canonical migration tool.

**BLOCKER found:** `migrations/0001_chat_history.sql` only creates `chat_messages` + `chat_runs`. **It does NOT create `spec_data` or `ai_log`**, which `worker.ts` writes to (`PUT /api/spec`, `logAi()`, `/api/ai-stats`). Either they exist out-of-band or those endpoints are throwing at runtime. **Fix this first** with `migrations/0002_spec_and_ai_log.sql`.

**Plan:** Fix schema drift → add `GET /api/schema` introspection endpoint → react-flow ER view → read-only query analytics via GraphQL proxy → (defer) admin CRUD gated behind identity work.

**Sources:** [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [D1 read replication beta](https://blog.cloudflare.com/d1-read-replication-beta/), [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), [@xyflow/react](https://reactflow.dev/).

---

### 13. Identity / SSO / Passkey — rebuild auth properly

**Now:** Firebase Google popup (optional). **`WebAuthnNode.tsx` is server-less — challenge is generated client-side, credential stored in localStorage, no server verification. Forgeable by editing localStorage.** D1 has no `user_id` columns; "logged-in" restricts nothing.

**SOTA (2026):**
- **Better Auth 1.5+** added **Cloudflare D1 as a first-class adapter** (pass your D1 binding directly). TypeScript, MIT, self-hosted. Ships email/password, social OAuth, 2FA, **passkey plugin**, **organization plugin with RBAC**, and as of 1.5 an **OAuth 2.1 / OIDC provider plugin** so you can *be* the IdP. Current line 1.7 RC. (Critical: pin ≥1.3.26 — CVE in the API-keys plugin.)
- **`@simplewebauthn/server` v13** for passkeys done right — server-issued challenge, `verifyRegistrationResponse()` / `verifyAuthenticationResponse()`. Primary auth, not 2FA. Conditional UI (`mediation: 'conditional'` + `<input autocomplete="webauthn">`) for the passkey-in-username-field UX. Sync via iCloud Keychain / Google Password Manager / 1Password / Bitwarden.
- **Sessions: D1-backed, opaque id in httpOnly+Secure+SameSite cookie.** Revocable instantly. JWT only as short-lived access token (never as browser session — "please don't use JWTs for browser sessions").
- **Migrate off Firebase** as a phased bridge: federate Firebase as an OAuth provider behind Better Auth, identity-link by email, keep Firestore as cold-storage reader, add `user_id` to D1 tables.

**Plan:** Step 1 (1 day, removes the most embarrassing gap) — server-side passkey verification with `@simplewebauthn/server`. Step 2 — Better Auth on D1 (sessions + OAuth + passkeys + RBAC in one shot). Step 3 — add `user_id` to chat tables; enforce `WHERE user_id = ?` everywhere. Step 4 — Firebase migration bridge.

**Sources:** [Better Auth 1.5 D1 support](https://better-auth.com/blog/1-5), [Better Auth plugins](https://better-auth.com/docs/plugins), [@simplewebauthn/server v13](https://simplewebauthn.dev/docs/packages/server), [passkeys.dev](https://passkeys.dev/), [Don't use JWTs for sessions](https://ianlondon.github.io/posts/dont-use-jwts-for-sessions/).

---

### 14. Edge Functions + 15. API Gateway — both rebuild against real Cloudflare

**Edge Functions now:** spins up a browser `Worker` shim — NOT a Cloudflare Worker. No bindings, no deployment, no logs.

**API Gateway now:** probes the local Express server — touches nothing in Cloudflare. Meanwhile the app **already routes 100% of inference through AI Gateway** and logs every call to D1 `ai_log`.

**SOTA (2026):**
- **Edge Functions:** the new Beta Workers REST API (2025-09-03) treats Worker/Version/Deployment as separate resources — enables real edit→rollout→rollback. **Critical footgun:** every Version upload requires the *full* bindings manifest; never let users mutate the host `auraflare` Worker from a text box (could wipe D1/AI/Workflow bindings). Safe scope: deploy standalone utility Workers from templates (webhook receiver, image resizer, redirect map, KV counter, AI proxy) under distinct script names. **Tail Workers** give live log streaming.
- **API Gateway:** AI Gateway now has **spend limits** (returns 429 on over-budget), **Unified OpenAI-compatible `/chat/completions`**, **Dynamic Routing** (primary→fallback config), **secure key storage**, **GraphQL Analytics**. The Universal Endpoint is deprecated — use Unified + Dynamic Routing. The JSON config API for Dynamic Routing isn't fully documented yet (cloudflare-docs#27334) — surface current limits read-only and deep-link to dashboard for writes; don't fake writes.

**Plan:** Edge Functions — read-only host-Worker panel + 5 deployable templates + Tail Worker log stream. API Gateway — request-log explorer over the existing `ai_log` (B1, free win), widen schema (B2), GraphQL pull for ground-truth cost (B3), request-level controls (B4), multi-provider routing via gateway Unified endpoint (B5).

**Sources:** [new Workers REST API Beta](https://developers.cloudflare.com/changelog/post/2025-09-03-new-workers-api/), [Tail Workers](https://developers.cloudflare.com/workers/observability/logs/workers-tail-workers/), [AI Gateway spend limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/), [AI Gateway Dynamic Routing](https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/), [AI Gateway Aug 2025 refresh](https://blog.cloudflare.com/ai-gateway-aug-2025-refresh/).

---

### 16. CI/CD Pipelines + 17. IaC — real GitHub Actions + honest wrangler-as-IaC

**CI/CD now:** CIDashboard runs real local typecheck/audit/build via `/api/exec` (dev-only). No actual CI, no PR previews, no rollback.

**IaC now:** `handleProvision` runs `echo "mocking terraform..."`. Claims "PostgreSQL Managed Database" + "Edge Compute Workers x3" — both fictional (the app uses D1 and one Worker).

**SOTA (2026):**
- **`cloudflare/wrangler-action@v3.14.1`** is the canonical GitHub Action. Native OIDC/trusted-publishing is NOT yet supported (still needs a long-lived `CLOUDFLARE_API_TOKEN` secret — issue #402). **Cloudflare Workers Builds is GA** (push-to-deploy, 3,000 free build-min/mo) but `wrangler.jsonc` config support is still pending (#10802). **Per-branch preview URLs** shipped 2025-07-23. **Rollbacks** to 100 prior versions via the Versions API — free, instant.
- **Triggering deploys from the app:** `workflow_dispatch` (POST `/repos/.../actions/workflows/{id}/dispatches`) is the safe pattern. Avoid `repository_dispatch` (default-branch-only).

**IaC verdict (the honest answer):** `wrangler.jsonc` is **already effective IaC** for the Worker + its bindings. You do NOT need Terraform for the Worker — dual-management causes state fights. Terraform adds genuine value only for: **AI Gateway** (new `cloudflare_ai_gateway` resource in provider v5.19.0, not manageable from wrangler), **zone/DNS/WAF** for `aura.massivenumber.com`, and **drift detection**. The pragmatic path: keep wrangler as Worker IaC, add a *thin* Terraform layer for gateway+DNS+drift only. **CDKTF is deprecated (Dec 2025) — don't start new work on it.** SST Ion 3 / Pulumi are the TS-native alternatives if HCL feels wrong.

**Plan:** Tier 1 — `.github/workflows/deploy.yml` running `npm run deploy:cf` on push to main (highest ROI). Tier 2 — rollback UI via Versions API + real metrics from GitHub+Cloudflare APIs. Tier 3 — preview URLs per PR. For IaC: Tier 1 — make `IaCProvisioningSection` read real `wrangler.jsonc` and run `wrangler deploy --dry-run` (one-day honesty win). Tier 2 — thin Terraform for gateway+DNS+drift. **Do not** dual-manage the Worker in both wrangler and TF.

**Sources:** [cloudflare/wrangler-action](https://github.com/cloudflare/wrangler-action/releases), [Workers Builds GA](https://blog.cloudflare.com/cloudflare-developer-platform-keeps-getting-better-faster-and-more-powerful/), [preview URLs 2025-07-23](https://developers.cloudflare.com/changelog/post/2025-07-23-workers-preview-urls), [Workers rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/), [terraform-provider-cloudflare v5.19](https://github.com/cloudflare/terraform-provider-cloudflare/releases).

---

### 18–24. Showcase features (the honest verdicts)

These were each researched at full depth. Summary verdicts:

| Feature | Code real? | 2026 SOTA? | Verdict | Top action |
|---|---|---|---|---|
| **Quantum Emulator** | Yes (3-qubit statevector, H/X/Z/CNOT) | Yes (Qukit WASM 20+ qubits; Q.js) | **Keep + enhance** | Add Grover/teleport/QFT presets; optionally Qukit for 15–20 q |
| **NPU / Neuromorphic** | Real WebGPU FMA benchmark (not NPU) | WebNN origin trial Chrome 146/150; **neuromorphic silicon = zero web access** | **Reframe** | Rename `NeuromorphicHardwareSection` → `NeuralInferenceSection`; wire ONNX Runtime Web + WebNN; delete all "spiking/Loihi" copy |
| **VoIP WebRTC** | Real loopback (SDP/ICE/getStats) | Yes (WebRTC universal; AV1+SVC real; LiveKit native SIP) | **Keep + upgrade** | Real two-peer call via PeerJS/LiveKit; AV1 codec pref |
| **IoT Edge** | Real device APIs (battery/net/gamepad) | Yes (Web Serial in Firefox 151 May 2026; BLE/USB Chromium-only) | **Keep + upgrade** | Add Web Serial (Arduino/ESP32) + Web Bluetooth sensor; honest capability badges |
| **Satellite Link** | Real ISS tracker (wheretheiss.at) | Yes for tracking (satellite-js SGP4 + CelesTrak); **no uplink/PSTN API** | **Reframe + rename** | Drop "Uplink"; add satellite-js pass predictor from geolocation |
| **AR/VR Bridge** | Capability detect only (no rendered scene) | Yes (WebXR mature; AVP off-by-default; three.js works) | **Keep + upgrade** | Render the existing 3D viewport into a WebXR session; `<model-viewer ar>` for mobile |
| **Time-Travel Debugger** | Real localStorage snapshots + rewind | Yes (Zundo, Zustand devtools, Replay.io) | **Keep + upgrade** | Zustand+Zundo for in-memory undo (no reload); add action log |

**The two to be most honest about: NPU and Satellite.** Both are real code doing real things, but their names imply capabilities the browser categorically cannot deliver in 2026 (neuromorphic-silicon access, satellite radio transmission). Rename them; don't just polish them.

**Sources:** [WebNN spec](https://www.w3.org/TR/webnn/), [Q.js](https://quantumjavascript.app/), [Qukit](https://lib.rs/crates/qukit), [WebRTC AV1 (Meta June 2026)](https://engineering.fb.com/2026/06/22/video-engineering/adopting-av1-for-real-time-communication-rtc-meta/), [Firefox 151 Web Serial](https://www.hackster.io/news/mozilla-finally-adds-web-serial-support-to-firefox-starting-in-firefox-151-74ea75fdb9c6), [satellite-js](https://github.com/shashwatak/satellite-js), [CelesTrak GP data](https://www.celestrak.org/NORAD/documentation/gp-data-formats.php), [WWDC24 WebXR](https://developer.apple.com/videos/play/wwdc2024/10066/), [Zundo](https://github.com/charkour/zundo), [Replay.io](https://www.replay.io/).

---

### 25–32. Spec / Admin / Support features

| Feature | Verdict | Top action |
|---|---|---|
| **Agent Swarm Monitor** | **Reframe** → "System Telemetry" | Rename; it's real host CPU/mem telemetry, not agent swarm. Add `/api/ai-stats` card. |
| **Spec sections (5)** | **Consolidate + wire D1** | One "Spec" workspace; **wire the existing `/api/spec` D1 endpoints** (`useAutoSave` only writes localStorage today); cut `ArchitectureSection`'s 28 hallucinated cards (incl. fictional "Cloudflare Payment Collector"). |
| **Dynamic Forms** | **Reframe (RJSF) or cut** | Real builder but no validation/submit; adopt react-jsonschema-form or delete (Tasks covers structured capture). |
| **WebGL Game Engine** | **Cut/merge** | Real R3F scene but not a game engine; redundant with 3D Viewport. Merge `StatsProbe` into 3D Viewport; remove section. |
| **Fleet Health MDM** | **Cut entirely** | 100% decorative mock with fictional assets. MDM model doesn't apply. Route real concerns to Analytics + AutomatedWorkflows. |
| **Billing** | **Rebuild** | Stripe on Workers (`stripe-node` + `nodejs_compat`); Checkout + Customer Portal. Remove fictional Enterprise features ("Quantum Telemetry," "Neuromorphic Hardware"). |
| **Account Mgmt** | **Keep (light polish)** | Real Firebase auth + crypto API keys. Sync keys to D1/KV; add entitlement badge. |
| **Docs & Support** | **Rebuild** | Real Firestore tickets but no triage. LLM-triage → auto-fix trivial / email volcomman7@gmail.com for major (per directive #4). |

**Sources:** [Stripe on Workers](https://github.com/stripe-samples/stripe-node-cloudflare-worker-template), [Cloudflare payments reality (no processor; Monetization Gateway is for agents)](https://blog.cloudflare.com/monetization-gateway/), [Linear 2026 spec patterns](https://linear.app), [react-jsonschema-form](https://rjsf-team.github.io/react-jsonschema-form/).

---

## IMPLEMENTATION ROADMAP

Ranked by **impact ÷ effort**, grouped into ship-now / next / defer tiers. Each item lists the feature it advances and the dependency chain.

### Tier 1 — Ship now (highest ROI, mostly "free wins" / honesty fixes)

These are changes where the data/infra already exists and the work is plumbing, or where a dishonest/decorative surface needs to become honest. Most are hours-to-a-day each.

| # | Upgrade | Feature | Effort | Why first |
|---|---|---|---|---|
| **1.1** | **Widen `ai_log` schema** (`created_at`, `tokens_in/out`, `cost_usd`, `status`, `provider`) + backfill `spec_data`/`ai_log` migrations | Analytics, Workflows, Gateway | S | Unblocks ~60% of the dashboard value; fixes silent endpoint failures |
| **1.2** | **Wire `/api/spec` D1 endpoints** into `useAutoSave` (debounced fan-out after localStorage write) | Spec sections, Forms, API keys | S | Endpoints exist and are unused; one change cloud-persists 5 sections |
| **1.3** | **Replace Analytics localStorage reads with `/api/ai-stats`** + add cache-hit gauge + Workflow status donut | Analytics | S | Data already flowing; highest-credibility UI fix |
| **1.4** | **Make IaC section honest**: read real `wrangler.jsonc`, run `wrangler deploy --dry-run`, delete "PostgreSQL/3-workers" claims | IaC | S | Removes embarrassing false claims; one-day win |
| **1.5** | **Cut Fleet Health MDM**, **merge WebGL Engine into 3D Viewport**, **cut hallucinated Architecture cards** | Multiple | S | Removes fictional content; cleans the sidebar |
| **1.6** | **Reframe misnamed sections**: Swarm→"System Telemetry", NPU→"Neural Inference", Satellite→"Tracking", drop "Uplink" everywhere | Multiple | S | Honesty; no code logic change, just labels + copy |
| **1.7** | **Server-side passkey verification** with `@simplewebauthn/server` (delete the forgeable localStorage store) | Identity | S–M | Removes the most embarrassing security gap in 1 day |
| **1.8** | **Workers AI image-gen endpoint** `POST /api/media/generate` (FLUX.2 klein) → R2 | Media Studio | S | Highest-ROI single endpoint in the whole brief; free under your plan |
| **1.9** | **`.github/workflows/deploy.yml`** running `npm run deploy:cf` on push to main (wrangler-action@v3) | CI/CD | S | One change converts manual deploys to push-to-deploy |
| **1.10** | **`isomorphic-git` replaces git `/api/exec` calls** + **fix `cdn-cgi/trace` server-side** | IDE, Edge Matrix | S | Both work in prod (no shell needed); kills 501s |

**Tier 1 ships ~60% of the perceived quality improvement for ~30% of the total effort.**

### Tier 2 — Next (real rebuilds, the differentiators)

These are the features that make AuraFlare genuinely best-in-class rather than honest. Each is a focused multi-day build.

| # | Upgrade | Feature | Effort | Dependencies |
|---|---|---|---|---|
| **2.1** | **AI inline-edit (NCP → Monaco diff editor, Tab/Esc accept/reject)** — the missing "Cursor in browser" feel | IDE | M | Shared workspace store (Zustand or Yjs) |
| **2.2** | **Deep Research Workflow** — Tavily search + fetch + Readability + extract + cite, mirroring ChatWorkflow shape | Deep Research | M | Tavily key; D1 `research_sources` table |
| **2.3** | **Multi-Agent Builder on Cloudflare Agents SDK** — orchestrator DO + specialist subagents + synthesis pass + streaming timelines | Multi-Agent | M–L | DO + Vectorize bindings; Agents SDK dep |
| **2.4** | **Scheduled MaintenanceSweepWorkflow** (cron) + Queue for remediation + Cloudflare Email alerts | Workflows | M | ai_log migration (1.1); Email binding |
| **2.5** | **Better Auth on D1** (sessions + OAuth + passkeys + RBAC) + `user_id` columns + Firebase bridge | Identity | M | D1 migration; supersedes 1.7 |
| **2.6** | **Real Stripe billing** (Checkout + Portal + webhook → entitlements) + remove fictional features | Billing | M | Identity (2.5) for entitlement gating |
| **2.7** | **LLM-triage Docs & Support** → auto-fix trivial / email volcomman7 for major | Docs/Support | M | ChatWorkflow reuse; Email binding |
| **2.8** | **GraphQL Analytics proxy** (`CF_API_TOKEN` secret) → live Edge Matrix + DNS/zones/certs + Analytics Infra panel | Edge Matrix, Analytics | M | CF_API_TOKEN secret |
| **2.9** | **Multi-provider AI Gateway routing** via Unified `/chat/completions` + Dynamic Routing (Workers AI primary, user-keyed fallbacks) | API Gateway | M | AI Gateway Dynamic Routing GA in your account |
| **2.10** | **OPFS-backed VirtualFs** + **`@xterm/xterm` migration** + **real Yjs collab on a DO** | IDE | M–L | DO binding for collab |
| **2.11** | **Tone.js synth + step sequencer** + **PixiJS v8 image editor** (using existing deps) | Media Studio | M | Image-gen endpoint (1.8) |
| **2.12** | **Real Edge Functions management** (read-only host panel + 5 deployable templates + Tail Worker logs) | Edge Functions | M | CF_API_TOKEN; Tail Worker attach is a real deploy |
| **2.13** | **WebXR rendering of the 3D viewport** + satellite-js pass predictor + Web Serial/Bluetooth for IoT + real two-peer VoIP | Showcase quartet | M each | Per-feature |

### Tier 3 — Defer (heavy lifts, lower ROI, or "research horizon")

| # | Upgrade | Why defer |
|---|---|---|
| 3.1 | WebContainers runtime (kills `/api/exec` for code execution) | Chromium-only; needs COOP/COEP migration with knock-on effects |
| 3.2 | `monaco-languageclient` real TS LSP in a worker | Large effort; recharts-sized payoff |
| 3.3 | Full Langflow-class visual pipeline builder | You won't out-build Langflow/Flowise/n8n; curated pipelines win |
| 3.4 | True P2P WASM compute across strangers' devices | Not defensible in 2026 (throttling, battery, signaling); multi-tab lab demo only |
| 3.5 | In-browser quantum at 20+ qubits (Qukit) | Educational nice-to-have, not a product feature |
| 3.6 | SCIM/SAML enterprise auth | Defer until a paying enterprise customer asks |
| 3.7 | Terraform drift detection on the full stack | Only worth it after Tier 2 IaC layer stabilizes |
| 3.8 | Replay.io-style execution-level time travel | Separate tool; not embeddable |

---

## Cross-cutting prerequisites

A few items unlock many features and should land early:

1. **`migrations/0002_*.sql`** — widen `ai_log` (`created_at`, tokens, cost, status) AND create `spec_data`/`ai_log` (which are currently missing) AND add `user_id` to chat tables. One migration, three concerns. Unblocks Analytics, Workflows, Database viz, Identity.
2. **`CF_API_TOKEN` Wrangler secret** (scoped to Workers Scripts:Edit + Account:Read + AI Gateway read) — unblocks Edge Matrix, Edge Functions, CI/CD rollback, Analytics GraphQL, real deploys.
3. **A shared client-side workspace store (Zustand)** — unblocks AI inline-edit (2.1), real time-travel (Zundo, 2.x), and consistent state across NCP↔IDE.
4. **Cloudflare Email binding** (`send_email`) — unblocks Workflows alerts (2.4) and Docs/Support escalation (2.7). Free, GA.
5. **A Durable Object binding** — unblocks Multi-Agent (2.3), real Yjs collab (2.10), SSE-held streams (2.x Analytics). One binding, many uses.

---

## Recommended sequencing

If you want a single recommended order for the next coding pass, it's:

**Tier 1 batch (1.1–1.10) → Tier 2.5 (Better Auth) → Tier 2.1 (AI inline-edit) → Tier 2.2 (Deep Research) → Tier 2.4 (sweeps) → Tier 2.11 (Media Studio image+audio) → Tier 2.8 (real Edge analytics).**

That sequence front-loads honesty fixes and free wins, then builds the differentiators that make the product genuinely best-in-class: a Cursor-grade AI editor, real citable research, real self-healing, real auth, and real creative tools — all on Cloudflare primitives, no paid third-party APIs.

---

## What I need from you

This is a **research + plan** document, not code. Before I start implementing, I'd like your call on:

1. **Scope of the next pass** — all of Tier 1? A specific subset? Jump straight to a Tier 2 differentiator (Deep Research, AI inline-edit, Multi-Agent)?
2. **The cuts** — confirm Fleet Health, WebGL Engine, and the hallucinated Architecture cards can go; confirm the reframes (NPU→Neural Inference, Satellite→Tracking, Swarm→System Telemetry) are acceptable.
3. **External keys** — Tier 2 needs a Tavily key (Deep Research), a CF API token (Edge Matrix/Functions), and a Stripe key (Billing). Which do you have / want to provision?
4. **The auth migration** — Better Auth on D1 + phased Firebase bridge is the right but non-trivial call. Confirm we're migrating off Firebase Auth (Firestore stays as cold storage).

Once you confirm, I'll execute the chosen scope with the same pattern as the prior passes: research-grounded, type-checked, smoke-tested, committed, pushed, and deployed to `aura.massivenumber.com`.
