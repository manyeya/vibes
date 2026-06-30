/**
 * Custom agent streaming response that properly integrates plugin writers.
 *
 * The AI SDK's createAgentUIStreamResponse doesn't expose the writer,
 * so plugins can't send custom data parts (status, task updates, etc.).
 *
 * This implementation uses createUIMessageStream to create a stream where we
 * can control the writer and pass it to the agent for plugin hooks.
 */

import type { AgentHarness } from '../agent/agent-harness';
import type { ModelMessage, UIMessage, ToolSet, UIMessageChunk } from 'ai';
import type { VibesUIMessage } from './streaming';
import { createUIMessageStream, createUIMessageStreamResponse, convertToModelMessages } from 'ai';
import type { AgentState } from '../types';
import type StateBackend from '../../storage/state-backend';

interface AgentStreamOptions {
    agent: AgentHarness;
    uiMessages?: ModelMessage[];
    abortSignal?: AbortSignal;
    originalMessages?: ModelMessage[];
    backend?: StateBackend;
    /**
     * Optional per-chunk observer. Invoked for every UI message chunk
     * before it is forwarded to the HTTP response. The callback is the
     * integration point for resumable-stream persistence + live-tail
     * publishing (see apps/api/src/stream-registry.ts).
     */
    onChunk?: (chunk: unknown) => void;
    /**
     * Optional stream-end notification. Fires once the agent's stream has
     * settled, with `'failed'` for unhandled errors and `'completed'`
     * otherwise. Used by the API layer to mark the stream ended in
     * SQLite + flush retained subscribers.
     */
    onStreamEnd?: (status: 'completed' | 'failed') => void;
}

/**
 * Creates a streaming response with proper plugin writer integration.
 *
 * This follows the same pattern as the working /vibe/stream endpoint:
 * 1. Creates a UI message stream with execute function that receives writer
 * 2. Calls agent.stream() with the writer (triggers plugin onStreamReady hooks)
 * 3. Uses writer.merge(result.toUIMessageStream()) to properly forward the agent's response
 * 4. Saves messages to backend after streaming completes
 *
 * The toUIMessageStream() method handles proper conversion of the agent's stream
 * to UI message chunks, including text deltas, tool calls, and tool results.
 */
export async function createAgentStreamResponse(
    options: AgentStreamOptions
): Promise<Response> {
    const { agent, uiMessages = [], abortSignal, originalMessages, backend, onChunk, onStreamEnd } = options;

    // Create a UI message stream with an execute function that has writer
    // access. The custom `onError` shape extracts useful provider context
    // (HTTP status, response body) instead of leaving the client with a
    // bare "Provider returned error" — typical for OpenRouter rate limits
    // or upstream model failures.
    const stream = createUIMessageStream<VibesUIMessage>({
        onError(error) {
            const err = error as Error & {
                cause?: unknown;
                statusCode?: number;
                responseBody?: unknown;
                data?: unknown;
            };
            const status =
                err?.statusCode ??
                (typeof err?.cause === 'object' && err.cause && 'statusCode' in (err.cause as object)
                    ? (err.cause as { statusCode?: number }).statusCode
                    : undefined);
            const body =
                err?.responseBody ??
                err?.data ??
                (typeof err?.cause === 'object' && err.cause && 'responseBody' in (err.cause as object)
                    ? (err.cause as { responseBody?: unknown }).responseBody
                    : undefined);
            const bodyText = typeof body === 'string'
                ? body
                : body !== undefined
                    ? JSON.stringify(body)
                    : undefined;

            console.error('[agent-stream] provider error', {
                message: err?.message,
                statusCode: status,
                responseBody: bodyText,
                stack: err?.stack,
            });

            const parts: string[] = [];
            if (status === 429) parts.push('Rate limit hit');
            else if (status === 402) parts.push('Out of credits');
            else if (status === 401) parts.push('Auth failed (check API key)');
            else if (status) parts.push(`HTTP ${status}`);
            parts.push(err?.message || 'provider error');
            if (bodyText && bodyText.length < 500) parts.push(bodyText);
            return parts.join(' — ');
        },
        async execute({ writer }) {
            // Call the agent's stream method with the writer
            // The agent will call plugin onStreamReady hooks with this writer
            const result = await agent.stream({
                messages: uiMessages,
                writer,
                abortSignal,
            });

            // Merge the agent's UI message stream into the writer
            // This properly converts the StreamTextResult to UI message chunks
            writer.merge(result.toUIMessageStream());

            // Wait for the response promise to complete (handles final message state)
            const response = await result.response;

            // Save the FULL conversation (input + new turn) to the backend.
            // `response.messages` only contains the newly generated assistant/
            // tool messages; we have to prepend the input to preserve history.
            // Input may be ModelMessage[] or UIMessage[]; convert if needed.
            if (backend && response.messages) {
                const firstInput = uiMessages[0] as { parts?: unknown } | undefined;
                const inputModelMessages: ModelMessage[] = firstInput && 'parts' in firstInput
                    ? await convertToModelMessages(uiMessages as unknown as UIMessage[], {
                        tools: agent.tools as ToolSet,
                        ignoreIncompleteToolCalls: true,
                    })
                    : (uiMessages as ModelMessage[]);
                const fullMessages: ModelMessage[] = [
                    ...inputModelMessages,
                    ...(response.messages as ModelMessage[]),
                ];

                // This stream's token usage, added to the per-session running
                // total. Prefer the SDK's authoritative aggregate
                // (`result.totalUsage`, summed across every step) — it's ground
                // truth and doesn't depend on the per-step onStepFinish tally
                // firing. Fall back to the agent's tally when a provider omits
                // usage from the final result. Always consume the agent counter
                // so it resets for the next stream regardless.
                const tallied = agent.consumeLastStreamUsage();
                let sdk: { inputTokens?: number; outputTokens?: number; totalTokens?: number } = {};
                try { sdk = (await result.totalUsage) ?? {}; } catch { /* provider omitted usage */ }
                const sdkTotal = sdk.totalTokens ?? ((sdk.inputTokens ?? 0) + (sdk.outputTokens ?? 0));
                const streamUsage = sdkTotal > 0
                    ? { inputTokens: sdk.inputTokens ?? 0, outputTokens: sdk.outputTokens ?? 0, totalTokens: sdkTotal }
                    : tallied;
                const prior = await backend.getState();
                const priorUsage = (prior.metadata?.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 }) as {
                    inputTokens: number;
                    outputTokens: number;
                    totalTokens: number;
                };
                const mergedMetadata = {
                    ...(prior.metadata ?? {}),
                    usage: {
                        inputTokens: priorUsage.inputTokens + streamUsage.inputTokens,
                        outputTokens: priorUsage.outputTokens + streamUsage.outputTokens,
                        totalTokens: priorUsage.totalTokens + streamUsage.totalTokens,
                    },
                    lastStreamAt: new Date().toISOString(),
                };

                const state: Partial<AgentState> = {
                    messages: fullMessages,
                    metadata: mergedMetadata,
                };
                await backend.setState(state);
            }
        },
        // Use the incoming UI messages as the conversation base so onFinish
        // reports the FULL updated thread (prior messages + new assistant turn).
        originalMessages: (originalMessages ?? uiMessages) as unknown as VibesUIMessage[] | undefined,
        // Persist the complete UI messages. Their parts include the data-*
        // activity (ToT thoughts, tool progress, delegation, status), so
        // reloading a session restores the whole thread, not just text.
        async onFinish({ messages }) {
            try {
                await backend?.setUIMessages?.(messages);
            } catch (err) {
                console.error('[agent-stream] failed to persist UI messages:', err);
            }
        },
    });

    // Resumable streams: tee the chunk stream when an `onChunk` observer is
    // supplied so the same chunks can be persisted + broadcast for late
    // reconnects while the original branch flows out to the HTTP response.
    let responseStream = stream;
    if (onChunk) {
        // `stream` is typed as a chunk stream; .tee() preserves that type.
        const teed = (stream as unknown as ReadableStream<UIMessageChunk<unknown, never>>).tee();
        responseStream = teed[0] as unknown as typeof stream;
        const forObserver = teed[1];
        void (async () => {
            const reader = forObserver.getReader();
            let status: 'completed' | 'failed' = 'completed';
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    try {
                        onChunk(value);
                    } catch (err) {
                        console.error('[agent-stream] onChunk observer threw:', err);
                    }
                }
            } catch (err) {
                status = 'failed';
                console.error('[agent-stream] observer branch errored:', err);
            } finally {
                reader.releaseLock();
                try { onStreamEnd?.(status); } catch { /* swallow */ }
            }
        })();
    }

    // Create the response with proper SSE formatting
    return createUIMessageStreamResponse({
        stream: responseStream,
        headers: {
            'X-Accel-Buffering': 'no',
        },
    });
}
