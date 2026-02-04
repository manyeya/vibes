# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Vibes is a multi-agent AI coding orchestrator built on the Vercel AI SDK v6. It features a sophisticated plugin-based architecture with deep reasoning capabilities, persistent memory, and both terminal (TUI) and web interfaces.

**Monorepo structure** (Bun workspaces):
- `apps/api` - Hono backend server with session management
- `apps/tui` - Terminal UI (React + Ink)
- `apps/demo` - Web demo app
- `packages/harness-vibes` - Core DeepAgents framework

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

### DeepAgent Framework

The heart of the system is `VibeAgent` (in `packages/harness-vibes/src/core/agent.ts`), which extends AI SDK's `ToolLoopAgent`. This provides:

- **Plugin system** - Extensible capabilities via modular plugins
- **Restorable compression** - Large content replaced with file/path references
- **Error preservation** - Errors tracked separately, never summarized
- **KV-cache awareness** - Stable prompt prefix for cache optimization

### Plugin System (not middleware!)

Plugins (in `packages/harness-vibes/src/plugins/`) provide tools and lifecycle hooks. Key plugins:

| Plugin | Purpose |
|--------|---------|
| `PlanningPlugin` | Task management with persistence, plan save/load |
| `ReasoningPlugin` | ReAct, Tree-of-Thoughts, Plan-Execute modes |
| `ReflexionPlugin` | Error analysis and lesson extraction |
| `SemanticMemoryPlugin` | Vector-based fact storage (RAG-style) |
| `ProceduralMemoryPlugin` | Pattern/workflow storage |
| `SwarmPlugin` | Multi-agent coordination with shared state |
| `SubAgentPlugin` | Delegation to specialized sub-agents |
| `SkillsPlugin` | Skill management and discovery |
| `FilesystemPlugin` | File read/write operations |
| `BashPlugin` | Shell command execution |

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
- `POST /api/mimo-code/stream` - Streaming agent endpoint

The `sessionManager` (in `apps/api/src/session-manager.ts`) manages agent instances per session.

### Sub-Agent System

Specialized sub-agents can be defined and delegated to. Each sub-agent:
- Has its own system prompt and tool allowlist/blocklist
- Can inherit tools from the parent agent
- Results are saved to `subagent_results/` directory

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
2. **Streaming-first design** - All agent interactions should support streaming via `createDeepAgentStreamResponse`
3. **Session isolation** - Each session has its own agent instance and state
4. **Type safety** - The codebase uses TypeScript throughout; export types from `src/core/types.ts`

## Important Notes

- The project uses **Bun** as the JavaScript runtime
- **AI SDK v6** is the foundation - familiarize yourself with `ToolLoopAgent`, `useChat`, and streaming patterns
- Plugins were formerly called "middleware" - you may see old terminology in some files
- The `workspace/` directory contains runtime data (SQLite DB, plans, lessons, patterns)
