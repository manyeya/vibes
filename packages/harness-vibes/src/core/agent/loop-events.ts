/**
 * The owned loop's step + stop-condition contract.
 *
 * Split out from the UI data-part catalog (`../events.ts`) so the loop, the
 * LLM step, the UI adapter, and the agent share one definition of a step and a
 * stop predicate without pulling in the streaming-facing types.
 *
 * Only type-only imports from `ai` are allowed here (erased at runtime).
 */

import type { FinishReason, LanguageModelUsage, ModelMessage, TextStreamPart, ToolSet } from 'ai';

/** Token usage for one model call (the SDK's shape). */
export type StepUsage = LanguageModelUsage;

/**
 * The narrow view of a step that a stop condition reads. Deliberately a subset
 * of both the SDK's `StepResult` and our richer {@link LoopStep} so a single
 * {@link StopPredicate} works over either — and so the existing budget/loop
 * predicates (typed on the SDK's `StopCondition`) stay assignable to it.
 */
export interface StopStep {
    usage?: StepUsage;
    toolCalls?: ReadonlyArray<{ toolName?: string; input?: unknown; args?: unknown }>;
}

/**
 * A loop stop condition: a predicate over the steps taken so far. Evaluated
 * AFTER each step completes (so a cap can overshoot by the final step's cost).
 * Structurally compatible with the SDK's `StopCondition<ToolSet>` — the agent
 * casts budget/loop stops into this at the boundary during migration.
 */
export type StopPredicate = (opts: { steps: StopStep[] }) => boolean | PromiseLike<boolean>;

/** One completed step of the owned loop: one model call + its tool executions. */
export interface LoopStep {
    /** The SDK's aggregate finish reason for this step. */
    finishReason: FinishReason;
    /** Token usage the provider reported for this step (may be absent). */
    usage?: StepUsage;
    /** Tool calls the model made this step (empty on a final, text-only step). */
    toolCalls: ReadonlyArray<{ toolName: string; input?: unknown }>;
    /** New messages this step produced (assistant message + any tool results). */
    responseMessages: ModelMessage[];
    /** Assistant text produced this step. */
    text: string;
}

/** Why the loop stopped. */
export type StopReason =
    /** The model gave a final answer (a step with no tool calls). */
    | 'finished'
    /** Hit the max-steps cap. */
    | 'max-steps'
    /** A budget / loop-detection / user stop predicate fired. */
    | 'stop-condition'
    /** A tool in `haltOnToolCall` was called (e.g. ask_user, plan review). */
    | 'halted-by-tool'
    /** A tool needs user approval before it can run; control returns to the user. */
    | 'approval-required'
    /** Context crossed the threshold; the user must choose how to proceed. */
    | 'context-threshold'
    /** The run was aborted via the abort signal. */
    | 'aborted'
    /** The model step errored. */
    | 'error';

/** Re-exported for modules that build/forward raw model parts. */
export type ModelStreamPart = TextStreamPart<ToolSet>;
