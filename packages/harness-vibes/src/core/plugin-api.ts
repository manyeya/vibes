/**
 * The VibesPlugin API for the owned loop.
 *
 * This is the old {@link Plugin} contract with `prepareStep` renamed to
 * `prepareTurn` (same shape, clearer name now that WE own the turn). During
 * migration `VibesPlugin` EXTENDS `Plugin`, so every existing plugin already
 * satisfies it, and the agent fans out to `prepareTurn ?? prepareStep`. Leaf
 * plugins are ported to `prepareTurn` in Phase 2; the `prepareStep` alias and
 * the deprecated `onStreamReady` hook are removed in Phase 5.
 */

import type { LanguageModel, ModelMessage } from 'ai';
import type { Plugin } from './types';
import type { LoopStep } from './events';

/** Options passed to a plugin's `prepareTurn` before each model call. */
export interface PrepareTurnOptions {
    /** Steps completed so far this run. */
    steps: LoopStep[];
    /** Zero-based index of the step about to run. */
    stepNumber: number;
    /** The model that will be used (after any override). */
    model: LanguageModel;
    /** The pruned messages that will be sent this step. */
    messages: ModelMessage[];
    /** The system prompt assembled so far (base + prior plugin overrides). */
    system?: string;
}

/** A plugin's per-turn overrides. Merge rules live in the agent (see agent.ts). */
export interface PrepareTurnResult {
    model?: LanguageModel;
    toolChoice?: unknown;
    /** Narrow the active tool set; the agent intersects across plugins. */
    activeTools?: string[];
    system?: string;
    messages?: ModelMessage[];
    providerOptions?: Record<string, unknown>;
}

/**
 * A plugin for the owned loop. Extends the legacy {@link Plugin} so existing
 * plugins are valid VibesPlugins unchanged; `prepareTurn` is the going-forward
 * per-turn hook that supersedes `prepareStep`.
 */
export interface VibesPlugin extends Plugin {
    /**
     * Modify settings before a turn's model call (prune already applied). Return
     * void for side effects, or overrides the agent merges. Supersedes the
     * legacy `prepareStep`; the agent accepts either during migration.
     */
    prepareTurn?: (
        options: PrepareTurnOptions,
    ) => void | PrepareTurnResult | Promise<void | PrepareTurnResult>;
}
