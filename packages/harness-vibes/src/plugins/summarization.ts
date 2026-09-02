import { generateText, type LanguageModel, type ModelMessage } from 'ai';
import {
    PluginStreamContext,
    type DataStreamWriter,
    type VibesUIMessage,
} from '../core/types';
import type { VibesPlugin } from '../core/agent/plugin-api';

export interface SummarizationConfig {
    /** Model context window in tokens (default 128000). */
    contextWindow?: number;
    /**
     * Fraction of the context window at which summarization kicks in, 0–1
     * (default 0.7). Compression triggers once the conversation's estimated
     * tokens exceed `contextWindow * compressionRatio`.
     */
    compressionRatio?: number;
    /**
     * Optional override model for the summarization call. Defaults to the
     * agent's primary model. Pointing this at a cheaper model is recommended.
     */
    summarizationModel?: LanguageModel;
    /**
     * Maximum characters from each message included in the summarization
     * prompt. Bigger value = more faithful summary, more tokens spent.
     */
    perMessageCharCap?: number;
}

const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_COMPRESSION_RATIO = 0.7;
const DEFAULT_PER_MESSAGE_CAP = 1200;
// Above this fraction of the window the model gets a "wrap up" nudge. Set above
// the compaction ratio on purpose: it measures the EFFECTIVE (post-summary)
// payload, so it only fires when summarization can't pull the real context back
// under the line — not on every step once raw history is large.
const WARN_RATIO = 0.85;

/**
 * Rolling-summary plugin (token-based). Hooks `prepareTurn`, emits a live
 * context-usage gauge every step, and once the conversation's estimated tokens
 * pass `contextWindow * compressionRatio` (default 70%), summarises the oldest
 * messages into a synthetic system message prepended to the recent tail. The
 * running summary is cached so a run doesn't re-summarise covered content.
 *
 * Pairs with `AgentHarness.pruneMessages`, which does lossless large-tool-output
 * compression and only hard-truncates as a last resort near the very top of the
 * window — so this token-based summarisation is the primary mechanism and short
 * conversations are never trimmed by message count.
 */
export default class SummarizationPlugin implements VibesPlugin {
    name = 'SummarizationPlugin';

    private currentSummary = '';
    private summarizedFingerprints = new Set<string>();
    private contextWindow: number;
    private compressionRatio: number;
    private readonly perMessageCharCap: number;
    private readonly model: LanguageModel;
    /** Per-request model override (the UI's currently-selected model). */
    private modelOverride?: LanguageModel;
    private writer?: DataStreamWriter;
    /**
     * The user's standing answer for this session. Undefined means "ask before
     * compacting" — compaction is never performed without an explicit choice.
     * 'compact' is cleared after a failed attempt so a rate limit doesn't put
     * the run into a silent retry loop.
     */
    private decision?: 'compact' | 'continue';
    /** A prompt waiting to be surfaced + halted on (see checkpoint). */
    private pendingDecision?: {
        id: string;
        usedTokens: number;
        contextWindow: number;
        pct: number;
        reason: 'threshold' | 'compaction-failed';
        error?: string;
    };

    constructor(model: LanguageModel, config: SummarizationConfig = {}) {
        this.model = config.summarizationModel ?? model;
        this.contextWindow = config.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
        this.compressionRatio = config.compressionRatio ?? DEFAULT_COMPRESSION_RATIO;
        this.perMessageCharCap = config.perMessageCharCap ?? DEFAULT_PER_MESSAGE_CAP;
    }

    /** Follow the user's selected model instead of the build-time default.
     *  `undefined` reverts to the constructed model. */
    setModelOverride(model?: LanguageModel): void {
        this.modelOverride = model;
    }

    /** Rough token estimate (~4 chars/token). */
    private estimateTokens(messages: ModelMessage[]): number {
        let chars = 0;
        for (const m of messages) chars += this.extractText(m).length;
        return Math.round(chars / 4);
    }

    /**
     * Update the window/ratio that drive the compression threshold — called by
     * the agent when the UI swaps the active model mid-session. The live gauge
     * itself is emitted by AgentHarness from real provider token counts.
     */
    setContextWindow(contextWindow: number, compressionRatio?: number): void {
        if (Number.isFinite(contextWindow) && contextWindow > 0) {
            this.contextWindow = contextWindow;
        }
        if (compressionRatio !== undefined && compressionRatio > 0 && compressionRatio <= 1) {
            this.compressionRatio = compressionRatio;
        }
    }

    onStreamContextReady(context: PluginStreamContext) {
        this.writer = context.writer.withDefaults({ plugin: this.name });
    }

    async prepareTurn(options: {
        steps: any[];
        stepNumber: number;
        model: LanguageModel;
        messages: ModelMessage[];
        system?: string;
    }) {
        const messages = options.messages;
        // Estimate from the message list PLUS the system prompt to decide whether
        // to compress. The live UI gauge is emitted by AgentHarness from the
        // provider's real token counts (which include the system prompt + tool
        // schemas), so folding in the system prompt here keeps the trigger from
        // lagging far behind the gauge — otherwise the gauge can read "full"
        // while this estimate (messages only) stays under the threshold.
        const systemChars = options.system?.length ?? 0;
        const used = this.estimateTokens(messages) + Math.round(systemChars / 4);
        const compressAt = Math.round(this.contextWindow * this.compressionRatio);

        // Below the threshold → leave the conversation intact (just carry any
        // existing summary). This is the common case: no flow disruption.
        if (used <= compressAt) {
            return this.warnIfTight(this.maybePrependSummary(messages), messages, systemChars);
        }

        // Over threshold → keep the most recent messages that fit in ~60% of
        // the trigger budget verbatim, summarize everything older.
        const keepBudget = compressAt * 0.6;
        let acc = 0;
        let splitAt = 0;
        for (let i = messages.length - 1; i >= 0; i--) {
            acc += this.estimateTokens([messages[i]]);
            if (acc > keepBudget) {
                splitAt = i + 1;
                break;
            }
        }
        splitAt = Math.min(splitAt, messages.length - 1); // always keep ≥1 recent message
        const oldest = messages.slice(0, splitAt);
        const recent = messages.slice(splitAt);

        if (oldest.length === 0) {
            return this.warnIfTight(this.maybePrependSummary(messages), messages, systemChars);
        }

        // Over the threshold, but compaction is lossy AND costs a model call
        // that can fail (a rate limit here used to silently drop the
        // un-summarized messages). So it is never done unprompted: pause and
        // let the user choose. The full history is returned untouched meanwhile.
        if (this.decision !== 'compact') {
            if (this.decision !== 'continue') {
                this.pendingDecision = {
                    id: `ctx-${Date.now().toString(36)}`,
                    usedTokens: used,
                    contextWindow: this.contextWindow,
                    pct: Math.round((used / this.contextWindow) * 100),
                    reason: 'threshold',
                };
            }
            // 'continue' means the user accepted an uncompacted context; keep
            // the whole history and just nudge the model to wrap up.
            return this.warnIfTight(this.maybePrependSummary(messages), messages, systemChars);
        }

        const newOldies = oldest.filter(m => !this.summarizedFingerprints.has(this.fingerprint(m)));

        if (newOldies.length > 0) {
            this.writer?.writeSummarization('in_progress', messages.length, recent.length);
            try {
                const delta = await this.summarize(newOldies);
                this.currentSummary = this.currentSummary
                    ? `${this.currentSummary}\n\n${delta}`
                    : delta;
                for (const m of newOldies) {
                    this.summarizedFingerprints.add(this.fingerprint(m));
                }
                this.writer?.writeSummarization('complete', messages.length, recent.length, newOldies.length);
            } catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                this.writer?.writeSummarization('failed', messages.length, recent.length, undefined, error);
                console.error('[SummarizationPlugin] summary call failed:', err);
                // Do NOT fall through to the trimmed tail: that dropped the
                // oldest messages with no summary standing in for them, losing
                // real context on a transient rate limit. Keep everything and
                // halt so the user can retry or continue deliberately.
                this.decision = undefined;
                this.pendingDecision = {
                    id: `ctx-${Date.now().toString(36)}`,
                    usedTokens: used,
                    contextWindow: this.contextWindow,
                    pct: Math.round((used / this.contextWindow) * 100),
                    reason: 'compaction-failed',
                    error,
                };
                return this.warnIfTight(this.maybePrependSummary(messages), messages, systemChars);
            }
        }

        return this.warnIfTight(this.maybePrependSummary(recent), recent, systemChars);
    }

    /**
     * Halt the run when a context decision is outstanding, emitting the prompt
     * the UI pins above the composer. Called by the agent after each step.
     */
    checkpoint(): 'context-threshold' | null {
        if (!this.pendingDecision) return null;
        this.writer?.writeContextDecision(this.pendingDecision);
        this.pendingDecision = undefined;
        return 'context-threshold';
    }

    /**
     * Record the user's answer to a context prompt. 'compact' summarizes on the
     * next turn; 'continue' keeps the full history for the rest of the session.
     */
    setContextDecision(decision: 'compact' | 'continue' | undefined): void {
        this.decision = decision;
    }

    /**
     * Prepend a one-line "context nearly full" reminder when the payload we're
     * about to send (summary + tail + system) crosses {@link WARN_RATIO} of the
     * window, nudging the model to write results to files and wrap up before
     * older turns get summarized away or hard-truncated. Measures the effective
     * messages, so it stays quiet whenever summarization is holding the line.
     */
    private warnIfTight(
        result: { messages: ModelMessage[] } | undefined,
        fallback: ModelMessage[],
        systemChars: number,
    ) {
        const messages = result?.messages ?? fallback;
        const effective = this.estimateTokens(messages) + Math.round(systemChars / 4);
        if (effective < Math.round(this.contextWindow * WARN_RATIO)) return result;
        const pct = Math.round((effective / this.contextWindow) * 100);
        const warn: ModelMessage = {
            role: 'system',
            content:
                `# Context nearly full (~${pct}% of ${this.contextWindow.toLocaleString()} tokens)\n` +
                'Wrap up now: save any in-progress work to files and give your final answer. ' +
                'Older messages will be summarized or dropped if the conversation keeps growing.',
        };
        return { messages: [warn, ...messages] };
    }

    private maybePrependSummary(messages: ModelMessage[]) {
        if (!this.currentSummary) return undefined;
        const summaryMsg: ModelMessage = {
            role: 'system',
            content: `# Earlier conversation summary\n\n${this.currentSummary}`,
        };
        return { messages: [summaryMsg, ...messages] };
    }

    /**
     * Stable per-message identity. AI SDK's ResponseMessage does not carry an
     * `id`, so we hash by role + a content prefix. Collisions across truly
     * different messages with the same prefix are rare in practice and
     * benign (we'd just skip a re-summarisation).
     */
    private fingerprint(message: ModelMessage): string {
        const text = this.extractText(message).slice(0, 200);
        return `${message.role}::${text}`;
    }

    private extractText(message: ModelMessage): string {
        if (typeof message.content === 'string') return message.content;
        if (!Array.isArray(message.content)) return '';
        return message.content
            .map(part => {
                if (part.type === 'text' || part.type === 'reasoning') {
                    return (part as { text?: string }).text ?? '';
                }
                // Include the actual tool input/output payloads. In an agentic
                // loop these dominate the context (file contents, command
                // output), so counting only a `[tool-result name]` placeholder
                // made the token estimate — and the compression trigger — wildly
                // undercount.
                if (part.type === 'tool-call') {
                    const tc = part as { toolName?: string; input?: unknown };
                    return `[tool-call ${tc.toolName ?? ''}] ${this.stringifyPayload(tc.input)}`;
                }
                if (part.type === 'tool-result') {
                    const tr = part as { toolName?: string; output?: unknown };
                    return `[tool-result ${tr.toolName ?? ''}] ${this.stringifyPayload(tr.output)}`;
                }
                return `[${part.type}]`;
            })
            .join('\n');
    }

    /** Best-effort string form of a tool input/output, for token estimation. */
    private stringifyPayload(value: unknown): string {
        if (value == null) return '';
        if (typeof value === 'string') return value;
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }

    private async summarize(messages: ModelMessage[]): Promise<string> {
        const formatted = messages
            .map((m, i) => {
                const role = m.role;
                const text = this.extractText(m);
                const capped = text.length > this.perMessageCharCap
                    ? `${text.slice(0, this.perMessageCharCap)}…[truncated]`
                    : text;
                return `[${i + 1}] ${role}:\n${capped}`;
            })
            .join('\n\n---\n\n');

        const result = await generateText({
            model: this.modelOverride ?? this.model,
            prompt:
                `Summarise the following agent conversation history concisely. ` +
                `Preserve concrete facts, decisions, unresolved questions, file paths, ` +
                `and tool outcomes. Use short bullet points. Do not editorialise or ` +
                `add preamble — output the summary only.\n\n${formatted}`,
        });
        return result.text.trim();
    }
}
