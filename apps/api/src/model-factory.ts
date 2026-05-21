/**
 * Model factory. Resolves a `ModelSpec` (or env-driven default) into a
 * concrete AI SDK `LanguageModel` instance.
 *
 * Provider priority (when no spec is supplied):
 *   1. AI Gateway, if `AI_GATEWAY_API_KEY` is set — preferred path, gives
 *      one knob for all providers and is consistent with the AI SDK skill
 *      guidance.
 *   2. Zhipu, if `ZHIPU_API_KEY` is set — the historical default.
 *   3. OpenAI, if `OPENAI_API_KEY` is set — falls back to gpt-4o.
 *   4. OpenRouter, if `OPENROUTER_API_KEY` is set.
 *
 * Callers can override entirely with `getModel({provider, id})`.
 */

import { gateway, type LanguageModel } from 'ai';
import { openai } from '@ai-sdk/openai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createZhipu } from 'zhipu-ai-provider';

export type ProviderName = 'gateway' | 'openai' | 'anthropic' | 'openrouter' | 'zhipu';

export interface ModelSpec {
    provider: ProviderName;
    /** Provider-scoped model id, e.g. "anthropic/claude-sonnet-4-5", "gpt-4o", "glm-4.7-flash". */
    id: string;
}

const DEFAULT_GATEWAY_MODEL = 'anthropic/claude-sonnet-4-5';
const DEFAULT_OPENAI_MODEL = 'gpt-4o';
const DEFAULT_ZHIPU_MODEL = 'glm-4.7-flash';
const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-3.5-sonnet';

function resolveDefaultSpec(): ModelSpec {
    if (process.env.AI_GATEWAY_API_KEY) {
        return { provider: 'gateway', id: DEFAULT_GATEWAY_MODEL };
    }
    if (process.env.ZHIPU_API_KEY) {
        return { provider: 'zhipu', id: DEFAULT_ZHIPU_MODEL };
    }
    if (process.env.OPENAI_API_KEY) {
        return { provider: 'openai', id: DEFAULT_OPENAI_MODEL };
    }
    if (process.env.OPENROUTER_API_KEY) {
        return { provider: 'openrouter', id: DEFAULT_OPENROUTER_MODEL };
    }
    // Last-resort default: assume Zhipu (matches pre-existing behaviour
    // even though the API key may be missing). The provider will throw a
    // clear error on first call rather than failing at import time.
    return { provider: 'zhipu', id: DEFAULT_ZHIPU_MODEL };
}

/**
 * Resolve a `ModelSpec` (or env-driven default) into a LanguageModel.
 *
 * Anthropic is currently routed through the Gateway as the SDK does not
 * ship a direct `@ai-sdk/anthropic` import in this repo. To use direct
 * Anthropic, install the provider and extend the switch below.
 */
export function getModel(spec?: ModelSpec): LanguageModel {
    const resolved = spec ?? resolveDefaultSpec();

    switch (resolved.provider) {
        case 'gateway':
            // The `gateway` instance from 'ai' is a callable provider.
            return gateway(resolved.id);
        case 'openai':
            return openai(resolved.id);
        case 'anthropic':
            // Route Anthropic via gateway in absence of a direct provider.
            return gateway(resolved.id.startsWith('anthropic/') ? resolved.id : `anthropic/${resolved.id}`);
        case 'openrouter': {
            const provider = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
            // OpenRouter returns a typed chat model; AI SDK accepts it as LanguageModel.
            return provider.chat(resolved.id) as unknown as LanguageModel;
        }
        case 'zhipu': {
            const provider = createZhipu({
                baseURL: 'https://api.z.ai/api/paas/v4',
                apiKey: process.env.ZHIPU_API_KEY,
            });
            return provider(resolved.id) as unknown as LanguageModel;
        }
        default: {
            const exhaustive: never = resolved.provider;
            throw new Error(`Unknown model provider: ${String(exhaustive)}`);
        }
    }
}
