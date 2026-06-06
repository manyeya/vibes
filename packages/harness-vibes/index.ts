// harness-vibes public API barrel.
//
// This file is intentionally thin: the VibeAgent engine lives in
// src/core/vibe-agent.ts and the public Flue-like facade in
// src/core/harness.ts. Keeping the barrel free of class definitions avoids
// circular imports and keeps the package's surface easy to scan.

import { type InferAgentUIMessage } from 'ai';
import {
    TasksPlugin,
    PlanningPlugin,
    FilesystemPlugin,
    BashPlugin,
    SkillsPlugin,
    SubAgentPlugin,
    SummarizationPlugin,
    ArtifactPlugin,
    type ArtifactKind,
    type ArtifactPluginConfig,
    ClarificationPlugin,
    ASK_USER_TOOL_NAME,
    type SummarizationConfig,
    type ParallelDelegationResult,
} from './src/plugins';
import MemoryPlugin from './src/plugins/memory';
import SqliteBackend from './src/backend/sqlite-backend';
import StateBackend, { InMemoryStateBackend } from './src/backend/state-backend';
import {
    type AgentState,
    type AgentCoreConfig,
    type SubAgent,
    type TaskItem,
    type TaskTemplate,
    TaskType,
    type VibesDataParts,
    type VibesUIMessage,
    createDataStreamWriter,
    DataStreamWriter,
} from './src/core/types';
import { AgentCore } from './src/core/agent-core';

export { createAgentStreamResponse } from './src/core/stream-response';
export {
    SessionStore,
    defaultSessionManager,
    type SessionConfig,
    type StoredSession,
    type SessionAgentConfig,
    type CleanupOptions,
} from './src/core/session-manager';

// ── Phase 1: Sandbox abstraction ────────────────────────────────────────
export {
    type Sandbox,
    type SandboxKind,
    type ExecResult,
    type ExecOptions,
    type ListOptions,
    containPath,
} from './src/core/sandbox';
export { LocalSandbox, type LocalSandboxOptions } from './src/sandbox/local-sandbox';

// ── VibeAgent engine (extracted from this barrel) ───────────────────────
export {
    VibeAgent,
    createVibeAgent,
    createDefaultPlugins,
    type VibeAgentConfig,
    type DefaultPluginFactoryOptions,
} from './src/core/vibe-agent';

// ── Phase 2: Public harness facade ──────────────────────────────────────
export {
    defineAgent,
    createHarness,
    Harness,
    Session,
    type AgentDefinition,
    type AgentFactory,
    type HarnessOptions,
    type SessionOptions,
    type PromptOptions,
    type PromptResult,
} from './src/core/harness';

export {
    type AgentState,
    type TaskItem,
    type TaskTemplate,
    TaskType,
    type VibesDataParts,
    type VibesUIMessage,
    type InferAgentUIMessage,
    createDataStreamWriter,
    DataStreamWriter,
    TasksPlugin,
    PlanningPlugin,
    FilesystemPlugin,
    BashPlugin,
    SkillsPlugin,
    SubAgentPlugin,
    MemoryPlugin,
    ArtifactPlugin,
    type ArtifactKind,
    type ArtifactPluginConfig,
    ClarificationPlugin,
    ASK_USER_TOOL_NAME,
    type ParallelDelegationResult,
    SqliteBackend,
    StateBackend,
    InMemoryStateBackend,
    SummarizationPlugin,
    type SummarizationConfig,
    type AgentCoreConfig,
    type SubAgent,
    AgentCore,
};
