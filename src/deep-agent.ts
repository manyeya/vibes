/// <reference types="bun-types" />
import {
    generateText,
    streamText,
    type LanguageModel,
    type ModelMessage,
    type AssistantModelMessage,
    type UIMessage,
    type UIMessageStreamWriter,
    stepCountIs,
} from 'ai';

import { openai } from '@ai-sdk/openai';
import StateBackend from './the-vibes/backend/statebackend';
import { SkillsMiddleware, TodoListMiddleware, BashMiddleware, Middleware } from './the-vibes/middleware';
import { TodoItem } from './the-vibes/middleware/todos';
import SubAgentMiddleware, { SubAgent } from './the-vibes/middleware/subagent';

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
    };
};

/** Type-safe UI message with agent-specific data parts */
export type AgentUIMessage = UIMessage<never, AgentDataParts>;


/**
 * Configuration for initializing a DeepAgent instance.
 */
interface DeepAgentConfig {
    /** The AI model to use (defaults to GPT-4o) */
    model?: LanguageModel;
    /** Custom instructions to extend the base system prompt */
    systemPrompt?: string;
    /** Additional custom tools available to the agent */
    tools?: any[];
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

    /**
     * Initializes a new DeepAgent instance.
     * @param config Optional configuration to customize model, prompt, and middleware.
     */
    constructor(config: DeepAgentConfig = {}) {
        this.backend = config.backend || new StateBackend();
        this.model = config.model || openai('gpt-4o');
        this.maxSteps = config.maxSteps || 20;
        this.customSystemPrompt = config.systemPrompt || '';

        // Default system prompt inspired by Claude Code
        this.baseSystemPrompt = `You are a capable AI assistant that can tackle complex, multi - step tasks.

You have access to planning tools, a filesystem, and the ability to spawn sub - agents.

## Core Principles
1. PLAN before acting: Use todos to break down complex tasks
2. OFFLOAD context: Save large outputs to files to prevent context overflow
3. DELEGATE: Use sub - agents for specialized or isolated tasks
4. ITERATE: Check your work and refine as needed

## Best Practices
    - For complex tasks, create a todo list FIRST
        - Save intermediate results to files
            - Use sub - agents to isolate context and run parallel workstreams
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

        return allTools;
    }

    /**
     * Executes the agent in a one-shot (non-streaming) request.
     * Automatically handles the reasoning loop and middleware hooks.
     * @param state Optional external state to merge with the agent's current state.
     * @returns Promise resolving to the agent response and updated state.
     */
    async invoke(state: Partial<AgentState> = {}): Promise<any> {
        this.importState({ ...this.backend.getState(), ...state } as AgentState);
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
        });

        // Add response to state
        const assistantMessage: AssistantModelMessage = {
            role: 'assistant',
            content: [{ type: 'text', text: result.text }],
        };
        currentState.messages.push(assistantMessage);
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
        };
    }

    /**
     * Executes the agent and returns a stream of tool results and text content.
     * Useful for building real-time UI experiences.
     * @param options Streaming options including external state and an optional UIMessageStreamWriter.
     * @returns A streaming object compatible with createUIMessageStream.
     */
    async stream(options: {
        state?: Partial<AgentState>,
        writer?: UIMessageStreamWriter<AgentUIMessage>
    } = {}): Promise<any> {
        const { state = {}, writer } = options;
        this.importState({ ...this.backend.getState(), ...state } as AgentState);
        const currentState = this.backend.getState();
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

        const result = streamText({
            model: this.model,
            system: this.getSystemPrompt(),
            messages: currentState.messages,
            tools,
            stopWhen: stepCountIs(this.maxSteps),
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

    /** Gets the current internal state of the agent */
    getState(): AgentState {
        return this.backend.getState();
    }

    /** 
     * Exports the full internal state for external persistence.
     * Useful for saving sessions to a database.
     */
    exportState(): AgentState {
        return this.backend.getState();
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
export function createDeepAgent(config: DeepAgentConfig = {}): DeepAgent {
    return new DeepAgent(config);
}


export {
    type AgentState,
    type DeepAgentConfig,
};