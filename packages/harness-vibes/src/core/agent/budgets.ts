import type { StopCondition, StepResult, ToolSet } from 'ai';

/**
 * Per-run budgets. Enforced as native AI SDK `stopWhen` conditions: each one is
 * a predicate over the steps so far, so the loop halts once a cap is hit. This
 * is the v7 loop-control pattern (the docs ship the cost-estimate example
 * verbatim) — no custom abort machinery needed.
 *
 * ponytail: stopWhen is evaluated AFTER a step completes, so a budget can
 * overshoot by the tokens/calls of the final step. Acceptable ceiling; if you
 * need a hard pre-call cap, gate it in prepareTurn instead.
 */

/** $ per million tokens, in/out. */
export interface ModelPricing {
    inputPerMTok: number;
    outputPerMTok: number;
}

export interface BudgetConfig {
    /** Stop once cumulative total tokens (input + output) reach this. */
    maxTotalTokens?: number;
    /** Stop once this many tool calls have been made across the run. */
    maxToolCalls?: number;
    /** Stop once estimated spend (USD) reaches this. Requires `pricing`. */
    maxCostUsd?: number;
    /** Token pricing used for the cost budget. */
    pricing?: ModelPricing;
}

interface UsageTotals {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
}

function sumUsage(steps: ReadonlyArray<StepResult<ToolSet>>): UsageTotals {
    return steps.reduce<UsageTotals>(
        (acc, step) => {
            const u = step.usage;
            const input = u?.inputTokens ?? 0;
            const output = u?.outputTokens ?? 0;
            acc.inputTokens += input;
            acc.outputTokens += output;
            acc.totalTokens += u?.totalTokens ?? input + output;
            return acc;
        },
        { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    );
}

function countToolCalls(steps: ReadonlyArray<StepResult<ToolSet>>): number {
    return steps.reduce((n, step) => n + (step.toolCalls?.length ?? 0), 0);
}

/** Estimated USD spend for the given usage at the given price. */
export function estimateCost(usage: UsageTotals, pricing: ModelPricing): number {
    return (
        (usage.inputTokens / 1_000_000) * pricing.inputPerMTok +
        (usage.outputTokens / 1_000_000) * pricing.outputPerMTok
    );
}

export function tokenBudget(maxTotalTokens: number): StopCondition<ToolSet> {
    return ({ steps }) => sumUsage(steps).totalTokens >= maxTotalTokens;
}

export function toolCallBudget(maxToolCalls: number): StopCondition<ToolSet> {
    return ({ steps }) => countToolCalls(steps) >= maxToolCalls;
}

export function costBudget(maxCostUsd: number, pricing: ModelPricing): StopCondition<ToolSet> {
    return ({ steps }) => estimateCost(sumUsage(steps), pricing) >= maxCostUsd;
}

/** Translate a BudgetConfig into the stop conditions it implies. */
export function resolveBudgetStops(budget: BudgetConfig): StopCondition<ToolSet>[] {
    const stops: StopCondition<ToolSet>[] = [];
    if (budget.maxTotalTokens != null) stops.push(tokenBudget(budget.maxTotalTokens));
    if (budget.maxToolCalls != null) stops.push(toolCallBudget(budget.maxToolCalls));
    if (budget.maxCostUsd != null && budget.pricing) {
        stops.push(costBudget(budget.maxCostUsd, budget.pricing));
    }
    return stops;
}

/**
 * Report which budgets are currently exceeded given the run's steps — used to
 * surface a human-readable "stopped: budget exceeded" notice after the loop
 * halts (the StopConditions themselves stay pure side-effect-free predicates).
 */
export function budgetBreaches(
    budget: BudgetConfig,
    steps: ReadonlyArray<StepResult<ToolSet>>,
): string[] {
    const usage = sumUsage(steps);
    const breaches: string[] = [];
    if (budget.maxTotalTokens != null && usage.totalTokens >= budget.maxTotalTokens) {
        breaches.push(`token budget (${budget.maxTotalTokens.toLocaleString()} tokens)`);
    }
    if (budget.maxToolCalls != null && countToolCalls(steps) >= budget.maxToolCalls) {
        breaches.push(`tool-call budget (${budget.maxToolCalls})`);
    }
    if (budget.maxCostUsd != null && budget.pricing && estimateCost(usage, budget.pricing) >= budget.maxCostUsd) {
        breaches.push(`cost budget ($${budget.maxCostUsd})`);
    }
    return breaches;
}
