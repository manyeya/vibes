// harness-vibes public API barrel.
//
// This file is intentionally thin: the VibeAgent engine lives in
// src/core/vibe-agent.ts and the public Flue-like facade in
// src/core/runtime.ts. Keeping the barrel free of class definitions avoids
// circular imports and keeps the package's surface easy to scan.

import { type InferAgentUIMessage } from 'ai';
import {
    TasksPlugin,
    PlanningPlugin,
    PLAN_REVIEW_TOOL_NAME,
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
    WorkflowPlugin,
    type WorkflowPluginConfig,
    type Workflow,
    type WorkflowStep,
    type StepKind,
    validateWorkflow,
    type WorkflowValidation,
    runWorkflowToStream,
    type RunWorkflowOptions,
    type RunWorkflowOutcome,
    type SummarizationConfig,
    type ParallelDelegationResult,
} from './src/plugins';
import MemoryPlugin from './src/plugins/memory';
import SqliteBackend from './src/backend/sqlite-backend';
import StateBackend, { InMemoryStateBackend } from './src/backend/state-backend';
export type { SessionInfo, WorkspaceInfo } from './src/backend/sqlite-backend';
import {
    type AgentState,
    type AgentHarnessConfig,
    type SubAgent,
    type TaskItem,
    type TaskTemplate,
    TaskType,
    type VibesDataParts,
    type VibesUIMessage,
    createDataStreamWriter,
    DataStreamWriter,
} from './src/core/types';
import { AgentHarness } from './src/core/agent/agent-harness';

export { createAgentStreamResponse } from './src/core/streaming/stream-response';
export {
    SessionStore,
    defaultSessionManager,
    type SessionConfig,
    type StoredSession,
    type SessionAgentConfig,
    type CleanupOptions,
} from './src/core/session/session-manager';

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
} from './src/core/agent/vibe-agent';

// ── Phase 2: Public harness facade ──────────────────────────────────────
export {
    defineAgent,
    createRuntime,
    AgentRuntime,
    Session,
    type AgentDefinition,
    type AgentFactory,
    type RuntimeOptions,
    type SessionOptions,
    type PromptOptions,
    type PromptResult,
} from './src/core/runtime';

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
    PLAN_REVIEW_TOOL_NAME,
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
    WorkflowPlugin,
    type WorkflowPluginConfig,
    type Workflow,
    type WorkflowStep,
    type StepKind,
    validateWorkflow,
    type WorkflowValidation,
    runWorkflowToStream,
    type RunWorkflowOptions,
    type RunWorkflowOutcome,
    type ParallelDelegationResult,
    SqliteBackend,
    StateBackend,
    InMemoryStateBackend,
    SummarizationPlugin,
    type SummarizationConfig,
    type AgentHarnessConfig,
    type SubAgent,
    AgentHarness,
};
