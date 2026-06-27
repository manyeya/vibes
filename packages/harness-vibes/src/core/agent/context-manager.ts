import type { ModelMessage } from 'ai';
import {
    extractMessageContent,
    isErrorMessage,
    extractToolInfo,
    compressMessage,
} from './message-compression';

/** Payload for the live context-window gauge data part. */
export interface ContextUsagePayload {
    usedTokens: number;
    contextWindow: number;
    threshold: number;
    compressAt: number;
}

export interface ContextManagerConfig {
    contextWindow?: number;
    contextCompressionRatio?: number;
    compressionThreshold?: number;
    compressionGateRatio?: number;
}

/** Called when prune surfaces an error message, so it can be logged separately. */
export type LogError = (toolName: string | undefined, error: string, context?: string) => void;

/**
 * Context engineering for the harness: sizing, restorable compression, and
 * last-resort truncation that keep the conversation inside the model's window.
 *
 * It owns the window + ratios and the token math, but does NOT emit anything —
 * {@link gauge} returns a payload and the harness (which owns the stream writer)
 * decides whether to render it. Errors found during compression are handed back
 * via the injected {@link LogError} rather than swallowed.
 */
export class ContextManager {
    /** Model context window in tokens (token-based pruning). */
    contextWindow: number;
    /** Fraction of the window at which we start trimming context (0–1). */
    compressionRatio: number;
    /** Min characters a single payload must reach before in-place compression shrinks it. */
    compressionThreshold: number;
    /**
     * Fraction of the window the whole conversation must reach before per-message
     * compression runs at all. Below it, large reads are kept verbatim — so a big
     * file read in an otherwise-empty context isn't gutted. (0 = compress eagerly.)
     */
    compressionGateRatio: number;

    constructor(cfg: ContextManagerConfig = {}) {
        this.contextWindow = cfg.contextWindow ?? 128000;
        this.compressionRatio = cfg.contextCompressionRatio ?? 0.7;
        this.compressionThreshold = cfg.compressionThreshold ?? 3000;
        this.compressionGateRatio = cfg.compressionGateRatio ?? 0.7;
    }

    /** Update the window (and optionally the compression ratio); ignores invalid values. */
    setWindow(contextWindow: number, compressionRatio?: number): void {
        if (Number.isFinite(contextWindow) && contextWindow > 0) {
            this.contextWindow = contextWindow;
        }
        if (compressionRatio !== undefined && compressionRatio > 0 && compressionRatio <= 1) {
            this.compressionRatio = compressionRatio;
        }
    }

    /** Rough token estimate (chars/4) for a system prompt + message list. */
    estimateTokens(system: string, messages: ModelMessage[]): number {
        let chars = system.length;
        for (const m of messages) chars += extractMessageContent(m).length;
        return Math.round(chars / 4);
    }

    /** The gauge payload for a given occupancy, or `null` when there's nothing meaningful to show. */
    gauge(usedTokens: number): ContextUsagePayload | null {
        if (usedTokens <= 0 || this.contextWindow <= 0) return null;
        return {
            usedTokens,
            contextWindow: this.contextWindow,
            threshold: this.compressionRatio,
            compressAt: Math.round(this.contextWindow * this.compressionRatio),
        };
    }

    /**
     * Apply restorable compression to large content. User/system messages and
     * errors are never shrunk (errors are reported via {@link LogError} and kept
     * verbatim); oversized assistant/tool payloads are replaced with a reference
     * + preview. See `message-compression.ts` for the per-message mechanics.
     */
    async compressLargeContent(messages: ModelMessage[], logError: LogError): Promise<ModelMessage[]> {
        const compressed: ModelMessage[] = [];

        for (const msg of messages) {
            // NEVER compress user or system messages.
            if (msg.role === 'user' || msg.role === 'system') {
                compressed.push(msg);
                continue;
            }

            // NEVER compress errors — track them separately instead.
            if (isErrorMessage(msg)) {
                const { toolName } = extractToolInfo(msg);
                logError(toolName, extractMessageContent(msg), `Role: ${msg.role}`);
                compressed.push(msg);
                continue;
            }

            // Below the threshold: keep verbatim.
            if (extractMessageContent(msg).length < this.compressionThreshold) {
                compressed.push(msg);
                continue;
            }

            compressed.push(compressMessage(msg, this.compressionThreshold));
        }

        return compressed;
    }

    /**
     * Keep the conversation inside the window:
     *   1. Restorable compression of large tool outputs — but only once the whole
     *      conversation approaches the window (so a lone big read isn't gutted).
     *   2. A last-resort hard truncation near the very top of the window, so it
     *      doesn't pre-empt the SummarizationPlugin or trim short conversations.
     */
    async prune(messages: ModelMessage[], logError: LogError): Promise<ModelMessage[]> {
        const estimateTokens = (msgs: ModelMessage[]) =>
            msgs.reduce((acc, msg) => acc + extractMessageContent(msg).length, 0) / 4;

        const compressionFloor = this.contextWindow * this.compressionGateRatio;
        const compressed = estimateTokens(messages) >= compressionFloor
            ? await this.compressLargeContent(messages, logError)
            : messages;

        const emergencyCeiling = this.contextWindow * 0.95;
        if (estimateTokens(compressed) < emergencyCeiling) {
            return compressed;
        }

        // Over the ceiling: keep the most recent messages that fit in ~85% of the window.
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
            console.log(`[ContextManager] Emergency prune ${messages.length} → ${messagesToKeep.length} messages (>${Math.round(emergencyCeiling)} tok)`);
        }

        return messagesToKeep;
    }
}
