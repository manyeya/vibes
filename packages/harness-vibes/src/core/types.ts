import {
    type LanguageModel,
    type ModelMessage,
    type Tool,
    type UIMessageStreamWriter,
    type StreamTextResult,
    type GenerateTextResult,
    type ToolSet,
    type StepResult,
} from 'ai';

// Re-export ModelMessage for middleware use
export type { ModelMessage };

// Import streaming types
import type { VibesUIMessage, VibesDataParts } from './streaming.js';

/**
 * A single item in the agent's internal todo list.
 * @deprecated Consider using TaskItem for more advanced task management
 */
export interface TodoItem {
    /** Unique identifier for the todo item */
    id: string;
    /** Human-readable title of the task */
    title: string;
    /** Current status of the task */
    status: 'pending' | 'in_progress' | 'completed';
    /** Task priority level */
    priority: 'low' | 'medium' | 'high';
    /** ISO timestamp when the task was created */
    createdAt: string;
}

/**
 * A single item in the agent's advanced task management system.
 * Supports dependencies, blocking, references, and metadata.
 */
export interface TaskItem {
    /** Unique identifier for the task */
    id: string;
    /** Human-readable title of the task */
    title: string;
    /** Detailed description of the task */
    description: string;
    /** Current status of the task */
    status: 'pending' | 'blocked' | 'in_progress' | 'completed' | 'failed';
    /** Task priority level */
    priority: 'low' | 'medium' | 'high' | 'critical';
    /** ISO timestamp when the task was created */
    createdAt: string;
    /** ISO timestamp when the task was last updated */
    updatedAt: string;
    /** ISO timestamp when the task was completed (if applicable) */
    completedAt?: string;
    /** Task IDs that this task blocks (dependents that wait for this task) */
    blocks: string[];
    /** Task IDs that must complete before this task can start (dependencies) */
    blockedBy: string[];
    /** File paths to auto-read when working on this task */
    fileReferences: string[];
    /** Related task IDs that aren't strict dependencies */
    taskReferences: string[];
    /** URLs to docs, issues, PRs, or other external resources */
    urlReferences: string[];
    /** ID of the template used to create this task (if applicable) */
    templateId?: string;
    /** Additional metadata storage */
    metadata: Record<string, any>;
    /** Error message if the task failed */
    error?: string;
    /** Estimated complexity score (1-10) */
    complexity?: number;
    /** Owner of the task (agent name or user ID) */
    owner?: string;
    /** Tags for categorization and filtering */
    tags: string[];
}

/**
 * A reusable task template for common patterns.
 */
export interface TaskTemplate {
    /** Unique identifier for the template */
    id: string;
    /** Human-readable name of the template */
    name: string;
    /** Description of what this template is for */
    description: string;
    /** Base task structure with parameter placeholders */
    baseTask: Partial<Omit<TaskItem, 'id' | 'createdAt' | 'updatedAt'>>;
    /** Parameter definitions for placeholder substitution */
    parameters: Array<{
        name: string;
        description: string;
        default?: any;
        required: boolean;
    }>;
    /** Optional sub-tasks to create alongside the main task */
    subTasks?: Partial<TaskItem>[];
    /** Default file patterns to include as references */
    defaultFilePatterns?: string[];
}

/**
 * Error entry for tracking failures separately from context.
 * Errors are preserved and never included in summaries (Manus approach).
 */
export interface ErrorEntry {
    /** ISO timestamp of when the error occurred */
    timestamp: string;
    /** Name of the tool that produced the error (if applicable) */
    toolName?: string;
    /** The error message or stack trace */
    error: string;
    /** Additional context about where/when the error occurred */
    context?: string;
    /** Number of times this same error recurred recently */
    occurrenceCount: number;
}

/**
 * Configuration for a specialized sub-agent that can be delegated tasks.
 */
export interface SubAgent {
    /** Name used to identify the agent in the delegation tool */
    name: string;
    /** Description of what this agent specializes in */
    description: string;
    /** The core persona and operating rules for the sub-agent */
    systemPrompt: string;
    /** Custom tool definitions (object) or explicit tool names to include (deprecated, use allowedTools) */
    tools?: string[] | Record<string, Tool<any, any>>;
    /** Whitelist of inherited tool names to allow (undefined = all inherited tools allowed) */
    allowedTools?: string[];
    /** Blacklist of tool names to block (takes precedence over allowedTools) */
    blockedTools?: string[];
    /** Optional specific model to use for this sub-agent */
    model?: LanguageModel;
    /** Optional existing middleware instances to share with this sub-agent */
    middleware?: Middleware[];
}

/**
 * Interface for agent middleware that can extend capabilities.
 *
 * Middleware provides tools and lifecycle hooks that run at specific points
 * during agent execution. Hooks that duplicate AI SDK functionality are avoided.
 *
 * @example
 * ```ts
 * const myMiddleware: Middleware = {
 *   name: 'MyMiddleware',
 *   tools: { myTool },
 *   modifySystemPrompt: (prompt) => prompt + '\\n\\nAdditional instructions...',
 *   onStreamReady: (writer) => writer.write({ type: 'data-status', data: { message: 'Ready' } }),
 *   waitReady: async () => { await initialize(); },
 * }
 * ```
 */
export interface Middleware {
    /** Display name of the middleware */
    name: string;

    /** Optional collection of tools provided by this middleware to the agent */
    tools?: Record<string, any>;

    /**
     * Hook to modify settings for each step (runs before model call).
     * This receives the AI SDK's prepareStep options and can return modifications.
     * The options include: steps, stepNumber, model, messages, experimental_context
     *
     * Can return either:
     * - void/undefined for side effects only
     * - An object with modifications (model, toolChoice, activeTools, system, messages, etc.)
     */
    prepareStep?: (options: {
        steps: any[];
        stepNumber: number;
        model: LanguageModel;
        messages: ModelMessage[];
        experimental_context?: unknown;
    }) => (
        | void
        | Promise<void>
        | {
              model?: LanguageModel;
              toolChoice?: any;
              activeTools?: string[];
              system?: string | any;
              messages?: ModelMessage[];
              experimental_context?: unknown;
          }
        | Promise<{
              model?: LanguageModel;
              toolChoice?: any;
              activeTools?: string[];
              system?: string | any;
              messages?: ModelMessage[];
              experimental_context?: unknown;
          }>
    );

    /** Function to modify or extend the system prompt (can be async) */
    modifySystemPrompt?: (prompt: string) => string | Promise<string>;

    /** Hook executed after the model provides a response (no AI SDK equivalent) */
    afterModel?: (state: AgentState, response: any) => Promise<void>;

    /** Hook executed when a tool execution starts (AI SDK v6) */
    onInputStart?: (args: any) => void;

    /** Hook executed when tool input delta is available (AI SDK v6) */
    onInputDelta?: (delta: string) => void;

    /** Hook executed when full tool input is available (AI SDK v6) */
    onInputAvailable?: (args: any) => void;

    /** Optional promise to wait for during initialization (e.g., sandbox startup) */
    waitReady?: () => Promise<void>;

    /** Optional hook to receive a data stream writer for real-time UI updates */
    onStreamReady?: (writer: UIMessageStreamWriter<VibesUIMessage>) => void;

    /** Optional hook executed when the stream finishes (successful completion) */
    onStreamFinish?: (result: any) => Promise<void>;

    // REMOVED: beforeModel - use prepareStep instead (AI SDK built-in)
    // REMOVED: onStepFinish - use ToolLoopAgent.onStepFinish (AI SDK built-in)
}

/**
 * Represents the persistent state of an agent session.
 */
export interface AgentState {
    /** Array of conversation messages in AI SDK format */
    messages: ModelMessage[];
    /** Structured todo list for tracking agent progress */
    todos: TodoItem[];
    /** Advanced task list with dependencies and blocking */
    tasks: TaskItem[];
    /** Arbitrary metadata storage for middleware use */
    metadata: Record<string, any>;
    /** Summarized context of past conversation to maintain continuity */
    summary?: string;
}

/**
 * @deprecated Use VibesDataParts from './streaming.ts' instead
 * This is kept for backwards compatibility
 */
export type AgentDataParts = import('./streaming.js').VibesDataParts;

/**
 * @deprecated Use VibesUIMessage from './streaming.ts' instead
 * This is kept for backwards compatibility
 */
export type AgentUIMessage = import('./streaming.js').VibesUIMessage;

/**
 * Re-export commonly used streaming types and utilities
 */
export type {
    VibesDataParts,
    VibesUIMessage,
} from './streaming.js';

export {
    createDataStreamWriter,
    DataStreamWriter,
} from './streaming.js';

/**
 * Configuration for initializing a VibeAgent instance.
 */
export interface VibeAgentConfig {
    /** The AI model to use */
    model: LanguageModel;
    /** The base system instructions */
    instructions: string;
    /** Optional display name for the agent (used in notifications) */
    name?: string;
    /** Custom instructions to extend the base system prompt */
    systemPrompt?: string;
    /** Additional custom tools available to the agent */
    tools?: Record<string, Tool<any, any>>;
    /** Maximum number of reasoning steps per invocation (default: 20) */
    maxSteps?: number;
    /** Maximum messages before context compression kicks in (default: 30) */
    maxContextMessages?: number;
    /** Model temperature for controlling randomness */
    temperature?: number;
    /** Maximum retries for API failures (default: 2) */
    maxRetries?: number;
    /** Callback for step progress updates (matches AI SDK's StepResult) */
    onStepFinish?: (stepResult: StepResult<ToolSet>) => void | Promise<void>;
    /** Custom middleware to extend agent behavior */
    middleware?: Middleware[];
    /** Enable telemetry for observability (default: false) */
    enableTelemetry?: boolean;
    /** The base directory for filesystem operations (e.g., 'workspace') */
    workspaceDir?: string;
    /** List of tool names that require explicit user approval before execution */
    toolsRequiringApproval?: string[] | Record<string, boolean | ((args: any) => boolean | Promise<boolean>)>;
    /** Optional whitelist of tool names allowed for this agent instance */
    allowedTools?: string[];
    /** Optional blacklist of tool names to block (takes precedence over allowedTools) */
    blockedTools?: string[];
}

/**
 * Result returned by VibeAgent.generate()
 * Extends GenerateTextResult with additional agent-specific fields
 */
export interface VibeAgentGenerateResult<TOOLS extends ToolSet = ToolSet>
    extends GenerateTextResult<TOOLS, never> {
    /** The current agent state after generation */
    state: AgentState;
    /** Tool errors that occurred during generation (if any) */
    toolErrors?: Array<unknown>;
}

/**
 * Result returned by VibeAgent.stream() - same as StreamTextResult from AI SDK
 * Using ToolSet for tool types due to dynamic tool registration
 */
export type VibeAgentStreamResult = StreamTextResult<ToolSet, never>;
