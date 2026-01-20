import {
    generateText,
    streamText,
    convertToModelMessages,
    type LanguageModel,
    type ModelMessage,
    type UIMessage,
    type UIMessageStreamWriter,
    stepCountIs,
    Agent,
    ToolLoopAgent,
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
 * It extends the AI SDK v6 ToolLoopAgent to provide native agent support
 * while maintaining middleware hooks and context compression.
 */
export class VibeAgent extends ToolLoopAgent {
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
    protected allowedTools?: string[];
    protected onStepFinishCallback?: (step: { stepNumber: number; stepType: string; text?: string }) => void;

    constructor(config: VibeAgentConfig, backend?: StateBackend) {
        super({
            model: config.model,
            instructions: config.instructions,
            stopWhen: stepCountIs(config.maxSteps || 20),
            experimental_telemetry: config.enableTelemetry ? {
                isEnabled: true,
                functionId: 'vibe-agent'
            } : undefined,
            onStepFinish: async (step) => {
                const stepData = {
                    stepNumber: this.backend.getState().messages.length,
                    stepType: step.finishReason,
                    text: step.text,
                    content: step.content,
                };
                this.onStepFinishCallback?.(stepData);
                for (const mw of this.middleware) {
                    mw.onStepFinish?.(stepData);
                }
            },
       
            prepareCall: async (settings) => {
                const state = this.backend.getState();
                const processedMessages = await this.pruneMessages(settings.messages || []);

                let prompt = this.baseInstructions;
                for (const mw of this.middleware) {
                    if (mw.modifySystemPrompt) {
                        prompt = mw.modifySystemPrompt(prompt);
                    }
                }
                if (this.customSystemPrompt) {
                    prompt += `\n\n## Custom Instructions\n${this.customSystemPrompt} `;
                }
                if (state.summary) {
                    prompt += `\n\n## Previous Context Summary\n${state.summary}`;
                }

                const tools = await this.getAllTools(this.allowedTools);

                return {
                    ...settings,
                    messages: processedMessages,
                    instructions: prompt,
                    tools: tools as any,
                };
            }
        });

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
        this.allowedTools = config.allowedTools;
        this.onStepFinishCallback = config.onStepFinish;

        if (config.middleware) {
            this.addMiddleware(config.middleware);
        }
    }

    addMiddleware(middleware: Middleware | Middleware[]) {
        if (Array.isArray(middleware)) {
            this.middleware.push(...middleware);
        } else {
            this.middleware.push(middleware);
        }
    }

    protected toolCache: Record<string, any> | null = null;

    protected async getAllTools(allowedTools?: string[]): Promise<Record<string, any>> {
        if (this.toolCache && !allowedTools) {
            return this.toolCache;
        }

        const allTools: Record<string, any> = {};

        // Wait for all middleware to be ready
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

        // Merge custom tools from config
        Object.assign(allTools, this.customTools);

        const approvalConfig = this.toolsRequiringApproval;
        const resolvedTools: Record<string, any> = {};

        for (const [toolName, toolDef] of Object.entries(allTools)) {
            const originalExecute = toolDef.execute;

            // Determine if this tool needs approval
            let needsApproval = false;
            if (Array.isArray(approvalConfig)) {
                needsApproval = approvalConfig.includes(toolName);
            } else if (approvalConfig && typeof approvalConfig === 'object') {
                const policy = (approvalConfig as Record<string, any>)[toolName];
                if (policy !== undefined) {
                    needsApproval = typeof policy === 'boolean' ? policy : true; // Keep it simple for now
                }
            }

            // Create a stable wrapped tool
            resolvedTools[toolName] = {
                ...toolDef,
                needsApproval: needsApproval || toolDef.needsApproval,
                execute: originalExecute ? async (args: any, context: any) => {
                    // Trigger lifecycle hooks
                    for (const mw of this.middleware) {
                        mw.onInputAvailable?.(args);
                    }
                    return originalExecute(args, context);
                } : undefined
            };
        }

        // Apply filtering if specified
        if (allowedTools) {
            const filtered: Record<string, any> = {};
            for (const name of allowedTools) {
                if (resolvedTools[name]) {
                    filtered[name] = resolvedTools[name];
                }
            }
            return filtered;
        }

        this.toolCache = resolvedTools;
        return resolvedTools;
    }

    protected async pruneMessages(messages: ModelMessage[]): Promise<ModelMessage[]> {
        const maxMessages = this.maxContextMessages;
        if (messages.length <= maxMessages) {
            return messages;
        }

        const keepCount = Math.floor(maxMessages / 2);
        const messagesToKeep = messages.slice(-keepCount);

        while (messagesToKeep.length > 0 && messagesToKeep[0].role === 'tool') {
            messagesToKeep.shift();
        }

        const messagesToSummarize = messages.slice(0, messages.length - messagesToKeep.length);
        if (messagesToSummarize.length === 0) {
            return messagesToKeep;
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

            return [
                { role: 'system', content: `## Previous Context Summary\n${newSummary}` },
                ...messagesToKeep
            ] as ModelMessage[];

        } catch (error) {
            console.error('[VibeAgent] Summarization failed:', error);
            return messagesToKeep;
        }
    }

    async invoke(input: { messages?: UIMessage[] | ModelMessage[] } & Partial<Omit<AgentState, 'messages'>> = {}): Promise<any> {
        const modelMessages = input.messages
            ? await this.convertMessages(input.messages)
            : this.backend.getState().messages;

        const stateToMerge = { ...input, messages: modelMessages };
        this.importState({ ...this.backend.getState(), ...stateToMerge } as AgentState);
        const currentState = this.backend.getState();

        for (const mw of this.middleware) {
            if (mw.beforeModel) {
                await mw.beforeModel(currentState);
            }
        }

        const result = await super.generate({
            messages: currentState.messages,
        });

        const toolErrors = result.steps?.flatMap(step =>
            step.content?.filter((part: any) => part.type === 'tool-error') ?? []
        ) ?? [];

        // result.response.messages are ONLY the new ones
        const updatedMessages = [...currentState.messages, ...result.response.messages];
        this.backend.setState({ messages: updatedMessages });

        for (const mw of this.middleware) {
            if (mw.afterModel) {
                await mw.afterModel(this.backend.getState(), result);
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

        const result = await super.stream({
            messages: currentState.messages,
            abortSignal,
        });

        result.response.then(async (finishResult) => {
            const prevMessages = this.backend.getState().messages || [];
            this.backend.setState({ messages: [...prevMessages, ...finishResult.messages] });

            for (const mw of this.middleware) {
                if (mw.onStreamFinish) {
                    await mw.onStreamFinish(finishResult);
                }
            }
        });

        return result;
    }

    protected async convertMessages(messages: UIMessage[] | ModelMessage[]): Promise<ModelMessage[]> {
        if (messages.length === 0) return [];

        let modelMessages: ModelMessage[] = [];
        const firstMsg = messages[0] as any;

        if (firstMsg.parts !== undefined) {
            const tools = await this.getAllTools();
            modelMessages = await convertToModelMessages(messages as UIMessage[], {
                tools,
            });
        } else {
            modelMessages = messages as ModelMessage[];
        }

        if (process.env.DEBUG_VIBES) {
            console.log('[VibeAgent] Converted Messages:', JSON.stringify(modelMessages, null, 2));
        }
        return modelMessages;
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
