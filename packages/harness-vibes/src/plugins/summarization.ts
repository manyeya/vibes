import { generateText, type LanguageModel, type ModelMessage } from 'ai';
import { Plugin } from '../core/types';

export interface SummarizationConfig {
    /**
     * Soft cap on verbatim messages kept after summarization. The plugin
     * triggers once message count exceeds `maxContextMessages * 1.5`.
     */
    maxContextMessages?: number;
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

const DEFAULT_MAX_MESSAGES = 30;
const DEFAULT_PER_MESSAGE_CAP = 1200;

/**
 * Rolling-summary plugin. Hooks `prepareStep` and, when the conversation
 * grows past `maxContextMessages * 1.5`, summarises the oldest excess
 * messages into a synthetic system message that is prepended to the
 * conversation. The running summary is cached on the plugin instance so
 * a single agent run does not re-summarise content it has already covered.
 *
 * Pairs with `VibeAgent.pruneMessages` (which handles lossless compression
 * of large tool outputs). Configure the agent's `maxContextMessages` higher
 * than the plugin's so this summarisation triggers *before* the agent's
 * fallback truncation.
 */
export default class SummarizationPlugin implements Plugin {
    name = 'SummarizationPlugin';

    private currentSummary = '';
    private summarizedFingerprints = new Set<string>();
    private readonly maxContextMessages: number;
    private readonly perMessageCharCap: number;
    private readonly model: LanguageModel;

    constructor(model: LanguageModel, config: SummarizationConfig = {}) {
        this.model = config.summarizationModel ?? model;
        this.maxContextMessages = config.maxContextMessages ?? DEFAULT_MAX_MESSAGES;
        this.perMessageCharCap = config.perMessageCharCap ?? DEFAULT_PER_MESSAGE_CAP;
    }

    async prepareStep(options: {
        steps: any[];
        stepNumber: number;
        model: LanguageModel;
        messages: ModelMessage[];
        experimental_context?: unknown;
    }) {
        const messages = options.messages;
        const triggerThreshold = Math.floor(this.maxContextMessages * 1.5);

        if (messages.length <= triggerThreshold) {
            return this.maybePrependSummary(messages);
        }

        const keepN = this.maxContextMessages;
        const splitAt = messages.length - keepN;
        const oldest = messages.slice(0, splitAt);
        const recent = messages.slice(splitAt);

        const newOldies = oldest.filter(m => !this.summarizedFingerprints.has(this.fingerprint(m)));

        if (newOldies.length > 0) {
            try {
                const delta = await this.summarize(newOldies);
                this.currentSummary = this.currentSummary
                    ? `${this.currentSummary}\n\n${delta}`
                    : delta;
                for (const m of newOldies) {
                    this.summarizedFingerprints.add(this.fingerprint(m));
                }
            } catch (err) {
                // Summarisation is best-effort. On failure, fall through to
                // the trimmed-without-summary case so the conversation can
                // continue rather than fail the whole step.
                console.error('[SummarizationPlugin] summary call failed:', err);
            }
        }

        return this.maybePrependSummary(recent);
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
                if (part.type === 'text') return (part as { text?: string }).text ?? '';
                if (part.type === 'tool-call') {
                    const tc = part as { toolName?: string; input?: unknown };
                    return `[tool-call ${tc.toolName ?? ''}]`;
                }
                if (part.type === 'tool-result') {
                    const tr = part as { toolName?: string };
                    return `[tool-result ${tr.toolName ?? ''}]`;
                }
                return `[${part.type}]`;
            })
            .join('\n');
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
