/**
 * Custom agent streaming response that properly integrates plugin writers.
 *
 * The AI SDK's createAgentUIStreamResponse doesn't expose the writer,
 * so plugins can't send custom data parts (status, task updates, etc.).
 *
 * This implementation uses createUIMessageStream to create a stream where we
 * can control the writer and pass it to the agent for plugin hooks.
 */

import type { VibeAgent } from './agent';
import type { ModelMessage, UIMessage, ToolSet, UIMessageChunk } from 'ai';
import type { VibesUIMessage } from './streaming';
import { createUIMessageStream, createUIMessageStreamResponse, convertToModelMessages } from 'ai';
import type { AgentState } from './types';
import type StateBackend from '../backend/statebackend';

interface AgentStreamOptions {
    agent: VibeAgent;
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
 * This follows the same pattern as the working /mimo-code/stream endpoint:
 * 1. Creates a UI message stream with execute function that receives writer
 * 2. Calls agent.stream() with the writer (triggers plugin onStreamReady hooks)
 * 3. Uses writer.merge(result.toUIMessageStream()) to properly forward the agent's response
 * 4. Saves messages to backend after streaming completes
 *
 * The toUIMessageStream() method handles proper conversion of the agent's stream
 * to UI message chunks, including text deltas, tool calls, and tool results.
 */
export async function createDeepAgentStreamResponse(
    options: AgentStreamOptions
): Promise<Response> {
    const { agent, uiMessages = [], abortSignal, originalMessages, backend, onChunk, onStreamEnd } = options;

    // Create a UI message stream with an execute function that has writer access
    const stream = createUIMessageStream<VibesUIMessage>({
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

                // Add this stream's accumulated token usage to the existing
                // per-session running total. Pulled out of the agent and
                // merged with whatever's already on the backend.
                const streamUsage = agent.consumeLastStreamUsage();
                const prior = backend.getState();
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
                backend.setState(state);
            }
        },
        originalMessages: originalMessages as VibesUIMessage[] | undefined,
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
