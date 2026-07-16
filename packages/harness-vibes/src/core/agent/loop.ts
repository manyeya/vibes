/**
 * The owned agent loop.
 *
 * A pure async function (no class state) modeled on pi's `runAgentLoop`: an
 * outer loop that drains follow-up messages after the agent would stop, and an
 * inner loop that runs turns until the model gives a final answer (a step with
 * no tool calls) or a stop condition fires. Each turn is ONE `streamModelStep`
 * call (see `llm.ts`) — the SDK does the model call + that step's tool
 * execution; we own everything between turns.
 *
 * The transcript (`messages`) grows with every response; a per-turn
 * `transformContext` produces the pruned SEND view without mutating history,
 * and `prepareTurn` resolves the system prompt / model / active tools for the
 * turn (the agent fans out to plugins there). Steering / follow-up injection
 * points mirror pi; the queue wiring lives in the agent.
 */

import type { LanguageModel, ModelMessage, ToolChoice, ToolSet } from 'ai';
import type { streamModelStep as StreamModelStepFn } from './llm';
import type { AgentEvent, EventSink, LoopStep, ModelStreamPart, StopPredicate, StopReason } from './loop-events';

/** The resolved settings for one turn (what `prepareTurn` produces). */
export interface ResolvedTurn {
    system: string;
    model: LanguageModel;
    messages: ModelMessage[];
    activeTools?: string[];
    toolChoice?: ToolChoice<ToolSet>;
    providerOptions?: Record<string, unknown>;
}

export interface LoopConfig {
    model: LanguageModel;
    /** The assembled base system prompt (used when `prepareTurn` is absent). */
    instructions: string;
    /** Initial transcript (input messages). */
    messages: ModelMessage[];
    /** Wrapped tool set passed to the model call. */
    tools: ToolSet;
    temperature?: number;
    /** Hard cap on model steps. */
    maxSteps: number;
    /** Budget / loop-detection / user stop predicates, evaluated after each step. */
    stopWhen: StopPredicate[];
    /** Tool names that halt the run after their step (ask_user, plan review, …). */
    haltOnToolCall: Set<string>;
    /** Opaque telemetry settings forwarded to the model call. */
    telemetry?: unknown;
    abortSignal?: AbortSignal;
    emit: EventSink;

    /** Prune/compress the transcript into the SEND view for a turn. */
    transformContext?: (messages: ModelMessage[], ctx: { stepNumber: number }) => Promise<ModelMessage[]> | ModelMessage[];
    /** Resolve the system prompt / model / active tools for a turn (plugin fan-out). */
    prepareTurn?: (opts: {
        steps: LoopStep[];
        stepNumber: number;
        model: LanguageModel;
        system: string;
        messages: ModelMessage[];
    }) => Promise<ResolvedTurn> | ResolvedTurn;
    /** Called after each step completes (usage accounting). */
    onStepFinish?: (step: LoopStep) => void | Promise<void>;
    /** Every raw model stream part (UI adapter + sub-agent fullStream). */
    onModelPart?: (part: ModelStreamPart) => void;
    /** Raw provider/stream error logger. */
    onError?: (error: unknown) => void;
    /** Steering messages to inject before the next turn (polled between turns). */
    getSteeringMessages?: () => Promise<ModelMessage[]> | ModelMessage[];
    /** Follow-up messages to run after the agent would otherwise stop. */
    getFollowUpMessages?: () => Promise<ModelMessage[]> | ModelMessage[];
}

export interface LoopResult {
    stopReason: StopReason;
    steps: LoopStep[];
    /** New messages produced this run (assistant + tool results across all steps). */
    responseMessages: ModelMessage[];
    /** Final assistant text (last step's text). */
    text: string;
}

async function anyStop(preds: StopPredicate[], steps: LoopStep[]): Promise<boolean> {
    for (const pred of preds) {
        if (await pred({ steps })) return true;
    }
    return false;
}

/** True when a step's messages carry an unresolved tool-approval request. */
function hasApprovalRequest(messages: ModelMessage[]): boolean {
    for (const m of messages) {
        if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
        for (const part of m.content) {
            if ((part as { type?: string }).type === 'tool-approval-request') return true;
        }
    }
    return false;
}

/**
 * Run the loop to completion. `callModel` is injectable for tests.
 */
export async function runAgentLoop(
    config: LoopConfig,
    callModel: typeof StreamModelStepFn = defaultCallModel,
): Promise<LoopResult> {
    const transcript: ModelMessage[] = [...config.messages];
    const responseMessages: ModelMessage[] = [];
    const steps: LoopStep[] = [];
    let finalText = '';

    const finish = (stopReason: StopReason): LoopResult => {
        config.emit({ type: 'agent_end', stopReason, steps });
        return { stopReason, steps, responseMessages, text: finalText };
    };

    config.emit({ type: 'agent_start' });

    let pending: ModelMessage[] = (await config.getSteeringMessages?.()) ?? [];

    // Outer loop: re-enters when follow-up messages arrive after a natural stop.
    // eslint-disable-next-line no-constant-condition
    while (true) {
        let moreWork = true;

        // Inner loop: one turn per iteration until a final answer or a stop.
        while (moreWork) {
            if (config.abortSignal?.aborted) return finish('aborted');

            if (pending.length > 0) {
                transcript.push(...pending);
                responseMessages.push(...pending);
                pending = [];
            }

            const stepIndex = steps.length;
            config.emit({ type: 'step_start', stepIndex });

            const pruned = config.transformContext
                ? await config.transformContext(transcript, { stepNumber: stepIndex })
                : transcript;

            const turn: ResolvedTurn = config.prepareTurn
                ? await config.prepareTurn({
                    steps,
                    stepNumber: stepIndex,
                    model: config.model,
                    system: config.instructions,
                    messages: pruned,
                })
                : { system: config.instructions, model: config.model, messages: pruned };

            let outcome;
            try {
                outcome = await callModel({
                    model: turn.model,
                    system: turn.system,
                    messages: turn.messages,
                    tools: config.tools,
                    toolChoice: turn.toolChoice,
                    activeTools: turn.activeTools,
                    temperature: config.temperature,
                    providerOptions: turn.providerOptions,
                    abortSignal: config.abortSignal,
                    telemetry: config.telemetry,
                    onPart: (part) => config.onModelPart?.(part),
                    onError: config.onError,
                });
            } catch (error) {
                config.emit({ type: 'error', error });
                if (config.abortSignal?.aborted) return finish('aborted');
                return finish('error');
            }

            const step: LoopStep = {
                finishReason: outcome.finishReason,
                usage: outcome.usage,
                toolCalls: outcome.toolCalls.map((c) => ({ toolName: c.toolName, input: c.input })),
                responseMessages: outcome.responseMessages,
                text: outcome.text,
            };
            steps.push(step);
            transcript.push(...outcome.responseMessages);
            responseMessages.push(...outcome.responseMessages);
            if (outcome.text) finalText = outcome.text;

            config.emit({ type: 'step_end', stepIndex, step });
            await config.onStepFinish?.(step);

            if (config.abortSignal?.aborted) return finish('aborted');

            const hasToolCalls = step.toolCalls.length > 0;

            // A tool that needs approval streams a tool-approval-request part and
            // is NOT executed, so the step leaves an unresolved tool call. Halt
            // and return control to the user rather than spinning on it. (The
            // approve → resubmit flow is handled by the edge/UI.)
            if (hasApprovalRequest(outcome.responseMessages)) {
                return finish('approval-required');
            }
            if (hasToolCalls && step.toolCalls.some((c) => config.haltOnToolCall.has(c.toolName))) {
                return finish('halted-by-tool');
            }
            if (steps.length >= config.maxSteps) return finish('max-steps');
            if (config.stopWhen.length > 0 && (await anyStop(config.stopWhen, steps))) {
                return finish('stop-condition');
            }

            if (!hasToolCalls) {
                // Final answer → the inner loop is done.
                moreWork = false;
            } else {
                pending = (await config.getSteeringMessages?.()) ?? [];
            }
        }

        // The agent would stop here. Run any queued follow-ups, else exit.
        const followUps = (await config.getFollowUpMessages?.()) ?? [];
        if (followUps.length > 0) {
            pending = followUps;
            continue;
        }
        break;
    }

    return finish('finished');
}

/** Default model caller — imported lazily to keep loop.ts test-injectable. */
const defaultCallModel: typeof StreamModelStepFn = async (cfg) => {
    const { streamModelStep } = await import('./llm');
    return streamModelStep(cfg);
};
