import { describe, expect, test } from 'bun:test';
import { runAgentLoop, type LoopConfig } from '../src/core/agent/loop';
import type { StepModelOutcome } from '../src/core/agent/llm';

/** Build a StepModelOutcome with sensible defaults. */
function outcome(partial: Partial<StepModelOutcome> = {}): StepModelOutcome {
    return {
        text: '',
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        responseMessages: [{ role: 'assistant', content: partial.text ?? '' }],
        toolCalls: [],
        ...partial,
    };
}

/** A call-counted fake model: returns the next scripted outcome each call. */
function scripted(outcomes: StepModelOutcome[]) {
    let i = 0;
    const callModel = async (): Promise<StepModelOutcome> => {
        const o = outcomes[Math.min(i, outcomes.length - 1)];
        i++;
        return o;
    };
    return { callModel: callModel as never, count: () => i };
}

/** Minimal loop config; overrides merge on top. */
function baseConfig(over: Partial<LoopConfig> = {}): LoopConfig {
    return {
        model: {} as never,
        instructions: 'BASE',
        messages: [{ role: 'user', content: 'hi' }],
        tools: {},
        maxSteps: 10,
        stopWhen: [],
        haltOnToolCall: new Set<string>(),
        ...over,
    };
}

describe('runAgentLoop', () => {
    test('runs multiple turns until a final answer with no tool calls', async () => {
        const { callModel, count } = scripted([
            outcome({ toolCalls: [{ toolName: 'search' }], responseMessages: [{ role: 'assistant', content: 'looking' }] }),
            outcome({ text: 'done', responseMessages: [{ role: 'assistant', content: 'done' }] }),
        ]);
        const result = await runAgentLoop(baseConfig(), callModel);

        expect(count()).toBe(2);
        expect(result.stopReason).toBe('finished');
        expect(result.steps).toHaveLength(2);
        expect(result.text).toBe('done');
        expect(result.responseMessages).toHaveLength(2);
    });

    test('finishes on the first turn when the model makes no tool calls', async () => {
        const { callModel, count } = scripted([outcome({ text: 'hello' })]);
        const result = await runAgentLoop(baseConfig(), callModel);
        expect(count()).toBe(1);
        expect(result.stopReason).toBe('finished');
        expect(result.steps).toHaveLength(1);
    });

    test('stops at maxSteps when the model keeps calling tools', async () => {
        const { callModel, count } = scripted([outcome({ toolCalls: [{ toolName: 'loop' }] })]);
        const result = await runAgentLoop(baseConfig({ maxSteps: 3 }), callModel);
        expect(count()).toBe(3);
        expect(result.stopReason).toBe('max-steps');
        expect(result.steps).toHaveLength(3);
    });

    test('stops when a stop predicate fires', async () => {
        const { callModel } = scripted([outcome({ toolCalls: [{ toolName: 'x' }] })]);
        const result = await runAgentLoop(
            baseConfig({ stopWhen: [({ steps }) => steps.length >= 2] }),
            callModel,
        );
        expect(result.stopReason).toBe('stop-condition');
        expect(result.steps).toHaveLength(2);
    });

    test('halts after a tool in haltOnToolCall is called', async () => {
        const { callModel, count } = scripted([
            outcome({ toolCalls: [{ toolName: 'ask_user' }], responseMessages: [{ role: 'assistant', content: '?' }] }),
        ]);
        const result = await runAgentLoop(
            baseConfig({ haltOnToolCall: new Set(['ask_user']) }),
            callModel,
        );
        expect(count()).toBe(1);
        expect(result.stopReason).toBe('halted-by-tool');
    });

    test('returns aborted when the signal is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        const { callModel, count } = scripted([outcome({ text: 'unused' })]);
        const result = await runAgentLoop(baseConfig({ abortSignal: controller.signal }), callModel);
        expect(count()).toBe(0);
        expect(result.stopReason).toBe('aborted');
    });

    test('calls onStepFinish once per step', async () => {
        const finished: number[] = [];
        const { callModel } = scripted([
            outcome({ toolCalls: [{ toolName: 'x' }] }),
            outcome({ text: 'done' }),
        ]);
        await runAgentLoop(
            baseConfig({ onStepFinish: (s) => finished.push(s.text.length) }),
            callModel,
        );
        expect(finished).toHaveLength(2);
    });

    test('surfaces a model error as stopReason "error"', async () => {
        const callModel = (async () => { throw new Error('provider boom'); }) as never;
        let logged: unknown;
        const result = await runAgentLoop(baseConfig({ onError: (e) => { logged = e; } }), callModel);
        expect(result.stopReason).toBe('error');
        expect((logged as Error).message).toBe('provider boom');
    });

    test('onBeforeFinish keeps the run alive and its messages reach the next turn', async () => {
        // Both turns are final answers. Without the hook the loop returns on the
        // first; the hook makes it take a second with the injected message.
        const { callModel, count } = scripted([
            outcome({ text: 'first', responseMessages: [{ role: 'assistant', content: 'first' }] }),
            outcome({ text: 'second', responseMessages: [{ role: 'assistant', content: 'second' }] }),
        ]);

        let calls = 0;
        const seen: string[] = [];
        const result = await runAgentLoop(baseConfig({
            onBeforeFinish: async () => {
                calls += 1;
                // Feed the pending result once, then let the run end.
                return calls === 1 ? [{ role: 'user', content: 'background task finished: done' }] : null;
            },
            prepareTurn: ({ system, model, messages }) => {
                seen.push(messages.map((m) => String(m.content)).join('|'));
                return { system, model, messages };
            },
        }), callModel);

        expect(result.stopReason).toBe('finished');
        expect(count()).toBe(2);
        expect(calls).toBe(2);
        expect(result.text).toBe('second');
        // The injected message must be visible to the turn that follows it.
        expect(seen[1]).toContain('background task finished: done');
    });

    test('a final answer still ends the run when onBeforeFinish returns nothing', async () => {
        const { callModel, count } = scripted([
            outcome({ text: 'done', responseMessages: [{ role: 'assistant', content: 'done' }] }),
        ]);
        const result = await runAgentLoop(baseConfig({ onBeforeFinish: async () => null }), callModel);
        expect(result.stopReason).toBe('finished');
        expect(count()).toBe(1);
    });

    test('an empty array from onBeforeFinish does not spin the loop', async () => {
        const { callModel, count } = scripted([
            outcome({ text: 'done', responseMessages: [{ role: 'assistant', content: 'done' }] }),
        ]);
        const result = await runAgentLoop(baseConfig({ onBeforeFinish: async () => [] }), callModel);
        expect(result.stopReason).toBe('finished');
        expect(count()).toBe(1);
    });
});
