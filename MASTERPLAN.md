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
| 0.4 | Post-deploy browser check: load the flower + crystal presets on a WebGPU browser; confirm petals/shards render and backend shows `gpu` | ⬜ user or next session (Claude-in-Chrome) |
| 0.5 | `migrations/0002_spec_and_ai_log.sql` — capture live `spec_data`/`ai_log` schemas + add `tokens_in/out`, `cost_usd`, `status`, `user_id` columns | ⬜ next session, ~1h |

**Exit criteria:** production 3D renders symmetric models correctly on GPU; migrations reproduce the full live schema from scratch.

---

## Phase 1 — Honesty + free wins (1–2 sessions)

The corrected Tier 1 from RESEARCH.md, in dependency order. All data/infra already exists; this is plumbing and label-truth.

1. ✅ **Wire `/api/ai-stats` into Analytics** — done 2026-07-06 (AI Usage table, 15 s poll). Workflow status donut still open.
2. ✅ **Wire `/api/spec` into `useAutoSave`** — done 2026-07-06 (debounced D1 fan-out, fire-and-forget).
3. ✅ (mostly) **Honesty pass** — done 2026-07-06: Fleet Health cut, WebGL Engine cut, renames landed in the section registry, minimal Create/Build/Operate/Labs shell shipped. Still open: component-internal copy for the renamed four; Architecture cards; IaC reading real `wrangler.jsonc`.
4. ✅ **Workers AI image gen** — done 2026-07-06: `POST /api/media/generate` + `/image` command in the chat. Verify against the live model after deploy.
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
| 3D-1 | **GPU kernel parity**: port cone/hex/octahedron + fBm warp to WGSL (the CPU already has them) | Removes the 60³-CPU quality cliff for the newest features |
| 3D-2 | **Live raymarch preview** while typing (same SDF, fragment shader) → polygonize on confirm | The "wow" interaction no free competitor has |
| 3D-3 | **Resolution upgrade**: sparse-octree or surface-following sampling @ ~200³ effective | Sharper edges, GLB stays small |
| 3D-4 | **PBR materials per part** (roughness/metalness already exist; add per-op emissive + simple triplanar textures) | Visual quality jump at near-zero cost |
| 3D-5 | **Model gallery** on R2 (prod) / disk (dev) + share links | Turns generations into a library |
| 3D-6 | **Optional paid tier**: Meshy/Fal/TRELLIS behind the same prompt box, SDF stays the free default | Product/budget decision — only after 3D-1…3D-4 |

**Rule:** every 3D change re-runs the smoke suite (presets + symmetry expansion + hostile sanitizer + a GPU-path test in a real browser).

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
