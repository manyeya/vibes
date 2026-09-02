# Vibes

Vibes is a multi-agent AI **coding orchestrator** built on the Vercel AI SDK v7.
It **owns its agent loop** — implementing the SDK's `Agent` (`agent-v1`)
interface rather than extending `ToolLoopAgent` — and layers a lean, plugin-based
architecture on top: real shell + file tools, runtime sub-agent deployment,
renderable canvas artifacts, working memory, and execution
modes. It ships with both a terminal (TUI) and a web interface, and runs on
**Bun**.

The core lives in `packages/harness-vibes`; `apps/*` are thin front doors over it.

## What the agent can do

Everything below is a real, wired capability of the flagship agent
(`createVibeAgent`), exposed as tools the model can call:

- **Real host shell** — `bash` runs actual commands through Bun's shell
  (`Bun.$`): `git`, `node`, `npm`/`bun`, `python`, pipes, redirects, globs. It is
  rooted at the workspace but not jailed. (This replaced the old in-process
  interpreter, so host binaries genuinely work now.)
- **File tools** — `readFile` / `writeFile` / `edit_file` / `list_files`, path-
  contained to the workspace via a `Sandbox`, streaming syntax-highlighted
  unified diffs and file-op cards to the UI.
- **Planning** — `create_plan` / `generate_tasks_from_plan` plus a persisted
  task list (`plan.md`, `tasks.json`), with a plan that can be put up for user
  sign-off before any work.
- **Execution modes** — `plan` / `manual` / `auto-edit` / `auto`, a policy layer
  over the tool-approval gate. Plan mode is read-only; manual asks before every
  edit/exec; auto-edit auto-applies file edits but asks for shell/delegation;
  auto is full autonomy. Both the user (UI/API) and the agent (`set_mode`) can
  switch it live.
- **Sub-agents** — delegate work to focused workers (`task` / `delegate` /
  `parallel_delegate`), and **deploy new specialists at runtime**
  (`create_agent` / `spawn_agent` / `list_agents`). Sub-agents run a lean plugin
  set and report back a result.
- **Renderable artifacts** — build HTML sites, markdown docs, mermaid diagrams
  and charts that stream to a canvas panel and save under `artifacts/`.
- **Working memory** — a per-session scratchpad plus a searchable long-term note
  store (`remember` / `recall` / `update_memory` / `forget` / `list_memories`);
  only a compact index is injected into the prompt.
- **Ask the user** — `ask_user` streams a structured questionnaire (single /
  multi / boolean / number / text) rendered as a form; the run halts until the
  answers arrive.
- **Skills** — discover and activate human-authored skills from `SKILL.md`
  files.
- **Web search** — Exa / Tavily / Brave, enabled only when a provider key is set.
- **Repo awareness** — auto-loads `CLAUDE.md` / `AGENTS.md` guidance into the
  system prompt.
- **Guardrails** — secret masking on prose and tool output, plus caller-defined
  content checks.

Cross-cutting: **restorable compression** (large content swapped for file
references), **rolling summarization** to stay within the context window,
per-request model override, provider/stream **error surfacing**, and an
**event bus** to observe a run headlessly.

## Monorepo layout

```text
vibes/
├── apps/
│   ├── api/                # Hono backend: sessions, streaming, models
│   ├── demo/               # React/Vite web chat + canvas UI (AI SDK useChat)
│   └── tui/                # Terminal UI (React + OpenTUI): chat, forms, activity
├── packages/
│   └── harness-vibes/      # The agent framework — the "harness"
├── CLAUDE.md               # Contributor + architecture notes (authoritative)
└── package.json
```

## Architecture

Three layers, each with a role-obvious name:

| Role | Name | File |
|------|------|------|
| The owned loop | `runAgentLoop` + `streamModelStep` | `src/core/agent/loop.ts`, `llm.ts` |
| The agent | `VibesAgent` (implements SDK `Agent`) | `src/core/agent/agent.ts` |
| The flagship | `VibeAgent` / `createVibeAgent` (all default plugins) | `src/core/agent/vibe-agent.ts` |
| The runtime / front door | `AgentRuntime` / `createRuntime` / `defineAgent` / `Session` | `src/core/runtime.ts` |

The loop is a pure outer/inner loop: each step is one `streamText` call with
`stopWhen: stepCountIs(1)`. Vibes owns prune, plugin fan-out, stop conditions,
halt (e.g. on `ask_user` / plan review) and steering; `streamText` is only the
single-step primitive.

**Plugins** (`src/plugins/`) provide the tools and lifecycle hooks above:
`PlanningPlugin`, `SkillsPlugin`, `FilesystemPlugin`, `BashPlugin`,
`RepoContextPlugin`, `ArtifactPlugin`, `ClarificationPlugin`, `GuardrailsPlugin`,
`SummarizationPlugin`, `WebSearchPlugin`, `MemoryPlugin`,
`ModePlugin`, `SubAgentPlugin`. `McpPlugin` (connect MCP servers, expose their
tools) ships in the package as an opt-in plugin, not in the default roster. New
capabilities are added as plugins, not core changes.

**Sandbox** — filesystem + shell go through a `Sandbox` (`src/core/sandbox.ts`).
The default `LocalSandbox` runs on the host using Bun (`Bun.$`, `Bun.file`,
`Bun.write`); structured path operations are contained within the workspace root.

## Getting started

Prerequisites: **Bun ≥ 1.3** and at least one model provider key.

```bash
bun install
```

Create `.env` in the repo root. The API picks a provider in this order, using
whichever key is present:

```env
# providers (first one present wins)
AI_GATEWAY_API_KEY=...     # preferred — Vercel AI Gateway
ZHIPU_API_KEY=...          # historical default
OPENAI_API_KEY=...
OPENROUTER_API_KEY=...      # free default model: openai/gpt-oss-20b:free

# server
PORT=3000
NODE_ENV=development
SKILLS_DIR=./skills        # optional; where SkillsPlugin looks
```

### Use it in any repo

Like claude code / opencode, run the agent inside any project directory. Install
the global command once from a checkout, then run it anywhere:

```bash
git clone <vibes> && cd vibes && bun install && bun link   # installs `vibes`

cd ~/some/other/repo
vibes
```

`vibes` opens the current directory as the project, auto-starts the API as a
child process on an ephemeral port (you don't run a server yourself), and drops
you into the terminal UI rooted at that repo. All Vibes state (DB, sessions,
memory) lives under `~/.vibes/` — nothing is written into your repo. On exit the
API is stopped.

**Configuration.** Model keys are stored securely, never asked for twice:

```bash
vibes login                 # prompts for a key (hidden), stores it securely
                            # defaults to OPENROUTER_API_KEY — free keys at openrouter.ai/keys
vibes login OPENAI_API_KEY  # or a specific provider
vibes keys                  # show the backend + stored names (never values)
vibes keys rm OPENAI_API_KEY
vibes logout                # clear all
```

Providers, in resolution order: `AI_GATEWAY_API_KEY`, `ZHIPU_API_KEY`,
`OPENAI_API_KEY`, `OPENROUTER_API_KEY` (also `EXA_API_KEY` / `TAVILY_API_KEY` /
`BRAVE_API_KEY` for web search).

**Where keys live (per platform):**

| | Storage |
|---|---|
| macOS / Windows / Linux desktop | **OS keychain** — Keychain / Credential Manager / Secret Service |
| headless Linux, container, WSL, CI | **`~/.vibes/credentials.json`**, AES-256-GCM encrypted (fallback when no keychain is available) |
| any (highest precedence) | **environment variables** — `export OPENROUTER_API_KEY=…`; nothing stored |

The keychain is tried first and the code is lazy-loaded, so a missing keychain
never crashes — it transparently falls back to the encrypted file. Environment
variables always win, so CI just exports them. The file's master key is
`CREDENTIAL_ENCRYPTION_KEY` (64 hex chars) if set, else an auto-generated
`~/.vibes/credential-key` (mode 0600). Honest note: because that key sits next
to the data, the file fallback guards against accidental commits / backups /
casual reads — not a local attacker; the OS keychain (the default where
available) is the real at-rest protection.

**CLI:**

```
vibes [--port <n>] [--home <dir>] [--api-url <url>] [--help] [--version]
```

`--api-url` attaches to an already-running API (e.g. `bun run dev:api`) instead
of spawning one; `--home` overrides the state dir (`$VIBES_HOME`, default
`~/.vibes`).

**Packaging.** `bun run vibes:build` bundles the API and TUI into `dist/`; the
launcher prefers those bundles when present. (A fully self-contained,
cross-platform single binary is not yet shipped — the terminal UI's native
`@opentui/core` renderer needs per-platform packaging, so `@opentui/core` stays
a runtime dependency. Install via `bun link` for now.)

### Run the pieces separately (development)

```bash
bun run dev:api            # Hono API on :3000
bun run dev:demo           # web UI (Vite) — proxies /api/* to :3000
bun run dev:tui            # terminal UI (expects the API on :3000)
```

## Scripts

- `bun run dev:api` / `dev:demo` / `dev:tui` — run each app in watch mode
- `bun run build` — build packages then apps
- `bun run test` — run package tests (`packages/harness-vibes` has 31 test files)
- `bun run dev:tools` — AI SDK devtools

## API endpoints

Base URL `http://localhost:3000/api`:

- **Sessions** — `GET/POST /sessions`, `GET/PATCH/DELETE /sessions/:id`,
  `GET /sessions/:id/messages`
- **Chat** — `POST /vibe/stream` (main streaming path),
  `GET /vibe/:sessionId/reconnect` (resume a live stream)
- **Discovery** — `GET /agents` (sub-agent roster), `GET /workspaces/:id/git`
  (branch + dirty state), `GET /health`

Request shape:

```json
{ "messages": [{ "role": "user", "content": "Hello" }], "session_id": "optional", "mode": "auto" }
```

## Persistence & session isolation

Runtime state lives under `workspace/` (gitignored), persisted to SQLite via
Drizzle (`src/storage/drizzle-backend.ts`, DB at `workspace/vibes.db`). Each
session gets its own agent instance and state directory.

- Per-session: `scratchpad.md`, `plan.md`, `tasks.json`, `tracked_files.json`,
  `artifacts/`, `subagent_results/`
- Shared across sessions: `memories.json`

## License

MIT
