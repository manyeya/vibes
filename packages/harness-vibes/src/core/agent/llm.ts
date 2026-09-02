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
    generateText,
    streamText,
    stepCountIs,
    InvalidToolInputError,
    NoSuchToolError,
    type FinishReason,
    type LanguageModel,
    type ModelMessage,
    type ToolChoice,
    type ToolSet,
} from 'ai';
import type { ModelStreamPart, StepUsage } from './loop-events';
import { repairDeterministically } from './tool-call-repair';

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
    /**
     * A tool call the model emitted that could not be validated and that repair
     * could not rescue. Schema validation happens BEFORE `execute`, so these
     * never reach the tool-execute wrapper's error handling — without this the
     * harness is blind to the whole failure class and only finds out when loop
     * detection kills the run.
     */
    onToolCallError?: (toolName: string, message: string) => void;
}

/** Strip a ```json fence if the model wrapped its answer in one. */
function stripFence(text: string): string {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    return (fenced ? fenced[1] : text).trim();
}

/**
 * Ask the model to re-emit a tool call's arguments against the tool's schema.
 *
 * The failure this exists for: a model emits `writeFile` with `{}`, the SDK
 * rejects it, the raw TypeValidationError dump goes back, and the model emits
 * the identical empty call again until loop detection kills the run. One
 * targeted re-ask with the schema in front of it breaks that cycle.
 *
 * Returns the corrected arguments as a JSON **string** — `LanguageModelV4ToolCall.input`
 * is stringified JSON, not an object.
 */
async function repairToolArguments(opts: {
    model: LanguageModel;
    toolName: string;
    badInput: string;
    schema: unknown;
    cause: string;
}): Promise<string | null> {
    const { output } = await generateText({
        model: opts.model,
        prompt:
            `A tool call failed schema validation. Emit ONLY the corrected arguments as a single JSON object — ` +
            `no prose, no code fence, no explanation.\n\n` +
            `Tool: ${opts.toolName}\n` +
            `JSON Schema:\n${JSON.stringify(opts.schema, null, 2)}\n\n` +
            `Arguments that failed: ${opts.badInput || '(none provided)'}\n` +
            `Validation error: ${opts.cause}\n\n` +
            `If a required value is genuinely unknown, make the most reasonable inference from the schema ` +
            `rather than omitting the field.`,
    }).then((r) => ({ output: r.text }), () => ({ output: '' }));

    if (!output) return null;
    try {
        const parsed = JSON.parse(stripFence(output));
        // Only an object can satisfy a tool input schema; anything else would
        // just fail validation again on the way back in.
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        return JSON.stringify(parsed);
    } catch {
        return null;
    }
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
    // At most ONE repair per tool call. A model that reliably emits garbage
    // would otherwise turn each bad call into an unbounded re-ask loop — trading
    // a visible failure for an expensive invisible one.
    const repairAttempted = new Set<string>();
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
        // Rescue a tool call the model malformed, instead of handing back a raw
        // TypeValidationError dump and letting it retry the same broken call
        // until loop detection kills the run.
        experimental_repairToolCall: async ({ toolCall, error, inputSchema, tools }) => {
            const rawName = toolCall.toolName;
            const isUnknownTool = NoSuchToolError.isInstance(error);
            if (!isUnknownTool && !InvalidToolInputError.isInstance(error)) return null;

            if (repairAttempted.has(toolCall.toolCallId)) {
                cfg.onToolCallError?.(rawName, `Repair already attempted for this ${rawName} call; giving up.`);
                return null;
            }
            repairAttempted.add(toolCall.toolCallId);

            const available = Object.keys(tools ?? {});

            // Deterministic pass first — free, instant, and it handles the real
            // cause of most of these: a model's native tool-call syntax leaking
            // through a provider parser that expected JSON. The SDK docs say not
            // to repair unknown tool names, which assumes hallucination; a
            // format leak carries recoverable intent, so we try to match it.
            const fixed = repairDeterministically({ toolName: rawName, rawInput: toolCall.input, availableTools: available });

            if (!fixed) {
                cfg.onToolCallError?.(
                    rawName,
                    isUnknownTool
                        ? `Called unknown tool "${rawName}". Available: ${available.join(', ')}.`
                        : `Called ${rawName} with invalid arguments (${toolCall.input || 'no arguments'}).`,
                );
                return null;
            }

            // Arguments recovered wholesale — no model call needed.
            if (fixed.args) {
                return { ...toolCall, toolName: fixed.toolName, input: JSON.stringify(fixed.args) };
            }

            // Name resolved but arguments are still missing or malformed: fall
            // back to one bounded re-ask against the MATCHED tool's schema.
            const toolName = fixed.toolName;
            let schema: unknown;
            try {
                schema = await inputSchema({ toolName });
            } catch {
                cfg.onToolCallError?.(toolName, `No input schema available for ${toolName}.`);
                return null;
            }

            const repaired = await repairToolArguments({
                model: cfg.model,
                toolName,
                badInput: toolCall.input,
                schema,
                cause: error.message,
            });

            if (!repaired) {
                cfg.onToolCallError?.(
                    toolName,
                    `Called ${toolName} with invalid arguments (${toolCall.input || 'no arguments'}) and repair failed. ` +
                    `Re-read the tool's schema and supply every required field.`,
                );
                return null;
            }
            return { ...toolCall, toolName, input: repaired };
        },
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
