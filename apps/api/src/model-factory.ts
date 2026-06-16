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

/**
 * A model offered in the UI selector. The free OpenRouter catalog is fetched
 * live (see {@link getAvailableModels}); this is also the shape of the curated
 * fallback used when the catalog can't be reached.
 */
export interface AvailableModel {
    id: string;
    label: string;
    free: boolean;
    /** Provider/family for grouping in the selector (e.g. "Google", "Qwen"). */
    group?: string;
    note?: string;
    /** USD per 1M input tokens (for session cost estimate). */
    priceIn?: number;
    /** USD per 1M output tokens. */
    priceOut?: number;
    /** Total context window in tokens (drives compression threshold). */
    contextWindow?: number;
}

/** Fallback window when a model isn't in the table / is unknown. */
export const DEFAULT_CONTEXT_WINDOW = 128_000;

/**
 * Curated fallback, used only when the OpenRouter catalog can't be fetched
 * (offline / no network). The paid Claude entry is always appended to the live
 * list too, as a reliable option when the free models are rate-limited.
 */
export const AVAILABLE_MODELS: AvailableModel[] = [
    { id: 'openai/gpt-oss-120b:free', label: 'GPT-OSS 120B', free: true, group: 'OpenAI', note: 'Strong tool use', priceIn: 0, priceOut: 0, contextWindow: 131_072 },
    { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet', free: false, group: 'Anthropic', note: 'Paid, most reliable', priceIn: 3, priceOut: 15, contextWindow: 200_000 },
];

// ============ OPENROUTER FREE-MODEL CATALOG ============

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const CATALOG_TTL_MS = 10 * 60 * 1000;

/** id → model, for sync lookups (override validation). Seeded with the curated
 *  fallback and enriched after each successful catalog fetch. This is the
 *  SELECTOR set (free + tool-capable only). */
const modelIndex = new Map<string, AvailableModel>();
for (const m of AVAILABLE_MODELS) modelIndex.set(m.id, m);

/**
 * id → context window (tokens) for EVERY model OpenRouter lists — not just the
 * free, tool-capable slice shown in the selector. The window gauge must resolve
 * correctly for any model the user is actually on (incl. paid ones, or a model
 * that dropped out of the free filter), so this is populated unfiltered. */
const windowIndex = new Map<string, number>();
for (const m of AVAILABLE_MODELS) if (m.contextWindow) windowIndex.set(m.id, m.contextWindow);

let catalogCache: { at: number; models: AvailableModel[] } | null = null;
let inflight: Promise<AvailableModel[]> | null = null;

const PROVIDER_LABELS: Record<string, string> = {
    google: 'Google',
    'meta-llama': 'Meta',
    meta: 'Meta',
    qwen: 'Qwen',
    mistralai: 'Mistral',
    deepseek: 'DeepSeek',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    nvidia: 'NVIDIA',
    microsoft: 'Microsoft',
    moonshotai: 'Moonshot',
    nousresearch: 'Nous',
    cognitivecomputations: 'Cognitive',
    'z-ai': 'Z.AI',
    thudm: 'THUDM',
    gryphe: 'Gryphe',
    sao10k: 'Sao10K',
    openchat: 'OpenChat',
    liquid: 'Liquid',
    arliai: 'ArliAI',
    tencent: 'Tencent',
    tngtech: 'TNG',
    featherless: 'Featherless',
    rekaai: 'Reka',
    inception: 'Inception',
    agentica: 'Agentica',
};

function prettyProvider(prefix: string): string {
    return (
        PROVIDER_LABELS[prefix] ??
        prefix.replace(/[-_]/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())
    );
}

/** Map a raw OpenRouter catalog entry to an {@link AvailableModel}, or null if
 *  it isn't a free, tool-capable model (the agent requires tool calling). */
function toAvailableModel(raw: any): AvailableModel | null {
    const id: unknown = raw?.id;
    if (typeof id !== 'string' || !id) return null;

    const pricing = raw.pricing ?? {};
    const isFree = (pricing.prompt === '0' && pricing.completion === '0') || id.endsWith(':free');
    if (!isFree) return null;

    // The whole app is tool-driven; skip models that can't call tools.
    const params: string[] = Array.isArray(raw.supported_parameters) ? raw.supported_parameters : [];
    if (!params.includes('tools')) return null;

    const prefix = id.split('/')[0] ?? 'other';
    const rawName: string = typeof raw.name === 'string' ? raw.name : id;
    const label =
        rawName.replace(/^[^:]+:\s*/, '').replace(/\s*\(free\)\s*$/i, '').trim() || id;
    const ctx = typeof raw.context_length === 'number' ? raw.context_length : undefined;

    return {
        id,
        label,
        free: true,
        group: prettyProvider(prefix),
        priceIn: 0,
        priceOut: 0,
        contextWindow: ctx,
        note: ctx && ctx >= 1_000_000 ? '1M context' : undefined,
    };
}

/** Fetch + cache the free, tool-capable slice of the OpenRouter catalog.
 *  Returns [] on any failure so callers fall back to the curated list. */
async function fetchFreeCatalog(): Promise<AvailableModel[]> {
    if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.models;
    if (inflight) return inflight;

    inflight = (async () => {
        try {
            const headers: Record<string, string> = { Accept: 'application/json' };
            if (process.env.OPENROUTER_API_KEY) {
                headers.Authorization = `Bearer ${process.env.OPENROUTER_API_KEY}`;
            }
            const res = await fetch(OPENROUTER_MODELS_URL, { headers });
            if (!res.ok) throw new Error(`OpenRouter /models responded ${res.status}`);
            const json = (await res.json()) as { data?: unknown[] };
            // Index the context window for EVERY listed model (unfiltered), so
            // getContextWindow resolves for any model the user is on — even paid
            // ones or models excluded from the free/tool-capable selector slice.
            for (const raw of json.data ?? []) {
                const id = (raw as { id?: unknown })?.id;
                const ctx = (raw as { context_length?: unknown })?.context_length;
                if (typeof id === 'string' && typeof ctx === 'number' && ctx > 0) {
                    windowIndex.set(id, ctx);
                }
            }
            const free = (json.data ?? [])
                .map(toAvailableModel)
                .filter((m): m is AvailableModel => m !== null)
                .sort(
                    (a, b) =>
                        (a.group ?? '').localeCompare(b.group ?? '') ||
                        a.label.localeCompare(b.label),
                );
            for (const m of free) modelIndex.set(m.id, m);
            catalogCache = { at: Date.now(), models: free };
            return free;
        } catch (err) {
            console.warn('[model-factory] Failed to fetch OpenRouter catalog:', (err as Error).message);
            return [];
        } finally {
            inflight = null;
        }
    })();

    return inflight;
}

/**
 * The full selector list: every free tool-capable OpenRouter model (grouped by
 * provider) plus the curated paid fallback. Falls back to {@link AVAILABLE_MODELS}
 * when the live catalog is unreachable.
 */
export async function getAvailableModels(): Promise<AvailableModel[]> {
    const free = await fetchFreeCatalog();
    if (free.length === 0) return AVAILABLE_MODELS;
    const seen = new Set(free.map((m) => m.id));
    const curatedExtras = AVAILABLE_MODELS.filter((m) => !seen.has(m.id));
    return [...free, ...curatedExtras];
}

/** Whether a model id is one we know about (from the catalog or the curated
 *  list). Falls back to a loose OpenRouter-id shape check so a freshly listed
 *  model the cache hasn't seen yet is still accepted. */
export function isKnownModelId(id: string): boolean {
    if (modelIndex.has(id)) return true;
    return /^[\w.-]+\/[\w.:-]+$/.test(id);
}

/** The model id the backend defaults to (env override, else the first curated). */
export function getDefaultModelId(): string {
    return process.env.OPENROUTER_MODEL || AVAILABLE_MODELS[0].id;
}

/** Context window (tokens) for a model id, with a safe default. Resolves from
 *  the unfiltered window index first (covers any OpenRouter model), then the
 *  curated/selector entries, then the default. */
export function getContextWindow(modelId?: string): number {
    if (!modelId) return DEFAULT_CONTEXT_WINDOW;
    return windowIndex.get(modelId) ?? modelIndex.get(modelId)?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
}

function resolveDefaultSpec(): ModelSpec {
    if (process.env.AI_GATEWAY_API_KEY) {
        return { provider: 'gateway', id: DEFAULT_GATEWAY_MODEL };
    }
    if (process.env.ZHIPU_API_KEY) {
        return { provider: 'zhipu', id: DEFAULT_ZHIPU_MODEL };
    }
    if (process.env.OPENROUTER_API_KEY) {
        return {
            provider: 'openrouter',
            id: process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL,
        };
    }
    if (process.env.OPENAI_API_KEY) {
        return { provider: 'openai', id: DEFAULT_OPENAI_MODEL };
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
