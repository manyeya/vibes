import type { StopCondition, StepResult, ToolSet } from 'ai';

/**
 * Stuck-loop detection. Like {@link ./budgets}, this is a native AI SDK
 * `stopWhen` predicate over the steps so far: the loop halts once the agent has
 * repeated the *same* tool call (same name + same input) too many times in a
 * short window — the classic "retry the identical failing command forever" spin.
 *
 * ponytail: a call's identity is `toolName + JSON.stringify(input)`. Model-emitted
 * argument key order is stable in practice; a deterministic stringify is the
 * upgrade if it isn't. Detects tool-call repetition only — a model looping in
 * pure text (no tool calls) isn't caught here, and we HALT rather than nudge;
 * both are upgrade paths if needed.
 */

export interface LoopDetectionConfig {
    /** Halt once one identical tool call recurs this many times in the window (default 3). */
    maxRepeats?: number;
    /** How many of the most recent steps to scan (default 6). */
    window?: number;
}

const DEFAULT_MAX_REPEATS = 3;
const DEFAULT_WINDOW = 6;

/** A tool call as it appears on a step — `input` in v7, `args` on older shapes. */
interface ToolCallLike {
    toolName?: string;
    input?: unknown;
    args?: unknown;
}

/** A stable-ish identity for a tool call: name + serialized input. */
function callSignature(call: ToolCallLike): string {
    const raw = call.input ?? call.args;
    let argsStr: string;
    try {
        argsStr = raw === undefined ? '' : JSON.stringify(raw);
    } catch {
        argsStr = String(raw);
    }
    return `${call.toolName ?? 'unknown'}:${argsStr}`;
}

/** Count each tool-call signature across the last `window` steps. */
function signatureCounts(
    steps: ReadonlyArray<StepResult<ToolSet>>,
    window: number,
): Map<string, { count: number; toolName: string }> {
    const counts = new Map<string, { count: number; toolName: string }>();
    for (const step of steps.slice(-window)) {
        const calls = (step.toolCalls ?? []) as ToolCallLike[];
        for (const call of calls) {
            const sig = callSignature(call);
            const entry = counts.get(sig);
            if (entry) entry.count++;
            else counts.set(sig, { count: 1, toolName: call.toolName ?? 'unknown' });
        }
    }
    return counts;
}

export function loopStop(config: LoopDetectionConfig = {}): StopCondition<ToolSet> {
    const maxRepeats = config.maxRepeats ?? DEFAULT_MAX_REPEATS;
    const window = config.window ?? DEFAULT_WINDOW;
    return ({ steps }) => {
        for (const { count } of signatureCounts(steps, window).values()) {
            if (count >= maxRepeats) return true;
        }
        return false;
    };
}

/**
 * Name the tool(s) currently looping — used to surface a human-readable
 * "stopped: possible loop" notice after the run halts (the StopCondition itself
 * stays a pure, side-effect-free predicate).
 */
export function loopBreaches(
    config: LoopDetectionConfig,
    steps: ReadonlyArray<StepResult<ToolSet>>,
): string[] {
    const maxRepeats = config.maxRepeats ?? DEFAULT_MAX_REPEATS;
    const window = config.window ?? DEFAULT_WINDOW;
    const looping: string[] = [];
    for (const { count, toolName } of signatureCounts(steps, window).values()) {
        if (count >= maxRepeats) looping.push(toolName);
    }
    return looping;
}

/** Translate a LoopDetectionConfig into the stop conditions it implies. */
export function resolveLoopStops(config: LoopDetectionConfig): StopCondition<ToolSet>[] {
    return [loopStop(config)];
}
