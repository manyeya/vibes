import { describe, expect, test } from 'bun:test';
import type { ModelMessage } from 'ai';
import SummarizationPlugin from '../src/plugins/summarization';

/**
 * Compaction used to happen automatically at 70% of the window, and a failure
 * (a provider rate limit) silently dropped the un-summarized messages. Now it
 * asks first, and never loses history when it can't summarize.
 */

/** Enough text to blow past the threshold of a small window. */
const bulk = (n: number): ModelMessage[] =>
    Array.from({ length: n }, (_, i) => ({
        role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
        content: `message ${i} ` + 'x'.repeat(2000),
    }));

function makePlugin(over: { summarize?: () => Promise<string> } = {}) {
    const plugin: any = new SummarizationPlugin({} as any, { contextWindow: 4000, compressionRatio: 0.5 });
    if (over.summarize) plugin.summarize = over.summarize;
    const written: any[] = [];
    plugin.writer = {
        writeSummarization: (...a: any[]) => written.push(['summarization', ...a]),
        writeContextDecision: (d: any) => written.push(['decision', d]),
    };
    return { plugin, written };
}

const run = (plugin: any, messages: ModelMessage[]) =>
    plugin.prepareTurn({ steps: [], stepNumber: 0, model: {}, messages, system: '' });

describe('context threshold asks instead of compacting', () => {
    test('under the threshold nothing happens', async () => {
        const { plugin, written } = makePlugin({ summarize: async () => 'SUMMARY' });
        await run(plugin, bulk(1));
        expect(plugin.checkpoint()).toBeNull();
        expect(written).toHaveLength(0);
    });

    test('over the threshold it halts and does NOT summarize', async () => {
        let summarizeCalls = 0;
        const { plugin, written } = makePlugin({
            summarize: async () => { summarizeCalls++; return 'SUMMARY'; },
        });
        const messages = bulk(10);
        const out = await run(plugin, messages);

        // No model call, and the full history is preserved for this turn.
        expect(summarizeCalls).toBe(0);
        expect((out?.messages ?? messages).length).toBeGreaterThanOrEqual(messages.length);

        expect(plugin.checkpoint()).toBe('context-threshold');
        const decision = written.find((w) => w[0] === 'decision');
        expect(decision[1].reason).toBe('threshold');
        expect(decision[1].pct).toBeGreaterThan(50);
    });

    test('the halt fires once, not on every subsequent turn', async () => {
        const { plugin } = makePlugin({ summarize: async () => 'SUMMARY' });
        await run(plugin, bulk(10));
        expect(plugin.checkpoint()).toBe('context-threshold');
        // Nothing new pending until the next prepareTurn re-detects it.
        expect(plugin.checkpoint()).toBeNull();
    });

    test('"continue" keeps the full history and stops asking', async () => {
        let summarizeCalls = 0;
        const { plugin } = makePlugin({
            summarize: async () => { summarizeCalls++; return 'SUMMARY'; },
        });
        plugin.setContextDecision('continue');

        const messages = bulk(10);
        const out = await run(plugin, messages);
        expect(summarizeCalls).toBe(0);
        expect(plugin.checkpoint()).toBeNull();
        // History intact — nothing trimmed away behind the user's back.
        const sent = out?.messages ?? messages;
        expect(sent.filter((m: ModelMessage) => m.role !== 'system')).toHaveLength(messages.length);
    });

    test('"compact" summarizes and trims', async () => {
        let summarizeCalls = 0;
        const { plugin, written } = makePlugin({
            summarize: async () => { summarizeCalls++; return 'SUMMARY'; },
        });
        plugin.setContextDecision('compact');

        const messages = bulk(10);
        const out = await run(plugin, messages);
        expect(summarizeCalls).toBe(1);
        expect(plugin.checkpoint()).toBeNull();
        // Trimmed: fewer messages went out than came in.
        expect((out?.messages ?? messages).length).toBeLessThan(messages.length);
        expect(written.some((w) => w[0] === 'summarization' && w[1] === 'complete')).toBe(true);
    });
});

describe('compaction failure preserves context', () => {
    test('a rate limit halts instead of dropping the un-summarized messages', async () => {
        const { plugin, written } = makePlugin({
            summarize: async () => { throw new Error('AI_APICallError: Rate limit exceeded'); },
        });
        plugin.setContextDecision('compact');

        const messages = bulk(10);
        const out = await run(plugin, messages);

        // The whole point: nothing is lost on a transient provider failure.
        const sent = (out?.messages ?? messages).filter((m: ModelMessage) => m.role !== 'system');
        expect(sent).toHaveLength(messages.length);

        expect(plugin.checkpoint()).toBe('context-threshold');
        const decision = written.find((w) => w[0] === 'decision');
        expect(decision[1].reason).toBe('compaction-failed');
        expect(decision[1].error).toContain('Rate limit');
    });

    test('a failed compact clears the decision so it does not silently retry', async () => {
        let calls = 0;
        const { plugin } = makePlugin({
            summarize: async () => { calls++; throw new Error('rate limited'); },
        });
        plugin.setContextDecision('compact');

        await run(plugin, bulk(10));
        plugin.checkpoint();
        // Second turn must ask again rather than hammering the rate-limited API.
        await run(plugin, bulk(10));
        expect(calls).toBe(1);
        expect(plugin.checkpoint()).toBe('context-threshold');
    });
});
