import { describe, expect, test } from 'bun:test';
import {
    tokenBudget,
    toolCallBudget,
    costBudget,
    budgetBreaches,
    resolveBudgetStops,
} from '../src/core/agent/budgets';

// Minimal fake steps — only the fields the budgets read (usage + toolCalls).
const step = (inputTokens: number, outputTokens: number, toolCalls = 0) =>
    ({
        usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
        toolCalls: Array.from({ length: toolCalls }, (_, i) => ({ toolCallId: `c${i}` })),
    } as any);

const run = (stop: any, steps: any[]) => stop({ steps }) as boolean;

describe('budgets', () => {
    test('tokenBudget trips once cumulative total tokens reach the cap', () => {
        const stop = tokenBudget(100);
        expect(run(stop, [step(20, 20)])).toBe(false);          // 40
        expect(run(stop, [step(20, 20), step(30, 20)])).toBe(false); // 90
        expect(run(stop, [step(20, 20), step(30, 30)])).toBe(true);  // 100
    });

    test('toolCallBudget trips once enough tool calls have been made', () => {
        const stop = toolCallBudget(2);
        expect(run(stop, [step(0, 0, 1)])).toBe(false);
        expect(run(stop, [step(0, 0, 1), step(0, 0, 1)])).toBe(true);
        expect(run(stop, [step(0, 0, 3)])).toBe(true);
    });

    test('costBudget trips on estimated spend at the given price', () => {
        // $10/Mtok in, $30/Mtok out. 1M in + 1M out = $40 > $0.50.
        const stop = costBudget(0.5, { inputPerMTok: 10, outputPerMTok: 30 });
        expect(run(stop, [step(1000, 1000)])).toBe(false); // ~$0.04
        expect(run(stop, [step(20_000, 10_000)])).toBe(true); // $0.2 + $0.3 = $0.5
    });

    test('budgetBreaches names which caps were exceeded', () => {
        const breaches = budgetBreaches(
            { maxTotalTokens: 50, maxToolCalls: 1 },
            [step(40, 20, 2)],
        );
        expect(breaches.length).toBe(2);
        expect(breaches.join(' ')).toContain('token budget');
        expect(breaches.join(' ')).toContain('tool-call budget');
    });

    test('resolveBudgetStops only adds cost when pricing is present', () => {
        expect(resolveBudgetStops({ maxTotalTokens: 1, maxToolCalls: 1 }).length).toBe(2);
        expect(resolveBudgetStops({ maxCostUsd: 1 }).length).toBe(0); // no pricing → skipped
        expect(resolveBudgetStops({ maxCostUsd: 1, pricing: { inputPerMTok: 1, outputPerMTok: 1 } }).length).toBe(1);
    });
});
