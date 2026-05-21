/**
 * Agent factory. Builds DeepAgent instances for a given session, fully
 * decoupled from the in-memory registry and HTTP layer so tests and
 * alternative entry points can construct agents directly.
 *
 * Owns:
 *   - The default sub-agent roster (Planner, Librarian, etc.)
 *   - The default agent prompt + step/context limits
 *   - The model resolution path (currently delegates to a model factory)
 *   - Workspace setup for new sessions
 */

import { DeepAgent } from '../../../packages/harness-vibes/index';
import type { SubAgent } from '../../../packages/harness-vibes/index';
import { wrapLanguageModel, type LanguageModel } from 'ai';
import { devToolsMiddleware } from '@ai-sdk/devtools';
import { webSearch } from '@exalabs/ai-sdk';
import { mimoCodePrompt } from './prompts/mimo-code';
import { getModel, type ModelSpec } from './model-factory';

/**
 * The default roster of sub-agents shipped with every Mimo-Code session.
 * Tools listed in `allowedTools` must exist on the parent agent — they
 * are inherited via the SubAgentPlugin's tool whitelist mechanism.
 */
export const defaultSubAgents: SubAgent[] = [
    {
        name: 'Planner',
        description: 'Specialized in high-level task breakdown, recursive execution, and progress tracking.',
        systemPrompt: `You are Planner, the strategic logical core of the team.
        Your role is to break complex requests into exhaustive, actionable todo lists.`,
        mode: 'general-purpose',
        allowedTools: ['create_plan', 'generate_tasks', 'update_task', 'get_next_tasks', 'list_tasks', 'readFile', 'writeFile'],
        allowSubdelegation: false,
        artifactMode: 'always',
    },
    {
        name: 'Librarian',
        description: 'Focused on codebase documentation, design patterns, and systemic context.',
        systemPrompt: `You are Librarian. Your role is to maintain the "Source of Truth" for the project.`,
        mode: 'general-purpose',
        allowedTools: ['readFile', 'list_files'],
        allowSubdelegation: false,
        artifactMode: 'always',
    },
    {
        name: 'Explorer',
        description: 'Specialized in navigating large codebases and finding relevant files/logic.',
        systemPrompt: `You are Explorer. Your role is to map out the codebase and find exactly what is needed.`,
        mode: 'general-purpose',
        allowedTools: ['readFile', 'list_files', 'bash'],
        allowSubdelegation: false,
        artifactMode: 'always',
    },
    {
        name: 'Oracle',
        description: 'RAG-based knowledge retrieval and expert Q&A for the codebase.',
        systemPrompt: `You are Oracle. Your role is to answer complex questions about the system logic and architecture.`,
        mode: 'general-purpose',
        allowedTools: ['readFile', 'list_files', 'webSearch'],
        allowSubdelegation: false,
        artifactMode: 'always',
    },
    {
        name: 'SuperCoder',
        description: 'Elite Front End UI/UX Engineer and Creative Technologist.',
        systemPrompt: `You are SuperCoder, the master of implementation. Focus on stunning visuals, fluid interactions, and flawless performance.`,
        mode: 'general-purpose',
        allowedTools: ['readFile', 'writeFile', 'list_files', 'bash', 'activate_skill'],
        allowSubdelegation: false,
        artifactMode: 'always',
    },
    {
        name: 'BrowserAgent',
        description: 'Browser Automation with agent-browser for research and testing.',
        systemPrompt: `You are BrowserAgent. Your role is to interact with the web and verify the UI.`,
        mode: 'general-purpose',
        allowedTools: ['bash', 'activate_skill', 'readFile', 'writeFile'],
        allowSubdelegation: false,
        artifactMode: 'always',
    },
];

export interface CreateAgentOptions {
    /** Stable session identifier, used for workspace + SQLite scoping. */
    sessionId: string;
    /** Per-session workspace directory, owned by the harness session manager. */
    workspaceDir: string;
    /**
     * Optional model spec to override the env-driven default. Leave undefined
     * to let `model-factory.getModel()` pick based on environment.
     */
    modelSpec?: ModelSpec;
    /**
     * Optional override for the base language model. If supplied, it
     * shortcuts the model factory entirely. Useful in tests.
     */
    model?: LanguageModel;
    /**
     * Override `maxSteps`. Defaults to 60 (matches the previous inline config).
     */
    maxSteps?: number;
    /**
     * Override the verbatim-message cap. Defaults to 50 (raised from the old
     * value of 3 in PR 1).
     */
    maxContextMessages?: number;
    /**
     * If true, wraps the resolved model with @ai-sdk/devtools middleware.
     * Defaults to true to match historical behaviour; flip off for tests.
     */
    enableDevtools?: boolean;
}

/**
 * Build a DeepAgent for a session. Pure function (modulo model factory
 * lookups); does not register the result anywhere.
 */
export function createAgentForSession(options: CreateAgentOptions): DeepAgent {
    const baseModel = options.model ?? getModel(options.modelSpec);
    // `LanguageModel = string | LanguageModelV3 | LanguageModelV2` in AI
    // SDK v6. Our model factory returns concrete provider instances, but
    // some legacy providers (e.g. zhipu-ai-provider) still emit V2. We
    // pass through a single boundary cast here rather than spreading
    // version-specific branching through the wrap call site.
    type WrappableModel = Parameters<typeof wrapLanguageModel>[0]['model'];
    const model = options.enableDevtools === false
        ? baseModel
        : wrapLanguageModel({
            model: baseModel as unknown as WrappableModel,
            middleware: devToolsMiddleware(),
        });

    return new DeepAgent({
        model,
        systemPrompt: mimoCodePrompt,
        maxSteps: options.maxSteps ?? 60,
        // Verbatim window kept by the agent's pruneMessages fallback.
        // SummarizationPlugin (default-loaded by createDefaultPlugins) trims
        // and summarises earlier history *before* this threshold; raising
        // this protects flows where summarisation is not active (tests).
        maxContextMessages: options.maxContextMessages ?? 50,
        sessionId: options.sessionId,
        workspaceDir: options.workspaceDir,
        tools: {
            webSearch: webSearch() as any,
        },
        subAgents: defaultSubAgents,
    });
}
