import type { Plugin, PluginStreamContext, ToolsRequiringApprovalConfig } from '../types';
import { resolveApprovalPolicy, wrapToolExecute } from './tool-resolution';

export interface ToolRegistryConfig {
    /** Custom tool definitions supplied via agent config. */
    customTools: Record<string, unknown>;
    /** Per-tool approval policy (boolean / predicate / name→policy map). */
    toolsRequiringApproval: ToolsRequiringApprovalConfig;
    /** Allowlist — only these tools survive (applied after blockedTools). */
    allowedTools?: string[];
    /** Blocklist — removed even if allowed (takes precedence). */
    blockedTools?: string[];
    /** Retries for a failing tool before its error is surfaced. */
    maxRetries: number;
    /** Redact known secrets from tool results before they're returned/streamed (default true). */
    redactToolIO?: boolean;
}

/** Runtime hooks the wrapped tools need from the harness. */
export interface ToolRegistryDeps {
    getStreamContext: () => PluginStreamContext | undefined;
    logError: (toolName: string | undefined, error: string, context?: string) => void;
}

/**
 * Assembles the agent's effective tool set: plugin tools + custom tools, each
 * wrapped with retry + activity-feed instrumentation and an approval policy,
 * then filtered by the block/allow lists. Caches the result and only rebuilds
 * when the plugin set changes.
 *
 * Split out of the harness so tool wiring is one cohesive thing — the harness
 * just asks for `build(plugins, …)` and exposes the cache as its `tools`.
 */
export class ToolRegistry {
    private cache: Record<string, unknown> = {};
    /**
     * Plugin count the current cache was built from; `-1` = never built /
     * invalidated. Reused only when it still equals `plugins.length`, which
     * closes a constructor race where an early build runs before a subclass
     * finishes adding its default plugins.
     */
    private cacheVersion = -1;
    private owners: Record<string, string> = {};

    constructor(private config: ToolRegistryConfig) {}

    /** The most recently built tool set (the agent's `tools` getter returns this). */
    get cached(): Record<string, unknown> {
        return this.cache;
    }

    /** Drop the cache so the next build re-collects from plugins. */
    invalidate(): void {
        this.cache = {};
        this.cacheVersion = -1;
    }

    /**
     * Build (or return the cached) tool set for the given plugins. Pass
     * `allowedTools` to compute a one-off filtered set without touching the cache
     * (used when resolving a narrower set for a single call).
     */
    async build(
        plugins: Plugin[],
        deps: ToolRegistryDeps,
        allowedTools?: string[],
    ): Promise<Record<string, unknown>> {
        if (
            !allowedTools &&
            this.cacheVersion === plugins.length &&
            Object.keys(this.cache).length > 0
        ) {
            return this.cache;
        }

        const allTools: Record<string, unknown> = {};
        const owners: Record<string, string> = {};

        for (const plugin of plugins) {
            if (plugin.waitReady) await plugin.waitReady();
        }

        for (const plugin of plugins) {
            if (!plugin.tools) continue;
            for (const [toolName, toolDef] of Object.entries(plugin.tools)) {
                allTools[toolName] = toolDef;
                owners[toolName] = plugin.name;
            }
        }

        for (const [toolName, toolDef] of Object.entries(this.config.customTools)) {
            allTools[toolName] = toolDef;
            owners[toolName] ??= 'custom';
        }

        this.owners = owners;
        const approvalConfig = this.config.toolsRequiringApproval;
        const resolvedTools: Record<string, unknown> = {};

        for (const [toolName, toolDef] of Object.entries(allTools)) {
            const toolDefRecord = toolDef as Record<string, unknown>;
            const originalExecute = toolDefRecord.execute as
                | ((args: unknown, options: unknown) => Promise<unknown>)
                | undefined;
            const ownerName = this.owners[toolName] ?? 'custom';
            const resolvedNeedsApproval = resolveApprovalPolicy(approvalConfig, toolName, toolDefRecord);

            resolvedTools[toolName] = {
                ...(toolDef as Record<string, unknown>),
                ...(resolvedNeedsApproval !== undefined ? { needsApproval: resolvedNeedsApproval } : {}),
                execute: originalExecute
                    ? wrapToolExecute({
                        toolName,
                        ownerName,
                        originalExecute,
                        plugins,
                        maxRetries: this.config.maxRetries,
                        redactToolIO: this.config.redactToolIO ?? true,
                        getStreamContext: deps.getStreamContext,
                        logError: deps.logError,
                    })
                    : undefined,
            };
        }

        if (this.config.blockedTools) {
            for (const name of this.config.blockedTools) delete resolvedTools[name];
        }

        const effectiveAllowed = allowedTools ?? this.config.allowedTools;
        const allowedSet = effectiveAllowed ? new Set(effectiveAllowed) : undefined;
        if (allowedSet) {
            const filtered: Record<string, unknown> = {};
            for (const name of allowedSet) {
                if (resolvedTools[name]) filtered[name] = resolvedTools[name];
            }
            // A one-off `allowedTools` filter doesn't poison the shared cache.
            if (!allowedTools) this.store(filtered, plugins.length);
            return filtered;
        }

        this.store(resolvedTools, plugins.length);
        return resolvedTools;
    }

    private store(tools: Record<string, unknown>, version: number): void {
        this.cache = tools;
        this.cacheVersion = version;
    }
}
