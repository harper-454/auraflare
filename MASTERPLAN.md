# AuraFlare — Master Plan

**Date:** 2026-07-06
**Author:** Claude (post-audit)
**Inputs:** `RESEARCH.md` (corrected — see its audit addendum), `HANDOFF.md`, live verification of production.

This is the sequenced plan to take AuraFlare from "real engine, demo-grade surface" to best-in-class on every core feature. It supersedes the loose "what I need from you" list at the bottom of RESEARCH.md by turning it into phases with entry/exit criteria.

---

## North star

Two flagship surfaces, everything else supports them:

1. **NCP Chat (the MVP):** natural language → code, durable (survives browser close), correctly attributed, eventually with inline-edit into the IDE ("Cursor in the browser").
2. **3D Viewport:** prompt → real mesh → real `.glb`, free and local-first, with an optional paid tier for photoreal generation later.

Everything in the sidebar either feeds those two, tells the truth about the infra running them, or gets cut/renamed (per RESEARCH.md verdicts).

**Standing rule learned from this audit:** every feature ships with a runnable smoke test and a live-production check. Two prior sessions declared 3D "done" while the GPU path silently dropped geometry — tests that exercise only the fallback path don't count.

---

## Phase 0 — Ship the audit fixes (today; blocking everything)

| # | Item | Status |
|---|---|---|
| 0.1 | Fix GPU symmetry drop, radial-array placement, cone SDF sign | ✅ done, typechecked, smoke-tested (this session) |
| 0.2 | Commit + push to `auraflare` | ✅ done (this session) |
| 0.3 | **Deploy** (`Deploy.cmd` or `npm run deploy:cf`) — must run on the Windows machine (wrangler auth lives there) | ⬜ **user action** |
| 0.4 | Post-deploy browser check: load the flower + crystal presets on a WebGPU browser; confirm petals/shards render and backend shows `gpu` | ✅ done 2026-07-08 (Claude-in-Chrome, RDNA-2). Exposed the dead-GPU `meta` bug + the recompile-every-call perf bug — both fixed. Crystal renders on GPU @112³ in 131 ms. |
| 0.5 | `migrations/0002_spec_and_ai_log.sql` — capture live `spec_data`/`ai_log` schemas + add `tokens_in/out`, `cost_usd`, `status`, `user_id` columns | ⬜ next session, ~1h |

**Exit criteria:** production 3D renders symmetric models correctly on GPU; migrations reproduce the full live schema from scratch.

---

## Phase 1 — Honesty + free wins (1–2 sessions)

The corrected Tier 1 from RESEARCH.md, in dependency order. All data/infra already exists; this is plumbing and label-truth.

1. ✅ **Wire `/api/ai-stats` into Analytics** — done 2026-07-06 (AI Usage table, 15 s poll). Workflow status donut still open.
2. ✅ **Wire `/api/spec` into `useAutoSave`** — done 2026-07-06 (debounced D1 fan-out, fire-and-forget).
3. ✅ (mostly) **Honesty pass** — done 2026-07-06: Fleet Health cut, WebGL Engine cut, renames landed in the section registry, minimal Create/Build/Operate/Labs shell shipped. Still open: component-internal copy for the renamed four; Architecture cards; IaC reading real `wrangler.jsonc`.
4. ✅ **Workers AI image gen** — done 2026-07-06, **verified + fixed live 2026-07-08**: the shipped FLUX.2-klein path never worked (multipart model + AI-Gateway-can't-stream + R2-needs-known-length). Switched to `@cf/bytedance/stable-diffusion-xl-lightning` (JSON input, buffered→R2); returns a real 1024×1024 JPEG. Restore FLUX once CF ships the gateway multipart-streaming fix.
5. **`isomorphic-git` + server-side `cdn-cgi/trace`** — kill the two `/api/exec` 501 paths that break in prod.
6. **`.github/workflows/deploy.yml`** (wrangler-action) — push-to-deploy, removes the manual deploy dependency that blocked Phase 0.3 today.
7. **Server-side passkey verification** (`@simplewebauthn/server`) — delete the forgeable localStorage WebAuthn.
8. ✅ **NCP as the flagship surface** — done 2026-07-06: hero empty state, 7 capability chips (research paper / enterprise-regulatory app / game / podcast / deep plan / image / 3D), honest runtime panel, upgraded creation-engine system prompt.

**Exit criteria:** no fictional content anywhere in the UI; every dashboard shows real data; deploys happen on push.

---

## Phase 2 — Differentiators (ordered; one at a time, each ~2–5 days)

1. **AI inline-edit** — NCP chat → Monaco diff → Tab/Esc accept/reject. The "Cursor in browser" feel. (Prereq: shared Zustand workspace store.)
2. **Deep Research Workflow** — real Tavily search + fetch + Readability + citations in D1, mirroring the proven ChatWorkflow shape. Differentiator vs. open-source: durability (survives browser close). **Needs: Tavily key.**
3. **Better Auth on D1** — sessions, OAuth, passkeys, RBAC; `user_id` on chat tables; phased Firebase bridge. (Supersedes 1.7.)
4. **MaintenanceSweepWorkflow** — cron schedule + D1/R2/spend sweeps + email alerts. Implements AGENTS.md directives #3/#4. (Prereq: 0.5 schema.)
5. **Media Studio real tools** — Tone.js synth + PixiJS editor on the image-gen endpoint (deps already installed).
6. **GraphQL Analytics proxy** — live Cloudflare metrics into Edge Matrix + Analytics. **Needs: CF API token secret.**
7. **Multi-Agent on Cloudflare Agents SDK** — only if expanded to genuine parallel work with per-agent timelines; otherwise keep single-agent (RESEARCH.md's honest verdict stands).

---

## Phase 3 — 3D best-in-class track (parallel, incremental)

The current engine is real but capped at "stylized compositional models." The path to best-in-class free browser text-to-3D:

| Step | Upgrade | Why |
|---|---|---|
| 3D-1 | ✅ **GPU kernel parity** — DONE 2026-07-08, browser-verified on RDNA-2. Ported cone/hex/octahedron + fBm warp to WGSL; widened the GPU gate to all 8 prims + warp. **Also fixed two latent bugs the parity work exposed:** (a) `Params.meta` is a WGSL reserved word → the kernel silently failed to compile in modern Chrome and *every* model fell back to CPU (renamed `meta`→`cfg`); (b) the pipeline recompiled (~7 s) on every generate → cached per-device + `warmupGPU()` on mount, **crystal 24,186 ms → 131 ms**. Smoke test: `npm run smoke:3d`. | Removes the 60³-CPU quality cliff **and** revived the GPU path, which had been dead |
| 3D-2 | ✅ (2026-07-08) **Live raymarch preview** — `SDFRaytracer.tsx` + `sdf-glsl.ts` sphere-trace the SDF in a fragment shader while typing (`buildPreviewProgram` keyword composer, 10/10 novel prompts via `scripts/test-10models.ts`); polygonize on Generate. Browser-verified (PREVIEWING state live). | The "wow" interaction no free competitor has |
| 3D-3 | **Resolution upgrade**: sparse-octree or surface-following sampling @ ~200³ effective. *(Partial 2026-07-08: brute-force default raised 112³→144³ + MAX_TRIS 500k — needs browser timing check; adaptive sampling still open.)* | Sharper edges, GLB stays small |
| 3D-4 | ✅ (v1, 2026-07-08 second pass) **Textures + materials** — `src/lib/sdf-material.ts`: shared material factory + triplanar projection for the UV-less meshes; SDXL-Lightning seamless-texture endpoint (`kind:'texture'` → R2 `tex/`); Texture bar in the 3D Studio; **photo→3D** (VLM describe → compose → photo as triplanar albedo). Deployed 7c7df50f + live-verified (texture JPEG in R2; describe answers via llava fallback). Open: xatlas UV-bake so `.glb` export carries the texture; per-op emissive; llama-3.2-vision input contract. | Visual quality jump at near-zero cost |
| 3D-5 | ✅ (2026-07-08 fifth pass) **Batch Forge + model library + program cache** — `forge-pipeline.ts` (one pipeline module for interactive/batch/cache/gallery), queue N prompts unattended (fast mode skips QA to halve AI spend), every model persisted to R2/disk (animated .glb + snapshot + program JSON + QA report), library reload + repeat prompts recompile from the stored program with ZERO AI calls (verified: 2-model batch re-forged from cache in ~1 s; gallery reload in 0.6 s). Grounding also live: reference photos from Wikimedia Commons (search-term ladder) or generated stand-ins → VLM consensus notes anchor compose + QA (`refs online · N photos` in the HUD). Share links still open. | Turns generations into a library — and stops paying AI twice for the same model |
| 3D-6 | **Optional paid tier**: Meshy/Fal/TRELLIS behind the same prompt box, SDF stays the free default | Product/budget decision — only after 3D-1…3D-4 |

| 3D-7 | ✅ (2026-07-08 fourth pass) **Articulated assemblies + factory pipeline** — `assemblies[]` in the shape program (per-part meshes, pivots, spin/oscillate/piston motion), two-pass compose (plan parts on the grid → refine each part; AssetForge-derived category priors), per-part effective-resolution via placement scale, live kinematics in the viewport, **animated .glb export** (baked clips), and a **pre-delivery QA loop** (offscreen render → lint → AI critique → revise once → recompile; `sdf-qa.ts`). Verified live: pocket watch 6 parts · 5 moving `qa: revised`; 4-cyl engine 7 parts · 6 moving. | Watches tick, engines run — no free competitor generates rigged, moving machines from text |

**Rule:** every 3D change re-runs the smoke suite (fixtures + symmetry expansion + hostile sanitizer + assembly/animator math + a GPU-path test in a real browser).

---

## Decisions needed from you (carried over from RESEARCH.md, still open)

1. **Scope:** proceed Phase 1 → 2 in order, or jump to a specific Phase-2 differentiator first?
2. **Cuts/renames:** confirm the Phase-1 honesty pass list (Fleet Health cut, WebGL merge, renames).
3. **Keys to provision:** Tavily (Deep Research), Cloudflare API token (analytics/deploys), Stripe (billing, Phase 3+).
4. **Auth:** confirm Better Auth on D1 migration (Firebase becomes cold storage).

---

## Session log

- **2026-07-04/05 (Claude Fable):** production Worker, D1/KV/R2/AI bindings, SDF compiler + GPU kernel, IDE forge.
- **2026-07-05 (GLM 5.2):** MVP chat fix + durable ChatWorkflow, 3D viewport rewired to real engine + symmetry DSL (introduced two of the three bugs above), shell reorg, RESEARCH.md sweep. Git history rebuilt after object corruption (`b8dda1e`…`96edfe0`).
- **2026-07-06 (Claude, this session):** full audit of all prior claims; fixed GPU symmetry drop + radial placement + cone SDF sign; corrected RESEARCH.md/HANDOFF.md; wrote this plan. Verified durable chat + prod parity live.
- **2026-07-08 (Claude Fable):** shipped MASTERPLAN 3D-1 (GPU parity: cone/hex/octahedron + fBm warp in WGSL, gate widened to all 8 prims + warp) and browser-verified it on a real RDNA-2 GPU — which exposed and fixed two latent bugs that had the GPU path silently dead (`meta` reserved-word compile failure) and pathologically slow (pipeline recompiled every call → cached + warmup, 24 s→131 ms). Made `/image` real (FLUX multipart is blocked by AI-Gateway streaming → SDXL-Lightning JSON path, verified live). Added `npm run smoke:3d`. All typechecks clean; deployed (f51a5aac).
- **2026-07-08 second pass (Claude Fable):** 3D-4 v1 — triplanar texturing for the UV-less SDF meshes (`src/lib/sdf-material.ts`, both backends' materials centralized there), SDXL-Lightning seamless-texture endpoint + Texture bar, **photo→3D** (new `/api/media/describe` VLM caption → compose → photo as triplanar albedo; Gemini-vision dev parity), GPU default 144³ + MAX_TRIS 500k. The owner's research workflow died twice on the monthly spend limit → implemented inline instead. Verified: both typechecks + smoke:3d clean; browser check (crystal 125k tris @144³, triplanar shader compiles/renders/samples, zero console errors); **deployed 7c7df50f and live-verified** (texture-gen → real 1024² JPEG in R2 `tex/`; describe → coherent caption via llava after the llama-3.2 slot didn't produce). Known: dev Gemini key out of prepaid credits (local AI dead, prod unaffected); uncommitted — owner to review + commit.
- **2026-07-08 third pass (Claude Fable):** **non-preset generation made real and verified in the browser** — fixed the kimi-k2.6 reasoning-model failure chain (empty-`content`-then-cached at 2048 tokens / `3046: Request timeout` at 8192): structured contexts now route to `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, empty replies throw and are never cached. **Custom AI provider system** per owner directive: provider list + templates (Gemini/ChatGPT/Claude/Openference/Ollama/LM Studio/custom), Google-OAuth-first, AuraFlare Cloud built-in default, `/api/providers/relay` for CORS-blocked hosts, dev→prod chat-sync proxy fallback. Silent workspace auto-restore (banner cut). A parallel session's 3D-2 (SDFRaytracer live preview + buildPreviewProgram, 10/10 test) verified here. **Browser-verified end-to-end: "hot air balloon" → source=ai (AuraFlare Cloud) 218k tris @144³ / 1.15 s; "medieval castle with four corner towers" → composed by the owner's Openference key (GLM-5.2) via the relay, 22 ops, 140,650 tris @144³.** Deployed ae7ab28e. Next: exercise Claude/ChatGPT templates with real keys, HUD provider attribution, own-model training track.
