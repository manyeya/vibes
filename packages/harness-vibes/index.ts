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
    GuardrailsPlugin,
    GuardrailError,
    type Guardrail,
    type GuardrailResult,
    type GuardrailStage,
    type GuardrailContext,
    type GuardrailsConfig,
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
import {
    resolveBudgetStops,
    tokenBudget,
    toolCallBudget,
    costBudget,
    estimateCost,
    type BudgetConfig,
    type ModelPricing,
} from './src/core/agent/budgets';
import {
    resolveLoopStops,
    loopStop,
    loopBreaches,
    type LoopDetectionConfig,
} from './src/core/agent/loop-detection';
import {
    classifyComplexity,
    reasoningProviderOptions,
    type ReasoningTier,
    type AdaptiveReasoningConfig,
} from './src/core/agent/reasoning';
import { redactSecrets, redactString } from './src/core/redact';
import DrizzleBackend from './src/storage/drizzle-backend';
import StateBackend from './src/storage/state-backend';
import { connectStore, type StoreConnection, type ConnectOptions } from './src/storage/connect';
export type { SessionInfo, WorkspaceInfo, StreamChunk, StreamMeta, LatestStream } from './src/storage/state-backend';
import {
    type AgentState,
    type SubAgent,
    type TaskItem,
    type TaskTemplate,
    TaskType,
    type VibesDataParts,
    type VibesUIMessage,
    createDataStreamWriter,
    DataStreamWriter,
} from './src/core/types';
import { VibesAgent, type VibesAgentConfig, type VibesGenerateResult, type VibesStreamResult } from './src/core/agent/agent';

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

// ── Execution modes (plan / manual / auto-edit / auto) ──────────────────
export {
    type AgentMode,
    AGENT_MODES,
    MODE_LABEL,
    isAgentMode,
    nextMode,
} from './src/core/agent/modes';

// ── Event bus (subscribe to a run headlessly) ───────────────────────────
export {
    AgentEventBus,
    type AgentEvent,
    type AgentEventListener,
} from './src/core/streaming/streaming';

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
    GuardrailsPlugin,
    GuardrailError,
    type Guardrail,
    type GuardrailResult,
    type GuardrailStage,
    type GuardrailContext,
    type GuardrailsConfig,
    resolveBudgetStops,
    tokenBudget,
    toolCallBudget,
    costBudget,
    estimateCost,
    type BudgetConfig,
    type ModelPricing,
    resolveLoopStops,
    loopStop,
    loopBreaches,
    type LoopDetectionConfig,
    classifyComplexity,
    reasoningProviderOptions,
    type ReasoningTier,
    type AdaptiveReasoningConfig,
    redactSecrets,
    redactString,
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
    DrizzleBackend,
    StateBackend,
    connectStore,
    type StoreConnection,
    type ConnectOptions,
    SummarizationPlugin,
    type SummarizationConfig,
    type SubAgent,
    VibesAgent,
    type VibesAgentConfig,
    type VibesGenerateResult,
    type VibesStreamResult,
};
