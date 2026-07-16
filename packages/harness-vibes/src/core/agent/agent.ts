/**
 * VibesAgent — the owned-loop agent.
 *
 * Implements the AI SDK `Agent` (`version: 'agent-v1'`) contract on top of our
 * own `runAgentLoop` instead of extending `ToolLoopAgent`. It re-hosts exactly
 * what `AgentHarness` owned — once-per-run system assembly, per-turn error
 * overlay + plugin fan-out, the context gauge, usage tracking, adaptive
 * reasoning, the run-wide retry budget, model override, budget/loop breach
 * notices — and delegates the loop mechanics to `loop.ts` + `llm.ts`.
 *
 * Result typing: we run N `streamText` calls per run, so we can't return a
 * genuine `StreamTextResult`/`GenerateTextResult`. We expose the structural
 * subsets the edges actually use ({@link VibesStreamResult} /
 * {@link VibesGenerateResult}) and `asAgent()` for the one place a real `Agent`
 * type is required.
 */

import type {
    Agent,
    LanguageModel,
    ModelMessage,
    StopCondition,
    ToolSet,
    UIMessage,
    UIMessageChunk,
} from 'ai';
import { ContextManager } from './context-manager';
import { UsageTracker, type TokenUsage } from './usage-tracker';
import { ToolRegistry } from './tool-registry';
import { recordError, getRecentErrors, formatRecentErrors } from './error-log';
import { resolveBudgetStops, budgetBreaches, type BudgetConfig } from './budgets';
import { resolveLoopStops, loopBreaches, type LoopDetectionConfig } from './loop-detection';
import { classifyComplexity, reasoningProviderOptions, type AdaptiveReasoningConfig } from './reasoning';
import {
    createPluginStreamContext,
    type VibesAgentConfig,
    type AgentState,
    type ErrorEntry,
    type Plugin,
    type PluginStreamContext,
} from '../types';
import type { VibesPlugin } from './plugin-api';
import type { LoopStep, ModelStreamPart, StepUsage, StopPredicate, StopReason } from './loop-events';
import { runAgentLoop, type ResolvedTurn } from './loop';
import { streamModelStep } from './llm';
import { toModelMessages, lastUserText } from './messages';
import { createUIChunkAdapter } from './ui-stream';

const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

// The config type lives in ../types (VibesAgentConfig); re-exported so callers
// importing from the agent module keep working.
export type { VibesAgentConfig };

/** Non-streaming result. The subset {@link Session.prompt} + the /vibe route read. */
export interface VibesGenerateResult {
    text: string;
    steps: LoopStep[];
    usage: TokenUsage;
    totalUsage: TokenUsage;
    response: { messages: ModelMessage[] };
    state: AgentState;
    stopReason: StopReason;
}

/** Streaming result. The subset `createAgentStreamResponse` + SubAgentPlugin read. */
export interface VibesStreamResult {
    /** The UI-message chunk stream to hand to `writer.merge(...)`. */
    toUIMessageStream(): ReadableStream<UIMessageChunk>;
    /** Resolves with the run's new messages once it settles (for persistence). */
    readonly response: Promise<{ messages: ModelMessage[] }>;
    /** Summed token usage across every step. */
    readonly totalUsage: Promise<TokenUsage>;
    /** Final assistant text. */
    readonly text: Promise<string>;
    /** All completed steps. */
    readonly steps: Promise<LoopStep[]>;
    /** Raw model stream parts (SubAgentPlugin forwards these live). */
    readonly fullStream: ReadableStream<ModelStreamPart>;
}

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
}
function defer<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
}

export class VibesAgent {
    readonly version = 'agent-v1' as const;
    // Required (not optional) to match the AI SDK `Agent.id: string | undefined`.
    readonly id: string | undefined;

    protected plugins: VibesPlugin[] = [];
    protected model: LanguageModel;
    protected instructions: string;
    protected customSystemPrompt: string;
    protected temperature?: number;
    protected maxSteps: number;
    protected emitContextGauge: boolean;
    protected modelOverride?: LanguageModel;
    protected haltOnToolCall: Set<string>;
    protected telemetry?: unknown;

    protected errorLog: ErrorEntry[] = [];
    protected maxRecentErrors = 5;

    protected context: ContextManager;
    protected usage = new UsageTracker();
    protected toolRegistry: ToolRegistry;

    protected activeStreamContext?: PluginStreamContext;
    protected budgets?: BudgetConfig;
    protected loopDetection?: LoopDetectionConfig;
    protected userStopWhen?: StopCondition<ToolSet> | StopCondition<ToolSet>[];
    protected adaptiveReasoning?: AdaptiveReasoningConfig;

    protected maxTotalRetries: number;
    protected retriesUsed = 0;
    protected lastContextEstimate = 0;

    protected get contextWindow(): number { return this.context.contextWindow; }
    protected get contextCompressionRatio(): number { return this.context.compressionRatio; }

    constructor(config: VibesAgentConfig) {
        this.id = config.id;
        this.model = config.model;
        this.instructions = config.instructions;
        this.customSystemPrompt = config.systemPrompt || '';
        this.temperature = config.temperature;
        this.maxSteps = config.maxSteps ?? 20;
        this.emitContextGauge = config.emitContextGauge ?? true;
        this.haltOnToolCall = new Set(config.haltOnToolCall ?? []);
        this.budgets = config.budgets;
        this.loopDetection = config.loopDetection;
        this.userStopWhen = config.stopWhen;
        this.maxTotalRetries = config.toolRetry?.maxTotalRetries ?? 20;
        this.adaptiveReasoning = config.adaptiveReasoning === true
            ? {}
            : (config.adaptiveReasoning || undefined);
        this.telemetry = config.enableTelemetry
            ? { isEnabled: true, functionId: config.name ?? 'vibe-agent' }
            : undefined;

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

        if (config.plugins) this.addPlugin(config.plugins);
        void this.preloadTools();
    }

    // ── public surface ───────────────────────────────────────────────────

    get tools(): ToolSet {
        return this.toolRegistry.cached as ToolSet;
    }

    addPlugin(plugin: VibesPlugin | Plugin | Array<VibesPlugin | Plugin>): void {
        const list = (Array.isArray(plugin) ? plugin : [plugin]) as VibesPlugin[];
        this.plugins.push(...list);
        this.toolRegistry.invalidate();
    }

    setModelOverride(model?: LanguageModel): void {
        this.modelOverride = model;
    }

    setContextWindow(contextWindow: number, compressionRatio?: number): void {
        this.context.setWindow(contextWindow, compressionRatio);
        for (const plugin of this.plugins) {
            const p = plugin as { setContextWindow?: (w: number, r?: number) => void };
            p.setContextWindow?.(this.context.contextWindow, this.context.compressionRatio);
        }
    }

    setSearchProviderPreference(provider?: string): void {
        for (const plugin of this.plugins) {
            const p = plugin as { setProviderPreference?: (id?: string) => void };
            p.setProviderPreference?.(provider);
        }
    }

    consumeLastStreamUsage(): TokenUsage {
        return this.usage.consume();
    }

    /** The one boundary cast to the AI SDK `Agent` contract. */
    asAgent(): Agent<never, ToolSet> {
        return this as unknown as Agent<never, ToolSet>;
    }

    // ── streaming ──────────────────────────────────────────────────────────

    async stream(options?: {
        messages?: UIMessage[] | ModelMessage[];
        writer?: PluginStreamContext['rawWriter'];
        abortSignal?: AbortSignal;
    }): Promise<VibesStreamResult> {
        this.retriesUsed = 0;
        const { messages, writer, abortSignal } = options ?? {};

        const modelMessages = messages ? await toModelMessages(messages, () => this.getAllTools()) : [];
        const streamContext = writer ? createPluginStreamContext(writer) : undefined;
        this.activeStreamContext = streamContext;
        if (streamContext) {
            for (const plugin of this.plugins) {
                plugin.onStreamContextReady?.(streamContext);
            }
        }

        const instructions = await this.assembleInstructions();
        const tools = await this.getAllTools();
        const ui = createUIChunkAdapter({ messageId: crypto.randomUUID(), tools });

        let fullController: ReadableStreamDefaultController<ModelStreamPart> | undefined;
        const fullStream = new ReadableStream<ModelStreamPart>({ start(c) { fullController = c; } });

        const responseD = defer<{ messages: ModelMessage[] }>();
        const usageD = defer<TokenUsage>();
        const textD = defer<string>();
        const stepsD = defer<LoopStep[]>();

        void (async () => {
            try {
                const result = await runAgentLoop({
                    model: this.model,
                    instructions,
                    messages: modelMessages,
                    tools,
                    temperature: this.temperature,
                    maxSteps: this.maxSteps,
                    stopWhen: this.resolveStopPredicates(),
                    haltOnToolCall: this.haltOnToolCall,
                    telemetry: this.telemetry,
                    abortSignal,
                    transformContext: (m) => this.pruneMessages(m),
                    prepareTurn: this.makePrepareTurn(instructions),
                    onStepFinish: (s) => this.recordStepUsage(s),
                    onModelPart: (part) => { ui.handlePart(part); fullController?.enqueue(part); },
                }, streamModelStep);

                await this.runStreamFinishHooks(result.text, result.responseMessages, result.steps);
                this.emitBreachNotices(result.steps, streamContext);

                responseD.resolve({ messages: result.responseMessages });
                usageD.resolve(sumUsage(result.steps));
                textD.resolve(result.text);
                stepsD.resolve(result.steps);
            } catch (err) {
                ui.error(err instanceof Error ? err.message : String(err));
                responseD.resolve({ messages: [] });
                usageD.resolve(ZERO_USAGE);
                textD.resolve('');
                stepsD.resolve([]);
            } finally {
                ui.finish();
                try { fullController?.close(); } catch { /* already closed */ }
                if (this.activeStreamContext === streamContext) this.activeStreamContext = undefined;
            }
        })();

        return {
            toUIMessageStream: () => ui.stream,
            response: responseD.promise,
            totalUsage: usageD.promise,
            text: textD.promise,
            steps: stepsD.promise,
            fullStream,
        };
    }

    // ── non-streaming ───────────────────────────────────────────────────────

    async generate(options?: {
        messages?: UIMessage[] | ModelMessage[];
        abortSignal?: AbortSignal;
    }): Promise<VibesGenerateResult> {
        this.retriesUsed = 0;
        const { messages, abortSignal } = options ?? {};
        this.activeStreamContext = undefined;

        const modelMessages = messages ? await toModelMessages(messages, () => this.getAllTools()) : [];
        const instructions = await this.assembleInstructions();
        const tools = await this.getAllTools();

        const result = await runAgentLoop({
            model: this.model,
            instructions,
            messages: modelMessages,
            tools,
            temperature: this.temperature,
            maxSteps: this.maxSteps,
            stopWhen: this.resolveStopPredicates(),
            haltOnToolCall: this.haltOnToolCall,
            telemetry: this.telemetry,
            abortSignal,
            transformContext: (m) => this.pruneMessages(m),
            prepareTurn: this.makePrepareTurn(instructions),
            onStepFinish: (s) => this.recordStepUsage(s),
        }, streamModelStep);

        this.usage.consume(); // reset the per-run tally
        const usage = sumUsage(result.steps);
        return {
            text: result.text,
            steps: result.steps,
            usage,
            totalUsage: usage,
            response: { messages: result.responseMessages },
            state: { messages: result.responseMessages, metadata: { usage } },
            stopReason: result.stopReason,
        };
    }

    // ── internals ────────────────────────────────────────────────────────

    protected async preloadTools(): Promise<void> {
        await this.getAllTools();
    }

    protected getAllTools(allowedTools?: string[]): Promise<ToolSet> {
        return this.toolRegistry.build(
            this.plugins,
            {
                getStreamContext: () => this.activeStreamContext,
                logError: (t, e, c) => this.logError(t, e, c),
                consumeRetry: () => this.consumeRetry(),
            },
            allowedTools,
        ) as Promise<ToolSet>;
    }

    protected consumeRetry(): boolean {
        if (this.retriesUsed >= this.maxTotalRetries) return false;
        this.retriesUsed++;
        return true;
    }

    protected logError(toolName: string | undefined, error: string, context?: string): void {
        recordError(this.errorLog, toolName, error, context);
    }

    protected pruneMessages(messages: ModelMessage[]): Promise<ModelMessage[]> {
        return this.context.prune(messages, (t, e, c) => this.logError(t, e, c));
    }

    /** Restorable compression of large content; errors route to the error log. */
    protected compressLargeContent(messages: ModelMessage[]): Promise<ModelMessage[]> {
        return this.context.compressLargeContent(messages, (t, e, c) => this.logError(t, e, c));
    }

    /** Rough token estimate (chars/4) for a system prompt + message list. */
    protected estimateContextTokens(system: string, messages: ModelMessage[]): number {
        return this.context.estimateTokens(system, messages);
    }

    /** Assemble the stable system prompt once per run (KV-cache prefix). */
    protected async assembleInstructions(): Promise<string> {
        let instructions = this.instructions;
        for (const plugin of this.plugins) {
            if (plugin.modifySystemPrompt) {
                const r = plugin.modifySystemPrompt(instructions);
                instructions = r instanceof Promise ? await r : r;
            }
        }
        if (this.customSystemPrompt) {
            instructions += `\n\n## Custom Instructions\n${this.customSystemPrompt} `;
        }
        const environment = this.getEnvironmentContext();
        if (environment) instructions += `\n\n${environment}`;
        return instructions;
    }

    /** Volatile date/time tail — appended LAST so the prefix stays cacheable. */
    protected getEnvironmentContext(): string {
        const now = new Date();
        const human = now.toLocaleString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
        });
        return [
            '<environment>',
            `Current date and time: ${human} (${now.toISOString()}).`,
            'Treat this as the present moment, not your training cutoff. For anything time-sensitive or recent, rely on this date and your available tools rather than assumptions about what is current.',
            '</environment>',
        ].join('\n');
    }

    /**
     * Build the per-turn resolver: overlay recent errors, write the pre-call
     * gauge, fan out to each plugin`s `prepareTurn` and merge, then apply the
     * model override + adaptive reasoning.
     */
    protected makePrepareTurn(baseInstructions: string) {
        return async (opts: {
            steps: LoopStep[];
            stepNumber: number;
            model: LanguageModel;
            system: string;
            messages: ModelMessage[];
        }): Promise<ResolvedTurn> => {
            const recentErrors = getRecentErrors(this.errorLog, this.maxRecentErrors);
            const overlaidSystem = recentErrors.length > 0
                ? `${baseInstructions}\n\n${formatRecentErrors(recentErrors)}`
                : baseInstructions;

            // Proactive gauge, BEFORE the model call, from the prepared context.
            this.lastContextEstimate = this.context.estimateTokens(overlaidSystem, opts.messages);
            this.writeContextGauge(this.lastContextEstimate);

            let mergedSystem = overlaidSystem;
            let mergedModel = this.modelOverride ?? opts.model;
            let mergedMessages = opts.messages;
            let toolChoice: unknown;
            let providerOptions: Record<string, unknown> | undefined;
            let activeToolsSet: Set<string> | undefined;

            for (const plugin of this.plugins) {
                const res = await plugin.prepareTurn?.({
                    steps: opts.steps,
                    stepNumber: opts.stepNumber,
                    model: mergedModel,
                    messages: mergedMessages,
                    system: mergedSystem,
                });
                if (!res) continue;
                if (res.model !== undefined) mergedModel = res.model;
                if (res.toolChoice !== undefined) toolChoice = res.toolChoice;
                if (res.system !== undefined) mergedSystem = res.system;
                if (res.messages !== undefined) mergedMessages = res.messages;
                if (res.providerOptions !== undefined) providerOptions = res.providerOptions;
                if (Array.isArray(res.activeTools)) {
                    const incoming = new Set(res.activeTools);
                    activeToolsSet = activeToolsSet
                        ? new Set([...activeToolsSet].filter((n) => incoming.has(n)))
                        : incoming;
                }
            }

            const reasoning = this.resolveReasoningEffort(mergedMessages);
            if (reasoning) providerOptions = { ...(providerOptions ?? {}), ...reasoning };

            return {
                system: mergedSystem,
                model: mergedModel,
                messages: mergedMessages,
                ...(activeToolsSet ? { activeTools: Array.from(activeToolsSet) } : {}),
                ...(toolChoice !== undefined ? { toolChoice: toolChoice as ResolvedTurn['toolChoice'] } : {}),
                ...(providerOptions ? { providerOptions } : {}),
            };
        };
    }

    protected resolveReasoningEffort(messages: ModelMessage[]): Record<string, unknown> | undefined {
        if (!this.adaptiveReasoning) return undefined;
        const hasRecentError = this.errorLog.some(
            (e) => Date.now() - new Date(e.timestamp).getTime() < 120_000,
        );
        const tier = classifyComplexity(lastUserText(messages), hasRecentError);
        return reasoningProviderOptions(tier, this.adaptiveReasoning);
    }

    protected recordStepUsage(step: LoopStep): void {
        // UsageTracker reads `usage?.inputTokens ?? 0`, so an absent usage is
        // safe; `{}` satisfies the (all-optional) LanguageModelUsage shape.
        const used = this.usage.record({ usage: step.usage as StepUsage }, this.lastContextEstimate);
        if (used !== null) this.writeContextGauge(used);
    }

    protected writeContextGauge(usedTokens: number): void {
        if (!this.emitContextGauge) return;
        const writer = this.activeStreamContext?.writer;
        if (!writer) return;
        const payload = this.context.gauge(usedTokens);
        if (payload) writer.writeContextUsage(payload);
    }

    /**
     * Budget / loop-detection / user stop conditions as {@link StopPredicate}s.
     * ponytail: budgets.ts / loop-detection.ts still return the SDK's
     * `StopCondition<ToolSet>`; the cast is safe (they only read `usage` /
     * `toolCalls`, which `LoopStep` has). Retype them in Phase 5.
     */
    protected resolveStopPredicates(): StopPredicate[] {
        const stops: StopPredicate[] = [];
        if (this.userStopWhen) {
            const arr = Array.isArray(this.userStopWhen) ? this.userStopWhen : [this.userStopWhen];
            stops.push(...(arr as unknown as StopPredicate[]));
        }
        if (this.budgets) stops.push(...(resolveBudgetStops(this.budgets) as unknown as StopPredicate[]));
        if (this.loopDetection) stops.push(...(resolveLoopStops(this.loopDetection) as unknown as StopPredicate[]));
        return stops;
    }

    private async runStreamFinishHooks(text: string, messages: ModelMessage[], steps: LoopStep[]): Promise<void> {
        const finishResult = { text, response: { messages }, steps };
        for (const plugin of this.plugins) {
            if (plugin.onStreamFinish) await plugin.onStreamFinish(finishResult);
        }
    }

    /** Surface a human-readable notice when a budget / loop cap halted the run. */
    private emitBreachNotices(steps: LoopStep[], ctx?: PluginStreamContext): void {
        if (!ctx || (!this.budgets && !this.loopDetection)) return;
        const stepsForCheck = steps as unknown as Parameters<typeof budgetBreaches>[1];
        if (this.budgets) {
            const breaches = budgetBreaches(this.budgets, stepsForCheck);
            if (breaches.length) {
                ctx.writer.writeGuardrail({
                    id: `budget-${Date.now().toString(36)}`,
                    stage: 'budget', guardrail: 'budget', action: 'exceeded',
                    message: `Run stopped: ${breaches.join(' and ')} exceeded.`,
                });
            }
        }
        if (this.loopDetection) {
            const loops = loopBreaches(this.loopDetection, stepsForCheck);
            if (loops.length) {
                const unique = Array.from(new Set(loops));
                ctx.writer.writeGuardrail({
                    id: `loop-${Date.now().toString(36)}`,
                    stage: 'budget', guardrail: 'loop', action: 'exceeded',
                    message: `Run stopped: repeated ${unique.join(', ')} call (possible loop).`,
                });
            }
        }
    }
}

/** Sum token usage across steps (matches the SDK's `totalUsage` aggregation). */
function sumUsage(steps: LoopStep[]): TokenUsage {
    let inputTokens = 0, outputTokens = 0, totalTokens = 0;
    for (const s of steps) {
        const u = s.usage;
        inputTokens += u?.inputTokens ?? 0;
        outputTokens += u?.outputTokens ?? 0;
        totalTokens += u?.totalTokens ?? (u?.inputTokens ?? 0) + (u?.outputTokens ?? 0);
    }
    return { inputTokens, outputTokens, totalTokens: totalTokens || inputTokens + outputTokens };
}

// Compile-time guard: VibesAgent structurally satisfies the parts of the AI SDK
// Agent contract we fully implement (version / id / tools). generate/stream
// return narrower shapes, so `asAgent()` holds the sole runtime cast.
type _AgentShape = Pick<Agent<never, ToolSet>, 'version' | 'id' | 'tools'>;
const _assertAgentShape = (a: VibesAgent): _AgentShape => a;
void _assertAgentShape;
