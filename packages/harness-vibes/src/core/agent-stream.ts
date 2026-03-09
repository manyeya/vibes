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
import type { ModelMessage } from 'ai';
import type { VibesUIMessage } from './streaming';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import type { AgentState } from './types';
import SqliteBackend from '../persistence/sqlite-backend';

interface AgentStreamOptions {
    agent: VibeAgent;
    uiMessages?: ModelMessage[];
    abortSignal?: AbortSignal;
    originalMessages?: ModelMessage[];
    backend?: SqliteBackend;
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
    const { agent, uiMessages = [], abortSignal, originalMessages, backend } = options;

    // Create a UI message stream with an execute function that has writer access
    const stream = createUIMessageStream<VibesUIMessage>({
        async execute({ writer }) {
            try {
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

                // Save messages to backend after streaming completes
                if (backend && response.messages) {
                    const state: Partial<AgentState> = {
                        messages: response.messages as any,
                    };
                    backend.setState(state);
                }
            } finally {
                backend?.close();
            }
        },
        originalMessages: originalMessages as VibesUIMessage[] | undefined,
    });

    // Create the response with proper SSE formatting
    return createUIMessageStreamResponse({
        stream,
        headers: {
            'X-Accel-Buffering': 'no',
        },
    });
}
