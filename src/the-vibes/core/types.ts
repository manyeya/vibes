import {
    type LanguageModel,
    type ModelMessage,
    type UIMessage,
    type Tool,
    type UIMessageStreamWriter,
    Agent,
    ToolLoopAgent,
} from 'ai';

/**
 * A single item in the agent's internal todo list.
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
 * Configuration for a specialized sub-agent that can be delegated tasks.
 */
export interface SubAgent {
    /** Name used to identify the agent in the delegation tool */
    name: string;
    /** Description of what this agent specializes in */
    description: string;
    /** The core persona and operating rules for the sub-agent */
    systemPrompt: string;
    /** List of tool names to inherit from parent, or direct tool definitions */
    tools?: string[] | Record<string, Tool<any, any>>;
    /** Optional specific model to use for this sub-agent */
    model?: LanguageModel;
    /** Optional existing middleware instances to share with this sub-agent */
    middleware?: Middleware[];
}

/**
 * Interface for agent middleware that can extend capabilities,
 * modify prompts, or run logic before/after model execution.
 */
export interface Middleware {
    /** Display name of the middleware */
    name: string;
    /** Optional collection of tools provided by this middleware to the agent */
    tools?: Record<string, any>;
    /** Hook executed before the model is called */
    beforeModel?: (state: AgentState) => Promise<void>;
    /** Hook executed after the model provides a response */
    afterModel?: (state: AgentState, response: any) => Promise<void>;
    /** Hook executed when a tool execution starts (AI SDK v6) */
    onInputStart?: (args: any) => void;
    /** Hook executed when tool input delta is available (AI SDK v6) */
    onInputDelta?: (delta: string) => void;
    /** Hook executed when full tool input is available (AI SDK v6) */
    onInputAvailable?: (args: any) => void;
    /** Function to modify or extend the system prompt */
    modifySystemPrompt?: (prompt: string) => string;
    /** Optional promise to wait for during initialization (e.g., sandbox startup) */
    waitReady?: () => Promise<void>;
    /** Optional hook to receive a data stream writer for real-time UI updates */
    onStreamReady?: (writer: UIMessageStreamWriter<AgentUIMessage>) => void;
    /** Optional hook executed when the stream finishes (successful completion) */
    onStreamFinish?: (result: any) => Promise<void>;
    /** Optional hook executed after each step in the reasoning loop */
    onStepFinish?: (step: { stepNumber: number; stepType: string; text?: string; content?: any }) => void;
}

/**
 * Represents the persistent state of an agent session.
 */
export interface AgentState {
    /** Array of conversation messages in AI SDK format */
    messages: ModelMessage[];
    /** Structured task list for tracking agent progress */
    todos: TodoItem[];
    /** Arbitrary metadata storage for middleware use */
    metadata: Record<string, any>;
    /** Summarized context of past conversation to maintain continuity */
    summary?: string;
}

/**
 * Defines the structure for custom data streamed to the UI.
 */
export type AgentDataParts = {
    /** System or informational notifications */
    notification: {
        message: string;
        level: 'info' | 'warning' | 'error';
    };
    /** Current operation status updates */
    status: {
        message: string;
        step?: number;
    };
    /** Updates to specific todo items for UI synchronization */
    todo_update: {
        id: string;
        status: string;
        title?: string;
    };
};

/** Type-safe UI message with agent-specific data parts */
export type AgentUIMessage = UIMessage<never, AgentDataParts>;

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
    /** Callback for step progress updates */
    onStepFinish?: (step: { stepNumber: number; stepType: string; text?: string }) => void;
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
}
