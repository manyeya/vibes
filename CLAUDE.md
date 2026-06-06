# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Vibes is a multi-agent AI coding orchestrator built on the Vercel AI SDK v6. It features a lean plugin-based architecture with runtime sub-agent deployment, renderable canvas artifacts, and both terminal (TUI) and web interfaces.

**Monorepo structure** (Bun workspaces):
- `apps/api` - Hono backend server with session management
- `apps/tui` - Terminal UI (React + Ink)
- `apps/demo` - Web demo app
- `packages/harness-vibes` - Core Vibes agent framework

## Development Commands

```bash
# Development
bun run dev:api      # Start backend API (port 3000)
bun run dev:tui      # Start TUI (run in separate terminal)
bun run dev:demo     # Start web demo

# Building
bun run build        # Build all packages and apps
bun run build:packages
bun run build:apps

# Testing
bun run test         # Run tests for all packages
```

Run tests for a specific package:
```bash
cd packages/harness-vibes && bun test
```

## Core Architecture

### Agent layering & vocabulary

There are three layers, each with one clear name:

| Layer | Name | File | Role |
|-------|------|------|------|
| Engine | `AgentCore` | `src/core/agent-core.ts` | Low-level loop extending AI SDK's `ToolLoopAgent`; plugins + context engineering |
| Flagship | `VibeAgent` (`createVibeAgent`) | `src/core/vibe-agent.ts` | Batteries-included `AgentCore` subclass with all default plugins + sub-agents |
| Facade | `defineAgent` / `createHarness` / `Harness` / `Session` | `src/core/harness.ts` | Small Flue-like front door: declare → build → `session.prompt({ result })` |

`AgentCore` (in `src/core/agent-core.ts`) provides:

- **Plugin system** - Extensible capabilities via modular plugins
- **Restorable compression** - Large content replaced with file/path references
- **Error preservation** - Errors tracked separately, never summarized
- **KV-cache awareness** - Stable prompt prefix for cache optimization
- **Sandbox** - Filesystem + shell go through a `Sandbox` (`src/core/sandbox.ts`); the default `LocalSandbox` is Node-portable and path-contained

### Plugin System (not middleware!)

Plugins (in `packages/harness-vibes/src/plugins/`) provide tools and lifecycle hooks. Key plugins:

| Plugin | Purpose |
|--------|---------|
| `PlanningPlugin` | Task management with persistence, plan save/load |
| `SubAgentPlugin` | Delegation to sub-agents (`task`/`delegate`/`parallel_delegate`) + runtime agent deployment (`create_agent`/`spawn_agent`/`list_agents`) |
| `SkillsPlugin` | Skill management and discovery |
| `ClarificationPlugin` | `ask_user` — streams a `data-clarification` questionnaire rendered as a form above the composer; the agent halts (`stopWhen: hasToolCall('ask_user')`) until the user's answers arrive as the next message |
| `MemoryPlugin` | Working memory: a scratchpad (always in-prompt) + a searchable long-term note store (`remember`/`recall`/`update_memory`/`forget`/`list_memories`); injects a compact index, not full content |
| `FilesystemPlugin` | File read/write operations |
| `BashPlugin` | Shell command execution |
| `ArtifactPlugin` | Renderable artifacts (HTML sites, markdown docs, mermaid diagrams, charts) streamed to the web canvas panel and saved to `artifacts/` in the sandbox |

**Plugin hooks** (defined in `src/core/types.ts`):
- `prepareStep` - Modify settings before each model call
- `modifySystemPrompt` - Extend the system prompt
- `onStreamReady` - Receive writer for real-time UI updates
- `onStreamFinish` - Handle stream completion
- `waitReady` - Async initialization (e.g., sandbox startup)
- `onInputAvailable` - Tool execution lifecycle

### Streaming Architecture

The streaming system (`packages/harness-vibes/src/core/streaming.ts`) defines custom UI message types (`VibesUIMessage`, `VibesDataParts`) that work with AI SDK's `UIMessageStreamWriter`. This enables:
- Real-time tool execution updates
- Custom data parts (agent data, task updates, etc.)
- Integration with `useChat` hook in frontend

### Session Management

Sessions are persisted to SQLite (`workspace/vibes.db`) via `SqliteBackend`. The API provides:
- `GET /api/sessions` - List all sessions
- `POST /api/sessions` - Create new session
- `GET /api/sessions/:id` - Get session details
- `GET /api/sessions/:id/messages` - Load chat history
- `POST /api/vibe/stream` - Streaming agent endpoint

Sessions have a single owner: the harness `vibeHarness` (in `apps/api/src/vibe-coder.ts`) owns session lifecycle + agent instances (one cached agent per session id, via `vibeHarness.session(id)`). The API's `streamCoordinator` (in `apps/api/src/stream-coordinator.ts`) holds only HTTP streaming-transport state (abort controllers + the reconnect registry).

### Sub-Agent System

Sub-agents are **lean workers**, not second brains. They run a minimal plugin
set (`createSubAgentPlugins` in `vibe-agent.ts`: filesystem, shell, skills,
artifacts, planning) — a subset of the main agent's defaults, without
summarization/memory. That keeps delegation fast and avoids the nested model
calls + prompt bloat that made it flaky on weaker models. (The old cognitive
plugins — Reasoning/ToT, Reflexion, semantic/procedural memory, swarm — have
been removed from the codebase entirely; modern models reason natively.)

- Each sub-agent has its own system prompt and tool allowlist; it inherits the
  parent's custom tools (e.g. `webSearch`).
- **Natural completion**: a sub-agent finishes by giving a final answer — that
  text is the result. An optional `report_result` tool adds a structured
  summary + file list, but is never required. A delegation only fails if it
  *threw* or produced literally nothing.
- **Runtime deployment**: the main agent isn't limited to the baked-in roster
  (`defaultSubAgents` in `apps/api/src/vibe-coder.ts`). It can `create_agent`
  (define a specialist), `spawn_agent` (define + run a one-off), and
  `list_agents` — the registry is mutable and delegation resolves against it
  live.
- Results are optionally saved to the `subagent_results/` directory.

## Environment Variables

```env
OPENAI_API_KEY=xxx         # OpenAI API key
OPENROUTER_API_KEY=xxx     # or OpenRouter
PORT=3000                  # API server port
NODE_ENV=development       # or production
SKILLS_DIR=./skills        # Skills directory
```

## Key Patterns

1. **Plugin-first architecture** - New capabilities should be added as plugins, not modifications to core
2. **Streaming-first design** - All agent interactions should support streaming via `createAgentStreamResponse`
3. **Session isolation** - Each session has its own agent instance and state
4. **Type safety** - The codebase uses TypeScript throughout; export types from `src/core/types.ts`

## Important Notes

- The project uses **Bun** as the JavaScript runtime
- **AI SDK v6** is the foundation - familiarize yourself with `ToolLoopAgent`, `useChat`, and streaming patterns
- Plugins were formerly called "middleware" - you may see old terminology in some files
- The `workspace/` directory contains runtime data (SQLite DB, plans, lessons, patterns)
