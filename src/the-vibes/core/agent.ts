import {
    generateText,
    streamText,
    convertToModelMessages,
    type LanguageModel,
    type ModelMessage,
    type UIMessage,
    type UIMessageStreamWriter,
    stepCountIs,
} from 'ai';
import {
    AgentState,
    AgentUIMessage,
    VibeAgentConfig,
    Middleware,
    
} from './types';
import StateBackend from '../backend/statebackend';

/**
 * VibeAgent is the core engine for autonomous multi-step reasoning.
 * It handles middleware hooks, prompt injection, and context compression.
 */
export class VibeAgent {
    protected backend: StateBackend;
    protected middleware: Middleware[] = [];
    protected model: LanguageModel;
    protected baseInstructions: string;
    protected customSystemPrompt: string;
    protected maxSteps: number;
    protected enableTelemetry: boolean;
    protected temperature?: number;
    protected maxRetries: number;
    protected maxContextMessages: number;
    protected customTools: Record<string, any>;
    protected toolsRequiringApproval: string[] | Record<string, boolean | ((args: any) => boolean | Promise<boolean>)> = [];
    protected onStepFinish?: (step: { stepNumber: number; stepType: string; text?: string }) => void;

    constructor(config: VibeAgentConfig, backend?: StateBackend) {
        this.backend = backend || new StateBackend();
        this.model = config.model;
        this.baseInstructions = config.instructions;
        this.customSystemPrompt = config.systemPrompt || '';
        this.maxSteps = config.maxSteps || 20;
        this.enableTelemetry = config.enableTelemetry || false;
        this.temperature = config.temperature;
        this.maxRetries = config.maxRetries ?? 2;
        this.maxContextMessages = config.maxContextMessages ?? 30;
        this.customTools = config.tools || {};
        this.toolsRequiringApproval = config.toolsRequiringApproval || [];
        this.onStepFinish = config.onStepFinish;
    }

    addMiddleware(middleware: Middleware | Middleware[]) {
        if (Array.isArray(middleware)) {
            this.middleware.push(...middleware);
        } else {
            this.middleware.push(middleware);
        }
    }

    protected getSystemPrompt(): string {
        let prompt = this.baseInstructions;

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

        // Inject Context Summary if available
        const state = this.backend.getState();
        if (state.summary) {
            prompt += `\n\n## Previous Context Summary\n${state.summary}`;
        }

        return prompt;
    }

    protected async getAllTools(): Promise<Record<string, any>> {
        const allTools: Record<string, any> = {};

        // Wait for all middleware to be ready if they have a waitReady method
        for (const mw of this.middleware) {
            if (mw.waitReady) {
                await mw.waitReady();
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

        // Apply approval requirement to specified tools
        const approvalConfig = this.toolsRequiringApproval;

        if (Array.isArray(approvalConfig)) {
            // Simple string array format: unconditional approval
            for (const toolName of approvalConfig) {
                if (allTools[toolName]) {
                    allTools[toolName] = {
                        ...allTools[toolName],
                        needsApproval: true,
                    };
                }
            }
        } else if (approvalConfig && typeof approvalConfig === 'object') {
            // Record format: supports conditional functions or booleans
            for (const [toolName, policy] of Object.entries(approvalConfig)) {
                if (allTools[toolName]) {
                    allTools[toolName] = {
                        ...allTools[toolName],
                        needsApproval: policy,
                    };
                }
            }
        }

        return allTools;
    }

    protected createPrepareStep() {
        const maxMessages = this.maxContextMessages;

        return async ({ messages }: { messages: ModelMessage[] }) => {
            if (messages.length <= maxMessages) {
                return {};
            }

            const keepCount = Math.floor(maxMessages / 2);
            const messagesToKeep = messages.slice(-keepCount);

            while (messagesToKeep.length > 0 && messagesToKeep[0].role === 'tool') {
                messagesToKeep.shift();
            }

            const messagesToSummarize = messages.slice(0, messages.length - messagesToKeep.length);

            if (messagesToSummarize.length === 0) {
                return { messages: messagesToKeep };
            }

            try {
                const currentSummary = this.backend.getState().summary || 'No previous summary.';
                const { text: newSummary } = await generateText({
                    model: this.model,
                    system: `You are a helpful assistant. Summarize the following conversation history into a concise, detailed narrative. 
Retain key decisions, user requirements, current potential plan status, and important context.
Merge this with the "Existing Summary" strictly.`,
                    messages: [
                        {
                            role: 'user',
                            content: `Existing Summary:\n${currentSummary}\n\nNew Conversation to Summarize:\n${JSON.stringify(messagesToSummarize)}`
                        }
                    ],
                });

                this.backend.setState({ summary: newSummary });

                return {
                    messages: [
                        { role: 'system', content: `## Previous Context Summary\n${newSummary}` },
                        ...messagesToKeep
                    ] as ModelMessage[]
                };

            } catch (error) {
                console.error('[VibeAgent] Summarization failed:', error);
                return { messages: messagesToKeep };
            }
        };
    }

    async invoke(input: { messages?: UIMessage[] | ModelMessage[] } & Partial<Omit<AgentState, 'messages'>> = {}): Promise<any> {
        const modelMessages = input.messages
            ? await this.convertMessages(input.messages)
            : this.backend.getState().messages;

        const stateToMerge = { ...input, messages: modelMessages };
        this.importState({ ...this.backend.getState(), ...stateToMerge } as AgentState);
        const currentState = this.backend.getState();
        const tools = await this.getAllTools();

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
                functionId: 'vibe-agent-invoke',
            } : undefined,
            onStepFinish: this.onStepFinish ? async ({ text, finishReason, reasoning }) => {
                console.log(reasoning);
                this.onStepFinish?.({
                    stepNumber: currentState.messages.length,
                    stepType: finishReason,
                    text,
                });
            } : undefined,
        });

        const toolErrors = result.steps?.flatMap(step =>
            step.content?.filter((part: any) => part.type === 'tool-error') ?? []
        ) ?? [];

        currentState.messages.push(...result.response.messages);
        this.backend.setState({ messages: currentState.messages });

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

    async stream(options: {
        messages?: UIMessage[] | ModelMessage[],
        state?: Partial<Omit<AgentState, 'messages'>>,
        writer?: UIMessageStreamWriter<AgentUIMessage>,
        abortSignal?: AbortSignal,
    } = {}): Promise<any> {
        const { messages, state = {}, writer, abortSignal } = options;

        const modelMessages = messages
            ? await this.convertMessages(messages)
            : this.backend.getState().messages;

        const stateToMerge = { ...state, messages: modelMessages };
        this.importState({ ...this.backend.getState(), ...stateToMerge } as AgentState);
        let currentState = this.backend.getState();
        const tools = await this.getAllTools();

        if (writer) {
            for (const mw of this.middleware) {
                if (mw.onStreamReady) {
                    mw.onStreamReady(writer);
                }
            }
        }

        for (const mw of this.middleware) {
            if (mw.beforeModel) {
                await mw.beforeModel(currentState);
            }
        }

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
                functionId: 'vibe-agent-stream',
            } : undefined,
            onStepFinish: async ({ text, finishReason, content }) => {
                currentStepCount++;
                writer?.write({
                    type: 'data-status',
                    data: {
                        message: `Step: ${finishReason}: ${JSON.stringify(content)}`,
                        step: currentStepCount,
                    },
                });
                this.onStepFinish?.({
                    stepNumber: currentStepCount,
                    stepType: finishReason,
                    text,
                });
            },
            onFinish: async (finishResult) => {
                this.backend.setState({ messages: finishResult.response.messages });
                for (const mw of this.middleware) {
                    if (mw.onStreamFinish) {
                        await mw.onStreamFinish(finishResult);
                    }
                }
            },
        });

        return result;
    }

    protected async convertMessages(messages: UIMessage[] | ModelMessage[]): Promise<ModelMessage[]> {
        if (messages.length === 0) return [];

        let modelMessages: ModelMessage[] = [];
        const firstMsg = messages[0] as any;

        if (firstMsg.parts !== undefined) {
            modelMessages = await convertToModelMessages(messages as UIMessage[]);
        } else {
            modelMessages = messages as ModelMessage[];
        }

        const sanitized: ModelMessage[] = [];

        for (let i = 0; i < modelMessages.length; i++) {
            const msg = modelMessages[i];
            if (msg.role === 'tool') {
                const prev = sanitized[sanitized.length - 1];
                if (!prev || (prev.role !== 'assistant' && prev.role !== 'tool')) {
                    continue;
                }
            }
            sanitized.push(msg);
        }

        return sanitized;
    }

    getState(): AgentState {
        return this.backend.getState();
    }

    exportState(): AgentState {
        return structuredClone(this.backend.getState());
    }

    importState(state: AgentState): void {
        this.backend.setState(state);
    }
}
