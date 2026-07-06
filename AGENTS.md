# AI Operator Protocol & System Instructions

Welcome, AI Agent or Operator. You are interacting with the Omni-Library Core Engine & Runtime.
This repository is architected for extreme multi-modal generation, real-time networking, and autonomous execution.

## Current State (2026-07-05)

**READ [`HANDOFF.md`](./HANDOFF.md) FIRST.** It's the map: what the app actually is, the dev (`server.ts`) vs prod (`src/worker.ts`) split, the real 3D engine in `src/lib/`, known follow-ups, and how to run/deploy.

Quick orientation:
- **MVP = NCP Chat** (`src/components/NaturalConversationProgramming.tsx`) — natural-language → code, local-first, optional Firestore sync. The app opens here.
- **3D Viewport** (`src/components/Viewport3DSection.tsx`) drives the real LLM→SDF→WebGPU pipeline in `src/lib/{meshforge,sdf-compiler,sdf-gpu}.ts`. Not a mock.
- **Section registry** lives in `src/sections.ts` — edit one place; sidebar/palette/settings update automatically.
- **Prod is live** at https://aura.massivenumber.com and matches local (same bundle). Deploy with `npm run deploy:cf`.
- Two `firebase.ts` files exist (both guarded); consolidation is a known follow-up.

## Core Directives

1. **Deterministic Execution First**: When generating logic, prioritize offline-capable, deterministic algorithms. Network calls and cloud AI inferences should be treated as progressive enhancements. The system must degrade gracefully to a fully functional offline state.
2. **Cloudflare Edge Affinity**: When provisioning infrastructure or networking, default to Cloudflare Workers, D1, KV, R2, and AI Gateway. 
3. **Omni-Library Utilization**: 
   - 3D/WebGL: Use `three` and `@react-three/fiber`.
   - Audio/Synthesis: Use `tone`.
   - 2D Canvas: Use `pixi.js`.
   - Multiplayer/Sync: Use `socket.io-client`, `yjs`, `y-websocket`.
   - State Management: Use `zustand`.
4. **Self-Healing Mechanics**: Ensure robust error boundaries, automatic retry mechanisms for network requests, and fallback deterministic models for AI failures.
5. **Zero-Human Intervention**: All setup, provisioning, and database migrations should be scripted and autonomous.

By adhering to these rules, you ensure the integrity of the Omni-Admin Control Plane.

## Operational Procedures Handbook (AI Rules)

1. **System Integration Awareness**: All systems (WebGPU, NPU Bindings, Quantum Telemetry, Deep Research) must be contextually aware of each other. Never silo a feature.
2. **Immutability of Core Engine**: AI Swarms CANNOT edit the core program's deterministic codebase unless specifically granted override keys via the `AutomatedWorkflows` loop.
3. **Automated Sweep Mandate**: The system must run a multi-time per day system sweep (via `Fleet Health & MDM` and `AutomatedWorkflows`) to detect leaks, memory overflows, or performance degradation.
4. **Support Ticket Resolution**: Trivial issues reported via the `DocsAndSupport` portal must be auto-corrected by the maintenance swarm. Major issues must alert the admin (`volcomman7@gmail.com`).
5. **No Hallucinations on Payments**: The `AccountManagement` system is deterministic. AI must never hallucinate billing states.
6. **Final Master Feature Guide**: (See Dashboard / Vision) Implement peer-to-peer WASM modules for decentralized browser-based compute sharing.
