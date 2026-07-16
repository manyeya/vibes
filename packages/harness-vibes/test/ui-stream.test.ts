import { describe, expect, test } from 'bun:test';
import { streamText, stepCountIs, tool, simulateReadableStream } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';
import { createUIChunkAdapter } from '../src/core/agent/ui-stream';
import type { ModelStreamPart } from '../src/core/agent/loop-events';

/** A one-step model that emits text then a tool call. */
function mkModel() {
    return new MockLanguageModelV3({
        doStream: async () => ({
            stream: simulateReadableStream({
                chunks: [
                    { type: 'stream-start', warnings: [] },
                    { type: 'response-metadata', id: 'r1', modelId: 'm', timestamp: new Date(0) },
                    { type: 'text-start', id: 't1' },
                    { type: 'text-delta', id: 't1', delta: 'Hello' },
                    { type: 'text-end', id: 't1' },
                    { type: 'tool-input-start', id: 'c1', toolName: 'echo' },
                    { type: 'tool-input-delta', id: 'c1', delta: '{"msg":"hi"}' },
                    { type: 'tool-input-end', id: 'c1' },
                    { type: 'tool-call', toolCallId: 'c1', toolName: 'echo', input: '{"msg":"hi"}' },
                    { type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 } },
                ],
            }),
        }),
    });
}

async function drain(stream: ReadableStream<{ type: string }>): Promise<Array<{ type: string; [k: string]: unknown }>> {
    const out: Array<{ type: string;[k: string]: unknown }> = [];
    const reader = stream.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        out.push(value as { type: string });
    }
    return out;
}

describe('createUIChunkAdapter', () => {
    test('emits exactly one start (with messageId), converts real parts, one trailing finish', async () => {
        const tools = { echo: tool({ inputSchema: z.object({ msg: z.string() }), execute: async ({ msg }) => ({ echoed: msg }) }) };
        const result = streamText({ model: mkModel(), tools, stopWhen: stepCountIs(1), messages: [{ role: 'user', content: 'hi' }] });

        const adapter = createUIChunkAdapter({ messageId: 'msg-1', tools });
        // Feed real parts across the (single) step, then finish.
        (async () => {
            for await (const part of result.fullStream) adapter.handlePart(part as ModelStreamPart);
            adapter.finish();
        })();

        const chunks = await drain(adapter.stream);
        const types = chunks.map((c) => c.type);

        expect(types.filter((t) => t === 'start')).toHaveLength(1);
        expect(chunks[0]).toEqual({ type: 'start', messageId: 'msg-1' });
        expect(types.filter((t) => t === 'finish')).toHaveLength(1);
        expect(types.at(-1)).toBe('finish');

        // Text streamed through, and the executed tool's result became an output chunk.
        expect(types).toContain('text-delta');
        expect(types).toContain('tool-input-available');
        expect(types).toContain('tool-output-available');

        const output = chunks.find((c) => c.type === 'tool-output-available') as { toolCallId: string; output: unknown };
        expect(output.toolCallId).toBe('c1');
        expect(output.output).toEqual({ echoed: 'hi' });
    });

    test('emits an error chunk before finishing', async () => {
        const adapter = createUIChunkAdapter({ messageId: 'm', tools: {} });
        adapter.error('boom');
        adapter.finish();
        const chunks = await drain(adapter.stream);
        expect(chunks.map((c) => c.type)).toEqual(['start', 'error', 'finish']);
        expect(chunks[1]).toMatchObject({ errorText: 'boom' });
    });
});
