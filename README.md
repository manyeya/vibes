# Vibes

Vibes is a Bun monorepo for building and running a multi-agent coding assistant.
It includes:

- a Hono API server with streaming responses
- a React web chat demo
- a shared `harness-vibes` package that implements the DeepAgent/plugin framework

## Monorepo Layout

```text
vibes/
├── apps/
│   ├── api/                  # Hono backend + session manager + prompts
│   ├── demo/                 # React/Vite chat UI (uses AI SDK useChat)
│   ├── docs/                 # Deep-agent design notes and plans
│   └── tui/                  # TUI artifacts (dist + deps, source currently empty)
├── packages/
│   └── harness-vibes/        # Core agent framework, plugins, SQLite backend
├── architecture_overview.md
├── CLAUDE.md
└── package.json
```

## Architecture (Current)

1. `apps/demo` sends chat messages to `/api/mimo-code/stream`.
2. `apps/api` routes requests, resolves `session_id`, and gets/creates a session agent.
3. `DeepAgent` (from `harness-vibes`) runs tool-loop generation with plugins.
4. Streaming chunks and custom data parts are pushed to the UI.
5. Session messages and metadata are persisted in `workspace/vibes.db`.

Core runtime files:

- API entry: `apps/api/src/index.ts`
- API routes: `apps/api/src/routers/mimo-code.ts`
- API session management: `apps/api/src/session-manager.ts`
- Agent core: `packages/harness-vibes/src/core/agent.ts`
- Stream response helper: `packages/harness-vibes/src/core/agent-stream.ts`
- SQLite state backend: `packages/harness-vibes/src/backend/sqlitebackend.ts`

## Prerequisites

- Bun `>= 1.3`
- A model API key (`ZHIPU_API_KEY` is used by current API/session setup)

Install dependencies:

```bash
bun install
```

## Environment Variables

Create `.env` in repo root:

```env
# model/provider keys
ZHIPU_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
OPENROUTER_API_KEY=your_key_here

# server
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

# optional debugging
DEBUG_VIBES=1
```

Notes:

- `apps/api/src/session-manager.ts` and `apps/api/src/simple.ts` load `.env` via `dotenv-mono`.
- In production, API boot requires `OPENAI_API_KEY` (see `apps/api/src/index.ts`).

## Running Locally

Start API:

```bash
bun run dev:api
```

Start web demo in another terminal:

```bash
bun run dev:demo
```

Open:

- `http://localhost:5173` (full session UI)
- `http://localhost:5173/?simple` (minimal chat UI)

The demo proxies `/api/*` to `http://localhost:3000`.

## Scripts

Root scripts in `package.json`:

- `bun run dev:api` - run API in watch mode
- `bun run dev:demo` - run Vite demo
- `bun run build` - build packages then apps
- `bun run test` - run package tests (currently no test files are present)

Current caveats:

- `bun run dev` is defined but currently points to a non-package filter and fails.
- `bun run dev:tui` is defined, but there is no `@vibes/tui` package manifest in this repo state.

## API Endpoints

Base URL: `http://localhost:3000/api`

Health and info:

- `GET /health`
- `GET /`

Session management:

- `GET /sessions` - list sessions
- `POST /sessions` - create session
- `GET /sessions/:id` - get session info
- `PATCH /sessions/:id` - update title/summary/metadata
- `DELETE /sessions/:id` - delete session
- `GET /sessions/:id/messages` - load chat history
- `GET /sessions/:id/files` - current persisted message state for session

Agent endpoints:

- `POST /mimo-code` - non-streaming generation
- `POST /mimo-code/stream` - streaming generation (main UI path)
- `POST /simple/stream` - streaming with the simplified agent config

Common request shape:

```json
{
  "messages": [{ "role": "user", "content": "Hello" }],
  "session_id": "optional-session-id"
}
```

## Persistence and Session Isolation

Vibes stores runtime data under `workspace/` (gitignored):

- SQLite DB: `workspace/vibes.db`
- session directories: `workspace/sessions/<sessionId>/`

Session-only files may include:

- `scratchpad.md`
- `plan.md`
- `tasks.json`
- `tracked_files.json`
- `subagent_results/`

Cross-session shared files include:

- `facts.json`
- `patterns.json`
- `lessons.json`
- `swarm-state.json`
- `reflections.md`
- `subagent_results/`

## Plugin System (`harness-vibes`)

`DeepAgent` composes capabilities via plugins. Included plugins cover:

- planning/task management
- reasoning modes (`react`, `tot`, `plan-execute`)
- reflexion/lessons
- semantic memory and procedural memory
- swarm coordination
- sub-agent delegation
- filesystem and bash tooling
- skill activation

Plugin exports are in `packages/harness-vibes/src/plugins/index.ts`.

## Skills

The `SkillsPlugin` scans for skills at:

```text
skills/*/SKILL.md
```

from the process working directory.

This repository currently contains example skills under `apps/api/skills/`, not root `skills/`.
If you want runtime discovery with `activate_skill`, place skills in root `skills/` (or symlink that path).

## Build and Validation Status

Observed in this repo state:

- `bun run dev:api` works
- `bun run dev:demo` works
- `bun run build` works
- `bun run test` exits because no tests are present

## Additional Docs

- `architecture_overview.md` - high-level architecture diagram
- `apps/docs/streaming-ui.md` - frontend streaming data-part integration
- `apps/docs/DEEP_AGENT_PLAN.md` - deep-agent enhancement roadmap
- `CLAUDE.md` - contributor notes and architecture conventions

## License

MIT
