import { describe, expect, test } from 'bun:test';
import { loopStop, loopBreaches, resolveLoopStops } from '../src/core/agent/loop-detection';

// Minimal fake step — only the field the detector reads (toolCalls).
const step = (...calls: Array<{ toolName: string; input?: unknown }>) =>
    ({ toolCalls: calls.map(c => ({ toolName: c.toolName, input: c.input ?? {} })) } as any);

const run = (stop: any, steps: any[]) => stop({ steps }) as boolean;

describe('loop-detection', () => {
    test('trips once the same call recurs maxRepeats times in the window', () => {
        const stop = loopStop({ maxRepeats: 3, window: 6 });
        const bash = { toolName: 'bash', input: { command: 'ls' } };
        expect(run(stop, [step(bash), step(bash)])).toBe(false);
        expect(run(stop, [step(bash), step(bash), step(bash)])).toBe(true);
    });

    test('different inputs to the same tool do NOT count as a loop', () => {
        const stop = loopStop({ maxRepeats: 3, window: 6 });
        const read = (path: string) => ({ toolName: 'read', input: { path } });
        expect(run(stop, [step(read('a')), step(read('b')), step(read('c'))])).toBe(false);
    });

    test('only the most recent `window` steps are considered', () => {
        const stop = loopStop({ maxRepeats: 3, window: 2 });
        const bash = { toolName: 'bash', input: { command: 'ls' } };
        // 3 identical calls, but window=2 only ever sees 2 of them.
        expect(run(stop, [step(bash), step(bash), step(bash)])).toBe(false);
    });

    test('repeats within a single step also count', () => {
        const stop = loopStop({ maxRepeats: 3, window: 6 });
        const bash = { toolName: 'bash', input: { command: 'ls' } };
        expect(run(stop, [step(bash, bash, bash)])).toBe(true);
    });

    test('loopBreaches names the looping tool', () => {
        const breaches = loopBreaches(
            { maxRepeats: 2, window: 6 },
            [step({ toolName: 'bash', input: { command: 'x' } }),
             step({ toolName: 'bash', input: { command: 'x' } })],
        );
        expect(breaches).toEqual(['bash']);
    });

    test('resolveLoopStops yields one stop condition', () => {
        expect(resolveLoopStops({ maxRepeats: 3 }).length).toBe(1);
    });
});
