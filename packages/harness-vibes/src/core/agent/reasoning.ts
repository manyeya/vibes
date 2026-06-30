/**
 * Adaptive reasoning effort. AI SDK v7 exposes a model's "reasoning effort" via
 * provider-namespaced `providerOptions` (e.g. `@ai-sdk/openai`'s `reasoningEffort`,
 * OpenRouter's `reasoning.effort`). We pick an effort tier from the request's
 * apparent complexity and emit it for the providers used here — each provider
 * reads its own key and ignores foreign ones, and models without reasoning
 * support ignore it entirely, so no provider detection is needed.
 *
 * ponytail: the tier comes from a length + keyword heuristic on the user request
 * (plus a "recently erroring → think harder" bump). That's deliberately crude;
 * swap in a one-shot classifier or an explicit per-turn signal if it misfires.
 */

export type ReasoningTier = 'low' | 'medium' | 'high';

export interface AdaptiveReasoningConfig {
    /**
     * Also emit Anthropic `thinking` options. Off by default — Anthropic thinking
     * needs an explicit token budget and conflicts with `temperature`, so it's a
     * deliberate opt-in rather than something we turn on blindly.
     */
    enableAnthropicThinking?: boolean;
}

// Signals the request is hard → think harder.
const HARDER =
    /refactor|debug|architect|optimi[sz]|design|prove|analy[sz]|investigat|root cause|trade-?off|\bplan\b|complex|migrat|concurren|race condition|deadlock|security|algorithm/i;
// Signals the request is trivial → don't burn reasoning tokens.
const EASIER = /\b(rename|reformat|format|lint|list|show|read|print|echo|cat|ls|what is|define|spelling|typo)\b/i;

/**
 * Map a user request (+ whether the run is currently erroring) to a reasoning
 * tier. Pure and stable for a given turn, so effort doesn't thrash step-to-step.
 */
export function classifyComplexity(userText: string, hasRecentError = false): ReasoningTier {
    const text = userText ?? '';
    let tier: ReasoningTier = 'medium';
    if (HARDER.test(text) || text.length > 600) tier = 'high';
    else if (EASIER.test(text) && text.length < 120) tier = 'low';
    // Struggling (a fresh error this run) → escalate one notch.
    if (hasRecentError) tier = tier === 'low' ? 'medium' : 'high';
    return tier;
}

/** Provider-namespaced reasoning options for a tier (foreign keys are ignored). */
export function reasoningProviderOptions(
    tier: ReasoningTier,
    config: AdaptiveReasoningConfig = {},
): Record<string, unknown> {
    const opts: Record<string, unknown> = {
        openai: { reasoningEffort: tier },
        openrouter: { reasoning: { effort: tier } },
    };
    if (config.enableAnthropicThinking) {
        opts.anthropic = tier === 'low'
            ? { thinking: { type: 'disabled' } }
            : { thinking: { type: 'enabled', budgetTokens: tier === 'high' ? 8000 : 4000 } };
    }
    return opts;
}
