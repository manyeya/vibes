/**
 * The VibesPlugin API for the owned loop.
 *
 * `VibesPlugin` EXTENDS the base {@link Plugin} contract (name, tools,
 * modifySystemPrompt, stream/error hooks) with `prepareTurn` — the per-turn
 * hook the agent fans out to before each model call. A plugin that needs to
 * influence a turn implements `VibesPlugin`; a plugin that only contributes
 * tools / a prompt section can implement the base `Plugin`.
 */

import type { LanguageModel, ModelMessage } from 'ai';
import type { Plugin } from '../types';
import type { LoopStep } from './loop-events';

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
 * A plugin for the owned loop: the base {@link Plugin} plus `prepareTurn`.
 */
export interface VibesPlugin extends Plugin {
    /**
     * Modify settings before a turn's model call (prune already applied). Return
     * void for side effects, or the overrides the agent merges across plugins.
     */
    prepareTurn?: (
        options: PrepareTurnOptions,
    ) => void | PrepareTurnResult | Promise<void | PrepareTurnResult>;
}
