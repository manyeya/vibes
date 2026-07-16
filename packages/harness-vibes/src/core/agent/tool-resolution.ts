/**
 * Tool resolution: turning the plugin/custom tool catalog into the runtime tool
 * set the model loop calls.
 *
 * AgentHarness owns the catalog assembly + cache (it's part of understanding the
 * loop); this module holds the self-contained pieces that orchestration would
 * otherwise bury — per-call approval policy, and the retry + activity-stream
 * instrumentation wrapper each tool's `execute` runs inside.
 */

import type {
    Plugin,
    PluginStreamContext,
    ToolsRequiringApprovalConfig,
    ToolApprovalPolicy,
    DataStreamOperation,
} from '../types';
import { redactSecrets } from '../redact';

/**
 * Turn a tool's return value into a short, human-readable completion line for
 * the activity feed (e.g. "12 results", "Wrote src/app.ts"). Plugins that
 * self-instrument set their own richer message; this is the fallback the
 * auto-instrumentation wrapper uses for tools that don't, so the feed shows
 * what happened instead of a generic "<tool> complete". Returns undefined when
 * nothing meaningful can be derived.
 */
export function summarizeToolResult(result: unknown): string | undefined {
    if (result == null) return undefined;

    if (typeof result === 'string') {
        const line = result.trim().split('\n')[0]?.trim();
        if (!line) return undefined;
        return line.length > 80 ? `${line.slice(0, 79)}…` : line;
    }

    if (typeof result !== 'object') return undefined;
    const r = result as Record<string, unknown>;

    // Collections — surface the count ("8 files", "3 results").
    for (const [key, noun] of [
        ['files', 'file'],
        ['results', 'result'],
        ['matches', 'match'],
        ['items', 'item'],
        ['entries', 'entry'],
    ] as const) {
        const value = r[key];
        if (Array.isArray(value)) {
            const plural = noun === 'match' ? 'matches' : noun === 'entry' ? 'entries' : `${noun}s`;
            return `${value.length} ${value.length === 1 ? noun : plural}`;
        }
    }

    if (typeof r.savedTo === 'string') return `Wrote ${r.savedTo}`;
    if (typeof r.path === 'string' && r.path.length <= 80) return r.path;
    if (typeof r.summary === 'string' && r.summary.trim()) return r.summary.trim().split('\n')[0];
    if (typeof r.message === 'string' && r.message.trim()) return r.message.trim().split('\n')[0];
    if (typeof r.count === 'number') return `${r.count} ${r.count === 1 ? 'result' : 'results'}`;
    if (typeof r.content === 'string') {
        const len = r.content.length;
        return `${len} char${len === 1 ? '' : 's'}`;
    }

    return undefined;
}

/**
 * Resolve a tool's approval policy. Per-agent config (a name list or a name →
 * policy map) wins; otherwise the tool's own `needsApproval` applies. Predicate
 * functions are forwarded as-is so AI SDK can evaluate them per call —
 * collapsing one to `true` would force approval on every invocation and defeat
 * the predicate.
 */
export function resolveApprovalPolicy(
    approvalConfig: ToolsRequiringApprovalConfig,
    toolName: string,
    toolDefRecord: Record<string, unknown>,
): ToolApprovalPolicy | undefined {
    let resolved: ToolApprovalPolicy | undefined;
    if (Array.isArray(approvalConfig)) {
        if (approvalConfig.includes(toolName)) {
            resolved = true;
        }
    } else if (approvalConfig && typeof approvalConfig === 'object') {
        const policy = (approvalConfig as Record<string, ToolApprovalPolicy>)[toolName];
        if (policy !== undefined) {
            resolved = policy;
        }
    }
    if (resolved === undefined) {
        resolved = toolDefRecord.needsApproval as ToolApprovalPolicy | undefined;
    }
    return resolved;
}

/**
 * Whether a tool error is worth retrying. Transient = network / rate-limit /
 * timeout / 5xx — the kind that often succeeds on a second attempt. Deterministic
 * failures (validation, not-found, permission) are NOT retried: re-running burns
 * a backoff delay to reproduce the same error.
 *
 * ponytail: a conservative pattern + status-code check. Widen the pattern, or
 * switch to typed error codes, if it ever misclassifies.
 */
const TRANSIENT_ERROR_PATTERN =
    /rate.?limit|429|50[234]|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|socket hang up|fetch failed|network|overloaded|temporarily unavailable|timed? ?out/i;

export function isTransientError(error: unknown): boolean {
    if (error == null) return false;
    const e = error as { message?: unknown; code?: unknown; name?: unknown; statusCode?: unknown; status?: unknown };
    const status = typeof e.statusCode === 'number' ? e.statusCode
        : typeof e.status === 'number' ? e.status
            : undefined;
    if (status === 408 || status === 429 || (status !== undefined && status >= 500)) return true;
    const haystack = `${String(e.name ?? '')} ${String(e.code ?? '')} ${String(e.message ?? '')}`;
    return TRANSIENT_ERROR_PATTERN.test(haystack);
}

/** Everything one tool needs to run safely under retry + instrumentation. */
export interface ToolExecuteDeps {
    toolName: string;
    /** Plugin (or 'custom') that owns the tool — for attribution. */
    ownerName: string;
    originalExecute: (args: unknown, options: unknown) => Promise<unknown>;
    /** Live plugin list, for input/error lifecycle hooks. */
    plugins: Plugin[];
    maxRetries: number;
    /** Redact known secrets from the tool result before it's returned/streamed. */
    redactToolIO: boolean;
    /** Read lazily — the active stream context changes per run. */
    getStreamContext: () => PluginStreamContext | undefined;
    logError: (toolName: string | undefined, error: string, context?: string) => void;
    /**
     * Reserve one unit of the run-wide retry budget. Returns false once the
     * budget is exhausted, so a flaky tool can't keep retrying on every call
     * across a long run. Omitted = unbounded (per-call `maxRetries` still caps).
     */
    consumeRetry?: () => boolean;
}

/**
 * Wrap a tool's `execute` with the standard agent treatment: one activity-feed
 * operation per call (established as the "current" one so a self-instrumenting
 * plugin enriches the same row instead of duplicating it), retry with
 * exponential backoff, plugin input/error hooks, and error logging.
 */
export function wrapToolExecute(
    deps: ToolExecuteDeps,
): (args: unknown, options: unknown) => Promise<unknown> {
    const { toolName, ownerName, originalExecute, plugins, maxRetries, redactToolIO, getStreamContext, logError, consumeRetry } = deps;

    return async (args: unknown, options: unknown) => {
        // `operation` is undefined only when there's no active stream (e.g.
        // non-streaming generate).
        const runBody = async (operation?: DataStreamOperation): Promise<unknown> => {
            operation?.progress('starting', {
                phase: 'starting',
                message: `Starting ${toolName}`,
                attempt: 1,
            });

            // Trigger lifecycle hooks.
            // NOTE: Plugin.onInputDelta is declared but not invoked here —
            // execute() only sees the FINAL tool input. Partial input deltas
            // surface inside AI SDK's streamText `onChunk` event (search for
            // `tool-input-delta` in node_modules/ai/src/generate-text/
            // stream-text.ts). Wiring that path is tracked as a follow-up.
            for (const plugin of plugins) {
                plugin.onInputStart?.({ toolName, args });
                plugin.onInputAvailable?.({ toolName, args });
            }

            // Retry logic for tool execution
            let lastError: Error | undefined;
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    operation?.progress('in_progress', {
                        phase: attempt === 0 ? 'running' : 'retry',
                        message: attempt === 0
                            ? `Running ${toolName}`
                            : `Retrying ${toolName} (${attempt + 1}/${maxRetries + 1})`,
                        attempt: attempt + 1,
                    });

                    const rawResult = await originalExecute(args, options);
                    // Secret masking at the real leak surface: redact the result
                    // before it reaches the model context, the activity feed, or
                    // the stream. (Args are model-authored and passed through to
                    // the tool unmodified — only the OUTPUT is masked.)
                    const result = redactToolIO ? redactSecrets(rawResult) : rawResult;
                    // If a plugin already closed the shared operation with its
                    // own richer message, keep it; otherwise surface a summary.
                    if (operation && !operation.isClosed) {
                        operation.complete(
                            summarizeToolResult(result) ?? `${toolName} complete`,
                            { phase: 'complete', attempt: attempt + 1 },
                        );
                    }
                    return result;
                } catch (error) {
                    lastError = error instanceof Error ? error : new Error(String(error));
                    // Retry only TRANSIENT errors, and only while the run-wide
                    // retry budget allows. A deterministic failure (validation,
                    // not-found, permission) fails fast instead of re-running to
                    // reproduce the same error after a backoff sleep.
                    const canRetry =
                        attempt < maxRetries &&
                        isTransientError(lastError) &&
                        (consumeRetry ? consumeRetry() : true);
                    if (!canRetry) break;
                    // Exponential backoff + jitter (avoids a thundering herd when
                    // several tools back off a shared rate limit together).
                    const delay = Math.pow(2, attempt) * 100 + Math.random() * 100;
                    await new Promise(resolve => setTimeout(resolve, delay));
                    console.warn(`[vibes] Tool ${toolName} failed transiently (attempt ${attempt + 1}/${maxRetries + 1}), retrying...`);
                }
            }

            logError(toolName, lastError!.message, `Plugin: ${ownerName}`);
            if (operation && !operation.isClosed) {
                operation.fail(lastError!.message, {
                    toolName,
                    phase: 'failed',
                    attempt: maxRetries + 1,
                    context: `Plugin: ${ownerName}`,
                    message: `${toolName} failed`,
                });
            }

            // Notify plugins of final failure after all retries exhausted
            for (const plugin of plugins) {
                try {
                    await plugin.onError?.(lastError!);
                } catch (hookError) {
                    console.error(`[vibes] Plugin onError hook error:`, hookError);
                }
            }

            throw lastError;
        };

        const ctx = getStreamContext();
        return ctx
            ? ctx.runToolOperation({ name: toolName, toolName, plugin: ownerName }, runBody)
            : runBody(undefined);
    };
}
