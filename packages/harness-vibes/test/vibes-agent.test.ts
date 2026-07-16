import { describe, expect, test } from 'bun:test';
import { simulateReadableStream, tool } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';
import { VibesAgent } from '../src/core/agent';

type Chunk = Record<string, unknown> & { type: string };

function textChunks(text: string): Chunk[] {
    return [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: '0' },
        { type: 'text-delta', id: '0', delta: text },
        { type: 'text-end', id: '0' },
        // v3 models report nested usage ({ total }); flat numbers are dropped.
        { type: 'finish', finishReason: 'stop', usage: { inputTokens: { total: 3 }, outputTokens: { total: 2 } } },
    ];
}

function toolChunks(toolName: string, input: unknown, id = 'c1'): Chunk[] {
    const json = JSON.stringify(input);
    return [
        { type: 'stream-start', warnings: [] },
        { type: 'tool-input-start', id, toolName },
        { type: 'tool-input-delta', id, delta: json },
        { type: 'tool-input-end', id },
        { type: 'tool-call', toolCallId: id, toolName, input: json },
        { type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: { total: 4 }, outputTokens: { total: 1 } } },
    ];
}

/** A call-counted model that plays each script in order, capturing call options. */
function scriptedModel(scripts: Chunk[][]) {
    let i = 0;
    const captured: Array<Record<string, unknown>> = [];
    const model = new MockLanguageModelV3({
        doStream: async (opts: Record<string, unknown>) => {
            captured.push(opts);
            const chunks = scripts[Math.min(i, scripts.length - 1)];
            i++;
            return { stream: simulateReadableStream({ chunks }) } as never;
        },
    });
    return { model, captured, count: () => i };
}

/** Pull the system prompt text out of a captured doStream call's prompt. */
function systemOf(opts: Record<string, unknown>): string {
    const prompt = (opts.prompt as Array<{ role: string; content: unknown }>) ?? [];
    const sys = prompt.find((m) => m.role === 'system');
    return typeof sys?.content === 'string' ? sys.content : JSON.stringify(sys?.content ?? '');
}

const echo = tool({ inputSchema: z.object({ msg: z.string() }), execute: async ({ msg }: { msg: string }) => ({ echoed: msg }) });

describe('VibesAgent', () => {
    test('satisfies the AI SDK agent-v1 contract shape', () => {
        const { model } = scriptedModel([textChunks('x')]);
        const agent = new VibesAgent({ model, instructions: 'BASE' });
        expect(agent.version).toBe('agent-v1');
        expect(agent.asAgent().version).toBe('agent-v1');
        expect(typeof agent.tools).toBe('object');
    });

    test('generate() runs a multi-step tool loop and returns text + usage + steps', async () => {
        const { model, count } = scriptedModel([
            toolChunks('echo', { msg: 'hi' }),
            textChunks('final answer'),
        ]);
        const agent = new VibesAgent({ model, instructions: 'BASE', tools: { echo }, maxSteps: 5 });

        const r = await agent.generate({ messages: [{ role: 'user', content: 'go' }] });

        expect(count()).toBe(2);
        expect(r.text).toBe('final answer');
        expect(r.steps).toHaveLength(2);
        expect(r.stopReason).toBe('finished');
        expect(r.usage.totalTokens).toBe(10); // 5 + 5 across the two steps
        // response.messages holds the new assistant + tool-result messages.
        expect(r.state.messages.length).toBeGreaterThanOrEqual(2);
        expect(r.state.messages.some((m) => m.role === 'tool')).toBe(true);
    });

    test('stream() yields one start, streamed text, and one finish', async () => {
        const { model } = scriptedModel([
            toolChunks('echo', { msg: 'hi' }),
            textChunks('final answer'),
        ]);
        const agent = new VibesAgent({ model, instructions: 'BASE', tools: { echo }, maxSteps: 5 });

        const res = await agent.stream({ messages: [{ role: 'user', content: 'go' }] });
        const chunks: Chunk[] = [];
        const reader = res.toUIMessageStream().getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value as Chunk);
        }

        const types = chunks.map((c) => c.type);
        expect(types.filter((t) => t === 'start')).toHaveLength(1);
        expect(types.at(-1)).toBe('finish');
        expect(types).toContain('text-delta');
        expect(types).toContain('tool-output-available');

        expect(await res.text).toBe('final answer');
        expect((await res.steps)).toHaveLength(2);
        expect((await res.response).messages.some((m) => m.role === 'tool')).toBe(true);
        expect((await res.totalUsage).totalTokens).toBe(10);
    });

    test('keeps the system prompt byte-stable across steps (KV cache)', async () => {
        const { model, captured } = scriptedModel([
            toolChunks('echo', { msg: 'hi' }),
            textChunks('done'),
        ]);
        const agent = new VibesAgent({ model, instructions: 'STABLE-BASE', tools: { echo }, maxSteps: 5 });
        await agent.generate({ messages: [{ role: 'user', content: 'go' }] });

        expect(captured).toHaveLength(2);
        expect(systemOf(captured[0])).toBe(systemOf(captured[1]));
        expect(systemOf(captured[0])).toContain('STABLE-BASE');
    });

    test('halts the run after a haltOnToolCall tool executes', async () => {
        const ask = tool({ inputSchema: z.object({ q: z.string() }), execute: async () => ({ asked: true }) });
        const { model, count } = scriptedModel([
            toolChunks('ask_user', { q: 'which?' }),
            textChunks('should not reach here'),
        ]);
        const agent = new VibesAgent({
            model, instructions: 'BASE', tools: { ask_user: ask },
            haltOnToolCall: ['ask_user'], maxSteps: 5,
        });

        const r = await agent.generate({ messages: [{ role: 'user', content: 'go' }] });
        expect(count()).toBe(1);
        expect(r.stopReason).toBe('halted-by-tool');
        expect(r.steps).toHaveLength(1);
    });

    test('halts (does not spin) when a tool needs approval', async () => {
        const danger = tool({ inputSchema: z.object({ x: z.number() }), needsApproval: true, execute: async () => ({ ok: true }) });
        const { model, count } = scriptedModel([
            toolChunks('danger', { x: 1 }),
            textChunks('should not reach here'),
        ]);
        const agent = new VibesAgent({
            model, instructions: 'BASE', tools: { danger },
            toolsRequiringApproval: ['danger'], maxSteps: 5,
        });

        const r = await agent.generate({ messages: [{ role: 'user', content: 'go' }] });
        expect(count()).toBe(1);
        expect(r.stopReason).toBe('approval-required');
    });
});
