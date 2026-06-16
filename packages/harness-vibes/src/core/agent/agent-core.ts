import {
    ToolLoopAgent,
    convertToModelMessages,
    stepCountIs,
    type LanguageModel,
    type ModelMessage,
    type ToolSet,
    type UIMessage,
    type ToolLoopAgentSettings,
    type AgentCallParameters,
    type StepResult,
} from 'ai';
import {
    AgentCoreConfig,
    AgentCoreGenerateResult,
    AgentCoreStreamResult,
    PluginStreamContext,
    Plugin,
    ErrorEntry,
    ToolsRequiringApprovalConfig,
    createPluginStreamContext,
} from '../types';
import { recordError, getRecentErrors, formatRecentErrors } from './error-log';
import {
    extractMessageContent,
    isErrorMessage,
    extractToolInfo,
    compressMessage,
} from './message-compression';
import { resolveApprovalPolicy, wrapToolExecute } from './tool-resolution';

// Re-export ErrorEntry for convenience
export type { ErrorEntry };

// ============ TYPE DEFINITIONS ============

/**
 * Message with potential parts property (UIMessage)
 */
interface PartedMessage {
    role: string;
    content?: unknown;
    parts?: Array<{ type: string; data?: unknown }>;
}

/**
 * Options passed to ToolLoopAgent's prepareCall hook
 */
interface PrepareCallOptions {
    model: LanguageModel;
    instructions: string;
    messages: ModelMessage[];
    tools: ToolSet;
    temperature?: number;
}

/**
 * AgentCore is the core engine for autonomous multi-step reasoning.
 * Extends ToolLoopAgent for proper AI SDK integration and onData callback support.
 *
 * Deep Agent Features:
 * - Restorable compression: Large content replaced with file/path references
 * - Error preservation: Errors tracked separately, never summarized
 * - KV-cache awareness: Stable prompt prefix for cache optimization
 * - Plugin system for extensible capabilities
 *
 * By extending ToolLoopAgent, we get:
 * - Proper streaming with toUIMessageStream() support
 * - onData callback working correctly in useChat
 * - Built-in tool loop management
 * - prepareCall hook for custom logic injection
 */
export class AgentCore extends ToolLoopAgent<never, ToolSet, never> {
    protected plugins: Plugin[] = [];
    protected model: LanguageModel;
    protected customSystemPrompt: string;
    protected maxContextMessages: number;
    /** Model context window in tokens (token-based pruning). */
    protected contextWindow: number;
    /** Fraction of the window at which we start trimming context (0–1). */
    protected contextCompressionRatio: number;
    /** Whether to emit the live context-usage gauge (false for sub-agents). */
    protected emitContextGauge: boolean;
    protected maxRetries: number;
    protected customTools: Record<string, unknown>;
    protected toolsRequiringApproval: ToolsRequiringApprovalConfig = [];
    protected allowedTools?: string[];
    protected blockedTools?: string[];
    /**
     * Optional per-run model override. When set, every step uses this model
     * instead of the one the agent was constructed with (unless a plugin
     * explicitly picks a different model for a step). Powers UI model
     * selectors without rebuilding the cached agent.
     */
    protected modelOverride?: LanguageModel;
    /** Error log tracked separately from context (never summarized) */
    protected errorLog: ErrorEntry[] = [];
    /** Min characters a single payload must reach before in-place compression shrinks it. */
    protected compressionThreshold: number = 3000;
    /**
     * Most recent estimate (chars/4) of the context actually prepared for the
     * model. Emitted proactively as the gauge before each step, and used as a
     * fallback for spend + gauge when a provider omits per-step token usage.
     */
    protected lastContextEstimate: number = 0;
    /**
     * Fraction of the context window the whole conversation must reach before
     * per-message restorable compression runs at all. Below it, large reads are
     * kept verbatim regardless of `compressionThreshold` — so a big file read in
     * an otherwise-empty context isn't gutted. (0 = compress eagerly.)
     */
    protected compressionGateRatio: number = 0.7;
    /** Maximum errors to show in recent errors section */
    protected maxRecentErrors: number = 5;

    // Tool cache - initialize with empty object so tools getter always has a value
    protected toolCache: Record<string, unknown> = {};
    protected pluginsVersion: number = 0;
    /**
     * The plugin count the current `toolCache` was actually built from.
     * `-1` means "never built / invalidated". The cache is only reused when
     * this still equals `this.plugins.length`, which prevents a stale cache
     * from sticking when plugins are added after an early build (e.g. the
     * base `preloadTools()` racing with a subclass adding default plugins).
     */
    protected toolCacheVersion: number = -1;
    protected toolOwners: Record<string, string> = {};
    protected activeStreamContext?: PluginStreamContext;
    /**
     * The assembled system instructions for the active call. Computed in
     * prepareCall (modifySystemPrompt chain + customSystemPrompt) and reused
     * per step. Recent-error injection is overlaid in prepareStep so the
     * latest errors are visible without re-running the plugin chain.
     */
    protected currentBaseInstructions: string = '';

    /**
     * Running token usage for the active stream. Reset at the start of each
     * stream by `consumeLastStreamUsage()`; accumulated in the wrapped
     * `onStepFinish` callback below. Exposed publicly so the stream wrapper
     * can persist into the backend's `AgentState.metadata.usage`.
     */
    protected lastStreamUsage: { inputTokens: number; outputTokens: number; totalTokens: number } = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
    };

    protected static resolveStopWhen(config: AgentCoreConfig) {
        const maxStepCondition = stepCountIs(config.maxSteps ?? 20);
        if (!config.stopWhen) {
            return maxStepCondition;
        }

        return Array.isArray(config.stopWhen)
            ? [...config.stopWhen, maxStepCondition]
            : [config.stopWhen, maxStepCondition];
    }

    constructor(config: AgentCoreConfig) {
        // Initialize ToolLoopAgent with base configuration. We hook both
        // prepareCall (once per stream/generate, assembles stable system
        // instructions) and prepareStep (every step, prunes context, fans
        // out to plugin.prepareStep and merges the results).
        // We also wrap onStepFinish to aggregate per-step token usage into
        // `lastStreamUsage` for the stream wrapper to persist.
        const userOnStepFinish = config.onStepFinish;
        const settings: ToolLoopAgentSettings<never, ToolSet, never> = {
            model: config.model,
            instructions: config.instructions,
            tools: config.tools || {},
            temperature: config.temperature,
            onStepFinish: async (step) => {
                this.recordStepUsage(step);
                if (userOnStepFinish) {
                    await userOnStepFinish(step);
                }
            },
            stopWhen: AgentCore.resolveStopWhen(config),
            prepareCall: async (baseOptions) => {
                return this.prepareCallOverride(baseOptions as any);
            },
            prepareStep: async (stepOptions) => {
                return this.prepareStepOverride(stepOptions);
            },
            // Forward experimental_telemetry when enabled. The SDK accepts
            // an opaque TelemetrySettings object; we populate functionId +
            // a minimal metadata bag so spans are attributable to a session.
            // Users wanting an OTLP exporter should set
            // OTEL_EXPORTER_OTLP_ENDPOINT in their environment — the SDK
            // picks up the global tracer.
            ...(config.enableTelemetry
                ? {
                    experimental_telemetry: {
                        isEnabled: true,
                        functionId: config.name ?? 'vibe-agent',
                        metadata: {
                            agentName: config.name ?? 'vibe-agent',
                        },
                    },
                }
                : {}),
        };

        super(settings);

        // Store model reference for use in summarization and other features
        this.model = config.model;
        this.customSystemPrompt = config.systemPrompt || '';
        this.maxContextMessages = config.maxContextMessages ?? 50;
        this.contextWindow = config.contextWindow ?? 128000;
        this.contextCompressionRatio = config.contextCompressionRatio ?? 0.7;
        this.compressionThreshold = config.compressionThreshold ?? this.compressionThreshold;
        this.compressionGateRatio = config.compressionGateRatio ?? this.compressionGateRatio;
        this.emitContextGauge = config.emitContextGauge ?? true;
        this.maxRetries = config.maxRetries ?? 2;
        this.customTools = config.tools || {};
        this.toolsRequiringApproval = config.toolsRequiringApproval || [];
        this.allowedTools = config.allowedTools;
        this.blockedTools = config.blockedTools;

        if (config.plugins) {
            this.addPlugin(config.plugins);
        }

        // Pre-build tools for the base tools getter
        this.preloadTools();
    }

    /**
     * Return the accumulated token usage for the most recent stream and
     * reset the internal counter to zero. Intended to be called by
     * `createAgentStreamResponse` after the stream completes so the
     * usage can be added to the persisted `AgentState.metadata.usage`.
     */
    consumeLastStreamUsage(): { inputTokens: number; outputTokens: number; totalTokens: number } {
        const usage = { ...this.lastStreamUsage };
        this.lastStreamUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
        return usage;
    }

    /**
     * Fold a finished step's token usage into the running totals and, when a
     * stream writer is active, emit the live context-window gauge. Two distinct
     * numbers come out of `step.usage`:
     *
     *   - **Cumulative spend** (`lastStreamUsage`): summed across every step, so
     *     it reflects what the provider actually bills — each step re-sends the
     *     growing context and you pay for all of it.
     *   - **Context fullness** (the gauge): the *latest* step's input + output is
     *     the real size of the conversation now in the window. This is the ground
     *     truth the provider reports — far more accurate than a char-count
     *     estimate because it includes the system prompt and tool schemas the
     *     model actually saw, plus the full tool-call/result payloads.
     */
    protected recordStepUsage(step: StepResult<ToolSet>): void {
        const u = step.usage;
        const inputTokens = u?.inputTokens ?? 0;
        const outputTokens = u?.outputTokens ?? 0;
        // Some providers report input/output but omit a combined total; derive
        // it so cumulative spend never sticks at zero.
        const totalTokens = u?.totalTokens ?? inputTokens + outputTokens;

        if (inputTokens > 0 || outputTokens > 0) {
            this.lastStreamUsage.inputTokens += inputTokens;
            this.lastStreamUsage.outputTokens += outputTokens;
            this.lastStreamUsage.totalTokens += totalTokens;
            // Live gauge: the freshest step's input+output is how full the
            // context is now — ground truth from the provider (includes the
            // system prompt + tool schemas it actually saw).
            this.writeContextGauge(inputTokens + outputTokens);
        } else if (this.lastContextEstimate > 0) {
            // Provider omitted usage entirely (some OpenRouter models do). Fall
            // back to the prepared-context estimate so neither the gauge nor
            // cumulative spend silently sticks at zero.
            this.lastStreamUsage.inputTokens += this.lastContextEstimate;
            this.lastStreamUsage.totalTokens += this.lastContextEstimate;
            this.writeContextGauge(this.lastContextEstimate);
        }
    }

    /** Rough token estimate (chars/4) for a system prompt + message list. */
    protected estimateContextTokens(system: string, messages: ModelMessage[]): number {
        let chars = system.length;
        for (const m of messages) chars += extractMessageContent(m).length;
        return Math.round(chars / 4);
    }

    /**
     * Emit/refresh the live context-window gauge with the given occupancy.
     * Uses a stable data-part id so each call overwrites the last — the meter
     * tracks the current window fullness rather than accumulating.
     */
    protected writeContextGauge(usedTokens: number): void {
        const writer = this.activeStreamContext?.writer;
        if (!this.emitContextGauge || !writer || usedTokens <= 0 || this.contextWindow <= 0) return;
        writer.writeContextUsage({
            usedTokens,
            contextWindow: this.contextWindow,
            threshold: this.contextCompressionRatio,
            compressAt: Math.round(this.contextWindow * this.contextCompressionRatio),
        });
    }

    /**
     * Update the context window (and optionally the compression ratio) used by
     * the live gauge and token-based summarization. Call this when the UI swaps
     * the active model mid-session for one with a different window — the change
     * is fanned out to any plugin that tracks its own window (the
     * SummarizationPlugin) so its compression threshold moves with the model.
     */
    setContextWindow(contextWindow: number, compressionRatio?: number): void {
        if (Number.isFinite(contextWindow) && contextWindow > 0) {
            this.contextWindow = contextWindow;
        }
        if (compressionRatio !== undefined && compressionRatio > 0 && compressionRatio <= 1) {
            this.contextCompressionRatio = compressionRatio;
        }
        for (const plugin of this.plugins) {
            const p = plugin as { setContextWindow?: (w: number, r?: number) => void };
            if (typeof p.setContextWindow === 'function') {
                p.setContextWindow(this.contextWindow, this.contextCompressionRatio);
            }
        }
    }

    addPlugin(plugin: Plugin | Plugin[]) {
        if (Array.isArray(plugin)) {
            this.plugins.push(...plugin);
        } else {
            this.plugins.push(plugin);
        }
        // Invalidate tool cache when plugin is added
        this.pluginsVersion = this.plugins.length;
        this.toolCache = {};
        this.toolCacheVersion = -1;
    }

    /**
     * Override the model used for subsequent runs (per-request model
     * selection). Pass `undefined` to revert to the constructed model.
     */
    setModelOverride(model?: LanguageModel): void {
        this.modelOverride = model;
    }

    /**
     * Forward a UI/API web-search backend preference to any plugin that
     * supports it (the WebSearchPlugin). Pass `undefined` or `'auto'` to revert
     * to the server's env auto-detection. Duck-typed so core stays decoupled
     * from the concrete plugin.
     */
    setSearchProviderPreference(provider?: string): void {
        for (const plugin of this.plugins) {
            const p = plugin as { setProviderPreference?: (id?: string) => void };
            if (typeof p.setProviderPreference === 'function') p.setProviderPreference(provider);
        }
    }

    /**
     * Set up cross-plugin dependencies after all plugins are added. No default
     * plugins currently need wiring; kept as an extension point for subclasses.
     */
    protected setupPluginDependencies(): void {
        // intentionally empty
    }

    /**
     * Override the tools getter to provide dynamic tools from plugins.
     * This is called by ToolLoopAgent before each generate/stream.
     */
    override get tools(): ToolSet {
        return this.toolCache as ToolSet;
    }

    /**
     * Preload tools during construction for initial tools getter value.
     */
    protected async preloadTools(): Promise<void> {
        // Setup plugin dependencies before any plugin operations
        this.setupPluginDependencies();
        this.toolCache = await this.getAllTools();
    }

    protected resolveAllowedToolSet(allowedTools?: string[]): Set<string> | undefined {
        const effectiveAllowedTools = allowedTools ?? this.allowedTools;
        return effectiveAllowedTools ? new Set(effectiveAllowedTools) : undefined;
    }

    protected getConfiguredCustomTools(): Record<string, unknown> {
        return { ...this.customTools };
    }

    protected getToolsRequiringApprovalConfig(): ToolsRequiringApprovalConfig {
        return Array.isArray(this.toolsRequiringApproval)
            ? [...this.toolsRequiringApproval]
            : { ...this.toolsRequiringApproval };
    }

    // ============ PREPARE CALL OVERRIDE ============

    /**
     * Called once per stream/generate. Assembles the stable parts of the
     * system prompt (modifySystemPrompt chain + customSystemPrompt) and
     * resolves the active tool set. Per-step concerns — message pruning,
     * recent-error overlay, plugin.prepareStep fan-out — live in
     * prepareStepOverride so they re-run for every model call in the loop.
     */
    protected async prepareCallOverride(baseOptions: PrepareCallOptions): Promise<PrepareCallOptions> {
        // Build system prompt with plugin modifications
        let instructions = baseOptions.instructions;
        for (const plugin of this.plugins) {
            if (plugin.modifySystemPrompt) {
                const result = plugin.modifySystemPrompt(instructions);
                instructions = result instanceof Promise ? await result : result;
            }
        }

        // Add custom system prompt
        if (this.customSystemPrompt) {
            instructions += `\n\n## Custom Instructions\n${this.customSystemPrompt} `;
        }

        // Anchor the model in real time. Appended LAST so the large, stable
        // instruction prefix above stays KV-cacheable — only this short tail
        // changes between turns. Computed per call (prepareCall runs once per
        // turn) so each turn sees the actual current time, never a value frozen
        // at process start.
        const environment = this.getEnvironmentContext();
        if (environment) {
            instructions += `\n\n${environment}`;
        }

        // Cache the assembled base so prepareStep can overlay recent errors.
        this.currentBaseInstructions = instructions;

        // Get all tools with plugin tools and wrapping
        const tools = await this.getAllTools();

        return {
            ...baseOptions,
            instructions,
            tools: tools as ToolSet,
        };
    }

    /**
     * A short, dynamic "environment" block appended to the system prompt on
     * every turn — chiefly the current date and time, so the model treats the
     * present as *now* instead of falling back on its training cutoff and
     * serving stale information.
     *
     * Recomputed each call (so it never freezes at process start). Override to
     * add more runtime context (locale, working directory, …) or return `''`
     * to disable.
     */
    protected getEnvironmentContext(): string {
        const now = new Date();
        const human = now.toLocaleString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZoneName: 'short',
        });
        return [
            '<environment>',
            `Current date and time: ${human} (${now.toISOString()}).`,
            'Treat this as the present moment, not your training cutoff. For anything time-sensitive or recent, rely on this date and your available tools rather than assumptions about what is current.',
            '</environment>',
        ].join('\n');
    }

    // ============ PREPARE STEP OVERRIDE ============

    /**
     * Called before every step in the tool loop. Responsibilities:
     *   1. Prune/compress messages so context stays bounded even across
     *      long multi-step runs (the previous prepareCall-only path could
     *      grow unbounded across `maxSteps`).
     *   2. Overlay the latest "Recent Errors" section on the system prompt
     *      so the model sees freshly logged failures without rebuilding
     *      the whole instruction chain.
     *   3. Fan out to `plugin.prepareStep` for every plugin and merge the
     *      results. Merge rules:
     *        - `activeTools` → intersection (every plugin that asks for a
     *          narrower set wins; absent value = no constraint)
     *        - `messages` → last non-undefined plugin override wins,
     *          otherwise the pruned messages
     *        - `model`, `system`, `toolChoice`, `experimental_context`,
     *          `providerOptions` → last writer wins
     */
    protected async prepareStepOverride(stepOptions: {
        steps: any[];
        stepNumber: number;
        model: LanguageModel;
        messages: ModelMessage[];
        experimental_context?: unknown;
    }): Promise<{
        model?: LanguageModel;
        toolChoice?: any;
        activeTools?: string[];
        system?: string | any;
        messages?: ModelMessage[];
        experimental_context?: unknown;
        providerOptions?: any;
    } | undefined> {
        // 1. Prune messages
        const prunedMessages = await this.pruneMessages(stepOptions.messages || []);

        // 2. Overlay recent errors onto the cached base instructions
        const recentErrors = getRecentErrors(this.errorLog, this.maxRecentErrors);
        const systemOverride = recentErrors.length > 0
            ? `${this.currentBaseInstructions}\n\n${formatRecentErrors(recentErrors)}`
            : undefined;

        // Proactively emit the context gauge from the prepared context, BEFORE
        // the model call — so the meter appears as soon as a turn starts and
        // still works for providers that omit per-step usage. recordStepUsage
        // overwrites it with the provider's ground truth when available.
        this.lastContextEstimate = this.estimateContextTokens(
            systemOverride ?? this.currentBaseInstructions ?? '',
            prunedMessages,
        );
        this.writeContextGauge(this.lastContextEstimate);

        // 3. Fan out to plugin.prepareStep
        const pluginStepOptions = {
            ...stepOptions,
            messages: prunedMessages,
        };

        let merged: {
            model?: LanguageModel;
            toolChoice?: any;
            activeTools?: string[];
            system?: string | any;
            messages?: ModelMessage[];
            experimental_context?: unknown;
            providerOptions?: any;
        } = {
            ...(systemOverride !== undefined ? { system: systemOverride } : {}),
            messages: prunedMessages,
        };
        let activeToolsSet: Set<string> | undefined;

        for (const plugin of this.plugins) {
            if (!plugin.prepareStep) continue;
            const pluginResult = await plugin.prepareStep({
                ...pluginStepOptions,
                system: merged.system ?? this.currentBaseInstructions,
            });
            if (!pluginResult) continue;

            if (pluginResult.model !== undefined) merged.model = pluginResult.model;
            if (pluginResult.toolChoice !== undefined) merged.toolChoice = pluginResult.toolChoice;
            if (pluginResult.system !== undefined) merged.system = pluginResult.system;
            if (pluginResult.messages !== undefined) merged.messages = pluginResult.messages;
            if (pluginResult.experimental_context !== undefined) {
                merged.experimental_context = pluginResult.experimental_context;
            }
            if (Array.isArray(pluginResult.activeTools)) {
                const incoming = new Set(pluginResult.activeTools);
                activeToolsSet = activeToolsSet
                    ? new Set([...activeToolsSet].filter(name => incoming.has(name)))
                    : incoming;
            }
        }

        if (activeToolsSet) {
            merged.activeTools = Array.from(activeToolsSet);
        }

        // Per-request model override (e.g. a UI model selector). Applies to
        // every step of the main loop unless a plugin explicitly chose a
        // different model for this step.
        if (this.modelOverride && merged.model === undefined) {
            merged.model = this.modelOverride;
        }

        return merged;
    }

    // ============ STREAM OVERRIDE ============

    /**
     * Override stream to handle plugin lifecycle while using super.stream()
     * for proper AI SDK streaming and onData callback support.
     */
    override async stream(
        options?: any
    ): Promise<AgentCoreStreamResult> {
        // Extract AgentCore-specific options (writer)
        // Also extract 'prompt' to avoid conflicts with 'messages' in super.stream()
        const { messages, writer, prompt, ...agentOptions } = options || {};

        // Convert messages if provided (either 'messages' or 'prompt')
        const modelMessages = messages
            ? await this.convertMessages(messages)
            : prompt
                ? await this.convertMessages(prompt as any)
                : undefined;

        const streamContext = writer ? createPluginStreamContext(writer) : undefined;
        this.activeStreamContext = streamContext;

        // Trigger plugin stream hooks
        if (streamContext) {
            for (const plugin of this.plugins) {
                if (plugin.onStreamContextReady) {
                    plugin.onStreamContextReady(streamContext);
                } else if (plugin.onStreamReady) {
                    plugin.onStreamReady(streamContext.rawWriter);
                }
            }
        }

        // Call super.stream() for proper AI SDK streaming
        // Use 'messages' parameter consistently (avoid 'prompt' to prevent conflict)
        const result = await super.stream({
            ...agentOptions,
            ...(modelMessages ? { messages: modelMessages } : {}),
        });

        // Handle stream completion with plugin hooks
        Promise.resolve(result.response).then(async (finishResult) => {
            for (const plugin of this.plugins) {
                if (plugin.onStreamFinish) {
                    await plugin.onStreamFinish(finishResult);
                }
            }
            if (this.activeStreamContext === streamContext) {
                this.activeStreamContext = undefined;
            }
        }).catch((error: Error) => {
            console.error('[AgentCore] Stream completion error:', error);
            if (this.activeStreamContext === streamContext) {
                this.activeStreamContext = undefined;
            }
        });

        return result;
    }

    // ============ GENERATE OVERRIDE ============

    /**
     * Override generate to handle plugin hooks.
     */
    override async generate(
        options?: AgentCallParameters<never, ToolSet> & { messages?: UIMessage[] | ModelMessage[] }
    ): Promise<AgentCoreGenerateResult> {
        // Extract AgentCore-specific options
        const { messages, ...agentOptions } = options as any;

        // Convert messages if provided
        const modelMessages = messages
            ? await this.convertMessages(messages)
            : undefined;

        // Call super.generate() for proper AI SDK generation
        const result = await super.generate({
            ...agentOptions,
            ...(modelMessages ? { messages: modelMessages } : {}),
        } as AgentCallParameters<never, ToolSet>);

        const toolErrors = result.steps?.flatMap(step =>
            (step.content?.filter((part) => part.type === 'tool-error') ?? []) as Array<{ type: 'tool-error' }>
        ) ?? [];

        // NOTE: spreading the SDK result ({ ...result }) drops its getter
        // properties (text, usage, response, …) because they live on the
        // prototype, not as own enumerable keys. Attach our extra fields in
        // place instead so the returned object keeps the full
        // GenerateTextResult surface. `state` is derived from the response
        // messages so callers — including the non-streaming API route and
        // the public Session.prompt() facade — receive a populated
        // AgentState rather than `undefined`.
        const responseMessages = (result.response?.messages ?? []) as ModelMessage[];
        return Object.assign(result, {
            toolErrors: toolErrors.length > 0 ? toolErrors : undefined,
            state: { messages: responseMessages, metadata: {} },
        }) as unknown as AgentCoreGenerateResult;
    }

    // ============ TOOL MANAGEMENT ============

    protected async getAllTools(allowedTools?: string[]): Promise<Record<string, unknown>> {
        // Reuse the cache only when it was built from the CURRENT plugin set.
        // Checking the built-at version (not just "non-empty") closes a
        // constructor race: the base preloadTools() can populate the cache
        // before a subclass finishes adding its default plugins, which would
        // otherwise leave a stale, tool-poor cache stuck forever.
        if (
            !allowedTools &&
            this.toolCacheVersion === this.plugins.length &&
            Object.keys(this.toolCache).length > 0
        ) {
            return this.toolCache;
        }

        const allTools: Record<string, unknown> = {};
        const toolOwners: Record<string, string> = {};

        // Wait for all plugins to be ready
        for (const plugin of this.plugins) {
            if (plugin.waitReady) {
                await plugin.waitReady();
            }
        }

        // Collect tools from all plugins
        for (const plugin of this.plugins) {
            if (plugin.tools) {
                for (const [toolName, toolDef] of Object.entries(plugin.tools)) {
                    allTools[toolName] = toolDef;
                    toolOwners[toolName] = plugin.name;
                }
            }
        }

        // Merge custom tools from config
        for (const [toolName, toolDef] of Object.entries(this.customTools)) {
            allTools[toolName] = toolDef;
            toolOwners[toolName] ??= 'custom';
        }

        const approvalConfig = this.toolsRequiringApproval;
        const resolvedTools: Record<string, unknown> = {};
        this.toolOwners = toolOwners;

        for (const [toolName, toolDef] of Object.entries(allTools)) {
            const toolDefRecord = toolDef as Record<string, unknown>;
            const originalExecute = toolDefRecord.execute as ((args: unknown, options: unknown) => Promise<unknown>) | undefined;
            const ownerName = this.toolOwners[toolName] ?? 'custom';

            const resolvedNeedsApproval = resolveApprovalPolicy(approvalConfig, toolName, toolDefRecord);

            // Wrap each executable tool with retry + activity-feed instrumentation
            // (see tool-resolution.ts). The stream context is read lazily so the
            // wrapper always sees the run's current writer.
            resolvedTools[toolName] = {
                ...(toolDef as Record<string, unknown>),
                ...(resolvedNeedsApproval !== undefined ? { needsApproval: resolvedNeedsApproval } : {}),
                execute: originalExecute
                    ? wrapToolExecute({
                        toolName,
                        ownerName,
                        originalExecute,
                        plugins: this.plugins,
                        maxRetries: this.maxRetries,
                        getStreamContext: () => this.activeStreamContext,
                        logError: (t, e, c) => this.logError(t, e, c),
                    })
                    : undefined,
            };
        }

        // Apply blockedTools filter (takes precedence over allowedTools)
        if (this.blockedTools) {
            for (const name of this.blockedTools) {
                delete resolvedTools[name];
            }
        }

        const allowedToolSet = this.resolveAllowedToolSet(allowedTools);
        if (allowedToolSet) {
            const filtered: Record<string, unknown> = {};
            for (const name of allowedToolSet) {
                if (resolvedTools[name]) {
                    filtered[name] = resolvedTools[name];
                }
            }
            if (!allowedTools) {
                this.toolCache = filtered;
                this.pluginsVersion = this.plugins.length;
                this.toolCacheVersion = this.plugins.length;
            }
            return filtered;
        }

        this.toolCache = resolvedTools;
        this.pluginsVersion = this.plugins.length;
        this.toolCacheVersion = this.plugins.length;
        return resolvedTools;
    }

    // ============ ERROR TRACKING ============

    /**
     * Record an error into the agent's separate error log (never summarized).
     * Thin instance hook over {@link recordError} so call sites — and the tool
     * wrapper — keep a stable `this.logError(...)`.
     */
    protected logError(toolName: string | undefined, error: string, context?: string): void {
        recordError(this.errorLog, toolName, error, context);
    }

    // ============ MESSAGE PROCESSING ============

    /**
     * Apply restorable compression to large content. User/system messages and
     * errors are never shrunk (errors are logged separately instead); oversized
     * assistant/tool payloads are replaced with a reference + preview. See
     * `message-compression.ts` for the per-message mechanics.
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
            if (isErrorMessage(msg)) {
                const { toolName } = extractToolInfo(msg);
                this.logError(toolName, extractMessageContent(msg), `Role: ${msg.role}`);
                // Still include error in compressed messages, but don't shrink it
                compressed.push(msg);
                continue;
            }

            // Check if content is large enough to compress
            if (extractMessageContent(msg).length < this.compressionThreshold) {
                compressed.push(msg);
                continue;
            }

            // Apply restorable compression based on message type
            compressed.push(compressMessage(msg, this.compressionThreshold));
        }

        return compressed;
    }

    /**
     * Prune messages using a hybrid approach:
     * 1. First pass: Restorable compression (lossless, replaces large content with references)
     * 2. Second pass: Truncation to max messages if still over limit
     */
    protected async pruneMessages(messages: ModelMessage[]): Promise<ModelMessage[]> {
        const estimateTokens = (msgs: ModelMessage[]) =>
            msgs.reduce((acc, msg) => acc + extractMessageContent(msg).length, 0) / 4;

        // Phase 1: lossless restorable compression of large tool outputs — but
        // only once the WHOLE conversation is approaching the window. While
        // there's headroom we keep full reads verbatim, so a single large file
        // read in an otherwise-empty context is no longer gutted to a preview.
        // (`compressionGateRatio` = 0 restores the old eager behaviour.)
        const compressionFloor = this.contextWindow * this.compressionGateRatio;
        const compressed = estimateTokens(messages) >= compressionFloor
            ? await this.compressLargeContent(messages)
            : messages;

        // Token-based: the SummarizationPlugin handles compression at the
        // configured ratio (e.g. 70% of the window). This hard truncation is a
        // last-resort safety net only — it fires near the very top of the
        // window so it doesn't pre-empt summarization or trim short
        // conversations by message count.
        const emergencyCeiling = this.contextWindow * 0.95;
        if (estimateTokens(compressed) < emergencyCeiling) {
            return compressed;
        }

        // Over the ceiling: keep the most recent messages that fit in ~85% of
        // the window, dropping the oldest.
        const keepBudget = this.contextWindow * 0.85;
        let acc = 0;
        let splitAt = compressed.length;
        for (let i = compressed.length - 1; i >= 0; i--) {
            acc += extractMessageContent(compressed[i]).length / 4;
            if (acc > keepBudget) break;
            splitAt = i;
        }
        const messagesToKeep = compressed.slice(splitAt);

        // Don't start the window on a dangling tool message.
        while (messagesToKeep.length > 0 && messagesToKeep[0].role === 'tool') {
            messagesToKeep.shift();
        }

        if (process.env.DEBUG_VIBES) {
            console.log(`[AgentCore] Emergency prune ${messages.length} → ${messagesToKeep.length} messages (>${Math.round(emergencyCeiling)} tok)`);
        }

        return messagesToKeep;
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
                ignoreIncompleteToolCalls: true, // Filter out incomplete tool calls from interrupted streams
            });
        } else {
            modelMessages = messages as ModelMessage[];
        }

        if (process.env.DEBUG_VIBES) {
            console.log('[AgentCore] Converted Messages:', JSON.stringify(modelMessages, null, 2));
        }
        return modelMessages;
    }
}
