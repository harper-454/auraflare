# AuraFlare — Handoff Notes

**Last updated:** 2026-07-09 (third pass)
**Status:** Production live at https://aura.massivenumber.com — deployed 95062e04.

## 2026-07-09 third pass — the Luma answer: Photoreal engine + procedural PBR materials

Owner ultimatum: models on par with Luma, with real materials (cloth/plastic/dirt/metal/wood/hair/clothing) or they walk. Two tracks shipped:

**Photoreal engine (generative 3D, the model class Luma runs).** New Engine toggle in the Studio Controls: Precision (SDF, free, moving parts) | **Photoreal** — text → SDXL product shot → **fal.ai image-to-3D** → fully textured GLB; photo upload → image-to-3D directly (no caption round-trip). Server-side relay `/api/photoreal/generate` (worker; dev proxies to prod): queue.fal.run submit → poll → model-agnostic GLB-URL scan → stored to R2 `photoreal/`. BYO fal key (Settings → AI → Photoreal 3D; fal.ai/dashboard/keys), sent per-request, never persisted. Models offered: `fal-ai/hunyuan3d-v21` (~$0.15 textured), `fal-ai/trellis` (~$0.25), `fal-ai/trellis-2` (~$0.30). Results auto-save to the library (manifest with program:null → gallery reload re-downloads the GLB — `resultFromGlbBlob` in forge-pipeline normalizes scale/center, counts tris). Photoreal errors surface directly — no silent fallback to the primitive engine (it costs money; the user must see the real failure). NOT yet exercised end-to-end: needs the owner's fal key (60-second signup; every code path up to the fal call verified, and the fal request shape follows their documented queue REST).

**Procedural PBR material packs (free, instant, deterministic).** `src/lib/pbr-textures.ts` paints albedo+roughness in-canvas per family — wood (grain rings + streaks), brushed metal, cloth (plain weave), plastic (mold flow lines), stone (granite veins), dirt (patchy soil) — cached, seeded, no downloads. The triplanar shader gained roughness-map sampling (same projection, `sdf-triplanar-v2-rough` cache key). Families flow from: explicit `"material"` on programs/assemblies (sanitized allowlist; compose/plan/refine instructions all ask for it) → else inferred from part names/labels (`inferMaterialFamily`). Applied per-part in compileAssemblies (wooden top + metal legs on one model) and per-program in compileAnyProgram. **Browser-verified: "a round wooden table with four legs" renders with visible wood grain on every part** (rim striping, vertical leg grain), refs online · 4 photos, gpu@144³.

Dev/prod unification en route: dev `/api/media/generate` now proxies to prod (images/textures/photoreal reference shots work locally), and dev media GET falls back to prod R2 on local-disk miss (photoreal GLBs, cross-origin gallery objects).

**Still open:** exercise Photoreal with a real fal key end-to-end; hair/character quality depends on the chosen fal model (Hunyuan v3.1 Pro adds full PBR maps at ~$0.375+0.15 — add `fal-ai/hunyuan-3d/v3.1/pro/image-to-3d` to PHOTOREAL_MODELS once tested); triplanar normal-map channel for the packs; cloth/hair on the Precision engine stays out of scope (that's what Photoreal is for).

## 2026-07-09 second pass — provider Test buttons + selection (owner: "no way to test GLM-5.2/MiniMax or select them")

- **`testProvider(id)`** (`ai-providers.ts`): health-checks any rung (OAuth / a provider / Cloud) with a tiny probe; returns latency or the real error. Settings → AI now has a **Test button on every provider row**, the OAuth line, and a new always-on **AuraFlare Cloud row**. Verified live in the owner's browser: GLM-5.2 ✓ 4.7 s, MiniMax M3 ✓ 5.4 s, Cloud ✓ 3.7 s.
- **Preferred-provider selection** (`getPreferredProvider`/`setPreferredProvider`, localStorage, app-wide): 'auto' = existing chain; a specific rung is **STRICT** — no silent fallback, its real error surfaces (selection doubles as testing). Honored inside `aiChatSync`, so the whole Studio pipeline (compose/plan/refine/QA) follows it.
- **Studio**: "AI provider" dropdown in Controls; the stats HUD now shows a **provider row** (which model composed the mesh — threaded `provider` through composeWithAI/composeComplexWithAI → ForgeResult).
- **Chat**: provider dropdown in the runtime panel. Auto/Cloud = durable server workflow as before. A specific provider = **DIRECT mode** — messages go browser→provider with the user's key (which can't reach the server workflow), replies render locally with an honest "not saved to the durable thread" note; the DURABLE badge swaps to "<PROVIDER> · DIRECT" and the runtime panel cells update (Execution "Direct · browser → provider", Memory "local only").
- Both tsconfigs clean, smoke suite green, deployed d3326cf0.

---

## What changed in the 2026-07-09 pass (Claude) — visual accuracy: the blob-mug fix

Owner escalation: generations must be visually/detail accurate or they walk. Reproduced the failure live in one try: **"a white coffee mug with a curved handle" → a 2-op white blob that QA PASSED**, with 4 reference photos in hand. Root-caused via the network log (all three AI responses inspected):
1. **Reference notes were parroted garbage** — llava-7b answered the open "distill the consensus" prompt with the category labels themselves ("1. Handle shape, 2. Handle length, …").
2. **The composer under-modeled** — llama-3.3-70b emitted ellipsoid+capsule; there was NO cylinder primitive (the workhorse of man-made objects), and the sanitizer **silently deleted** any op with an unknown prim name.
3. **QA rubber-stamped** — llava-7b, asked for a verdict, said "PASS" to a blob.

Fixes (all on the free default path, no user keys):
- **`cylinder` primitive end-to-end**: CPU SDF (IQ capped cylinder, r + h=half-height), WGSL kernel (prim id 8), GLSL raytracer, packOps, GPU gate, QA opRadius, compose/refine instructions.
- **Prim alias map in the sanitizer** (`sdf-compiler.ts`): tube/pipe/rod/disk→cylinder, cube/slab→box, ring/donut→torus, pyramid→cone, ball→sphere, etc. — unknown names map to the nearest real primitive instead of vanishing.
- **COMPOSE_INSTRUCTIONS rewritten around structural decomposition**: hollow containers MUST subtract a cavity, handles are torus rings, wheels are rotated cylinders, legs repeat via symmetry, flat tops are boxes/short cylinders, shape adjectives honored literally ("round table top" = cylinder, never box), "under-modeling is the #1 failure" + a worked mug example (cavity + torus handle).
- **Deterministic structural validator** (`validateProgramFeatures`, sdf-compiler.ts): prompt-implied features (cavity/handle/wheels/legs/min-op-count) must exist in the geometry — microseconds, model-independent. Runs in `forgeModel` **even in fast mode** with ONE corrective refine (accepted only if it reduces findings), and feeds QA findings.
- **QA is now describe-then-judge** (`sdf-qa.ts`): the small VLM only *describes* the render literally (with a parroting filter); the strong text model judges request + reference notes + render description + program JSON together. QA refine now demands MINIMAL edits (the old free-form revision bolted a square top + stray shapes onto a correct round table).
- **Reference notes prompt is a fill-in template** (BODY/PARTS/COLORS/PROPORTIONS) with a shape-vocabulary garbage filter — parroted or empty notes are discarded rather than poisoning the compose.

**Verified in the browser (dev, same free models):** the identical mug prompt now composes cylinder body + subtract cavity + torus handle + base (5 ops, textbook), renders as an unmistakable mug, 197.9k tris gpu@144³. "A round wooden table with four legs" → recognizable table, legs via radial×4 part symmetry (QA revision quality is the remaining weak link — hence the minimal-edits constraint). Smoke suite grew sections [7] cylinder + [8] validator (28 checks total, all green); both tsconfigs clean; deployed 485a7136 and the live bundle verified to contain the new code. Also this pass: `server.ts` PORT env override + `autoPort` in launch.json (another chat holds :3000).

---

## What changed in the 2026-07-08 third pass (Claude) — BYO providers + non-preset gen verified live

**Custom AI provider system** (owner directive: no hardcoded vendors). `src/lib/ai-providers.ts` reworked around a user-managed provider list, tried in order, each one of three wire formats: `gemini` (Google REST), `openai` (any OpenAI-compatible endpoint), `anthropic` (Claude Messages API with the browser-CORS opt-in header). Settings → AI has templates for Google Gemini, ChatGPT, Claude, Openference, **Ollama + LM Studio (local LLMs)**, plus fully Custom. Chain: **Google sign-in (Gemini OAuth) first** → user providers top-to-bottom → **AuraFlare Cloud** (built-in Workers AI default — llama-3.3-70b-fast for structured 3D tasks, kimi-k2.6 for chat; "our own model" until we train one, which stays on the roadmap). Old v1 config auto-migrates.

**CORS relay for hosted providers.** Openference (and some hosts) block browser-origin POSTs. New `POST /api/providers/relay` (worker + dev server, https-only) — the client tries the provider direct, and on a network-level failure retries through the relay with the user's key. **Verified in the browser: the owner's Openference key (GLM-5.2) composed "a medieval castle with four corner towers" → 22-op program → GPU @144³ → 140,650 tris**; network log shows direct-blocked → relay 200. Also verified: "a colorful hot air balloon" → source=ai via AuraFlare Cloud, 218k tris @144³ in 1.15 s.

**Model-quality fixes that made non-preset generation reliable:** (a) kimi-k2.6 (reasoning) either burned `max_tokens: 2048` inside its chain-of-thought and returned an **empty** `content` — which then got **cached** — or at 8192 blew the platform timeout (`3046: Request timeout`, ~4 min). `runInference` now takes a per-call model; `/api/chat-sync` routes structured contexts (`sdf-shape-compiler*`, `3d-generator`) to `@cf/meta/llama-3.3-70b-instruct-fp8-fast` verbatim (no assistant wrapper), keeps kimi for chat; `max_tokens` 8192; **empty replies now throw and are never cached** (KV key includes the model). (b) Dev `/api/chat-sync` falls back to proxying production when Gemini fails (the dev Gemini key is out of prepaid credits — Google 429 RESOURCE_EXHAUSTED — top up at ai.studio to restore local Gemini). (c) Compose/refine client timeout 20 s → 60 s. (d) Dev `PUT /api/spec` no-op (was 404 noise).

**Silent workspace restore** — the "Unsaved Session Found" banner is gone (App.tsx); autosaved state now restores unconditionally on load (it was already realtime-autosaved to localStorage + D1-mirrored).

**Also in this tree (built by a parallel session, verified here):** MASTERPLAN 3D-2 — `SDFRaytracer.tsx` + `sdf-glsl.ts` live sphere-traced preview while typing (PREVIEWING state), and `buildPreviewProgram` (deterministic keyword composer) with `scripts/test-10models.ts` — 10/10 novel prompts pass offline.

## 2026-07-08 fifth pass — reference grounding + Batch Forge (the credit saver)

Owner directives: "it must get an average of photos pulled online or generated images if not online" and "something next level to get us generating stuff, this back and forth is burning credits."

**Reference grounding** (`src/lib/sdf-reference.ts`): before composing, search Wikimedia Commons (keyless, CORS-safe, openly licensed) with a search-term ladder (full noun phrase → last 3/2/1 content words — the full prompt returns 0 results, "pocket watch" returns 10), tile up to 4 photos into a contact sheet, and have the VLM distill the CONSENSUS ("average of photos") into terse reference notes that anchor the plan pass, the geometry pass, and the QA critique. Falls back to SDXL-generated reference views when the web has nothing, `mode:'none'` when offline. HUD shows `refs online · 4 photos`; REFERENCING status while it runs. Dev `/api/media/describe` now proxies to prod when local Gemini fails (same pattern as chat-sync).

**Batch Forge** (`src/lib/forge-pipeline.ts` + `src/components/BatchForgePanel.tsx`): the whole pipeline factored into one reusable module (`forgeModel(prompt, opts, onStage)`) shared by the interactive viewport, the batch queue, the cache, and gallery reloads. The panel (layers button, bottom-left of the 3D Studio) queues up to 12 prompts and runs the grounded factory per prompt unattended; **fast mode** (default) skips QA to halve per-model AI calls. Every model persists to the media gallery (R2 prod / disk dev): animated `.glb` + snapshot `.jpg` + program/stats/QA `.json`. The **program cache** (localStorage, 48 entries) makes any repeated prompt — and any library Load — recompile from the stored ShapeProgram with **ZERO AI calls**. Verified: 2-model batch (desk fan, water wheel — both articulated, 1 moving part each) forged + saved; identical batch re-run completed **from cache in ~1 s**; library reload in **0.6 s** (`source: cached`). Gotcha fixed en route: the dev server's global `express.json()` swallowed `application/json` PUT bodies before the raw media handler — gallery manifests now upload as `application/octet-stream`.

Economics: a fresh grounded+QA'd model ≈ 4-6 AI calls; fast mode ≈ 2-3; cached/library ≈ 0. The library means generations accumulate instead of evaporating — the "constant back and forth" is replaced by queue → walk away → review the gallery.

---

## 2026-07-08 fourth pass — moving parts, the factory pipeline, and self-QA

Owner directive: complex multi-part models with FUNCTION — a watch with gears and hands, an engine with working pistons — plus a coarse-to-fine process (lay parts out on a grid, then refine) and a pre-delivery self-review. Process patterns were mined from the owner's **AssetForge** project (C:\Users\alexh\Developer\AssetForge): planner-owns-decomposition, category part-priors with roles, rig plan before build, QA as promotion blocker.

**Articulated assemblies** (`assemblies[]` on ShapeProgram, sdf-compiler.ts): named parts authored full-size in their local frame with `place {pos, rot, scale}` (the scale-down multiplies effective per-part resolution — every part gets its own 144³ lattice) and `motion {spin rpm | oscillate deg/freq | piston dist/freq/phase}` about the part's own pivot. Sanitizer clamps everything; `flattenProgram` bakes assemblies to exact static ops (quaternion-composed) for the raytracer preview; `totalProgramOps` gates validity.

**sdf-assembly.ts**: compiles base + each assembly SEPARATELY through compileProgramAuto (own mesh, own material), builds pivot/placement group trees, returns `animators` (driven every frame in the viewport via `applyAnimators` — same math the smoke test pins to 1e-6) and **baked AnimationClips sampled at 30 Hz from that same math — the exported .glb MOVES in any glTF viewer**.

**Two-pass compose** (`composeComplexWithAI`): pass 1 plans parts on the coordinate grid (name, role, pos, scale, motion, hint — with AssetForge-style category priors: timepiece/engine/vehicle/windmill…); pass 2 refines every part's ops in its local frame in one batched call; plan owns placement+motion, refine owns geometry; a skipped part degrades to a hint-colored primitive so the layout never loses parts. Mechanical-smelling prompts (`wantsComplexCompose`) route here first, then single-shot → buildPreviewProgram → parametric.

**Pre-delivery QA** (`sdf-qa.ts`): before the user sees anything — offscreen 3/4 render of the compiled group → deterministic lint (out-of-bounds, moving part fully inside the base = invisible motion, duplicate placements, unison piston phases, same-sign meshing gears) → AI critique (vision via /api/media/describe when available, text-only via the provider chain otherwise) → ONE refine round with the findings → recompile. Never blocks delivery. Viewport shows INSPECTING during the pass and `qa: inspected · passed|revised` in the HUD.

**Verified live in the browser:** pocket watch → GENERATING → INSPECTING → MESH READY, **6 parts · 5 moving, qa inspected · revised** (ops 11→15 after self-revision), gpu @144³, hands visibly sweeping with the camera locked; 4-cylinder engine → **7 parts · 6 moving**, 53.6k tris in 35.6 s via AuraFlare Cloud. Smoke suite grew an assemblies section (19 checks total: sanitize/slug/flatten-exactness/pose-math/clip-baking). Also this pass: the raytracer's invisible-preview bug (march budget 5.0 < camera distance 7.1 — every ray missed at default zoom) fixed with budget 20 + skip-ahead + discard-on-miss + renderOrder; plus the parallel session's 10 new preview shape families.

**Known limits (honest):** visual composition quality still tracks the provider (GLM-5.2 built a spherical watch case pre-QA; the QA round flattened it); gears often end up occluded — the lint flags it but the reviser doesn't always fix placement; animated-GLB clips are baked from verified math but haven't been opened in an external viewer yet; engine piston motion is subtle at final scale (screenshot delta aliased at 1.6 s).

---

**Presets removed (owner: "the ones you have are junk").** The six hand-authored preset programs, their keyword fallback in `composeWithAI`, the PRESETS button row, AND the old humanoid/animal/mechanical placeholder rigs are gone from the product. Every model is now composed — by the AI provider chain, or offline by `buildPreviewProgram`'s heuristics (now also the offline fallback inside Generate, ahead of the parametric last resort). The idle viewport is just the grid until you type. The former presets survive only as polygonizer fixtures inside `scripts/smoke-3d.ts` (they exercise every primitive/mode/symmetry).

**Known follow-ups:** the SDFRaytracer remounts spam a harmless `PCFSoftShadowMap deprecated` warning every frame-ish — worth a once-only guard; HUD could show *which* provider composed a mesh (chain already returns it); Anthropic/OpenAI/Gemini templates not yet exercised with real keys; component-internal copy for the 4 renamed sections still pending.

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

## What changed in the 2026-07-08 second pass (Claude) — textures + photo→3D + detail

Owner directive: texture generation in the 3D Studio, much higher model detail, and "upload a photo → model + texture from it" — free-first, borrowing what commercial apps (Meshy/Tripo) do. A 6-agent research workflow was launched twice and died/was cancelled on the monthly spend limit, so this was implemented inline from first principles. **Verified end-to-end:** both typechecks clean, `smoke:3d` all green, browser check (3D Studio renders; crystal preset generates 125,120 tris @144³ — exactly the expected 1.65× of the old 73.6k @112³; the triplanar shader compiles with zero GLSL errors and visibly samples a test texture), deployed **7c7df50f**, and live on production: texture-gen returned a real 1024² JPEG into R2 `tex/`, and `/api/media/describe` returned a coherent description. Two operational notes: (a) the describe fallback chain worked as designed — the `llama-3.2-11b-vision-instruct` first slot did not produce on this account and **llava-1.5-7b-hf answered**; investigate llama-3.2's input contract (it may want the `messages` format) if you want the stronger model. (b) **The dev-machine Gemini key is out of prepaid credits** (Google returns 429 RESOURCE_EXHAUSTED) — all local-dev AI (chat, compose, refine, dev describe) is dead until topped up at ai.studio; production is unaffected (Workers AI).

**Texture generation (UV-less meshes, solved with triplanar projection).** SDF marching-tets meshes have no UVs, so classic texturing is impossible; the standard answer for procedural geometry is triplanar projection, now implemented in the new shared material module **`src/lib/sdf-material.ts`**: `makeSDFMaterial` (the base both backends now use — the previously-duplicated inline materials at `sdf-compiler.ts:517` and `sdf-gpu.ts:528` route through it) and `makeTriplanarMaterial`/`applyTriplanarToGroup` (MeshStandardMaterial + `onBeforeCompile` — world-space albedo sampled per-axis, normal-weight blended, tinted by the per-vertex part colors so a textured snowman keeps its orange nose; `customProgramCacheKey` set so three.js doesn't cross-wire shader programs). **Export caveat:** glTF has no triplanar shader, so `.glb` export (done pre-texturing) carries vertex colors; xatlas-web UV-unwrap + bake is the known follow-up for textured export.

**Texture backend.** `/api/media/generate` now takes `kind: 'texture'`: same proven SDXL-Lightning JSON path, but wrapped in a seamless-material-scan prompt and stored under `tex/` in R2 (logged as `texture-gen`). The 3D Studio gained a Texture bar (fuchsia, appears once a mesh exists): blank input auto-derives the material prompt from the model's label.

**Photo → model + texture.** New `POST /api/media/describe` `{image: base64}` → Workers AI VLM caption tuned for 3D reconstruction (shape/parts/colors/material). Model ids are tried in a fallback chain (`@cf/llava-hf/llava-1.5-7b-hf`, then `@cf/unum/uform-gen2-qwen-500m`) — **the current catalog ids could not be web-verified this session (tooling outage); confirm on first deploy** and reorder/replace as needed (`@cf/meta/llama-3.2-11b-vision-instruct` is the likely newer option but has a different input shape). Dev server got a real Gemini-vision implementation of the same endpoint (plus an honest 501 for `/api/media/generate`, and `express.json` limit raised to 8 MB for the base64 photo). Client flow (ImagePlus button in the 3D Studio): photo → canvas-downscale to ≤1024px JPEG → describe → the description drives the normal compose→compile pipeline → **the photo itself is applied as the triplanar albedo**, so the model wears the exact real-world surface it came from. Stats HUD shows `source: photo` + a texture row.

**Model detail.** GPU lattice default raised 112³ → **144³** (~2.1× cells; affordable because the pipeline-compile cost was already fixed via caching — compute was measured trivial) and `MAX_TRIS` 350k → 500k so dense warp-heavy organics don't clip the atomic allocator. Base material gained `envMapIntensity: 1.1`.

---

## What changed in the 2026-07-08 pass (Claude) — 3D GPU domination + /image made real

Followed the prior handoff's next-steps to the letter (deploy + verify /image, then pivoted per owner to "dominating 3D model creation"). Everything below is deployed and **browser-verified on a real RDNA-2 GPU** via Claude-in-Chrome — not just typechecked. Two prior sessions declared 3D "done" while the GPU path was silently dead; this pass proves it live.

**3D GPU parity (MASTERPLAN 3D-1) — the flagship primitives now render on the GPU.** The WGSL kernel (`src/lib/sdf-gpu.ts`) only implemented 5 of 8 primitives and no warp, so every crystal / gem / spike / hex-nut / organically-warped model silently fell to the **60³ CPU path** while plain sphere/box models got the **112³ GPU path** — backwards. Ported `cone`, `hex`, `octahedron`, and the fBm noise-`warp` to WGSL as exact ports of the CPU formulations (the two backends must agree), widened `compileProgramAuto`'s GPU gate to allow all 8 prims + warp (op cap 24→64), and packed the new prim params + a `warp` vec4 into the uniform (grew 48→64 B).

**Two latent GPU bugs found by the browser check (both would never surface in a CPU-only test):**
1. **`meta` is a reserved word in modern WGSL/Tint.** The kernel's `Params.meta` field made `createShaderModule` **hard-fail to compile** in current Chrome → `generateMeshGPU` threw → silent CPU fallback for *every* model. The GPU path had been dead. Renamed `meta`→`cfg`. This is why the prior "GPU symmetry drop" audit fix never actually ran on GPU.
2. **The pipeline recompiled on every generation.** The static kernel takes **~7 s to compile** (it inlines `sdProgram` ~24× through gradient/color/emit), and `generateMeshGPU` rebuilt the module+pipeline on *every* call — that was the entire cost of a "24-second" model. Now the module+pipeline are **cached per device** and `warmupGPU()` (exported; called on `Viewport3DSection` mount) compiles it up front so the first Generate skips the wait. **Measured live: crystal went 24,186 ms → 131 ms (field 53.5 ms), ~185×.** Same 73.6k tris @112³.

Verified live: crystal (cone+hex+octahedron+radial symmetry) renders as a correct faceted gem on GPU @112³; a trivial 112³ dispatch is ~20 ms on this GPU, confirming compute was never the bottleneck. New **`npm run smoke:3d`** (`scripts/smoke-3d.ts`, tsx) enforces the MASTERPLAN standing rule: CPU parity of all presets, warp-field finiteness, GPU eligibility of the showcase programs, and packOps slot layout for the 3 new prims. `packOps`/`PRIM_ID` are now exported for that test.

**`/image` is real now (SDXL-Lightning).** The FLUX.2-klein path the prior pass shipped never worked: it's a *multipart-input* model, but Workers AI on this account routes through the AI Gateway data plane, which **can't stream a multipart request body** ("does not support ReadableStreams yet"); a buffered multipart body is rejected `8001: Invalid input`. Both dead-end today (Cloudflare says a fix is in flight). Switched `/api/media/generate` to `@cf/bytedance/stable-diffusion-xl-lightning` (plain JSON input, flows through the gateway) and **buffer its output stream before R2.put** (R2 rejects unbounded streams — "must have a known length"). **Verified live: returns a valid 1024×1024 JPEG (~150 KB) stored in R2.** Client copy updated FLUX→SDXL in `NaturalConversationProgramming.tsx` (chip hint, runtime panel, result caption). To restore FLUX later, swap the model id back and send the multipart form body once CF ships the gateway fix.

**Still open from this pass:** persist `/image` results into D1 chat history (still local-only messages — MASTERPLAN follow-up #2); component-internal copy for the four renamed sections (untouched this pass). Working tree is uncommitted — the owner should review + commit.

---

## What changed in the 2026-07-06 "minimal surface" pass (Claude, same day, after the audit)

Product direction from the owner: *"the most beautiful simplistic look with all the power hidden underneath — natural conversation programming that dominates. If someone can think it, we can create it."* This pass executed the UI half plus the free backend wins; a Claude Code session picks up from here.

**Shell** — the default sidebar is now just **Create** (Create/3D Studio/Media Studio/Deep Research) + **Build** (IDE + spec sections) + **Account**. The Operate and Labs groups (11 + 13 real sections) are hidden by default, one toggle away in Settings → Features; a "N more tools in Settings" affordance sits at the bottom of the sidebar. `aura-sidebar-hidden-v` version key resets returning users to the new minimal default. **Cut for good:** `fleet-health` (fictional MDM) and `3d-engine` (redundant WebGL demo) — section entries + routes removed; component files left on disk, unrouted. **Renamed honestly:** NPU→Neural Inference, Satellite Uplink→Orbital Tracking, Agent Swarm→System Telemetry, P2P WASM→WASM Workers. (Component-internal copy for those four still says the old names — small follow-up.)

**NCP chat ("Create")** — hero empty state ("What should we build?") with 7 capability chips that seed expert-grade prompts: research paper, enterprise/regulatory app, video game, podcast, deep plan, image, 3D model (routes to the 3D Studio via a new optional `onNavigate` prop). Compact chip strip persists above the composer in ongoing conversations. The decorative provider/model/agent selectors are **gone** (they controlled nothing); replaced by an honest runtime panel (kimi-k2.6 · Durable Workflow · D1 · /image→FLUX). New **`/image <prompt>` slash command** calls the new image-gen endpoint and renders the result inline (local-only message; not persisted to D1 history yet — follow-up).

**Worker** — new `POST /api/media/generate`: FLUX.2 [klein] on Workers AI → R2 (`gen/<ts>-<slug>.png`), returns `{key, url}`; handles both stream and base64 response shapes; logs to `ai_log`. The chat SYSTEM_PROMPT was rewritten around the "complete professional artifacts" promise (research/regulatory/games/podcasts/plans). **Untested against the live model — verify after next deploy** (the model string `@cf/black-forest-labs/flux-2-klein-4b` and its response shape come from RESEARCH.md's citations).

**Free wins wired** — `useAutoSave` now mirrors every autosaved key to D1 via debounced `PUT /api/spec` (fire-and-forget; localStorage stays authoritative). `AnalyticsDashboard` gained a real "AI Usage — edge telemetry" table reading `/api/ai-stats` (first UI ever to read it), polling every 15 s, honest DEV badge locally.

**Migrations** — `0002_spec_ai_log_and_users.sql` captures the live `spec_data`/`ai_log` schemas + widens `ai_log` (tokens_in/out, cost_usd, status) + adds `user_id` to chat tables + an endpoint/time index. **Already applied to production D1** (via API, 2026-07-06) — the file exists so fresh environments reproduce; `wrangler d1 migrations apply` on prod would re-run ALTERs and fail, so mark 0002 as applied if you adopt wrangler's migration tracking.

Verified: `tsc --noEmit` and `tsc -p tsconfig.worker.json` both clean. **Not yet deployed** — needs `Deploy.cmd` / `npm run deploy:cf` on the owner's machine (includes the earlier 3D fixes too).

**Suggested next steps for Claude Code:** deploy + verify /image and GPU-path 3D in a browser; persist generated images into chat history (D1); component-internal copy for the four renamed sections; then MASTERPLAN Phase 2 (AI inline-edit is the queued differentiator).

---

## What changed in the 2026-07-06 audit pass (Claude)

A full verification sweep of every claim from the prior sessions, against the code, the production D1, and the live site. Outcome: the architecture claims held (durable chat verified live end-to-end; prod bundle matches local), but **three real 3D engine bugs** were found and fixed in `src/lib/`:

1. **GPU symmetry drop** (`sdf-gpu.ts`): `compileProgramAuto` gated GPU-compatibility on the expanded program but passed the *unexpanded* program to `generateMeshGPU`, so WebGPU browsers silently lost every symmetry-generated op (flower rendered with no petals). Fix: pass `expanded`.
2. **Radial-array placement** (`sdf-compiler.ts`): `radius` translated parts along the rotation axis instead of outward — the documented "part at origin + radius" usage produced coincident copies. Fix: translate perpendicular to the axis (+x for y/z rings, +y for x rings). Crystal/flower presets re-authored to canonical form.
3. **Cone SDF sign error** (`sdf-compiler.ts`): the sign term used a dot product where IQ's exact cone uses a 2D cross product, producing phantom "inside" regions in a far-field wedge for rotated cones (crystal preset: 60k tris of phantom shell clipping at the lattice bound → 13k clean tris after fix). Replaced with a faithful IQ sdCone port.

Also corrected in docs: the RESEARCH.md "BLOCKER" about `spec_data`/`ai_log` was wrong — both tables exist in production D1 (verified by query); the real gap is that they're missing from `migrations/` (reproducibility) and `ai_log` lacks token/cost/status columns. See the audit addendum at the top of `RESEARCH.md`.

Verification: `tsc --noEmit` clean; CPU smoke tests green on all 6 presets (no NaNs, all in-bounds); radial expansion emits a correct ring; durable chat + chat-sync + ai-stats verified live on production.

---

## What changed in the 2026-07-05 pass

### 1. MVP chat — was silently broken, now durable and survives a closed browser
- **Bug fixed:** the chat read `data.reply` but both runtimes return `data.text` → every AI message was persisted to Firestore as `"Processing error."` Now reads `data.text` + handles `data.error`.
- **Durable execution via Cloudflare Workflows.** This is the headline change. `POST /api/chat` no longer blocks; it creates a `ChatWorkflow` instance and returns `{instanceId, sessionId}` immediately. The Workflow runs server-side (`persist user msg → AI turn → self-evaluate done/blocked → loop or pause → finalize`), writing every message to D1 with its true role (`user`/`ai`/`system`) as it happens. **The AI keeps working after the browser closes** — reopening the page reads `/api/chat/history` and renders the full, correctly-attributed thread. The autonomous loop is capped at 6 turns; if the AI is blocked it writes a `system` question and pauses. This solves both "continues on close" and "exact preserved history."
- **Single source of truth = D1** (`chat_messages`, `chat_runs` tables — see `migrations/0001_chat_history.sql`). The Firestore mirror was removed; D1 is the canonical store. localStorage only holds the `sessionId` so the client knows which thread to load.
- **Sync fallback preserved.** If the Workflow binding is somehow missing (e.g. migration not yet applied), `/api/chat` returns `{text, fallback:'sync'}` and the client renders it directly — chat never breaks. `/api/chat-sync` is the dedicated single-shot endpoint for the `FloatingAssistant` and the 3D `composeWithAI`/`refineProgramWithAI` paths (those want one reply, now, not a multi-turn run).
- **Removed the blocking "Initializing Core Systems…" splash** in `AuthProvider`.
- **Copyable code blocks** on AI messages. "DURABLE" + "Survives tab close" badges make the behavior visible.

### 2. 3D Viewport — was a fake demo, now routes the real engine (and the engine got deeper)
- The repo **already contained a complete real text-to-3D pipeline** in `src/lib/` (`meshforge.ts`, `sdf-compiler.ts`, `sdf-gpu.ts` — WGSL WebGPU kernel + CPU marching-tets fallback), but only the buried IDE → 3D tab exposed it. The visible "3D Viewport" sidebar item was a fake: `handleGenerate` was a 1.5s `setTimeout` that cycled Humanoid→Animal→Mech, and "Export Model" was an `alert("... (Mock)")`.
- **`Viewport3DSection.tsx` rewritten** to drive the real pipeline:
  - `composeWithAI(prompt)` → LLM emits a `ShapeProgram` (SDF primitive JSON); `sanitizeProgram` + 6 presets (`snowman`/`rocket`/`mushroom`/`dragon`/`crystal`/`flower`) + `parsePromptLocally` parametric fallback chain (deterministic-first per AGENTS.md §1).
  - `compileProgramAuto(program)` → WebGPU first @112³ when the *expanded* program uses only the original 5 primitives (≤24 ops, no warp) — symmetry-expanded programs now run on the GPU correctly; automatic CPU fallback @60³ for cone/hex/octahedron/warp or >24 expanded ops. (**2026-07-06 audit fix:** the GPU path previously received the unexpanded program and silently dropped all symmetry-generated ops.)
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
| `/api/chat` (POST) | Gemini sync, returns `{text, fallback:'sync'}` | **Durable Workflow** — returns `{instanceId, sessionId, status:'queued'}` immediately; AI keeps working after disconnect |
| `/api/chat/status` (GET) | stub: always `complete` | real — polls a Workflow instance's status |
| `/api/chat/history` (GET) | stub: empty | real — full thread from D1 `chat_messages` |
| `/api/chat-sync` (POST) | Gemini single-shot | Workers AI single-shot (for FloatingAssistant + 3D compose) |
| `/api/deep-research`, `/api/multi-agent-build` | Gemini | Workers AI |
| `/api/spec` (GET/PUT) | — | D1 `spec_data` |
| `/api/ai-stats` | — | D1 `ai_log` aggregate |
| `/api/media/*` | disk `.forge-gallery/` | R2 `BUCKET` |
| `/api/fs/*`, `/api/exec` | real (workspace files + shell) | **501 by design** |

So the **IDE Workspace** (file browser, terminal, git, Deploy/MCP/Claw views) is dev-only. In production those sub-views degrade gracefully (501 errors). This is intentional — the IDE is a local power tool.

### Durable chat architecture (the part that solves "continues after close")

```
Browser                  Cloudflare Worker                D1
  │  POST /api/chat {message,sessionId}                     │
  │ ─────────────────────► creates ChatWorkflow instance    │
  │ ◄───────────────────── {instanceId, sessionId}          │
  │                          │                              │
  │  (browser may close now) │ step: persist user msg ─────►│ chat_messages (role='user')
  │                          │ step: AI turn ──────┐        │
  │                          │                     │ Workers AI (kimi-k2.6 via AI Gateway)
  │                          │ ◄───────────────────┘        │
  │                          │ step: persist AI reply ─────►│ chat_messages (role='ai')
  │                          │ step: self-evaluate ─────┐   │
  │                          │   done? continue? blocked?   Workers AI
  │                          │ ◄────────────────────────┘   │
  │                          │ └ loop back to AI turn       │
  │                          │   until done/blocked/cap(6)  │
  │                          │ step: finalize ─────────────►│ chat_runs.status='complete'|'paused'
  │                                                          │
  │  GET /api/chat/history?sessionId=…  (on return or poll) │
  │ ◄────────────────────── full thread, correctly roled ───│
```

Key invariants:
- **Roles are never conflated.** The Workflow writes `role='user'` for the request and `role='ai'` for each reply as separate D1 rows. The old "AI message looks like it came from the user" bug is structurally impossible here.
- **Idempotent steps.** Each `step.do(...)` is named; on Workflow retry after a transient failure the step does not re-run, so you never get duplicate messages.
- **Bounded cost.** The loop is capped at `MAX_TURNS = 6`. The self-evaluate step defaults to `done` if the AI's JSON decision is malformed, so a buggy evaluation can't run forever.
- **Reconnect anywhere.** `GET /api/chat/history?sessionId=…&sinceId=…` supports incremental polling (only messages after the last seen id) for live updates while the tab is open, and full-thread reads for "I came back later."

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
