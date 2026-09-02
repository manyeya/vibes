/**
 * Wire types for out-of-process sub-agents.
 *
 * Everything here must survive `structuredClone` across a Bun IPC channel — so
 * no functions, no class instances, no LanguageModel objects. That is the whole
 * design constraint: the parent sends a *description* of the run, and the child
 * rebuilds the live objects on its side.
 *
 * The two things that cannot cross and how they're handled:
 *   - the model: sent as `{ resolverModule, resolverExport, modelSpec }` and
 *     rebuilt by dynamic-importing the consumer's own factory. The harness has
 *     no model factory of its own (providers live in the consuming app), so it
 *     cannot rebuild a model without being told how.
 *   - tools: never sent. The child rebuilds the sub-agent plugin set from
 *     `createSubAgentPlugins`, a pure function of serializable config. Tools
 *     passed as closures by a library consumer (`VibesAgentConfig.tools`) have
 *     no serializable form, so the parent falls back to in-process when any are
 *     registered rather than silently dropping them.
 */

import type { ExecutionResult } from './sub-agent';

/** How a child rebuilds the model. Supplied by the consumer, opaque to the harness. */
export interface ModelResolverSpec {
    /** Absolute path to a module exporting a model factory. */
    resolverModule: string;
    /** Named export to call. Defaults to `getModel`. */
    resolverExport?: string;
    /** Passed straight back to that factory — the harness never inspects it. */
    modelSpec: unknown;
}

/** Everything a child needs to run one delegation. Must be structured-cloneable. */
export interface SubAgentRunSpec extends ModelResolverSpec {
    delegationId: string;
    agentName: string;
    /** Fully-built system prompt, including the delegation contract. */
    systemPrompt: string;
    task: string;
    context?: Record<string, unknown>;
    relevantFiles?: string[];
    allowedTools?: string[];
    blockedTools?: string[];
    maxSteps: number;
    contextWindow: number;
    compressionRatio: number;
    workspaceDir: string;
    stateDir?: string;
    sessionId?: string;
    /** Nesting depth of this child (root delegation = 1), for the spawn-depth cap. */
    depth: number;
    maxDepth: number;
}

/** Parent → child. */
export type ParentMessage =
    | { type: 'run'; spec: SubAgentRunSpec }
    | { type: 'abort' };

/** Child → parent. */
export type ChildMessage =
    /** A raw model stream part, re-emitted by the parent through the scoped writer. */
    | { type: 'stream-part'; part: unknown }
    | { type: 'done'; result: ExecutionResult }
    /** The child failed before producing an ExecutionResult (bad spec, import failure, crash). */
    | { type: 'error'; message: string };
