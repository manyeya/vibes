import { generateText, type LanguageModel, type ModelMessage, type UIMessageStreamWriter } from 'ai';
import {
    Plugin,
    PluginStreamContext,
    createDataStreamWriter,
    type DataStreamWriter,
    type VibesUIMessage,
} from '../core/types';

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
 * Rolling-summary plugin (token-based). Hooks `prepareStep`, emits a live
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
export default class SummarizationPlugin implements Plugin {
    name = 'SummarizationPlugin';

    private currentSummary = '';
    private summarizedFingerprints = new Set<string>();
    private contextWindow: number;
    private compressionRatio: number;
    private readonly perMessageCharCap: number;
    private readonly model: LanguageModel;
    private writer?: DataStreamWriter;

    constructor(model: LanguageModel, config: SummarizationConfig = {}) {
        this.model = config.summarizationModel ?? model;
        this.contextWindow = config.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
        this.compressionRatio = config.compressionRatio ?? DEFAULT_COMPRESSION_RATIO;
        this.perMessageCharCap = config.perMessageCharCap ?? DEFAULT_PER_MESSAGE_CAP;
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

    onStreamReady(writer: UIMessageStreamWriter<VibesUIMessage>) {
        this.writer = createDataStreamWriter(writer).withDefaults({ plugin: this.name });
    }

    async prepareStep(options: {
        steps: any[];
        stepNumber: number;
        model: LanguageModel;
        messages: ModelMessage[];
        system?: string;
        experimental_context?: unknown;
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
                this.writer?.writeSummarization('failed', messages.length, recent.length, undefined,
                    err instanceof Error ? err.message : String(err));
                // Summarisation is best-effort. On failure, fall through to
                // the trimmed-without-summary case so the conversation can
                // continue rather than fail the whole step.
                console.error('[SummarizationPlugin] summary call failed:', err);
            }
        }

        return this.warnIfTight(this.maybePrependSummary(recent), recent, systemChars);
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
            model: this.model,
            prompt:
                `Summarise the following agent conversation history concisely. ` +
                `Preserve concrete facts, decisions, unresolved questions, file paths, ` +
                `and tool outcomes. Use short bullet points. Do not editorialise or ` +
                `add preamble — output the summary only.\n\n${formatted}`,
        });
        return result.text.trim();
    }
}
