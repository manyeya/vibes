import { describe, expect, test } from 'bun:test';
import { InvalidToolInputError, NoSuchToolError, tool } from 'ai';
import { z } from 'zod';
import { streamModelStep } from '../src/core/agent/llm';

/**
 * Regression cover for the failure that killed a real run: the model emitted
 * `writeFile` with `{}`, the SDK handed back a raw TypeValidationError, and the
 * model repeated the identical empty call until loop detection stopped
 * everything mid-plan. The harness now repairs the call instead.
 *
 * These drive `experimental_repairToolCall` through a stub model so the repair
 * path is exercised without a provider. The hook itself is invoked by the SDK
 * during a real stream; here we call the same logic via streamModelStep with a
 * model that first emits a bad call, then answers the repair prompt.
 */

const writeFile = tool({
    description: 'Write a file',
    inputSchema: z.object({ path: z.string(), content: z.string() }),
    execute: async ({ path, content }) => ({ ok: true, path, bytes: content.length }),
});

/** A LanguageModelV2-shaped stub whose stream is scripted per call. */
function stubModel(scripts: Array<(push: (p: any) => void) => void>) {
    let call = 0;
    return {
        specificationVersion: 'v2' as const,
        provider: 'stub',
        modelId: 'stub',
        supportedUrls: {},
        async doStream() {
            const script = scripts[Math.min(call, scripts.length - 1)];
            call++;
            return {
                stream: new ReadableStream({
                    start(c) {
                        c.enqueue({ type: 'stream-start', warnings: [] });
                        c.enqueue({ type: 'response-metadata', id: `r${call}`, modelId: 'stub', timestamp: new Date() });
                        script((p) => c.enqueue(p));
                        c.close();
                    },
                }),
            };
        },
        // generateText (used by the repair re-ask) goes through doGenerate.
        async doGenerate() {
            const text = repairAnswer;
            return {
                finishReason: { type: 'stop', unified: 'stop' },
                content: [{ type: 'text', text }],
                usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
                warnings: [],
            } as any;
        },
    };
}

/** What the stubbed repair call returns. Set per test. */
let repairAnswer = '';

/** Emit one tool call with the given (possibly malformed) raw arguments. */
const emitToolCall = (input: string) => (push: (p: any) => void) => {
    push({ type: 'tool-input-start', id: 'c1', toolName: 'writeFile' });
    push({ type: 'tool-input-delta', id: 'c1', delta: input });
    push({ type: 'tool-input-end', id: 'c1' });
    push({ type: 'tool-call', toolCallId: 'c1', toolName: 'writeFile', input });
    push({ type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } });
};

async function runStep(model: any, onToolCallError?: (t: string, m: string) => void) {
    return streamModelStep({
        model,
        system: 'sys',
        messages: [{ role: 'user', content: 'write it' }],
        tools: { writeFile } as any,
        onPart: () => {},
        ...(onToolCallError ? { onToolCallError } : {}),
    });
}

describe('malformed tool-call repair', () => {
    test('an empty-argument call is repaired and the tool runs', async () => {
        repairAnswer = JSON.stringify({ path: 'index.html', content: '<h1>hi</h1>' });
        const model = stubModel([emitToolCall('{}')]);

        const outcome = await runStep(model);

        // Repaired into a real call rather than surfacing a validation error.
        expect(outcome.toolCalls).toHaveLength(1);
        expect(outcome.toolCalls[0].toolName).toBe('writeFile');
        expect(outcome.toolCalls[0].input).toEqual({ path: 'index.html', content: '<h1>hi</h1>' });
    }, 20_000);

    test('a fenced repair answer is still parsed', async () => {
        repairAnswer = '```json\n{"path":"a.txt","content":"x"}\n```';
        const model = stubModel([emitToolCall('{}')]);

        const outcome = await runStep(model);
        expect(outcome.toolCalls[0].input).toEqual({ path: 'a.txt', content: 'x' });
    }, 20_000);

    test('an unparseable repair answer reports through onToolCallError', async () => {
        repairAnswer = 'sorry, I cannot do that';
        const errors: Array<[string, string]> = [];
        const model = stubModel([emitToolCall('{}')]);

        await runStep(model, (t, m) => errors.push([t, m]));

        // The harness must LEARN about it — this is the class of failure that
        // previously bypassed every error path it had.
        expect(errors).toHaveLength(1);
        expect(errors[0][0]).toBe('writeFile');
        expect(errors[0][1]).toContain('invalid arguments');
    }, 20_000);

    test('a non-object repair answer is rejected rather than passed through', async () => {
        repairAnswer = '"just a string"';
        const errors: Array<[string, string]> = [];
        const model = stubModel([emitToolCall('{}')]);

        await runStep(model, (t, m) => errors.push([t, m]));
        expect(errors).toHaveLength(1);
    }, 20_000);
});

describe('repair error-class handling', () => {
    test('NoSuchToolError is not repairable and names the available tools', () => {
        const err = new NoSuchToolError({ toolName: 'nope', availableTools: ['writeFile', 'readFile'] });
        expect(NoSuchToolError.isInstance(err)).toBe(true);
        // Guard the exact API the repair hook branches on.
        expect(err.availableTools).toEqual(['writeFile', 'readFile']);
    });

    test('InvalidToolInputError exposes the offending input for the repair prompt', () => {
        const err = new InvalidToolInputError({ toolName: 'writeFile', toolInput: '{}', cause: new Error('bad') });
        expect(InvalidToolInputError.isInstance(err)).toBe(true);
        expect(err.toolInput).toBe('{}');
        expect(NoSuchToolError.isInstance(err)).toBe(false);
    });
});
