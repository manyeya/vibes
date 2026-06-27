/**
 * Error log: failures the agent hit are tracked separately from the message
 * stream and never folded into summaries (the "Manus approach"), so the model
 * keeps seeing what went wrong and can avoid repeating it. These are pure
 * helpers over an `ErrorEntry[]` the agent owns; AgentHarness holds the array and
 * delegates the bookkeeping here.
 */

import type { ErrorEntry } from '../types';

/** How long an identical error is considered "the same recurrence" (ms). */
const DEDUPE_WINDOW_MS = 60_000;
/** Hard cap on retained entries, so the log can't grow unbounded. */
const MAX_ENTRIES = 20;

/**
 * Record an error into `log` (mutated in place). Identical errors (same
 * tool + message) seen within the dedupe window bump an occurrence count
 * instead of stacking duplicates; the log is capped to the most recent
 * {@link MAX_ENTRIES}.
 */
export function recordError(
    log: ErrorEntry[],
    toolName: string | undefined,
    error: string,
    context?: string,
): void {
    const existing = log.find(e =>
        e.error === error &&
        e.toolName === toolName &&
        Date.now() - new Date(e.timestamp).getTime() < DEDUPE_WINDOW_MS,
    );

    if (existing) {
        existing.occurrenceCount++;
        existing.timestamp = new Date().toISOString();
    } else {
        log.push({
            timestamp: new Date().toISOString(),
            toolName,
            error,
            context,
            occurrenceCount: 1,
        });
    }

    if (log.length > MAX_ENTRIES) {
        log.splice(0, log.length - MAX_ENTRIES);
    }

    if (process.env.DEBUG_VIBES) {
        console.error(`[AgentHarness] Error logged:`, { toolName, error, context });
    }
}

/**
 * The most relevant recent errors for the system prompt: the tail of the log,
 * ordered by recurrence count then recency, capped at `max`.
 */
export function getRecentErrors(log: ErrorEntry[], max: number): ErrorEntry[] {
    return log
        .slice(-max)
        .sort((a, b) => {
            if (b.occurrenceCount !== a.occurrenceCount) {
                return b.occurrenceCount - a.occurrenceCount;
            }
            return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        });
}

/**
 * Render recent errors as a "Do NOT Repeat These" system-prompt section so the
 * model learns from fresh failures without them being summarized away.
 */
export function formatRecentErrors(errors: ErrorEntry[]): string {
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
