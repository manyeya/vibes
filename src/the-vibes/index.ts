/// <reference types="bun-types" />
import {
    generateText,
    streamText,
    convertToModelMessages,
    type LanguageModel,
    type ModelMessage,
    type UIMessage,
    type UIMessageStreamWriter,
    type Tool,
    stepCountIs,
} from 'ai';

import { openai } from '@ai-sdk/openai';
import StateBackend from './backend/statebackend';
import {
    SkillsMiddleware,
    TodoListMiddleware,
    BashMiddleware,
    SubAgentMiddleware,
    Middleware
} from './middleware';
import { TodoItem } from './middleware/todos';
import { SubAgent } from './middleware/subagent';

/**
 * Represents the persistent state of an agent session, including conversation history,
 * virtual files, todos, and custom metadata.
 */
interface AgentState {
    /** Array of conversation messages in AI SDK format */
    messages: ModelMessage[];
    /** Virtual filesystem storage (legacy, replaced by real FS in BashMiddleware) */
    files: Record<string, string>;
    /** Structured task list for tracking agent progress */
    todos: TodoItem[];
    /** Arbitrary metadata storage for middleware use */
    metadata: Record<string, any>;
}


/**
 * Defines the structure for custom data streamed to the UI.
 */
type AgentDataParts = {
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
type AgentUIMessage = UIMessage<never, AgentDataParts>;


/**
 * Configuration for initializing a DeepAgent instance.
 */
interface DeepAgentConfig {
    /** The AI model to use (defaults to GPT-4o) */
    model?: LanguageModel;
    /** Custom instructions to extend the base system prompt */
    systemPrompt?: string;
    /** Additional custom tools available to the agent */
    tools?: Record<string, Tool<any, any>>;
    /** Custom middleware to extend agent behavior */
    middleware?: Middleware[];
    /** Registry of sub-agents available for delegation */
    subAgents?: SubAgent[];
    /** Maximum number of reasoning steps per invocation (default: 20) */
    maxSteps?: number;
    /** If true, standard middleware (Todos, Skills, Bash) will not be loaded */
    skipDefaultMiddleware?: boolean;
    /** Optional shared state backend for state inheritance (used in sub-agents) */
    backend?: StateBackend;
    /** Enable telemetry for observability (default: false) */
    enableTelemetry?: boolean;
    /** Model temperature for controlling randomness (0-1, default: undefined/model default) */
    temperature?: number;
    /** Maximum retries for API failures (default: 2) */
    maxRetries?: number;
    /** Maximum messages before context compression kicks in (default: 30) */
    maxContextMessages?: number;
    /** Callback for step progress updates */
    onStepFinish?: (step: { stepNumber: number; stepType: string; text?: string }) => void;
}


/**
 * DeepAgent is a sophisticated AI agent framework built on Vercel AI SDK v6.
 * It supports multi-step reasoning, persistent state (todos/findings),
 * real filesystem access, modular skills, and sub-agent delegation.
 */
export class DeepAgent {
    private backend: StateBackend;
    private middleware: Middleware[] = [];
    private model: LanguageModel;
    private baseSystemPrompt: string;
    private customSystemPrompt: string;
    private maxSteps: number;
    private enableTelemetry: boolean;
    private temperature?: number;
    private maxRetries: number;
    private maxContextMessages: number;
    private customTools: Record<string, Tool<any, any>>;
    private onStepFinish?: (step: { stepNumber: number; stepType: string; text?: string }) => void;

    /**
     * Initializes a new DeepAgent instance.
     * @param config Optional configuration to customize model, prompt, and middleware.
     */
    constructor(config: DeepAgentConfig = {}) {
        this.backend = config.backend || new StateBackend();
        this.model = config.model || openai('gpt-4o');
        this.maxSteps = config.maxSteps || 20;
        this.customSystemPrompt = config.systemPrompt || '';
        this.enableTelemetry = config.enableTelemetry || false;
        this.temperature = config.temperature;
        this.maxRetries = config.maxRetries ?? 2;
        this.maxContextMessages = config.maxContextMessages ?? 30;
        this.customTools = config.tools || {};
        this.onStepFinish = config.onStepFinish;
        this.baseSystemPrompt = `You are a capable AI assistant that can tackle complex, multi-step tasks.

You have access to planning tools, a filesystem, and the ability to spawn sub-agents.

## Core Principles
1. PLAN before acting: Use todos to break down complex tasks
2. OFFLOAD context: Save large outputs to files to prevent context overflow
3. DELEGATE: Use sub-agents for specialized or isolated tasks
4. ITERATE: Check your work and refine as needed

## Best Practices
- For complex tasks, create a todo list FIRST
- Save intermediate results to files
- Use sub-agents to isolate context and run parallel workstreams
- Mark todos as completed as you make progress
- Read files to review previous work

Think step by step and tackle tasks systematically.`;

        // Initialize built-in middleware
        this.initializeMiddleware(config);
    }

    private initializeMiddleware(config: DeepAgentConfig): void {
        const skipDefaults = config.skipDefaultMiddleware === true;

        if (!skipDefaults) {
            // TodoList middleware
            this.middleware.push(new TodoListMiddleware(this.backend));

            // Skills middleware
            this.middleware.push(new SkillsMiddleware());

            // Bash middleware (replaces FilesystemMiddleware)
            const bashMiddleware = new BashMiddleware();
            this.middleware.push(bashMiddleware);
        }

        // SubAgent middleware
        const subAgentMap = new Map<string, SubAgent>();
        if (config.subAgents) {
            config.subAgents.forEach(agent => {
                subAgentMap.set(agent.name, agent);
            });
        }
        this.middleware.push(new SubAgentMiddleware(
            this.backend,
            subAgentMap,
            this.model,
            () => this.getAllTools()
        ));

        // Custom middleware
        if (config.middleware) {
            this.middleware.push(...config.middleware);
        }
    }

    private getSystemPrompt(): string {
        let prompt = this.baseSystemPrompt;

        // Apply middleware modifications
        for (const mw of this.middleware) {
            if (mw.modifySystemPrompt) {
                prompt = mw.modifySystemPrompt(prompt);
            }
        }

        // Append custom instructions
        if (this.customSystemPrompt) {
            prompt += `\n\n## Custom Instructions\n${this.customSystemPrompt} `;
        }

        return prompt;
    }

    private async getAllTools(): Promise<Record<string, any>> {
        const allTools: Record<string, any> = {};

        // Wait for all middleware to be ready if they have a waitReady method
        for (const mw of this.middleware) {
            if ((mw as any).waitReady) {
                await (mw as any).waitReady();
            }
        }

        // Collect tools from all middleware
        for (const mw of this.middleware) {
            if (mw.tools) {
                Object.assign(allTools, mw.tools);
            }
        }

        // Merge custom tools from config (these take precedence)
        Object.assign(allTools, this.customTools);

        return allTools;
    }

    /**
     * Creates a prepareStep callback for context compression.
     * Compresses message history when it exceeds maxContextMessages.
     */
    private createPrepareStep() {
        const maxMessages = this.maxContextMessages;
        return async ({ messages }: { messages: ModelMessage[] }) => {
            if (messages.length > maxMessages) {
                // Keep system context + recent messages
                // We take the last N messages
                let compressed = messages.slice(-Math.floor(maxMessages / 2));

                // Sanitize: Ensure we don't start with a 'tool' message
                // (as this causes "Unexpected role 'tool' after role 'system'" errors)
                while (compressed.length > 0 && compressed[0].role === 'tool') {
                    compressed.shift();
                }

                // Optional: Try to start with a user message if possible, or at least ensure valid sequence
                // For now, removing leading tools is the critical fix.

                return { messages: compressed };
            }
            return {};
        };
    }

    /**
     * Executes the agent in a one-shot (non-streaming) request.
     * Automatically handles the reasoning loop and middleware hooks.
     * Accepts both UIMessage[] and ModelMessage[] formats - converts internally.
     * @param input Optional input containing messages and partial state.
     * @returns Promise resolving to the agent response and updated state.
     */
    async invoke(input: { messages?: UIMessage[] | ModelMessage[] } & Partial<Omit<AgentState, 'messages'>> = {}): Promise<any> {
        // Convert UIMessages to ModelMessages if needed (internal conversion)
        const modelMessages = input.messages
            ? await this.convertMessages(input.messages)
            : this.backend.getState().messages;

        const stateToMerge = { ...input, messages: modelMessages };
        this.importState({ ...this.backend.getState(), ...stateToMerge } as AgentState);
        const currentState = this.backend.getState();
        const tools = await this.getAllTools();

        // Run before hooks
        for (const mw of this.middleware) {
            if (mw.beforeModel) {
                await mw.beforeModel(currentState);
            }
        }

        const result = await generateText({
            model: this.model,
            system: this.getSystemPrompt(),
            messages: currentState.messages,
            tools,
            stopWhen: stepCountIs(this.maxSteps),
            maxRetries: this.maxRetries,
            temperature: this.temperature,
            prepareStep: this.createPrepareStep(),
            experimental_telemetry: this.enableTelemetry ? {
                isEnabled: true,
                functionId: 'deep-agent-invoke',
            } : undefined,
            onStepFinish: this.onStepFinish ? async ({ text, finishReason }) => {
                this.onStepFinish?.({
                    stepNumber: currentState.messages.length,
                    stepType: finishReason,
                    text,
                });
            } : undefined,
        });

        // Check for tool execution errors (AI SDK v6 pattern)
        const toolErrors = result.steps?.flatMap(step =>
            step.content?.filter((part: any) => part.type === 'tool-error') ?? []
        ) ?? [];

        if (toolErrors.length > 0) {
            console.warn('Tool execution errors:', toolErrors.map((e: any) => ({
                toolName: e.toolName,
                error: e.error,
            })));
        }

        // Preserve full response messages (includes tool calls context)
        currentState.messages.push(...result.response.messages);
        this.backend.setState({ messages: currentState.messages });

        // Run after hooks
        for (const mw of this.middleware) {
            if (mw.afterModel) {
                await mw.afterModel(currentState, result);
            }
        }

        return {
            text: result.text,
            state: this.backend.getState(),
            usage: result.usage,
            toolErrors: toolErrors.length > 0 ? toolErrors : undefined,
        };
    }

    /**
     * Executes the agent and returns a stream of tool results and text content.
     * Implements todo-driven workflow: stops after each todo completion,
     * streams update, then continues until all todos are done.
     * @param options Streaming options including messages, state, writer, and abort signal.
     * @returns A streaming object compatible with createUIMessageStream.
     */
    async stream(options: {
        messages?: UIMessage[] | ModelMessage[],
        state?: Partial<Omit<AgentState, 'messages'>>,
        writer?: UIMessageStreamWriter<AgentUIMessage>,
        abortSignal?: AbortSignal,
    } = {}): Promise<any> {
        const { messages, state = {}, writer, abortSignal } = options;

        // Convert UIMessages to ModelMessages if needed (internal conversion)
        const modelMessages = messages
            ? await this.convertMessages(messages)
            : this.backend.getState().messages;

        const stateToMerge = { ...state, messages: modelMessages };
        this.importState({ ...this.backend.getState(), ...stateToMerge } as AgentState);
        let currentState = this.backend.getState();
        const tools = await this.getAllTools();

        // Initialize middleware with the writer if provided
        if (writer) {
            for (const mw of this.middleware) {
                if (mw.onStreamReady) {
                    mw.onStreamReady(writer);
                }
            }
        }

        // Run before hooks
        for (const mw of this.middleware) {
            if (mw.beforeModel) {
                await mw.beforeModel(currentState);
            }
        }

        // Standard streaming - let the agent work through todos naturally
        // The enhanced prompts guide step-by-step behavior
        // Local step counter for this execution run (starts at current history length)
        let currentStepCount = currentState.messages.length;

        const result = streamText({
            model: this.model,
            system: this.getSystemPrompt(),
            messages: currentState.messages,
            tools,
            stopWhen: stepCountIs(this.maxSteps),
            abortSignal,
            maxRetries: this.maxRetries,
            temperature: this.temperature,
            prepareStep: this.createPrepareStep(),
            experimental_telemetry: this.enableTelemetry ? {
                isEnabled: true,
                functionId: 'deep-agent-stream',
            } : undefined,
            onStepFinish: async ({ text, finishReason, toolCalls, toolResults }) => {
                currentStepCount++;

                // Debug log for step details
                console.log(`[DeepAgent] Step ${currentStepCount} finished. Reason: ${finishReason}`);
                if (toolCalls?.length) console.log(`[DeepAgent] Tool calls: ${toolCalls.map(tc => tc.toolName).join(', ')}`);

                writer?.write({
                    type: 'data-status',
                    data: {
                        message: `Step: ${finishReason}`,
                        step: currentStepCount,
                    },
                });
                this.onStepFinish?.({
                    stepNumber: currentStepCount,
                    stepType: finishReason,
                    text,
                });
            },
            onError: (error) => {
                console.error('Stream error:', error);
                if (writer) {
                    writer.write({
                        type: 'data-notification',
                        data: { message: String(error), level: 'error' },
                    });
                }
            },
            onFinish: async (finishResult) => {
                this.backend.setState({ messages: finishResult.response.messages });
                // Run finish hooks
                for (const mw of this.middleware) {
                    if (mw.onStreamFinish) {
                        await mw.onStreamFinish(finishResult);
                    }
                }
            },
        });

        return result;
    }

    /**
     * Converts UIMessage[] to ModelMessage[] if needed.
     * This handles the internal conversion so callers don't need to import from 'ai'.
     */
    private async convertMessages(messages: UIMessage[] | ModelMessage[]): Promise<ModelMessage[]> {
        // Check if already ModelMessage[] format (has 'content' as array with type/text)
        if (messages.length === 0) return [];

        let modelMessages: ModelMessage[] = [];
        const firstMsg = messages[0] as any;

        // Convert to ModelMessage[] if needed
        if (firstMsg.parts !== undefined) {
            modelMessages = await convertToModelMessages(messages as UIMessage[]);
        } else {
            modelMessages = messages as ModelMessage[];
        }

        // Sanitize messages for strict providers (like Mistral/OpenRouter)
        // Rule 1: Ensure we don't start with a 'tool' message (must be after assistant)
        // Rule 2: Ensure every 'tool' message is preceded by an 'assistant' or 'tool' message
        const sanitized: ModelMessage[] = [];

        for (let i = 0; i < modelMessages.length; i++) {
            const msg = modelMessages[i];

            if (msg.role === 'tool') {
                const prev = sanitized[sanitized.length - 1];
                // Drop tool message if no previous message or previous wasn't assistant OR tool
                // (Tool messages can follow Assistant or other Tool messages)
                if (!prev || (prev.role !== 'assistant' && prev.role !== 'tool')) {
                    console.warn(`[Sanitizer] Dropping orphaned tool message at index ${i}`);
                    continue;
                }
            }

            sanitized.push(msg);
        }

        // Rule 3: Ensure we don't start with 'assistant' if the model requires 'user' first? 
        // (Most models are fine with Assistant first, but System -> Tool is the big killer)

        return sanitized;
    }

    /** Gets the current internal state of the agent (read-only view) */
    getState(): AgentState {
        return this.backend.getState();
    }

    /** 
     * Exports the full internal state for external persistence.
     * Returns a deep clone to prevent external mutation.
     * Useful for saving sessions to a database.
     */
    exportState(): AgentState {
        return structuredClone(this.backend.getState());
    }

    /** 
     * Imports a saved state to continue a previous session.
     * @param state The state object to restore.
     */
    importState(state: AgentState): void {
        this.backend.setState(state);
    }
}

/**
 * Factory function to create a DeepAgent instance with a LangChain-style API.
 * @param config Agent configuration object.
 */
function createDeepAgent(config: DeepAgentConfig = {}): DeepAgent {
    return new DeepAgent(config);
}

export {
    type AgentState,
    type DeepAgentConfig,
    type AgentDataParts,
    type AgentUIMessage,
    createDeepAgent,
};