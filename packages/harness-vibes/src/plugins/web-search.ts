import { tool, type UIMessageStreamWriter } from "ai";
import z from "zod";
import {
    VibesUIMessage,
    Plugin,
    PluginStreamContext,
    createDataStreamWriter,
    type DataStreamWriter,
} from "../core/types";

/** A single normalised search hit, regardless of backend. */
export interface SearchResult {
    title: string;
    url: string;
    snippet?: string;
}

export interface SearchQueryOptions {
    numResults: number;
    signal?: AbortSignal;
}

/**
 * A pluggable web-search backend. Implement this to add a provider; the plugin
 * doesn't care which one it talks to.
 */
export interface SearchProvider {
    readonly name: string;
    search(query: string, options: SearchQueryOptions): Promise<SearchResult[]>;
}

// ============ BUILT-IN PROVIDERS ============

/** Exa (https://exa.ai) — semantic search with page contents. */
export class ExaProvider implements SearchProvider {
    readonly name = 'exa';
    constructor(private readonly apiKey: string) {}

    async search(query: string, { numResults, signal }: SearchQueryOptions): Promise<SearchResult[]> {
        const res = await fetch('https://api.exa.ai/search', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey },
            body: JSON.stringify({ query, numResults, contents: { text: { maxCharacters: 600 } } }),
            signal,
        });
        if (!res.ok) throw new Error(`Exa search failed (${res.status} ${res.statusText})`);
        const json = (await res.json()) as { results?: Array<{ title?: string; url: string; text?: string }> };
        return (json.results ?? []).map((r) => ({
            title: r.title || r.url,
            url: r.url,
            snippet: typeof r.text === 'string' ? r.text.trim().slice(0, 600) : undefined,
        }));
    }
}

/** Tavily (https://tavily.com) — search API tuned for LLMs. */
export class TavilyProvider implements SearchProvider {
    readonly name = 'tavily';
    constructor(private readonly apiKey: string) {}

    async search(query: string, { numResults, signal }: SearchQueryOptions): Promise<SearchResult[]> {
        const res = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ api_key: this.apiKey, query, max_results: numResults }),
            signal,
        });
        if (!res.ok) throw new Error(`Tavily search failed (${res.status} ${res.statusText})`);
        const json = (await res.json()) as { results?: Array<{ title?: string; url: string; content?: string }> };
        return (json.results ?? []).map((r) => ({
            title: r.title || r.url,
            url: r.url,
            snippet: r.content?.trim().slice(0, 600),
        }));
    }
}

/** Brave Search (https://brave.com/search/api). */
export class BraveProvider implements SearchProvider {
    readonly name = 'brave';
    constructor(private readonly apiKey: string) {}

    async search(query: string, { numResults, signal }: SearchQueryOptions): Promise<SearchResult[]> {
        const url = new URL('https://api.search.brave.com/res/v1/web/search');
        url.searchParams.set('q', query);
        url.searchParams.set('count', String(numResults));
        const res = await fetch(url, {
            headers: { Accept: 'application/json', 'X-Subscription-Token': this.apiKey },
            signal,
        });
        if (!res.ok) throw new Error(`Brave search failed (${res.status} ${res.statusText})`);
        const json = (await res.json()) as {
            web?: { results?: Array<{ title?: string; url: string; description?: string }> };
        };
        return (json.web?.results ?? []).map((r) => ({
            title: r.title || r.url,
            url: r.url,
            snippet: r.description,
        }));
    }
}

/**
 * Build every search backend the current environment can actually use, keyed
 * by id, plus the auto-selected default (first available in priority order:
 * explicit override → Exa → Tavily → Brave). An empty map means no backend is
 * configured and the plugin disables itself cleanly.
 */
export function buildProviderRegistry(explicit?: SearchProvider): {
    providers: Map<string, SearchProvider>;
    autoName?: string;
} {
    const providers = new Map<string, SearchProvider>();
    if (explicit) providers.set(explicit.name, explicit);
    if (process.env.EXA_API_KEY) providers.set('exa', new ExaProvider(process.env.EXA_API_KEY));
    if (process.env.TAVILY_API_KEY) providers.set('tavily', new TavilyProvider(process.env.TAVILY_API_KEY));
    const brave = process.env.BRAVE_API_KEY ?? process.env.BRAVE_SEARCH_API_KEY;
    if (brave) providers.set('brave', new BraveProvider(brave));

    // "Auto" prefers an explicit override, then env order.
    const autoName = explicit?.name ?? ['exa', 'tavily', 'brave'].find((id) => providers.has(id));
    return { providers, autoName };
}

/**
 * Pick a provider: an explicit one wins, otherwise auto-detect from env in
 * priority order (Exa → Tavily → Brave). Returns undefined when none is
 * configured, which lets the plugin disable itself cleanly.
 */
export function resolveSearchProvider(explicit?: SearchProvider): SearchProvider | undefined {
    const { providers, autoName } = buildProviderRegistry(explicit);
    return autoName ? providers.get(autoName) : undefined;
}

export interface WebSearchPluginConfig {
    /** Override provider auto-detection. */
    provider?: SearchProvider;
    /** Results to fetch when the model doesn't specify (default 8). */
    defaultNumResults?: number;
}

function truncate(value: string, max = 48): string {
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * Grants the agent a `webSearch` tool backed by any {@link SearchProvider}
 * (Exa / Tavily / Brave out of the box). Self-instruments its operation and
 * streams a `data-search` part so the UI can render a clickable sources card —
 * unlike a bare custom tool, whose results only ever reach the model.
 */
export default class WebSearchPlugin implements Plugin {
    name = 'WebSearchPlugin';
    private writer?: DataStreamWriter;
    private streamContext?: PluginStreamContext;
    private readonly providers: Map<string, SearchProvider>;
    private readonly autoName?: string;
    /** UI/API provider preference for this run; undefined = env auto-detect. */
    private preference?: string;
    private readonly defaultNumResults: number;

    constructor(config: WebSearchPluginConfig = {}) {
        const { providers, autoName } = buildProviderRegistry(config.provider);
        this.providers = providers;
        this.autoName = autoName;
        this.defaultNumResults = config.defaultNumResults ?? 8;
    }

    /** Whether any backend is configured. Callers can skip loading the plugin when false. */
    get isEnabled(): boolean {
        return this.providers.size > 0;
    }

    /**
     * The provider this run will use: the explicit UI/API preference when it's
     * actually configured, otherwise the auto-detected default. A preference for
     * an unconfigured backend falls back to auto rather than erroring — which is
     * exactly what the settings UI promises ("Auto falls back to whatever the
     * server is configured with").
     */
    private get activeProvider(): SearchProvider | undefined {
        if (this.preference && this.providers.has(this.preference)) {
            return this.providers.get(this.preference);
        }
        return this.autoName ? this.providers.get(this.autoName) : undefined;
    }

    /**
     * Set the preferred backend for subsequent runs (from the UI settings).
     * Pass 'auto' or undefined to revert to env auto-detection.
     */
    setProviderPreference(id?: string): void {
        this.preference = id && id !== 'auto' ? id : undefined;
    }

    onStreamContextReady(context: PluginStreamContext) {
        this.streamContext = context;
        this.writer = context.writer.withDefaults({ plugin: this.name });
    }

    onStreamReady(writer: UIMessageStreamWriter<VibesUIMessage>) {
        this.streamContext = undefined;
        this.writer = createDataStreamWriter(writer).withDefaults({ plugin: this.name });
    }

    get tools(): Record<string, import("ai").Tool> {
        return {
            webSearch: tool({
                description:
                    'Search the web for current, real-world information. Returns ranked results with title, URL and a snippet. Use it whenever the answer depends on up-to-date facts you cannot derive from the workspace.',
                inputSchema: z.object({
                    query: z.string().describe('The search query'),
                    numResults: z
                        .number()
                        .int()
                        .min(1)
                        .max(20)
                        .optional()
                        .describe('How many results to return (default 8)'),
                }),
                execute: async ({ query, numResults }, options?: { abortSignal?: AbortSignal }) => {
                    const operation = this.streamContext?.createOperation({
                        name: 'web-search',
                        toolName: 'webSearch',
                        plugin: this.name,
                    });
                    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                    const provider = this.activeProvider;

                    if (!provider) {
                        const error =
                            'Web search is not configured. Set EXA_API_KEY, TAVILY_API_KEY, or BRAVE_API_KEY.';
                        operation?.fail(error, { message: 'Web search unavailable' });
                        this.writer?.writeSearch(id, query, 'failed', { error });
                        return { error, results: [] as SearchResult[] };
                    }

                    operation?.milestone(`Searching the web for "${truncate(query)}"`, { phase: 'search' });
                    this.writer?.writeSearch(id, query, 'running', { provider: provider.name });

                    try {
                        const results = await provider.search(query, {
                            numResults: numResults ?? this.defaultNumResults,
                            signal: options?.abortSignal,
                        });
                        operation?.complete(
                            `Searched "${truncate(query)}" · ${results.length} result${results.length === 1 ? '' : 's'}`,
                            { phase: 'complete' },
                        );
                        this.writer?.writeSearch(id, query, 'complete', {
                            provider: provider.name,
                            results,
                            count: results.length,
                        });
                        return { query, provider: provider.name, results };
                    } catch (err) {
                        const message = err instanceof Error ? err.message : String(err);
                        operation?.fail(message, { message: 'Web search failed' });
                        this.writer?.writeSearch(id, query, 'failed', { provider: provider.name, error: message });
                        return { error: message, results: [] as SearchResult[] };
                    }
                },
            }),
        };
    }

    modifySystemPrompt(prompt: string): string {
        const provider = this.activeProvider;
        if (!provider) return prompt;
        return `${prompt}

## Web Search
You can call \`webSearch(query)\` to look up current information online (backend: ${provider.name}). Prefer it over guessing when a question depends on recent or external facts, and cite the useful sources by URL in your answer.`;
    }
}
