# Vibes

A powerful AI coding agent orchestrator with a beautiful TUI interface.

## Features

- 🤖 Multi-agent orchestration using DeepAgents
- 🧠 Specialized subagents (Oracle, Librarian, Explore, etc.)
- 📚 Skills system for specialized workflows
- 🎨 Claude Code-like TUI interface
- 💬 Real-time streaming responses
- 📝 Code block highlighting
- ⌨️ Multi-line input support
- 🔄 Message history
- 🚀 Fast and responsive UI

## Quick Start

### Start Backend API

```bash
bun run dev
```

The API will start on `http://localhost:3000`

### Start TUI

In a new terminal:

```bash
bun run tui:dev
```

## Project Structure

```
vibes/
├── src/
│   ├── index.ts           # Backend API entry point
│   ├── logger.ts          # Logger configuration
│   ├── routers/
│   │   └── agent.ts      # Agent API routes (streaming support)
│   └── vibes/
│       ├── index.ts        # DeepAgents configuration
│       ├── subagents/
│       ├── tools/
│       └── middleware/
├── skills/              # Skills directory
│   └── example-skill/
│       └── SKILL.md
├── tui/                 # TUI package (separate)
│   └── src/
│       ├── components/
│       │   ├── App.tsx
│       │   ├── Message.tsx
│       │   ├── MessageList.tsx
│       │   ├── Input.tsx
│       │   └── Header.tsx
│       └── lib/
│           └── formatter.ts
└── package.json
```

## Technology Stack

### Backend
- **Hono** - Fast web framework
- **DeepAgents** - Multi-agent orchestration
- **LangChain** - AI agent framework
- **AI SDK** - Streaming protocol with langchain adapter
- **Bun** - JavaScript runtime

### TUI
- **Ink** - React for CLIs
- **React** - UI library
- **AI SDK** - `useChat` hook for streaming
- **TypeScript** - Type safety

## Environment Variables

Create a `.env` file in the root directory:

```env
OPENROUTER_API_KEY=your_api_key_here
# or
OPENAI_API_KEY=your_api_key_here

PORT=3000
 NODE_ENV=development
SKILLS_DIR=./skills
```

## API Endpoints

### `/api/vibes/stream` (POST)

Streaming chat endpoint that integrates with DeepAgents orchestration.

Request:
```json
{
  "messages": [
    { "role": "user", "content": "Hello" }
  ]
}
```

Response: Server-Sent Events (SSE) streaming format

## Skills System

Vibes supports the Anthropic Skills standard for modular, discoverable agent capabilities.

### Skill Structure

Following the [Anthropic Skills specification](https://github.com/anthropics/skills):

```
skills/
└── skill-name/
    ├── SKILL.md          # Required - Main skill file
    ├── scripts/           # Optional - Executable scripts
    ├── references/         # Optional - Documentation
    └── assets/            # Optional - Templates, images
```

### SKILL.md Format

Skills use YAML frontmatter for metadata:

```markdown
---
name: skill-name
description: What the skill does and when to use it
---

# Skill Title

Instructions for the agent when this skill is active.
```

**Required fields:**
- `name` - Skill identifier (must match folder name)
- `description` - What skill does and when to use it (for auto-discovery)

**Best practices:**
- Keep SKILL.md concise (under 500 lines)
- Move detailed info to `references/` directory
- Store reusable scripts in `scripts/` directory
- Use progressive disclosure - load only what's needed

### Example Skill

See `skills/example-skill/SKILL.md` for a complete example following the Anthropic format.

### Using Skills

The agent discovers skills automatically through their `description` field. Use `activate_skill(name)` to activate a skill when needed (e.g., "activate frontend" or "use frontend skill").

## Keyboard Shortcuts (TUI)

- `Ctrl+D` - Submit message
- `Ctrl+C` - Exit TUI
- `Ctrl+A` - Move to start of line
- `Ctrl+E` - Move to end of line
- `←` / `→` - Move cursor left/right
- `Backspace` / `Delete` - Delete character

## License

MIT
