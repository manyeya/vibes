import {
    generateText,
    streamText,
    convertToModelMessages,
    stepCountIs,
    type LanguageModel,
    type ModelMessage,
    type ToolSet,
    type UIMessage,
    type UIMessageStreamWriter,
    type Agent,
    type AgentCallParameters,
    type AgentStreamParameters,
    type StepResult,
} from 'ai';
import {
    AgentState,
    VibesUIMessage,
    VibeAgentConfig,
    VibeAgentGenerateResult,
    VibeAgentStreamResult,
    Middleware,
    ErrorEntry,
    createDataStreamWriter,
} from './types';
import StateBackend from '../backend/statebackend';

// Re-export ErrorEntry for convenience
export type { ErrorEntry };

// ============ TYPE DEFINITIONS ============

/**
 * Tool approval policy - either boolean or predicate function
 */
type ToolApprovalPolicy = boolean | ((args: unknown) => boolean | Promise<boolean>);

/**
 * Tool approval configuration
 */
type ToolsRequiringApprovalConfig = string[] | Record<string, ToolApprovalPolicy>;

/**
 * Tool call arguments with known properties
 */
interface ToolCallArgs {
    path?: string;
    command?: string;
    [key: string]: unknown;
}

/**
 * Message with potential parts property (UIMessage)
 */
interface PartedMessage {
    role: string;
    content?: unknown;
    parts?: Array<{ type: string; data?: unknown }>;
}

/**
 * Internal prepared call result - what prepareCall returns before generateText/streamText
 */
interface PreparedCall {
    model: LanguageModel;
    instructions: string;
    messages: ModelMessage[];
    tools: Record<string, unknown>;
    temperature?: number;
    maxSteps?: number;
}

/**
 * VibeAgent is the core engine for autonomous multi-step reasoning.
 * It implements the AI SDK v6 Agent interface directly to provide
 * native agent support while maintaining middleware hooks and context compression.
 *
 * Deep Agent Features:
 * - Restorable compression: Large content replaced with file/path references
 * - Error preservation: Errors tracked separately, never summarized
 * - KV-cache awareness: Stable prompt prefix for cache optimization
 *
 * Implements Agent interface directly (no longer extends ToolLoopAgent)
 * for cleaner control flow and proper type safety.
 */
export class VibeAgent implements Agent<never, ToolSet, never> {
    readonly version = 'agent-v1' as const;
    // Agent interface requires id, we use undefined since we don't support named agents
    readonly id = undefined;

    // Agent interface required: tools getter
    get tools(): ToolSet {
        // Note: This returns cached tools. The Agent interface expects sync tools,
        // so we preload tools in constructor and cache them.
        return this.toolCache as ToolSet;
    }

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
    protected customTools: Record<string, unknown>;
    protected toolsRequiringApproval: ToolsRequiringApprovalConfig = [];
    protected allowedTools?: string[];
    protected blockedTools?: string[];
    /** Optional onStepFinish callback from config */
    protected configOnStepFinish?: (stepResult: StepResult<ToolSet>) => void | Promise<void>;
    /** Writer for sending data updates to UI during stream */
    protected writer?: UIMessageStreamWriter<VibesUIMessage>;
    /** Track last message count to prevent duplicate summarization notifications */
    protected lastSummarizedCount: number = 0;
    /** Error log tracked separately from context (never summarized) */
    protected errorLog: ErrorEntry[] = [];
    /** Threshold for content compression (characters) */
    protected compressionThreshold: number = 3000;
    /** Maximum errors to show in recent errors section */
    protected maxRecentErrors: number = 5;

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
        this.allowedTools = config.allowedTools;
        this.blockedTools = config.blockedTools;
        this.configOnStepFinish = config.onStepFinish;

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

    // ============ AGENT INTERFACE IMPLEMENTATION ============

    /**
     * Generate output from the agent (non-streaming).
     * Implements the Agent interface generate method.
     */
    async generate(
        options?: AgentCallParameters<never, ToolSet> & { messages?: UIMessage[] | ModelMessage[] }
    ): Promise<VibeAgentGenerateResult> {
        // Extract VibeAgent-specific options
        const { messages, state: stateOptions, ...agentOptions } = options as any;

        // Convert and merge state
        const modelMessages = messages
            ? await this.convertMessages(messages)
            : this.backend.getState().messages;

        const stateToMerge = { ...stateOptions, messages: modelMessages };
        this.importState({ ...this.backend.getState(), ...stateToMerge } as AgentState);
        const currentState = this.backend.getState();

        // Prepare the call (was done by ToolLoopAgent's prepareCall)
        const prepared = await this.prepareCall({
            messages: currentState.messages,
        });

        // Merge onStepFinish callbacks (config + method)
        const onStepFinish = this.mergeOnStepFinishCallbacks(
            (agentOptions as any).onStepFinish
        );

        // Call generateText directly (was super.generate())
        const result = await generateText({
            model: prepared.model,
            messages: prepared.messages,
            system: prepared.instructions,
            tools: prepared.tools as ToolSet,
            temperature: prepared.temperature,
            stopWhen: stepCountIs(prepared.maxSteps || 20),
            abortSignal: (agentOptions as any).abortSignal,
            timeout: (agentOptions as any).timeout,
            onStepFinish,
            // Handle prepareStep middleware hooks if any exist
            ...(this.hasPrepareStepMiddleware() ? {
                experimental_prepareStep: async (stepOptions: any) => {
                    return this.runPrepareStepHooks(stepOptions);
                },
            } : {}),
        });

        const toolErrors = result.steps?.flatMap(step =>
            (step.content?.filter((part) => part.type === 'tool-error') ?? []) as Array<{ type: 'tool-error' }>
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
            ...result,
            state: this.backend.getState(),
            toolErrors: toolErrors.length > 0 ? toolErrors : undefined,
        } as VibeAgentGenerateResult;
    }

    /**
     * Stream output from the agent.
     * Implements the Agent interface stream method.
     */
    async stream(
        options?: AgentStreamParameters<never, ToolSet> & {
            messages?: ModelMessage[];
            state?: Partial<Omit<AgentState, 'messages'>>;
            writer?: UIMessageStreamWriter<VibesUIMessage>;
        }
    ): Promise<VibeAgentStreamResult> {
        // Extract VibeAgent-specific options
        const { messages, state: stateOptions, writer, ...agentOptions } = options as any;

        // Store writer for use in prepareCall/pruneMessages
        this.writer = writer;

        // Convert and merge state
        const modelMessages = messages
            ? await this.convertMessages(messages)
            : this.backend.getState().messages;

        const stateToMerge = { ...stateOptions, messages: modelMessages };
        this.importState({ ...this.backend.getState(), ...stateToMerge } as AgentState);
        const currentState = this.backend.getState();

        if (writer) {
            for (const mw of this.middleware) {
                if (mw.onStreamReady) {
                    mw.onStreamReady(writer);
                }
            }
        }

        // Prepare the call
        const prepared = await this.prepareCall({
            messages: currentState.messages,
        });

        // Merge onStepFinish callbacks
        const onStepFinish = this.mergeOnStepFinishCallbacks(
            (agentOptions as any).onStepFinish
        );

        // Call streamText directly (was super.stream())
        const result =  streamText({
            model: prepared.model,
            messages: prepared.messages,
            system: prepared.instructions,
            tools: prepared.tools as ToolSet,
            temperature: prepared.temperature,
            stopWhen: stepCountIs(prepared.maxSteps || 20),
            abortSignal: (agentOptions as any).abortSignal,
            timeout: (agentOptions as any).timeout,
            experimental_transform: (agentOptions as any).experimental_transform,
            onStepFinish,
            // Handle prepareStep middleware hooks if any exist
            ...(this.hasPrepareStepMiddleware() ? {
                experimental_prepareStep: async (stepOptions: any) => {
                    return this.runPrepareStepHooks(stepOptions);
                },
            } : {}),
        });

        // Handle stream completion with proper error handling
        Promise.resolve(result.response).then(async (finishResult) => {
            const prevMessages = this.backend.getState().messages || [];
            this.backend.setState({ messages: [...prevMessages, ...finishResult.messages] });

            for (const mw of this.middleware) {
                if (mw.onStreamFinish) {
                    await mw.onStreamFinish(finishResult);
                }
            }
        }).catch((error: Error) => {
            console.error('[VibeAgent] Stream completion error:', error);
        });

        return result;
    }

    // ============ PREPARE CALL LOGIC ============

    /**
     * Prepare the call settings before invoking generateText/streamText.
     * This was previously handled by ToolLoopAgent's prepareCall hook.
     */
    protected async prepareCall(baseSettings: { messages?: ModelMessage[] }): Promise<PreparedCall> {
        const state = this.backend.getState();
        const processedMessages = await this.pruneMessages(baseSettings.messages || [], this.writer);

        let prompt = this.baseInstructions;
        for (const mw of this.middleware) {
            if (mw.modifySystemPrompt) {
                const result = mw.modifySystemPrompt(prompt);
                prompt = result instanceof Promise ? await result : result;
            }
        }
        if (this.customSystemPrompt) {
            prompt += `\n\n## Custom Instructions\n${this.customSystemPrompt} `;
        }
        if (state.summary) {
            prompt += `\n\n## Previous Context Summary\n${state.summary}`;
        }

        // Add recent errors to prompt (Manus: keep errors visible for self-correction)
        const recentErrors = this.getRecentErrors();
        if (recentErrors.length > 0) {
            prompt += `\n\n${this.formatRecentErrors(recentErrors)}`;
        }

        const tools = await this.getAllTools(this.allowedTools);

        return {
            model: this.model,
            instructions: prompt,
            messages: processedMessages,
            tools,
            temperature: this.temperature,
            maxSteps: this.maxSteps,
        };
    }

    /**
     * Check if any middleware has prepareStep hooks
     */
    protected hasPrepareStepMiddleware(): boolean {
        return this.middleware.some(mw => mw.prepareStep);
    }

    /**
     * Run all middleware prepareStep hooks and merge their results
     */
    protected async runPrepareStepHooks(stepOptions: any): Promise<any> {
        let result: any = {};

        // Chain middleware prepareStep hooks
        for (const mw of this.middleware) {
            if (mw.prepareStep) {
                const mwResult = await mw.prepareStep(stepOptions);
                result = { ...result, ...mwResult };
            }
        }

        return result;
    }

    /**
     * Merge onStepFinish callbacks from config and method call
     */
    protected mergeOnStepFinishCallbacks(
        methodCallback: ((stepResult: StepResult<ToolSet>) => void | Promise<void>) | undefined,
    ): ((stepResult: StepResult<ToolSet>) => void | Promise<void>) | undefined {
        const constructorCallback = this.configOnStepFinish as
            | ((stepResult: StepResult<ToolSet>) => void | Promise<void>)
            | undefined;

        if (methodCallback && constructorCallback) {
            return async (stepResult: StepResult<ToolSet>) => {
                await constructorCallback(stepResult);
                await methodCallback(stepResult);
            };
        }

        return methodCallback ?? constructorCallback;
    }

    // ============ TOOL MANAGEMENT ============

    // Tool cache - initialize with empty object so tools getter always has a value
    protected toolCache: Record<string, unknown> = {};
    protected middlewareVersion: number = 0;

    protected async getAllTools(allowedTools?: string[]): Promise<Record<string, unknown>> {
        // Cache bust: always rebuild if allowedTools filter is specified
        if (!allowedTools && Object.keys(this.toolCache).length > 0) {
            return this.toolCache;
        }

        // Invalidate cache if middleware was added/removed
        const currentMiddlewareVersion = this.middleware.length;
        if (this.middlewareVersion !== currentMiddlewareVersion && Object.keys(this.toolCache).length > 0) {
            this.toolCache = {};
        }

        const allTools: Record<string, unknown> = {};

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
        const resolvedTools: Record<string, unknown> = {};

        for (const [toolName, toolDef] of Object.entries(allTools)) {
            const toolDefRecord = toolDef as Record<string, unknown>;
            const originalExecute = toolDefRecord.execute as ((args: unknown, options: unknown) => Promise<unknown>) | undefined;

            // Determine if this tool needs approval
            let needsApproval = false;
            if (Array.isArray(approvalConfig)) {
                needsApproval = approvalConfig.includes(toolName);
            } else if (approvalConfig && typeof approvalConfig === 'object') {
                const policy = (approvalConfig as Record<string, ToolApprovalPolicy>)[toolName];
                if (policy !== undefined) {
                    needsApproval = typeof policy === 'boolean' ? policy : true; // Keep it simple for now
                }
            }

            // Create a stable wrapped tool with retry logic
            resolvedTools[toolName] = {
                ...(toolDef as Record<string, unknown>),
                needsApproval: needsApproval || (toolDefRecord.needsApproval as boolean | undefined),
                execute: originalExecute ? async (args: unknown, options: unknown) => {
                    // Trigger lifecycle hooks
                    for (const mw of this.middleware) {
                        mw.onInputAvailable?.(args);
                    }

                    // Retry logic for tool execution
                    let lastError: Error | undefined;
                    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
                        try {
                            return await originalExecute(args, options);
                        } catch (error) {
                            lastError = error instanceof Error ? error : new Error(String(error));
                            if (attempt < this.maxRetries) {
                                // Exponential backoff before retry
                                await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100));
                                console.warn(`[VibeAgent] Tool ${toolName} failed (attempt ${attempt + 1}/${this.maxRetries + 1}), retrying...`);
                            }
                        }
                    }
                    throw lastError;
                } : undefined
            };
        }

        // Apply blockedTools filter (takes precedence over allowedTools)
        if (this.blockedTools) {
            for (const name of this.blockedTools) {
                delete resolvedTools[name];
            }
        }

        // Apply allowedTools filter if specified
        if (allowedTools) {
            const filtered: Record<string, unknown> = {};
            for (const name of allowedTools) {
                if (resolvedTools[name]) {
                    filtered[name] = resolvedTools[name];
                }
            }
            return filtered;
        }

        this.toolCache = resolvedTools;
        this.middlewareVersion = this.middleware.length;
        return resolvedTools;
    }

    // ============ ERROR TRACKING ============

    /**
     * Add an error to the error log. Errors are tracked separately
     * from the message stream and never included in summaries.
     */
    protected logError(toolName: string | undefined, error: string, context?: string): void {
        // Check if this error already occurred recently (deduplicate)
        const existing = this.errorLog.find(e =>
            e.error === error &&
            e.toolName === toolName &&
            Date.now() - new Date(e.timestamp).getTime() < 60000 // Within last minute
        );

        if (existing) {
            existing.occurrenceCount++;
            existing.timestamp = new Date().toISOString();
        } else {
            this.errorLog.push({
                timestamp: new Date().toISOString(),
                toolName,
                error,
                context,
                occurrenceCount: 1
            });
        }

        // Keep only recent errors
        if (this.errorLog.length > 20) {
            this.errorLog = this.errorLog.slice(-20);
        }

        if (process.env.DEBUG_VIBES) {
            console.error(`[VibeAgent] Error logged:`, { toolName, error, context });
        }
    }

    /**
     * Get recent errors for display in system prompt.
     */
    protected getRecentErrors(): ErrorEntry[] {
        // Return most recent errors, sorted by occurrence count and recency
        return this.errorLog
            .slice(-this.maxRecentErrors)
            .sort((a, b) => {
                // Prioritize frequently occurring errors
                if (b.occurrenceCount !== a.occurrenceCount) {
                    return b.occurrenceCount - a.occurrenceCount;
                }
                return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
            });
    }

    /**
     * Format recent errors for system prompt display.
     * Uses clear formatting to help agent avoid repeating mistakes.
     */
    protected formatRecentErrors(errors: ErrorEntry[]): string {
        let output = `## Recent Errors (Do NOT Repeat These)\n\n`;
        output += `The following errors occurred recently. Learn from them and avoid making the same mistakes.\n\n`;

        for (const err of errors) {
            output += `### ${err.toolName || 'Unknown'} ${err.occurrenceCount > 1 ? `(×${err.occurrenceCount})` : ''}\n`;
            output += `\`\`\`\n${err.error}\n\`\`\`\n`;
            if (err.context) {
                output += `**Context**: ${err.context}\n`;
            }
            output += `\n`;
        }

        output += `---\n`;
        return output;
    }

    // ============ MESSAGE PROCESSING ============

    /**
     * Extract message content as string for analysis.
     */
    protected extractMessageContent(msg: ModelMessage): string {
        if (typeof msg.content === 'string') {
            return msg.content;
        }
        if (Array.isArray(msg.content)) {
            return msg.content
                .map(part => {
                    if (part.type === 'text') return part.text;
                    if (part.type === 'tool-call') {
                        const tc = part as { toolName?: string; args?: unknown };
                        const argsStr = tc.args ? JSON.stringify(tc.args).slice(0, 200) : 'no args';
                        return `[Tool Call: ${tc.toolName || 'unknown'} with args: ${argsStr}]`;
                    }
                    return `[${part.type}]`;
                })
                .join('\n');
        }
        return String(msg.content || '');
    }

    /**
     * Check if a message contains a tool error.
     */
    protected isErrorMessage(msg: ModelMessage): boolean {
        if (msg.role !== 'tool') return false;
        const content = this.extractMessageContent(msg);
        // Common error indicators
        return content.toLowerCase().includes('error') ||
               content.toLowerCase().includes('failed') ||
               content.toLowerCase().includes('exception');
    }

    /**
     * Extract tool information from a message if available.
     */
    protected extractToolInfo(msg: ModelMessage): { toolName?: string; args?: ToolCallArgs } {
        const content = msg.content;
        if (Array.isArray(content)) {
            for (const part of content) {
                if (part.type === 'tool-call') {
                    const tc = part as unknown as { toolName: string; args: ToolCallArgs };
                    return { toolName: tc.toolName, args: tc.args };
                }
            }
        }
        return {};
    }

    /**
     * Apply restorable compression to large content.
     * Replaces large file reads, web content, and tool outputs with
     * references that can be restored if needed.
     *
     * Key principle: Compression is LOSSLESS and RESTORABLE.
     * - File reads → File path reference
     * - Web content → URL reference
     * - Errors → NEVER compress
     */
    protected async compressLargeContent(messages: ModelMessage[]): Promise<ModelMessage[]> {
        const compressed: ModelMessage[] = [];

        for (const msg of messages) {
            // NEVER compress user messages or system messages
            if (msg.role === 'user' || msg.role === 'system') {
                compressed.push(msg);
                continue;
            }

            // NEVER compress errors - track them separately instead
            if (this.isErrorMessage(msg)) {
                const { toolName } = this.extractToolInfo(msg);
                const content = this.extractMessageContent(msg);
                this.logError(toolName, content, `Role: ${msg.role}`);
                // Still include error in compressed messages, but don't shrink it
                compressed.push(msg);
                continue;
            }

            const content = this.extractMessageContent(msg);

            // Check if content is large enough to compress
            if (content.length < this.compressionThreshold) {
                compressed.push(msg);
                continue;
            }

            // Apply restorable compression based on message type
            const compressionResult = this.compressMessage(msg, content);
            compressed.push(compressionResult);
        }

        return compressed;
    }

    /**
     * Compress a single message using restorable references.
     */
    protected compressMessage(msg: ModelMessage, content: string): ModelMessage {
        const { toolName, args } = this.extractToolInfo(msg);

        // File read result - replace with file path reference
        if (toolName === 'readFile' && args?.path) {
            return { ...msg, content: `[File: ${args.path} - ${content.length} chars read. Use readFile() again if you need the full content.]` } as ModelMessage;
        }

        // Bash command result - compress large outputs
        if (toolName === 'bash' && args?.command) {
            const commandPreview = args.command.length > 50
                ? args.command.slice(0, 50) + '...'
                : args.command;
            return { ...msg, content: `[Command "${commandPreview}" output: ${content.length} chars. Run again if needed, or check workspace/logs/.]` } as ModelMessage;
        }

        // Generic large tool result - create restorable reference
        if (toolName) {
            return { ...msg, content: `[${toolName} result: ${content.length} chars. Key info preserved, run again if full details needed.\n\n${this.summarizeLargeContent(content)}]` } as ModelMessage;
        }

        // Assistant message with large text - summarize
        if (msg.role === 'assistant') {
            return { ...msg, content: `[Previous response: ${content.length} chars. ${this.summarizeLargeContent(content)}]` } as ModelMessage;
        }

        // Default: keep original
        return msg;
    }

    /**
     * Create a brief summary of large content for restorable compression.
     */
    protected summarizeLargeContent(content: string): string {
        const lines = content.split('\n');
        const summary: string[] = [];

        // Include first few lines
        summary.push('First lines:');
        summary.push(...lines.slice(0, 3).map(l => `  ${l.slice(0, 100)}`));

        // Include last few lines if content is very large
        if (lines.length > 10) {
            summary.push('...');
            summary.push('Last lines:');
            summary.push(...lines.slice(-3).map(l => `  ${l.slice(0, 100)}`));
        }

        return summary.join('\n');
    }

    /**
     * Format messages into a readable format for summarization.
     * Converts message structures into natural conversation format.
     */
    protected formatMessagesForSummary(messages: ModelMessage[]): string {
        const MAX_CONTENT_LENGTH = 2000;

        const formatContent = (content: unknown): string => {
            if (typeof content === 'string') {
                return content.length > MAX_CONTENT_LENGTH
                    ? content.slice(0, MAX_CONTENT_LENGTH) + '...[truncated]'
                    : content;
            }
            if (Array.isArray(content)) {
                return content
                    .map(part => {
                        if (part.type === 'text') {
                            return formatContent(part.text);
                        }
                        if (part.type === 'tool-call') {
                            const argsStr = part.args ? JSON.stringify(part.args).slice(0, 200) : 'no args';
                            return `[Tool Call: ${part.toolName} with args: ${argsStr}]`;
                        }
                        return `[${part.type}]`;
                    })
                    .join('\n');
            }
            return String(content).slice(0, MAX_CONTENT_LENGTH);
        };

        return messages
            .map((msg, index) => {
                const roleLabel = {
                    system: 'System',
                    user: 'User',
                    assistant: 'Assistant',
                    tool: 'Tool Result'
                }[msg.role] || msg.role;

                const content = formatContent(msg.content);
                return `[${index + 1}] ${roleLabel}:\n${content}`;
            })
            .join('\n\n---\n\n');
    }

    /**
     * Prune messages using a hybrid approach:
     * 1. First pass: Restorable compression (lossless, replaces large content with references)
     * 2. Second pass: Summarization (lossy, only if still over limit after compression)
     *
     * Key principle from Manus: Keep errors visible, compress restorably.
     */
    protected async pruneMessages(messages: ModelMessage[], writer?: UIMessageStreamWriter<VibesUIMessage>): Promise<ModelMessage[]> {
        const maxMessages = this.maxContextMessages;

        // Phase 1: Apply restorable compression
        const compressed = await this.compressLargeContent(messages);

        // Calculate token estimate (rough approximation)
        const estimateTokens = (msgs: ModelMessage[]) => {
            return msgs.reduce((acc, msg) => acc + this.extractMessageContent(msg).length, 0) / 4;
        };

        const estimatedTokens = estimateTokens(compressed);

        // If we're within reasonable bounds, return compressed messages
        if (compressed.length <= maxMessages && estimatedTokens < 100000) {
            return compressed;
        }

        // Phase 2: Summarization for messages still over limit
        const keepCount = Math.floor(maxMessages / 2);
        const messagesToKeep = compressed.slice(-keepCount);

        // Remove leading tool messages to ensure we start with meaningful content
        while (messagesToKeep.length > 0 && messagesToKeep[0].role === 'tool') {
            messagesToKeep.shift();
        }

        // Extract errors to preserve them (they shouldn't be summarized)
        const messagesToSummarize = compressed.slice(0, compressed.length - messagesToKeep.length);
        const { messagesWithoutErrors, extractedErrors } = this.extractErrorsFromMessages(messagesToSummarize);

        // Add extracted errors to the error log
        for (const err of extractedErrors) {
            this.logError(err.toolName, err.error, err.context);
        }

        if (messagesWithoutErrors.length === 0) {
            return messagesToKeep;
        }

        // Skip if we already summarized this exact message count (deduplicate)
        if (compressed.length === this.lastSummarizedCount) {
            // Return with the existing summary prepended
            const existingSummary = this.backend.getState().summary;
            if (existingSummary) {
                return [
                    { role: 'system', content: `## Previous Context Summary\n${existingSummary}` },
                    ...messagesToKeep
                ] as ModelMessage[];
            }
            return messagesToKeep;
        }

        // Send starting status if writer is available
        const streamWriter = createDataStreamWriter(writer);
        streamWriter.writeSummarization(
            'starting',
            messagesToSummarize.length,
            messagesToKeep.length
        );

        if (process.env.DEBUG_VIBES) {
            console.log(`[VibeAgent] Compressed ${messages.length} → ${compressed.length} messages, estimating ${estimatedTokens} tokens`);
            console.log(`[VibeAgent] Summarizing ${messagesToSummarize.length} messages, keeping ${messagesToKeep.length}`);
        }

        try {
            const currentSummary = this.backend.getState().summary || 'No previous summary.';

            // Send in_progress status
            streamWriter.writeSummarization(
                'in_progress',
                messagesToSummarize.length,
                messagesToKeep.length
            );

            // Format messages into readable conversation format
            const formattedMessages = this.formatMessagesForSummary(messagesWithoutErrors);

            const { text: newSummary } = await generateText({
                model: this.model,
                system: `You are a helpful assistant. Summarize the following conversation history into a concise, detailed narrative.
Retain key decisions, user requirements, current potential plan status, and important context.
Merge this with the "Existing Summary" strictly.

IMPORTANT: Exclude any error messages or stack traces from the summary - errors are tracked separately.

The conversation is formatted with:
- [N] Role: prefix indicating message number and role (System, User, Assistant, Tool Result)
- Content follows the role label
- --- separates messages`,
                messages: [
                    {
                        role: 'user',
                        content: `Existing Summary:\n${currentSummary}\n\nNew Conversation to Summarize:\n${formattedMessages}`
                    }
                ],
            });

            this.backend.setState({ summary: newSummary });

            // Track that we've summarized this message count
            this.lastSummarizedCount = compressed.length;

            if (process.env.DEBUG_VIBES) {
                console.log('[VibeAgent] Summarization complete:', newSummary.slice(0, 200) + '...');
            }

            // Send complete status
            streamWriter.writeSummarization(
                'complete',
                messagesToSummarize.length,
                messagesToKeep.length
            );

            return [
                { role: 'system', content: `## Previous Context Summary\n${newSummary}` },
                ...messagesToKeep
            ] as ModelMessage[];

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('[VibeAgent] Summarization failed:', errorMessage);

            if (process.env.DEBUG_VIBES) {
                console.error('[VibeAgent] Summarization error details:', error);
            }

            // Send failed status
            streamWriter.writeSummarization(
                'failed',
                messagesToSummarize.length,
                messagesToKeep.length,
                undefined,
                errorMessage
            );

            // Fallback: keep recent messages even if summarization fails
            return messagesToKeep;
        }
    }

    /**
     * Extract error messages from the message stream before summarization.
     * Errors should be tracked separately, not folded into summaries.
     */
    protected extractErrorsFromMessages(messages: ModelMessage[]): {
        messagesWithoutErrors: ModelMessage[];
        extractedErrors: Array<{ toolName?: string; error: string; context?: string }>;
    } {
        const messagesWithoutErrors: ModelMessage[] = [];
        const extractedErrors: Array<{ toolName?: string; error: string; context?: string }> = [];

        for (const msg of messages) {
            if (this.isErrorMessage(msg)) {
                const { toolName } = this.extractToolInfo(msg);
                const content = this.extractMessageContent(msg);
                extractedErrors.push({
                    toolName,
                    error: content,
                    context: `Extracted during summarization`
                });
            } else {
                messagesWithoutErrors.push(msg);
            }
        }

        return { messagesWithoutErrors, extractedErrors };
    }

    /**
     * Convert UIMessage[] to ModelMessage[] using AI SDK's converter
     */
    protected async convertMessages(messages: UIMessage[] | ModelMessage[]): Promise<ModelMessage[]> {
        if (messages.length === 0) return [];

        let modelMessages: ModelMessage[] = [];
        const firstMsg = messages[0] as PartedMessage;

        if (firstMsg.parts !== undefined) {
            const tools = await this.getAllTools();
            modelMessages = await convertToModelMessages(messages as UIMessage[], {
                tools: tools as ToolSet,
            });
        } else {
            modelMessages = messages as ModelMessage[];
        }

        if (process.env.DEBUG_VIBES) {
            console.log('[VibeAgent] Converted Messages:', JSON.stringify(modelMessages, null, 2));
        }
        return modelMessages;
    }

    // ============ STATE MANAGEMENT ============

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
