# @vibes/tui

Terminal User Interface for Vibes AI agent, built with Ink and React.

## Features

- 🎨 Beautiful TUI with Claude Code-like interface
- 💬 Real-time streaming responses
- 🎯 Color-coded messages (user/assistant/system)
- 📝 Code block highlighting
- ⌨️ Multi-line input support
- 🔄 Message history
- 🚀 Fast and responsive UI

## Installation

```bash
bun install
```

## Usage

### Development Mode

```bash
bun run dev
```

### Build

```bash
bun run build
```

### Run Built Version

```bash
bun run start
```

## Environment Variables

Make sure to set your API key in a `.env` file:

```env
OPENROUTER_API_KEY=your_api_key_here
# or
OPENAI_API_KEY=your_api_key_here
```

## Keyboard Shortcuts

- `Ctrl+D` - Submit message
- `Ctrl+C` - Exit TUI
- `Ctrl+A` - Move to start of line
- `Ctrl+E` - Move to end of line
- `←` / `→` - Move cursor left/right
- `Backspace` / `Delete` - Delete character

## Architecture

```
tui/
├── src/
│   ├── components/
│   │   ├── App.tsx          # Main app component using useChat hook
│   │   ├── Header.tsx       # Header component
│   │   ├── Message.tsx      # Message display with code block formatting
│   │   ├── MessageList.tsx  # Message list container
│   │   └── Input.tsx        # Input handling with keyboard shortcuts
│   ├── lib/
│   │   └── formatter.ts     # Text formatting utilities for code blocks
│   └── index.tsx            # Entry point
├── package.json
└── tsconfig.json
```

## Backend Integration

The TUI connects to the Vibes backend API at `http://localhost:3000/api/vibes/stream`. Make sure the backend server is running before starting the TUI.

The backend uses the AI SDK's langchain adapter to stream responses from the DeepAgents orchestration system.

## Technologies

- **Ink** - React for CLIs
- **React** - UI library
- **AI SDK** - AI streaming integration
- **TypeScript** - Type safety
- **Bun** - JavaScript runtime

## License

MIT
