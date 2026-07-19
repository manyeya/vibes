/**
 * The LLM boundary for the owned loop: one `streamText` call = one loop step.
 *
 * `stopWhen: stepCountIs(1)` makes the SDK do exactly one model call and then
 * execute that step's tool calls (through our already-wrapped `execute`) without
 * looping again — WE drive iteration in `loop.ts`. The SDK still builds the
 * correct assistant + tool-result `ModelMessage`s and streams `tool-result`
 * parts, which our UI adapter converts for free.
 */

import {
    streamText,
    stepCountIs,
    type FinishReason,
    type LanguageModel,
    type ModelMessage,
    type ToolChoice,
    type ToolSet,
} from 'ai';
import type { ModelStreamPart, StepUsage } from './loop-events';

export interface StepCallConfig {
    model: LanguageModel;
    system: string;
    messages: ModelMessage[];
    /** Wrapped tool set (retry/instrumentation/approval already applied). */
    tools: ToolSet;
    toolChoice?: ToolChoice<ToolSet>;
    activeTools?: string[];
    temperature?: number;
    providerOptions?: Record<string, unknown>;
    abortSignal?: AbortSignal;
    /** Opaque telemetry settings forwarded to streamText when present. */
    telemetry?: unknown;
    /** Called for every raw model stream part (feeds the UI adapter + fullStream). */
    onPart: (part: ModelStreamPart) => void;
    /** Raw provider/stream error logger (ports AgentHarness.stream's onError). */
    onError?: (error: unknown) => void;
}

export interface StepModelOutcome {
    text: string;
    /** The model's true finish reason for this step ('tool-calls' | 'stop' | 'length' | …). */
    finishReason: FinishReason;
    usage?: StepUsage;
    /** Assistant message + any tool-result messages this step produced. */
    responseMessages: ModelMessage[];
    toolCalls: Array<{ toolName: string; input?: unknown }>;
    /**
     * A provider/stream error for this step, if one occurred. In v7 these are
     * delivered to `onError` and the stream finishes empty instead of throwing,
     * so without capturing it here an errored step looks like an empty finish.
     */
    error?: string;
}

/**
 * Run one model step. Streams the response (forwarding every part to `onPart`),
 * lets the SDK execute this step's tools, and returns the step's outcome.
 */
export async function streamModelStep(cfg: StepCallConfig): Promise<StepModelOutcome> {
    let stepError: string | undefined;
    const result = streamText({
        model: cfg.model,
        instructions: cfg.system,
        messages: cfg.messages,
        tools: cfg.tools,
        ...(cfg.toolChoice !== undefined ? { toolChoice: cfg.toolChoice } : {}),
        ...(cfg.activeTools !== undefined ? { activeTools: cfg.activeTools } : {}),
        ...(cfg.temperature !== undefined ? { temperature: cfg.temperature } : {}),
        ...(cfg.providerOptions !== undefined ? { providerOptions: cfg.providerOptions as never } : {}),
        ...(cfg.abortSignal ? { abortSignal: cfg.abortSignal } : {}),
        ...(cfg.telemetry ? { experimental_telemetry: cfg.telemetry as never } : {}),
        stopWhen: stepCountIs(1),
        // In v7 a provider/stream error is delivered here and the stream
        // finishes without throwing (then collapses to a generic message
        // downstream). Surface the raw error so the real failure is visible.
        onError: ({ error }) => {
            const e = error as { name?: string; message?: string; statusCode?: number; responseBody?: string; cause?: unknown };
            stepError = [e?.statusCode ? `HTTP ${e.statusCode}` : undefined, e?.message || e?.name || String(error)]
                .filter(Boolean)
                .join(': ');
            console.error('[vibes-loop] model stream error:', {
                name: e?.name, message: e?.message, statusCode: e?.statusCode,
                responseBody: e?.responseBody, cause: e?.cause,
            });
            cfg.onError?.(error);
        },
    });

    // Draining fullStream drives the single model call AND this step's tool
    // executions; forward each part for the UI adapter and sub-agent fullStream.
    for await (const part of result.fullStream) {
        cfg.onPart(part);
    }

    const [text, steps, response, toolCalls, totalUsage] = await Promise.all([
        result.text,
        result.steps,
        result.response,
        result.toolCalls,
        // The aggregate across this call's single step — reliably reflects the
        // provider's finish usage (per-step `steps[i].usage` can come back empty).
        result.totalUsage,
    ]);

    const step = steps[steps.length - 1];
    return {
        text,
        finishReason: step?.finishReason ?? 'unknown',
        usage: totalUsage,
        responseMessages: response.messages as ModelMessage[],
        toolCalls: (toolCalls ?? []).map((c) => ({ toolName: c.toolName, input: (c as { input?: unknown }).input })),
        ...(stepError ? { error: stepError } : {}),
    };
}
