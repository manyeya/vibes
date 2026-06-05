import { describe, expect, test } from 'bun:test';
import { MockLanguageModelV3 } from 'ai/test';
import { ReasoningPlugin } from '../src/plugins/reasoning';
import { createPluginStreamContext } from '../src/core/types';
import { createCapturingWriter } from './helpers';

// One mock that answers both calls: thoughts for explore, scores for evaluate.
function totModel() {
    return new MockLanguageModelV3({
        doGenerate: async (opts: any) => {
            const promptStr = JSON.stringify(opts.prompt ?? opts.messages ?? '');
            const isEval = promptStr.includes('evaluator') || promptStr.includes('Evaluate these');
            const content = isEval
                ? JSON.stringify({
                    evaluations: [
                        { thoughtId: 'a', qualityScore: 9, feasibilityScore: 8, valueScore: 9, overallScore: 9, reasoning: 'strong' },
                        { thoughtId: 'b', qualityScore: 5, feasibilityScore: 5, valueScore: 5, overallScore: 5, reasoning: 'weak' },
                    ],
                })
                : JSON.stringify({
                    thoughts: [
                        { thought: 'Approach A', expectedOutcome: 'win', confidence: 0.8, effort: 'low' },
                        { thought: 'Approach B', expectedOutcome: 'maybe', confidence: 0.4, effort: 'high' },
                    ],
                });
            return {
                finishReason: { type: 'stop', unified: 'stop' },
                content: [{ type: 'text', text: content }],
                usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
                warnings: [],
                providerMetadata: undefined,
            } as any;
        },
    });
}

describe('ReasoningPlugin ToT streaming', () => {
    test('streams the actual thoughts and the selected branch', async () => {
        const parts: any[] = [];
        const plugin = new ReasoningPlugin(totModel() as any, { maxBranches: 5 });
        plugin.onStreamContextReady(createPluginStreamContext(createCapturingWriter(parts)));

        await (plugin.tools.explore_thoughts as any).execute({ problem: 'X', count: 2 });
        await (plugin.tools.evaluate_thoughts as any).execute({});
        await (plugin.tools.select_best_thought as any).execute({ autoDiscard: true });

        const thoughtParts = parts.filter(p => p.type === 'data-reasoning_thoughts');
        // explore + evaluate + select each (re)emit the thought set
        expect(thoughtParts.length).toBeGreaterThanOrEqual(3);

        // the ACTUAL thought content is streamed, not just a status string
        const proposed = thoughtParts[0].data.thoughts;
        expect(proposed.length).toBe(2);
        expect(proposed[0].thought).toBe('Approach A');
        expect(proposed[0].status).toBe('proposed');

        // after evaluation, branches carry scores
        const scored = thoughtParts.find(p => p.data.thoughts.some((t: any) => typeof t.score === 'number'));
        expect(scored).toBeDefined();

        // final set: one selected, one discarded
        const last = thoughtParts.at(-1).data.thoughts;
        expect(last.some((t: any) => t.status === 'selected')).toBe(true);
        expect(last.some((t: any) => t.status === 'discarded')).toBe(true);

        // explicit selection event with the winning branch
        const selection = parts.find(p => p.type === 'data-reasoning_selection');
        expect(selection).toBeDefined();
        expect(selection.data.thought).toBe('Approach A');
        expect(selection.data.score).toBe(9);
        expect(selection.data.discardedIds.length).toBe(1);
    });
});
