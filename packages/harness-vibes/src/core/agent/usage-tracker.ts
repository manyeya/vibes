import type { StepResult, ToolSet } from 'ai';

export interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
}

/**
 * Per-stream token accounting. Owns the running spend for one stream; the
 * harness folds each finished step in via {@link record} and drains the total
 * with {@link consume} when the stream ends.
 *
 * Two numbers come out of a step's `usage`:
 *   - **Cumulative spend** (`consume()`): summed across every step, matching what
 *     the provider bills — each step re-sends the growing context.
 *   - **Context fullness** (the value {@link record} returns): the *latest* step's
 *     input + output, i.e. how full the window is right now. The harness feeds
 *     that into the live gauge.
 *
 * Deliberately knows nothing about the stream writer or the context window —
 * the harness owns those and decides whether/how to render the gauge.
 */
export class UsageTracker {
    private running: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

    /**
     * Fold a finished step into the running total and return the token count to
     * display on the gauge, or `null` when there's nothing to show.
     *
     * @param fallbackEstimate used when the provider omits usage entirely (some
     *   OpenRouter models do) so neither spend nor the gauge silently sticks at 0.
     */
    record(step: Pick<StepResult<ToolSet>, 'usage'>, fallbackEstimate: number): number | null {
        const u = step.usage;
        const inputTokens = u?.inputTokens ?? 0;
        const outputTokens = u?.outputTokens ?? 0;
        // Some providers report input/output but omit a combined total; derive it.
        const totalTokens = u?.totalTokens ?? inputTokens + outputTokens;

        if (inputTokens > 0 || outputTokens > 0) {
            this.running.inputTokens += inputTokens;
            this.running.outputTokens += outputTokens;
            this.running.totalTokens += totalTokens;
            return inputTokens + outputTokens;
        }
        if (fallbackEstimate > 0) {
            this.running.inputTokens += fallbackEstimate;
            this.running.totalTokens += fallbackEstimate;
            return fallbackEstimate;
        }
        return null;
    }

    /** Return the accumulated usage and reset for the next stream. */
    consume(): TokenUsage {
        const usage = { ...this.running };
        this.running = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
        return usage;
    }
}
