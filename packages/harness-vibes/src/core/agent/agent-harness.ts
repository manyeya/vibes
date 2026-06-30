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
    type StopCondition,
} from 'ai';
import { resolveBudgetStops, budgetBreaches, type BudgetConfig } from './budgets';
import {
    AgentHarnessConfig,
    AgentHarnessGenerateResult,
    AgentHarnessStreamResult,
    PluginStreamContext,
    Plugin,
    ErrorEntry,
    createPluginStreamContext,
} from '../types';
import { recordError, getRecentErrors, formatRecentErrors } from './error-log';
import { ContextManager } from './context-manager';
import { UsageTracker } from './usage-tracker';
import { ToolRegistry } from './tool-registry';

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
    /** Per-call stop conditions (v7 prepareCall honors these); used to add budget caps. */
    stopWhen?: StopCondition<ToolSet> | StopCondition<ToolSet>[];
}

/**
 * AgentHarness is the agent **harness**: the runtime loop around the model. It
 * extends the AI SDK's `ToolLoopAgent` and orchestrates three collaborators
 * rather than implementing everything itself:
 *
 *   - {@link ContextManager} — window sizing, restorable compression, pruning, gauge math
 *   - {@link UsageTracker}  — per-stream token accounting
 *   - {@link ToolRegistry}  — plugin/custom tool assembly, approval, caching
 *
 * What stays here is genuinely the harness's job: the prepare-call / prepare-step
 * hooks, plugin lifecycle dispatch, the stream/generate overrides, the separate
 * error log, and wiring the collaborators together. Keep new responsibilities
 * out of this class — give them to a collaborator and orchestrate it from here.
 */
export class AgentHarness extends ToolLoopAgent<never, ToolSet> {
    protected plugins: Plugin[] = [];
    protected model: LanguageModel;
    protected customSystemPrompt: string;
    /** Whether to emit the live context-usage gauge (false for sub-agents). */
    protected emitContextGauge: boolean;
    /**
     * Optional per-run model override. When set, every step uses this model
     * instead of the one the agent was constructed with (unless a plugin
     * explicitly picks a different model for a step). Powers UI model
     * selectors without rebuilding the cached agent.
     */
    protected modelOverride?: LanguageModel;
    /** Error log tracked separately from context (never summarized). */
    protected errorLog: ErrorEntry[] = [];
    /** Maximum errors to show in the recent-errors section. */
    protected maxRecentErrors: number = 5;

    /** Context engineering (window, compression, pruning, gauge payload). */
    protected context: ContextManager;
    /** Per-stream token accounting. */
    protected usage: UsageTracker = new UsageTracker();
    /** Effective tool set assembly (plugin + custom tools, approval, caching). */
    protected toolRegistry: ToolRegistry;

    protected activeStreamContext?: PluginStreamContext;
    /** Per-run budgets (token/cost/tool-call caps), enforced via stopWhen. */
    protected budgets?: BudgetConfig;
    /** The base stop conditions (maxSteps + user stopWhen); budgets are added per-call. */
    private baseStopWhen!: StopCondition<ToolSet> | StopCondition<ToolSet>[];
    /**
     * The assembled system instructions for the active call. Computed in
     * prepareCall (modifySystemPrompt chain + customSystemPrompt) and reused
     * per step. Recent-error injection is overlaid in prepareStep so the
     * latest errors are visible without re-running the plugin chain.
     */
    protected currentBaseInstructions: string = '';
    /**
     * Most recent estimate (chars/4) of the context prepared for the model.
     * Set in prepareStep, used as the gauge value before the model replies and
     * as the spend fallback when a provider omits per-step usage. This is the
     * one scalar the harness passes between ContextManager and UsageTracker.
     */
    protected lastContextEstimate: number = 0;

    /** Backwards-compatible reads for subclasses (e.g. VibeAgent seeds plugins from these). */
    protected get contextWindow(): number { return this.context.contextWindow; }
    protected get contextCompressionRatio(): number { return this.context.compressionRatio; }

    protected static resolveStopWhen(config: AgentHarnessConfig) {
        const maxStepCondition = stepCountIs(config.maxSteps ?? 20);
        if (!config.stopWhen) {
            return maxStepCondition;
        }

        return Array.isArray(config.stopWhen)
            ? [...config.stopWhen, maxStepCondition]
            : [config.stopWhen, maxStepCondition];
    }

    constructor(config: AgentHarnessConfig) {
        // Initialize ToolLoopAgent with base configuration. We hook both
        // prepareCall (once per stream/generate, assembles stable system
        // instructions) and prepareStep (every step, prunes context, fans
        // out to plugin.prepareStep and merges the results).
        // We also wrap onStepFinish to aggregate per-step token usage into
        // the UsageTracker for the stream wrapper to persist.
        const userOnStepFinish = config.onStepFinish;
        const settings: ToolLoopAgentSettings<never, ToolSet> = {
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
            stopWhen: AgentHarness.resolveStopWhen(config),
            // v7 typed prepareCall's return as the AgentCallParameters intersection
            // (incl. toolsContext); our override returns the same object shape with
            // `instructions`, so cast through `any` rather than restate that type.
            prepareCall: (async (baseOptions: any) => {
                return this.prepareCallOverride(baseOptions as any);
            }) as any,
            prepareStep: async (stepOptions) => {
                return this.prepareStepOverride(stepOptions);
            },
            // Forward experimental_telemetry when enabled. The SDK accepts
            // an opaque TelemetrySettings object; we populate functionId so
            // spans are attributable to a session. Users wanting an OTLP
            // exporter should set OTEL_EXPORTER_OTLP_ENDPOINT in their
            // environment — the SDK picks up the global tracer.
            ...(config.enableTelemetry
                ? {
                    experimental_telemetry: {
                        isEnabled: true,
                        functionId: config.name ?? 'vibe-agent',
                    },
                }
                : {}),
        };

        super(settings);

        this.model = config.model;
        this.customSystemPrompt = config.systemPrompt || '';
        this.emitContextGauge = config.emitContextGauge ?? true;
        this.budgets = config.budgets;
        this.baseStopWhen = settings.stopWhen as StopCondition<ToolSet> | StopCondition<ToolSet>[];

        this.context = new ContextManager({
            contextWindow: config.contextWindow,
            contextCompressionRatio: config.contextCompressionRatio,
            compressionThreshold: config.compressionThreshold,
            compressionGateRatio: config.compressionGateRatio,
        });
        this.toolRegistry = new ToolRegistry({
            customTools: config.tools || {},
            toolsRequiringApproval: config.toolsRequiringApproval || [],
            allowedTools: config.allowedTools,
            blockedTools: config.blockedTools,
            maxRetries: config.maxRetries ?? 2,
            redactToolIO: config.redactToolIO ?? true,
        });

        if (config.plugins) {
            this.addPlugin(config.plugins);
        }

        // Pre-build tools for the base tools getter.
        this.preloadTools();
    }

    // ============ USAGE + GAUGE ============

    /**
     * Return the accumulated token usage for the most recent stream and reset
     * the counter. Called by `createAgentStreamResponse` after the stream
     * completes so usage can be added to `AgentState.metadata.usage`.
     */
    consumeLastStreamUsage(): { inputTokens: number; outputTokens: number; totalTokens: number } {
        return this.usage.consume();
    }

    /**
     * Fold a finished step into the running usage and refresh the live gauge.
     * Spend accumulates inside the UsageTracker; the value it returns is the
     * current window fullness (provider ground truth, or the prepared-context
     * estimate when the provider omits usage).
     */
    protected recordStepUsage(step: StepResult<ToolSet>): void {
        const usedTokens = this.usage.record(step, this.lastContextEstimate);
        if (usedTokens !== null) this.writeContextGauge(usedTokens);
    }

    /** Rough token estimate (chars/4) for a system prompt + message list. */
    protected estimateContextTokens(system: string, messages: ModelMessage[]): number {
        return this.context.estimateTokens(system, messages);
    }

    /**
     * Emit/refresh the live context-window gauge. The payload math lives in the
     * ContextManager (it owns the window); the harness owns the writer + the
     * on/off flag and decides whether to render.
     */
    protected writeContextGauge(usedTokens: number): void {
        if (!this.emitContextGauge) return;
        const writer = this.activeStreamContext?.writer;
        if (!writer) return;
        const payload = this.context.gauge(usedTokens);
        if (payload) writer.writeContextUsage(payload);
    }

    /**
     * Update the context window (and optionally the compression ratio) used by
     * the gauge and pruning. Call this when the UI swaps the active model for
     * one with a different window — the change is fanned out to any plugin that
     * tracks its own window (the SummarizationPlugin) so its threshold moves too.
     */
    setContextWindow(contextWindow: number, compressionRatio?: number): void {
        this.context.setWindow(contextWindow, compressionRatio);
        for (const plugin of this.plugins) {
            const p = plugin as { setContextWindow?: (w: number, r?: number) => void };
            if (typeof p.setContextWindow === 'function') {
                p.setContextWindow(this.context.contextWindow, this.context.compressionRatio);
            }
        }
    }

    // ============ PLUGINS + TOOLS ============

    addPlugin(plugin: Plugin | Plugin[]) {
        if (Array.isArray(plugin)) {
            this.plugins.push(...plugin);
        } else {
            this.plugins.push(plugin);
        }
        // Plugin set changed → the tool cache is stale.
        this.toolRegistry.invalidate();
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
     * Override the tools getter to provide dynamic tools from plugins. Called by
     * ToolLoopAgent before each generate/stream; returns the registry's cache.
     */
    override get tools(): ToolSet {
        return this.toolRegistry.cached as ToolSet;
    }

    /** Preload tools during construction for the initial tools getter value. */
    protected async preloadTools(): Promise<void> {
        this.setupPluginDependencies();
        await this.getAllTools();
    }

    /**
     * Assemble the effective tool set via the ToolRegistry, injecting the
     * harness-owned runtime hooks (current stream writer + error log).
     */
    protected async getAllTools(allowedTools?: string[]): Promise<Record<string, unknown>> {
        return this.toolRegistry.build(
            this.plugins,
            {
                getStreamContext: () => this.activeStreamContext,
                logError: (t, e, c) => this.logError(t, e, c),
            },
            allowedTools,
        );
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

        // Per-run budgets are added as native stopWhen conditions here (v7
        // honors stopWhen returned from prepareCall), kept alongside the base
        // step cap + user conditions so none is lost.
        const budgetStops = this.budgets ? resolveBudgetStops(this.budgets) : [];

        return {
            ...baseOptions,
            instructions,
            tools: tools as ToolSet,
            ...(budgetStops.length
                ? { stopWhen: [...this.asStopArray(this.baseStopWhen), ...budgetStops] }
                : {}),
        };
    }

    /** Normalize a stopWhen value to an array for merging. */
    private asStopArray(
        stop: StopCondition<ToolSet> | StopCondition<ToolSet>[],
    ): StopCondition<ToolSet>[] {
        return Array.isArray(stop) ? stop : [stop];
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
    ): Promise<AgentHarnessStreamResult> {
        // Extract AgentHarness-specific options (writer)
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
        // `onError` forwards to the internal streamText: in v7 a provider/stream
        // error is delivered here and the stream finishes without throwing, then
        // collapses downstream to a generic "An error occurred." Log the raw
        // error so the real failure (e.g. a mid-stream rate limit) is visible in
        // the server logs. (Not on ToolLoopAgentSettings, so passed per-call.)
        const result = await super.stream({
            ...agentOptions,
            ...(modelMessages ? { messages: modelMessages } : {}),
            onError: ({ error }: { error: unknown }) => {
                const e = error as { name?: string; message?: string; statusCode?: number; responseBody?: string; cause?: unknown };
                console.error('[AgentHarness] stream error:', {
                    name: e?.name, message: e?.message, statusCode: e?.statusCode,
                    responseBody: e?.responseBody, cause: e?.cause,
                });
            },
        } as any);

        // Handle stream completion with plugin hooks
        Promise.resolve(result.response).then(async (finishResult) => {
            for (const plugin of this.plugins) {
                if (plugin.onStreamFinish) {
                    await plugin.onStreamFinish(finishResult);
                }
            }
            // If a per-run budget halted the loop, tell the user why (the
            // StopConditions stay pure; the notice is derived from the steps).
            if (this.budgets && streamContext) {
                const stepsP = (result as unknown as { steps?: PromiseLike<StepResult<ToolSet>[]> }).steps;
                const steps = stepsP
                    ? await Promise.resolve(stepsP).catch(() => undefined)
                    : undefined;
                const breaches = steps ? budgetBreaches(this.budgets, steps) : [];
                if (breaches.length) {
                    streamContext.writer.writeGuardrail({
                        id: `budget-${Date.now().toString(36)}`,
                        stage: 'budget',
                        guardrail: 'budget',
                        action: 'exceeded',
                        message: `Run stopped: ${breaches.join(' and ')} exceeded.`,
                    });
                }
            }
            if (this.activeStreamContext === streamContext) {
                this.activeStreamContext = undefined;
            }
        }).catch(() => {
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
    ): Promise<AgentHarnessGenerateResult> {
        // Extract AgentHarness-specific options
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
        // Surface token usage on the state so the non-streaming route + the
        // Session.prompt() facade can persist it, matching the streaming path.
        // `totalUsage` is summed across steps; fall back to the last-step usage.
        const u = (result.totalUsage ?? result.usage) as
            | { inputTokens?: number; outputTokens?: number; totalTokens?: number }
            | undefined;
        const usage = {
            inputTokens: u?.inputTokens ?? 0,
            outputTokens: u?.outputTokens ?? 0,
            totalTokens: u?.totalTokens ?? (u?.inputTokens ?? 0) + (u?.outputTokens ?? 0),
        };
        return Object.assign(result, {
            toolErrors: toolErrors.length > 0 ? toolErrors : undefined,
            state: { messages: responseMessages, metadata: { usage } },
        }) as unknown as AgentHarnessGenerateResult;
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
     * Restorable compression of large content, delegated to the ContextManager.
     * Kept as a method so the tool wrapper / tests have a stable `this.`-hook;
     * the error side-effect is routed back into this agent's error log.
     */
    protected async compressLargeContent(messages: ModelMessage[]): Promise<ModelMessage[]> {
        return this.context.compressLargeContent(messages, (t, e, c) => this.logError(t, e, c));
    }

    /** Keep the conversation within the window (compress + last-resort truncate). */
    protected async pruneMessages(messages: ModelMessage[]): Promise<ModelMessage[]> {
        return this.context.prune(messages, (t, e, c) => this.logError(t, e, c));
    }

    /**
     * Convert UIMessage[] to ModelMessage[] using AI SDK's converter.
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
            console.log('[AgentHarness] Converted Messages:', JSON.stringify(modelMessages, null, 2));
        }
        return modelMessages;
    }
}
