# Vibes System Architecture

This diagram illustrates the core components and data flow of the **Vibes** agentic system, as derived from the provided architectural sketch.

## Architecture Diagram

```mermaid
graph TD
    %% Subgraphs for logical grouping
    subgraph UI ["User Interface"]
        CLI["CLI Commands"]
        TUI["Terminal UI"]
    end

    subgraph Core ["Core Orchestration"]
        AC["Agent Coordinator"]
        SM["Session Manager"]
        SP["Session Processor"]
    end

    subgraph Persist ["Persistence"]
        PC["Project Config"]
        DB["Local SQLite DB"]
    end

    subgraph Caps ["Capabilities"]
        TR["Tool Registry"]
        FST["File System Tools"]
        BST["Bash/Shell Tools"]
        LSP["LSP Integration"]
        MCP["MCP Client"]
    end

    %% Entry Point
    CLI --> AC

    %% Core Flow
    AC --> SM
    SM --> SP
    SP -- "AI Response" --> SM
    SM -- "Update UI" --> TUI

    %% Persistence & Config
    AC --> PC
    SP --> DB

    %% Tooling & Capabilities
    AC --> TR
    SP --> TR
    
    %% Specific Tools
    TR --> FST
    TR --> BST
    TR --> LSP
    TR --> MCP

    %% Styling
    classDef ui fill:#e1f5fe,stroke:#01579b,stroke-width:2px;
    classDef core fill:#fff3e0,stroke:#e65100,stroke-width:2px;
    classDef persist fill:#f3e5f5,stroke:#4a148c,stroke-width:2px;
    classDef caps fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px;

    class UI,CLI,TUI ui;
    class Core,AC,SM,SP core;
    class Persist,PC,DB persist;
    class Caps,TR,FST,BST,LSP,MCP caps;
```

## Component Breakdown

### User Interface
- **CLI Commands**: The primary entry point for user interactions.
- **Terminal UI**: Dynamic interface for real-time feedback and session updates.

### Core Orchestration
- **Agent Coordinator**: Manages high-level task orchestration and initial setup.
- **Session Manager**: Maintains the state of the current session and handles UI updates.
- **Session Processor**: Executes the logic for individual steps, interacting with AI models and tools.

### Persistence
- **Project Config**: Stores environment-specific settings and workspace configuration.
- **Local SQLite DB**: Persists session history, logs, and long-term memory.

### Capabilities
- **Tool Registry**: A central hub that manages available system tools.
- **System Tools**: Includes file system access, shell execution, LSP integration, and MCP (Model Context Protocol) clients.
